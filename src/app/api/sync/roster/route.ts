import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchEligibleAthletesWithDebug } from "@/lib/sync/fpf/roster";

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
  url_base: string | null;
  is_active: boolean;
};

type AthleteImportRow = {
  source: "FPF";
  cbf_registry: string;
  name: string;
  nickname: string;
  habilitation_date?: string;
  club_name: string;
  fpf_competition_id: string | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function extractCompetitionId(urlBase: string) {
  const clean = urlBase.replace(/\/+$/, "");
  const match = clean.match(/\/(\d+)$/);
  return match?.[1] ?? null;
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
      .select("id,name,url_base,is_active")
      .eq("is_active", true)
      .order("season_year", { ascending: false });

    if (competitionsError) {
      throw new Error(competitionsError.message);
    }

    const activeCompetitions = (competitions as CompetitionRow[]) ?? [];

    let compsChecked = 0;
    let imported = 0;
    let updated = 0;
    let rowsTotal = 0;
    let galoRows = 0;

    for (const competition of activeCompetitions) {
      if (!competition.url_base) continue;
      compsChecked += 1;

      const { athletes, debug } = await fetchEligibleAthletesWithDebug(competition.url_base);

      rowsTotal += debug.rows_total;
      galoRows += debug.galo_rows;

      if (athletes.length === 0) continue;

      const competitionId = extractCompetitionId(competition.url_base);

      const importRows: AthleteImportRow[] = athletes.map((athlete) => ({
        source: "FPF",
        cbf_registry: athlete.cbf_registry,
        name: athlete.name,
        nickname: athlete.nickname,
        habilitation_date: athlete.habilitation_date || undefined,
        club_name: "GALO MARINGA",
        fpf_competition_id: competitionId,
      }));

      const cbfKeys = importRows.map((row) => row.cbf_registry);

      const { data: existingRows, error: existingError } = await supabase
        .from("athletes")
        .select("cbf_registry")
        .eq("source", "FPF")
        .in("cbf_registry", cbfKeys);

      if (existingError) {
        throw new Error(existingError.message);
      }

      const existingSet = new Set<string>(((existingRows as { cbf_registry: string }[]) ?? []).map((row) => row.cbf_registry));

      const { error: upsertError } = await supabase.from("athletes").upsert(importRows, {
        onConflict: "source,cbf_registry",
      });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      updated += existingSet.size;
      imported += importRows.length - existingSet.size;
    }

    const summary = {
      source: "FPF_ROSTER",
      comps_checked: compsChecked,
      rows_total: rowsTotal,
      galo_rows: galoRows,
      imported,
      updated,
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
      throw new Error(doneError?.message ?? "Could not finalize roster sync run.");
    }

    return NextResponse.json({ sync_run: doneRun }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected roster sync error.";

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
