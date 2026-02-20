import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SyncRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary_json: Record<string, unknown> | null;
  error_text: string | null;
};

type AthleteRow = {
  id: string;
  name: string;
};

type MatchRow = {
  id: string;
  match_date: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMinutes() {
  const p = Math.random();
  if (p < 0.7) return randomInt(60, 90);
  if (p < 0.9) return randomInt(30, 59);
  return randomInt(0, 29);
}

function rareZeroOneTwo() {
  const p = Math.random();
  if (p < 0.82) return 0;
  if (p < 0.98) return 1;
  return 2;
}

function rareCard() {
  return Math.random() < 0.14 ? 1 : 0;
}

function veryRareCard() {
  return Math.random() < 0.02 ? 1 : 0;
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

    const { data: athletes, error: athletesError } = await supabase
      .from("athletes")
      .select("id,name")
      .order("name", { ascending: true });

    if (athletesError) {
      throw new Error(athletesError.message);
    }

    const athleteRows = (athletes as AthleteRow[]) ?? [];

    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (athleteRows.length === 0) {
      const summary = {
        source: "MOCK",
        no_athletes: true,
        competitions_checked: 4,
        matches_found: 0,
        matches_imported: 0,
        athletes_considered: 0,
        stats_rows_upserted: 0,
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
    }

    const opponents = ["Maringá FC", "Operário", "Londrina", "Coritiba", "Athletico", "Cianorte"];
    const matchesToGenerate = randomInt(3, 5);

    let matchesImported = 0;
    let statsRowsUpserted = 0;

    for (let index = 0; index < matchesToGenerate; index += 1) {
      const daysAgo = index * 5 + randomInt(0, 4);
      const matchDate = new Date();
      matchDate.setDate(matchDate.getDate() - daysAgo);

      const { data: match, error: matchError } = await supabase
        .from("matches")
        .insert({
          competition_name: "MOCK - Paranaense",
          season_year: 2026,
          match_date: matchDate.toISOString().slice(0, 10),
          opponent: opponents[index % opponents.length],
          home: index % 2 === 0,
          goals_for: randomInt(0, 3),
          goals_against: randomInt(0, 3),
        })
        .select("id,match_date")
        .single<MatchRow>();

      if (matchError || !match) {
        throw new Error(matchError?.message ?? "Could not insert mock match.");
      }

      matchesImported += 1;

      const statsPayload = athleteRows.map((athlete) => ({
        match_id: match.id,
        athlete_id: athlete.id,
        minutes: generateMinutes(),
        goals: rareZeroOneTwo(),
        assists: Math.random() < 0.88 ? 0 : Math.random() < 0.97 ? 1 : 2,
        yellow_cards: rareCard(),
        red_cards: veryRareCard(),
      }));

      const { error: upsertError } = await supabase
        .from("match_player_stats")
        .upsert(statsPayload, { onConflict: "match_id,athlete_id" });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      statsRowsUpserted += statsPayload.length;
    }

    const summary = {
      source: "MOCK",
      competitions_checked: 4,
      matches_found: matchesImported,
      matches_imported: matchesImported,
      athletes_considered: athleteRows.length,
      stats_rows_upserted: statsRowsUpserted,
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
