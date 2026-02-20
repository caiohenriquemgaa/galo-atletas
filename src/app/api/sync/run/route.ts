import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchCompetitionMatchesWithDebug } from "@/lib/sync/fpf/adapter";

type SyncRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary_json: Record<string, unknown> | null;
  error_text: string | null;
};

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
  goals_for: number;
  goals_against: number;
  source: "FPF";
  source_url: string;
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

export async function POST() {
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
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
      return NextResponse.json({ error: "Could not create sync run." }, { status: 500 });
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
    let rowsWithXFound = 0;
    let galoRowsFound = 0;

    for (const competition of activeCompetitions) {
      const competitionUrlBase = competition.url_base;
      if (!competitionUrlBase) continue;

      competitionsChecked += 1;

      const { matches, debug } = await fetchCompetitionMatchesWithDebug(competitionUrlBase);

      fetchedBytes += debug.fetched_bytes;
      anchorsFound += debug.anchors_found;
      rowsWithXFound += debug.rows_with_x_found;
      galoRowsFound += debug.galo_rows_found;

      matchesFound += matches.length;

      const importRows: MatchImportRow[] = matches.map((match) => {
        const galoHome = isGaloMaringa(match.home_team);
        const matchDateIso = match.match_date.toISOString().slice(0, 10);

        return {
          competition_name: competition.name,
          season_year: competition.season_year,
          match_date: matchDateIso,
          opponent: galoHome ? match.away_team : match.home_team,
          home: galoHome,
          goals_for: galoHome ? (match.goals_home ?? 0) : (match.goals_away ?? 0),
          goals_against: galoHome ? (match.goals_away ?? 0) : (match.goals_home ?? 0),
          source: "FPF",
          source_url: stableSourceUrl({
            competitionUrlBase,
            seasonYear: competition.season_year,
            matchDateIso,
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            detailsUrl: match.details_url,
          }),
        };
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

    const summary = {
      source: "FPF",
      competitions_checked: competitionsChecked,
      fetched_bytes: fetchedBytes,
      anchors_found: anchorsFound,
      rows_with_x_found: rowsWithXFound,
      galo_rows_found: galoRowsFound,
      matches_found: matchesFound,
      matches_imported: matchesImported,
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

    return NextResponse.json({ sync_run: doneRun }, { status: 200 });
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

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
