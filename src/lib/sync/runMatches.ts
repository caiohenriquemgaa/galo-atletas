import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCompetitionMatchesWithDebug, fetchMatchDetails } from "@/lib/sync/fpf/adapter";
import { linkAthlete } from "@/lib/linking/linkAthlete";
import { syncFinishedMatchReport } from "@/lib/sumula/syncFinishedMatchReport";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import { extractCompetitionId, extractMatchId, normalizeCompetitionUrlBase } from "@/lib/sync/fpf/url";
import type { SyncRunRow } from "@/lib/sync/runRoster";
import {
  buildCompetitionSummary,
  createSyncRun,
  getSyncTimeoutMs,
  markSyncRunError,
  type SyncRunOptions,
  withSyncTimeout,
} from "@/lib/sync/syncRun";

type CompetitionRow = {
  id: string;
  name: string;
  category?: string | null;
  season_year: number;
  url_base: string | null;
  fpf_competition_id?: string | null;
  external_competition_id?: string | null;
  is_active: boolean;
};

type SyncStateRow = {
  competition_id: string;
  last_hash: string | null;
};

type MatchImportRow = {
  competition_registry_id: string;
  competition_name: string;
  season_year: number;
  external_match_id: string;
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

type UpsertedMatchRow = {
  id: string;
  competition_registry_id?: string | null;
  competition_name?: string | null;
  season_year?: number | null;
  external_match_id?: string | null;
  source_url: string;
  match_date?: string;
  home?: boolean | null;
};

type PendingProcessMatchRow = {
  id: string;
  competition_name: string;
  season_year: number;
  source_url: string | null;
};

type MatchPlayerStatImportRow = {
  match_id: string;
  athlete_id: string | null;
  cbf_registry: string | null;
  athlete_name_raw: string | null;
  team_side: "HOME" | "AWAY";
  minutes: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  source: "MOCK";
};

type MockAthleteSeed = {
  cbf_registry: string | null;
  name: string;
};

type PendingAthleteStatPayload = {
  match_id: string;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
};

export type MatchesSyncSummary = {
  source: "FPF";
  competition_id?: string | null;
  competition_name?: string | null;
  category?: string | null;
  season_year?: number | null;
  competitions?: Array<{
    competition_id: string;
    competition_name: string;
    category: string | null;
    season_year: number;
  }>;
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
  players_linked: number;
  reports_synced: number;
  reports_failed: number;
};

export type ProcessMatchesSummary = {
  source: "FPF_PROCESS_MATCHES";
  competition_id?: string | null;
  competition_name?: string | null;
  category?: string | null;
  season_year?: number | null;
  competitions?: Array<{
    competition_id: string;
    competition_name: string;
    category: string | null;
    season_year: number;
  }>;
  max_matches_per_run: number;
  pending_loaded: number;
  processed: number;
  errors: number;
};

const MAX_MATCHES_PER_RUN = 3;

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

async function loadMockAthleteSeeds(supabase: SupabaseClient<Database>, competitionName: string, seasonYear: number) {
  const { data, error } = await supabase
    .from("athletes")
    .select("cbf_registry,name")
    .eq("club_name", "GALO MARINGA")
    .eq("is_active_fpf", true)
    .eq("competition_name", competitionName)
    .eq("season_year", seasonYear)
    .order("name", { ascending: true })
    .limit(11);

  if (error) {
    throw new Error(error.message);
  }

  return ((data as MockAthleteSeed[]) ?? []).filter((row) => !!row.name?.trim());
}

async function buildMockStatsRowsForMatches(
  supabase: SupabaseClient<Database>,
  matches: UpsertedMatchRow[],
  seeds: MockAthleteSeed[],
  competitionName: string,
  seasonYear: number
) {
  const rows: MatchPlayerStatImportRow[] = [];
  const pendingPayloads: PendingAthleteStatPayload[] = [];
  let linkedCount = 0;

  for (const match of matches) {
    const dedupeKeys = new Set<string>();

    for (const seed of seeds) {
      const athleteId = await linkAthlete({
        supabase,
        cbf_registry: seed.cbf_registry,
        name_raw: seed.name,
        competition_name: competitionName,
        season_year: seasonYear,
      });

      const dedupeKey = athleteId
        ? `athlete:${athleteId}`
        : `raw:${seed.cbf_registry ?? ""}:${seed.name.trim().toUpperCase()}`;

      if (dedupeKeys.has(dedupeKey)) continue;
      dedupeKeys.add(dedupeKey);

      if (athleteId) {
        linkedCount += 1;
      } else {
        pendingPayloads.push({
          match_id: match.id,
          athlete_name_raw: seed.name,
          cbf_registry: seed.cbf_registry,
        });
      }

      rows.push({
        match_id: match.id,
        athlete_id: athleteId,
        cbf_registry: seed.cbf_registry,
        athlete_name_raw: seed.name,
        team_side: match.home ? "HOME" : "AWAY",
        minutes: 0,
        goals: 0,
        assists: 0,
        yellow: 0,
        red: 0,
        source: "MOCK",
      });
    }
  }

  return {
    rows,
    pendingPayloads,
    linkedCount,
  };
}

function deriveExpectedCompetitionLabel(competition: Pick<CompetitionRow, "name" | "season_year">) {
  const baseName = competition.name.split(" - ")[0]?.trim() || competition.name;
  return normalizeText(baseName).includes(String(competition.season_year))
    ? normalizeText(baseName)
    : normalizeText(`${baseName} ${competition.season_year}`);
}

function extractSubCategory(value: string) {
  return normalizeText(value).match(/\bSUB[- ]?(\d{2})\b/)?.[1] ?? null;
}

function assertCompetitionPageMatches(input: {
  competition: CompetitionRow;
  competitionUrlBase: string;
  competitionId: string | null;
  pageCompetitionText: string;
}) {
  if (!input.competitionId) {
    throw new Error(
      `Competição ${input.competition.name} sem identificador FPF próprio em url_base: ${input.competitionUrlBase}`
    );
  }

  const expectedLabel = deriveExpectedCompetitionLabel(input.competition);
  const pageText = normalizeText(input.pageCompetitionText);
  const expectedSub = extractSubCategory(expectedLabel);
  const actualSub = extractSubCategory(pageText);

  if (expectedSub && actualSub && expectedSub !== actualSub) {
    throw new Error(
      `Página FPF incompatível para ${input.competition.name}: esperado SUB-${expectedSub}, recebido SUB-${actualSub} (${input.pageCompetitionText}).`
    );
  }

  if (!pageText.includes(expectedLabel)) {
    throw new Error(
      `Página FPF incompatível para ${input.competition.name}: texto da página "${input.pageCompetitionText}" não contém "${expectedLabel}".`
    );
  }
}

function stableExternalMatchId(input: {
  competitionId: string;
  matchDateIso: string;
  homeTeam: string;
  awayTeam: string;
  detailsUrl: string | null;
}) {
  const fromDetailsUrl = extractMatchId(input.detailsUrl);
  if (fromDetailsUrl) return fromDetailsUrl;

  return [
    input.competitionId,
    input.matchDateIso,
    normalizeText(input.homeTeam),
    normalizeText(input.awayTeam),
  ].join(":");
}

function matchImportKey(row: Pick<MatchImportRow, "competition_registry_id" | "season_year" | "external_match_id">) {
  return `${row.competition_registry_id}|${row.season_year}|${row.external_match_id}`;
}

function toMatchUpdateRow(row: MatchImportRow) {
  return {
    match_date: row.match_date,
    opponent: row.opponent,
    home: row.home,
    goals_for: row.goals_for,
    goals_against: row.goals_against,
    source: row.source,
    source_url: row.source_url,
    external_match_id: row.external_match_id,
    venue: row.venue,
    kickoff_time: row.kickoff_time,
    referee: row.referee,
    home_team: row.home_team,
    away_team: row.away_team,
    competition_registry_id: row.competition_registry_id,
  };
}

export async function runMatchesSync(options: SyncRunOptions = {}): Promise<{ syncRun: SyncRunRow; summary: MatchesSyncSummary }> {
  const supabase = getSupabaseAdmin();
  let runId: string | null = null;

  try {
    runId = await createSyncRun(supabase);

    let competitionsQuery = supabase
      .from("competitions_registry")
      .select("id,name,category,season_year,url_base,fpf_competition_id,external_competition_id,is_active")
      .eq("is_active", true)
      .order("season_year", { ascending: false });

    if (options.competitionId) {
      competitionsQuery = competitionsQuery.eq("id", options.competitionId);
    }

    const { data: competitions, error: competitionsError } = await competitionsQuery;

    if (competitionsError) {
      throw new Error(competitionsError.message);
    }

    const activeCompetitions = (competitions as CompetitionRow[]) ?? [];
    if (options.competitionId && activeCompetitions.length === 0) {
      throw new Error("Competição ativa não encontrada para sincronização.");
    }

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
    let playersLinked = 0;
    const reportsSynced = 0;
    const reportsFailed = 0;

    const summary = await withSyncTimeout(async () => {
      for (const competition of activeCompetitions) {
      const competitionUrlBase = normalizeCompetitionUrlBase(competition.url_base, competition.category);
      if (!competitionUrlBase) continue;
      const competitionId =
        competition.fpf_competition_id ?? competition.external_competition_id ?? extractCompetitionId(competitionUrlBase);
      if (!competitionId) {
        throw new Error(
          `Competição ${competition.name} sem identificador FPF próprio em url_base: ${competitionUrlBase}`
        );
      }

      competitionsChecked += 1;
      const mockSeeds = await loadMockAthleteSeeds(supabase, competition.name, competition.season_year);

      const { matches, debug } = await fetchCompetitionMatchesWithDebug(competitionUrlBase);
      assertCompetitionPageMatches({
        competition,
        competitionUrlBase,
        competitionId,
        pageCompetitionText: debug.page_competition_text,
      });

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

        const sourceUrl = stableSourceUrl({
          competitionUrlBase,
          seasonYear: competition.season_year,
          matchDateIso,
          homeTeam: resolvedHomeTeam,
          awayTeam: resolvedAwayTeam,
          detailsUrl: item.details_url,
        });
        const externalMatchId = stableExternalMatchId({
          competitionId,
          matchDateIso,
          homeTeam: resolvedHomeTeam,
          awayTeam: resolvedAwayTeam,
          detailsUrl: item.details_url,
        });

        return [{
          competition_registry_id: competition.id,
          competition_name: competition.name,
          season_year: competition.season_year,
          external_match_id: externalMatchId,
          match_date: matchDateIso,
          opponent,
          home: galoHome,
          goals_for: galoHome ? goalsHome : goalsAway,
          goals_against: galoHome ? goalsAway : goalsHome,
          source: "FPF" as const,
          source_url: sourceUrl,
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
            competition_registry_id: row.competition_registry_id,
            external_match_id: row.external_match_id,
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
      const existingMatchMap = new Map<string, string>();
      const conflictingExternalMatchIds = new Set<string>();

      if (importRows.length > 0) {
        const externalMatchIds = importRows.map((row) => row.external_match_id);
        const { data: existingMatches, error: existingMatchesError } = await supabase
          .from("matches")
          .select("id,competition_registry_id,competition_name,season_year,external_match_id,source_url,match_date")
          .eq("source", "FPF")
          .in("external_match_id", externalMatchIds);

        if (existingMatchesError) {
          throw new Error(existingMatchesError.message);
        }

        for (const row of ((existingMatches as UpsertedMatchRow[]) ?? [])) {
          if (!row.external_match_id) continue;

          const sameCompetition =
            row.competition_registry_id === competition.id ||
            (!row.competition_registry_id &&
              row.competition_name === competition.name &&
              row.season_year === competition.season_year);

          if (sameCompetition) {
            existingMatchMap.set(
              matchImportKey({
                competition_registry_id: competition.id,
                season_year: competition.season_year,
                external_match_id: row.external_match_id,
              }),
              row.id
            );
          } else {
            conflictingExternalMatchIds.add(row.external_match_id);
            console.warn("[sync.matches] external_match_id already exists in another competition; skipping import", {
              externalMatchId: row.external_match_id,
              currentCompetition: competition.name,
              existingCompetition: row.competition_name,
            });
          }
        }
      }

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
        const importableRows = importRows.filter((row) => !conflictingExternalMatchIds.has(row.external_match_id));
        const newRows = importableRows.filter((row) => !existingMatchMap.has(matchImportKey(row)));
        const updateRows = importableRows
          .map((row) => ({
            id: existingMatchMap.get(matchImportKey(row)) ?? null,
            row,
          }))
          .filter((entry): entry is { id: string; row: MatchImportRow } => !!entry.id);

        const importedMatchRows: UpsertedMatchRow[] = [];

        if (newRows.length > 0) {
          const { data: insertedMatches, error: insertError } = await supabase
            .from("matches")
            .insert(newRows)
            .select("id,external_match_id,source_url,home");

          if (insertError) {
            throw new Error(insertError.message);
          }

          const inserted = (insertedMatches as UpsertedMatchRow[]) ?? [];
          for (const row of inserted) {
            if (!row.external_match_id) continue;
            existingMatchMap.set(
              matchImportKey({
                competition_registry_id: competition.id,
                season_year: competition.season_year,
                external_match_id: row.external_match_id,
              }),
              row.id
            );
          }
          importedMatchRows.push(...inserted);
        }

        for (const entry of updateRows) {
          const { error: updateError } = await supabase
            .from("matches")
            .update(toMatchUpdateRow(entry.row))
            .eq("id", entry.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          existingMatchMap.set(matchImportKey(entry.row), entry.id);
          importedMatchRows.push({
            id: entry.id,
            source_url: entry.row.source_url,
            home: entry.row.home,
          });
        }

        if (importedMatchRows.length > 0 && mockSeeds.length > 0) {
          const { rows: statRows, pendingPayloads, linkedCount } = await buildMockStatsRowsForMatches(
            supabase,
            importedMatchRows,
            mockSeeds,
            competition.name,
            competition.season_year
          );

          if (statRows.length > 0) {
            const matchIds = Array.from(new Set(importedMatchRows.map((row) => row.id)));

            const { error: deleteStatsError } = await supabase
              .from("match_player_stats")
              .delete()
              .eq("source", "MOCK")
              .in("match_id", matchIds);

            if (deleteStatsError) {
              throw new Error(deleteStatsError.message);
            }

            const { error: insertStatsError } = await supabase.from("match_player_stats").insert(statRows);

            if (insertStatsError) {
              throw new Error(insertStatsError.message);
            }
          }

          if (pendingPayloads.length > 0) {
            const uniquePayloads = Array.from(
              new Map(
                pendingPayloads.map((payload) => [
                  `${payload.match_id}|${payload.cbf_registry ?? ""}|${payload.athlete_name_raw ?? ""}`,
                  payload,
                ])
              ).values()
            );

            const pendingRows = uniquePayloads.map((payload) => ({
              source: "FPF",
              kind: "athlete_stat",
              payload,
            }));

            const { error: pendingInsertError } = await supabase.from("sync_pending_links").insert(pendingRows);

            if (pendingInsertError) {
              throw new Error(pendingInsertError.message);
            }
          }

          playersLinked += linkedCount;
        }

        matchesImported += importedMatchRows.length;
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

      return {
        source: "FPF" as const,
        ...buildCompetitionSummary(options.competitionId, activeCompetitions),
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
        players_linked: playersLinked,
        reports_synced: reportsSynced,
        reports_failed: reportsFailed,
      };
    }, getSyncTimeoutMs(options), "Sync de jogos FPF");

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
      await markSyncRunError(supabase, runId, message);
    }

    throw new Error(message);
  }
}

export async function processPendingMatchesSync(
  options: SyncRunOptions = {}
): Promise<{ syncRun: SyncRunRow; summary: ProcessMatchesSummary }> {
  const supabase = getSupabaseAdmin();
  let runId: string | null = null;

  try {
    runId = await createSyncRun(supabase);

    let competitionsQuery = supabase
      .from("competitions_registry")
      .select("id,name,category,season_year,url_base,fpf_competition_id,external_competition_id,is_active")
      .eq("is_active", true)
      .order("season_year", { ascending: false });

    if (options.competitionId) {
      competitionsQuery = competitionsQuery.eq("id", options.competitionId);
    }

    const { data: competitions, error: competitionsError } = await competitionsQuery;

    if (competitionsError) {
      throw new Error(competitionsError.message);
    }

    const activeCompetitions = (competitions as CompetitionRow[]) ?? [];
    if (options.competitionId && activeCompetitions.length === 0) {
      throw new Error("Competição ativa não encontrada para processamento.");
    }

    const summary = await withSyncTimeout(async () => {
      let matchesQuery = supabase
        .from("matches")
        .select("id,competition_name,season_year,source_url")
        .eq("source", "FPF")
        .order("match_date", { ascending: true })
        .limit(MAX_MATCHES_PER_RUN);

      if (!options.force) {
        matchesQuery = matchesQuery.eq("processed", false);
      }

      const selectedCompetition = options.competitionId ? activeCompetitions[0] : null;

      if (selectedCompetition) {
        matchesQuery = matchesQuery
          .eq("competition_name", selectedCompetition.name)
          .eq("season_year", selectedCompetition.season_year);
      }

      const { data: pendingMatches, error: pendingError } = await matchesQuery;

      if (pendingError) {
        throw new Error(pendingError.message);
      }

      const matches = (pendingMatches as PendingProcessMatchRow[]) ?? [];
      let processed = 0;
      let errors = 0;

      for (const match of matches) {
        try {
          if (!match.source_url || match.source_url.startsWith("FPF:")) {
            throw new Error("URL de detalhes da partida não encontrada para buscar a súmula.");
          }

          const details = await fetchMatchDetails(match.source_url);

          if (!details.sumula_url) {
            throw new Error("Súmula ainda não disponível para esta partida.");
          }

          const reportResult = await syncFinishedMatchReport(supabase, {
            matchId: match.id,
            sumulaUrl: details.sumula_url,
          });

          const { error: updateError } = await supabase
            .from("matches")
            .update({
              processed: true,
              processed_at: new Date().toISOString(),
              processing_error: null,
              parser_used: reportResult.parser_used,
            })
            .eq("id", match.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          processed += 1;
        } catch (error) {
          errors += 1;
          const message = error instanceof Error ? error.message : "Erro inesperado ao processar partida.";

          const { error: updateError } = await supabase
            .from("matches")
            .update({
              processing_error: message,
              parser_used: "failed",
            })
            .eq("id", match.id);

          if (updateError) {
            console.error("[sync.matches] failed to persist processing error", {
              matchId: match.id,
              reason: updateError.message,
            });
          }

          console.error("[sync.matches] failed to process pending match", {
            matchId: match.id,
            sourceUrl: match.source_url,
            reason: message,
          });
        }
      }

      return {
        source: "FPF_PROCESS_MATCHES" as const,
        ...buildCompetitionSummary(options.competitionId, activeCompetitions),
        max_matches_per_run: MAX_MATCHES_PER_RUN,
        pending_loaded: matches.length,
        processed,
        errors,
      };
    }, getSyncTimeoutMs(options), "Processamento de súmulas FPF");

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
      throw new Error(doneError?.message ?? "Could not finalize match processing sync run.");
    }

    return {
      syncRun: doneRun,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected match processing error.";

    if (runId) {
      await markSyncRunError(supabase, runId, message);
    }

    throw new Error(message);
  }
}
