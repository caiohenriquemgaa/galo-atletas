import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fetchCompetitionMatchesWithDebug, fetchMatchDetails } from "@/lib/sync/fpf/adapter";
import type { SyncRunRow } from "@/lib/sync/runRoster";

type CompetitionRow = {
  id: string;
  name: string;
  season_year: number;
  url_base: string | null;
  is_active: boolean;
};

type SyncStateRow = {
  competition_id: string;
  last_hash: string | null;
};

type MatchImportRow = {
  competition_name: string;
  season_year: number;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  source: "FPF";
  source_url: string;
  venue: string | null;
  kickoff_time: string | null;
  referee: string | null;
  home_team: string | null;
  away_team: string | null;
};

export type MatchesSyncSummary = {
  source: "FPF";
  competitions_checked: number;
  fetched_bytes: number;
  anchors_found: number;
  candidates_parsed: number;
  candidates_discarded_too_long: number;
  imported: number;
  rows_with_x_found: number;
  galo_rows_found: number;
  matches_found: number;
  matches_imported: number;
  details_attempted: number;
  details_succeeded: number;
  details_failed: number;
  matches_updated_with_score: number;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isGaloMaringa(teamName: string) {
  const normalized = normalizeText(teamName);
  return normalized.includes("GALO") && normalized.includes("MARINGA");
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function stableSourceUrl(input: {
  competitionUrlBase: string;
  seasonYear: number;
  matchDateIso: string;
  homeTeam: string;
  awayTeam: string;
  detailsUrl: string | null;
}) {
  if (input.detailsUrl) return input.detailsUrl;

  return `FPF:${input.competitionUrlBase}:${input.seasonYear}:${input.matchDateIso}:${normalizeText(
    input.homeTeam
  )}:${normalizeText(input.awayTeam)}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);

  return results;
}

export async function runMatchesSync(): Promise<{ syncRun: SyncRunRow; summary: MatchesSyncSummary }> {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let runId: string | null = null;

  try {
    const { data: run, error: runError } = await supabase
      .from("sync_runs")
      .insert({ status: "RUNNING" })
      .select("id")
      .single<{ id: string }>();

    if (runError || !run) {
      throw new Error("Could not create sync run.");
    }

    runId = run.id;

    const { data: competitions, error: competitionsError } = await supabase
      .from("competitions_registry")
      .select("id,name,season_year,url_base,is_active")
      .eq("is_active", true)
      .order("season_year", { ascending: false });

    if (competitionsError) {
      throw new Error(competitionsError.message);
    }

    const activeCompetitions = (competitions as CompetitionRow[]) ?? [];

    let competitionsChecked = 0;
    let matchesFound = 0;
    let matchesImported = 0;
    let fetchedBytes = 0;
    let anchorsFound = 0;
    let candidatesParsed = 0;
    let candidatesDiscardedTooLong = 0;
    let rowsWithXFound = 0;
    let galoRowsFound = 0;
    let detailsAttempted = 0;
    let detailsSucceeded = 0;
    let detailsFailed = 0;
    let matchesUpdatedWithScore = 0;

    for (const competition of activeCompetitions) {
      const competitionUrlBase = competition.url_base;
      if (!competitionUrlBase) continue;

      competitionsChecked += 1;

      const { matches, debug } = await fetchCompetitionMatchesWithDebug(competitionUrlBase);

      fetchedBytes += debug.fetched_bytes;
      anchorsFound += debug.anchors_found;
      candidatesParsed += debug.candidates_parsed;
      candidatesDiscardedTooLong += debug.candidates_discarded_too_long;
      rowsWithXFound += debug.rows_with_x_found;
      galoRowsFound += debug.galo_rows_found;

      matchesFound += matches.length;

      const detailedMatches = await mapWithConcurrency(matches, 3, async (match) => {
        if (!match.details_url) {
          return {
            ...match,
            details: null,
          };
        }

        detailsAttempted += 1;

        const details = await fetchMatchDetails(match.details_url);

        if (
          details.goals_home !== undefined ||
          details.goals_away !== undefined ||
          details.venue ||
          details.kickoff_time ||
          details.referee ||
          details.home_team ||
          details.away_team
        ) {
          detailsSucceeded += 1;
          if (details.goals_home !== undefined && details.goals_away !== undefined) {
            matchesUpdatedWithScore += 1;
          }
        } else {
          detailsFailed += 1;
        }

        return {
          ...match,
          details,
        };
      });

      const importRows = detailedMatches.flatMap((item): MatchImportRow[] => {
        const details = item.details;

        const resolvedHomeTeam = (details?.home_team ?? item.home_team).replace(/\s+/g, " ").trim();
        const resolvedAwayTeam = (details?.away_team ?? item.away_team).replace(/\s+/g, " ").trim();
        const galoHome = isGaloMaringa(resolvedHomeTeam);

        const goalsHome: number | null = details?.goals_home ?? item.goals_home ?? null;
        const goalsAway: number | null = details?.goals_away ?? item.goals_away ?? null;

        const matchDateIso = item.match_date.toISOString().slice(0, 10);
        const opponent = (galoHome ? resolvedAwayTeam : resolvedHomeTeam).replace(/\s+/g, " ").trim();
        const opponentNormalized = normalizeText(opponent);

        if (
          !opponent ||
          opponent.length > 60 ||
          opponentNormalized.includes("COOKIES") ||
          opponentNormalized.includes("FEDERACAO PARANAENSE")
        ) {
          return [];
        }

        return [{
          competition_name: competition.name,
          season_year: competition.season_year,
          match_date: matchDateIso,
          opponent,
          home: galoHome,
          goals_for: galoHome ? goalsHome : goalsAway,
          goals_against: galoHome ? goalsAway : goalsHome,
          source: "FPF" as const,
          source_url: stableSourceUrl({
            competitionUrlBase,
            seasonYear: competition.season_year,
            matchDateIso,
            homeTeam: resolvedHomeTeam,
            awayTeam: resolvedAwayTeam,
            detailsUrl: item.details_url,
          }),
          venue: details?.venue ?? null,
          kickoff_time: details?.kickoff_time ?? null,
          referee: details?.referee ?? null,
          home_team: resolvedHomeTeam,
          away_team: resolvedAwayTeam,
        }];
      });

      const stateHash = hashPayload(
        importRows
          .map((row) => ({
            source_url: row.source_url,
            match_date: row.match_date,
            opponent: row.opponent,
            home: row.home,
            goals_for: row.goals_for,
            goals_against: row.goals_against,
            venue: row.venue,
            kickoff_time: row.kickoff_time,
            referee: row.referee,
            home_team: row.home_team,
            away_team: row.away_team,
          }))
          .sort((a, b) => (a.source_url > b.source_url ? 1 : -1))
      );

      const { data: currentState, error: stateError } = await supabase
        .from("sync_state")
        .select("competition_id,last_hash")
        .eq("competition_id", competition.id)
        .maybeSingle<SyncStateRow>();

      if (stateError) {
        throw new Error(stateError.message);
      }

      const nowIso = new Date().toISOString();

      if (currentState?.last_hash === stateHash) {
        const { error: touchStateError } = await supabase.from("sync_state").upsert({
          competition_id: competition.id,
          last_hash: stateHash,
          last_checked_at: nowIso,
        });

        if (touchStateError) {
          throw new Error(touchStateError.message);
        }

        continue;
      }

      if (importRows.length > 0) {
        const { error: upsertError } = await supabase.from("matches").upsert(importRows, {
          onConflict: "source,source_url",
        });

        if (upsertError) {
          throw new Error(upsertError.message);
        }

        matchesImported += importRows.length;
      }

      const { error: upsertStateError } = await supabase.from("sync_state").upsert({
        competition_id: competition.id,
        last_hash: stateHash,
        last_checked_at: nowIso,
        last_changed_at: nowIso,
      });

      if (upsertStateError) {
        throw new Error(upsertStateError.message);
      }
    }

    const summary: MatchesSyncSummary = {
      source: "FPF",
      competitions_checked: competitionsChecked,
      fetched_bytes: fetchedBytes,
      anchors_found: anchorsFound,
      candidates_parsed: candidatesParsed,
      candidates_discarded_too_long: candidatesDiscardedTooLong,
      imported: matchesImported,
      rows_with_x_found: rowsWithXFound,
      galo_rows_found: galoRowsFound,
      matches_found: matchesFound,
      matches_imported: matchesImported,
      details_attempted: detailsAttempted,
      details_succeeded: detailsSucceeded,
      details_failed: detailsFailed,
      matches_updated_with_score: matchesUpdatedWithScore,
    };

    const { data: doneRun, error: doneError } = await supabase
      .from("sync_runs")
      .update({
        status: "DONE",
        finished_at: new Date().toISOString(),
        summary_json: summary,
        error_text: null,
      })
      .eq("id", runId)
      .select("id,started_at,finished_at,status,summary_json,error_text")
      .single<SyncRunRow>();

    if (doneError || !doneRun) {
      throw new Error(doneError?.message ?? "Could not finalize sync run.");
    }

    return {
      syncRun: doneRun,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected sync error.";

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "ERROR",
          finished_at: new Date().toISOString(),
          error_text: message,
        })
        .eq("id", runId);
    }

    throw new Error(message);
  }
}
