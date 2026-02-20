import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchCompetitionMatches } from "@/lib/sync/fpf/adapter";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isGaloMaringa(teamName: string) {
  const normalized = normalizeText(teamName);
  return normalized.includes("GALO") && normalized.includes("MARING");
}

function hashMatchesPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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

    for (const competition of activeCompetitions) {
      if (!competition.url_base) continue;

      competitionsChecked += 1;

      const normalizedMatches = await fetchCompetitionMatches(competition.url_base);
      matchesFound += normalizedMatches.length;

      const galoMatches = normalizedMatches.filter(
        (match) => isGaloMaringa(match.home_team) || isGaloMaringa(match.away_team)
      );

      const statePayload = galoMatches
        .map((match) => ({
          external_id: match.external_id,
          match_date: match.match_date.toISOString().slice(0, 10),
          home_team: match.home_team,
          away_team: match.away_team,
          goals_home: match.goals_home,
          goals_away: match.goals_away,
        }))
        .sort((a, b) => (a.external_id > b.external_id ? 1 : -1));

      const newHash = hashMatchesPayload(statePayload);

      const { data: currentState, error: stateError } = await supabase
        .from("sync_state")
        .select("competition_id,last_hash")
        .eq("competition_id", competition.id)
        .maybeSingle<SyncStateRow>();

      if (stateError) {
        throw new Error(stateError.message);
      }

      const nowIso = new Date().toISOString();

      if (currentState?.last_hash === newHash) {
        const { error: touchStateError } = await supabase.from("sync_state").upsert({
          competition_id: competition.id,
          last_hash: newHash,
          last_checked_at: nowIso,
        });

        if (touchStateError) {
          throw new Error(touchStateError.message);
        }

        continue;
      }

      if (galoMatches.length > 0) {
        const matchRows = galoMatches.map((match) => {
          const galoHome = isGaloMaringa(match.home_team);

          return {
            competition_name: competition.name,
            season_year: competition.season_year,
            match_date: match.match_date.toISOString().slice(0, 10),
            opponent: galoHome ? match.away_team : match.home_team,
            home: galoHome,
            goals_for: galoHome ? (match.goals_home ?? 0) : (match.goals_away ?? 0),
            goals_against: galoHome ? (match.goals_away ?? 0) : (match.goals_home ?? 0),
            external_match_id: match.external_id,
            source_url: match.details_url,
          };
        });

        const { error: upsertMatchesError } = await supabase.from("matches").upsert(matchRows, {
          onConflict: "competition_name,season_year,external_match_id",
        });

        if (upsertMatchesError) {
          throw new Error(upsertMatchesError.message);
        }

        matchesImported += matchRows.length;
      }

      const { error: upsertStateError } = await supabase.from("sync_state").upsert({
        competition_id: competition.id,
        last_hash: newHash,
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
