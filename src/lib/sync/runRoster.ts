import { fetchEligibleAthletesWithDebug } from "@/lib/sync/fpf/roster";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import { extractCompetitionId, normalizeCompetitionUrlBase } from "@/lib/sync/fpf/url";

export type SyncRunRow = {
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
  category?: string | null;
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
  is_active_fpf: boolean;
  last_seen_at: string;
};

type ExistingAthleteRow = {
  id: string;
  cbf_registry: string;
};

export type RosterSyncSummary = {
  source: "FPF_ROSTER";
  comps_checked: number;
  rows_total: number;
  galo_rows: number;
  imported: number;
  updated: number;
};

export async function runRosterSync(): Promise<{ syncRun: SyncRunRow; summary: RosterSyncSummary }> {
  const supabase = getSupabaseAdmin();
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
      .select("id,name,category,url_base,is_active")
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

    const { error: prePassError } = await supabase
      .from("athletes")
      .update({ is_active_fpf: false })
      .eq("source", "FPF")
      .eq("club_name", "GALO MARINGA");

    if (prePassError) {
      throw new Error(prePassError.message);
    }

    for (const competition of activeCompetitions) {
      const competitionUrlBase = normalizeCompetitionUrlBase(competition.url_base, competition.category);
      if (!competitionUrlBase) continue;
      compsChecked += 1;

      const { athletes, debug } = await fetchEligibleAthletesWithDebug(competitionUrlBase);

      rowsTotal += debug.rows_total;
      galoRows += debug.galo_rows;

      if (athletes.length === 0) continue;

      const competitionId = extractCompetitionId(competitionUrlBase);
      const nowIso = new Date().toISOString();

      const importRows: AthleteImportRow[] = athletes.map((athlete) => ({
        source: "FPF",
        cbf_registry: athlete.cbf_registry,
        name: athlete.name,
        nickname: athlete.nickname,
        habilitation_date: athlete.habilitation_date || undefined,
        club_name: "GALO MARINGA",
        fpf_competition_id: competitionId,
        is_active_fpf: true,
        last_seen_at: nowIso,
      }));

      const cbfKeys = importRows.map((row) => row.cbf_registry);

      const { data: existingRows, error: existingError } = await supabase
        .from("athletes")
        .select("id,cbf_registry")
        .eq("source", "FPF")
        .in("cbf_registry", cbfKeys);

      if (existingError) {
        throw new Error(existingError.message);
      }

      const existingMap = new Map<string, string>(
        ((existingRows as ExistingAthleteRow[]) ?? []).map((row) => [row.cbf_registry, row.id])
      );
      const existingSet = new Set<string>(existingMap.keys());

      const newRows = importRows.filter((row) => !existingMap.has(row.cbf_registry));
      const updateRows = importRows
        .map((row) => ({
          id: existingMap.get(row.cbf_registry) ?? null,
          row,
        }))
        .filter((entry): entry is { id: string; row: AthleteImportRow } => !!entry.id);

      if (newRows.length > 0) {
        const { error: insertError } = await supabase.from("athletes").insert(newRows);
        if (insertError) {
          throw new Error(insertError.message);
        }
      }

      for (const entry of updateRows) {
        const { error: updateError } = await supabase
          .from("athletes")
          .update(entry.row)
          .eq("id", entry.id);

        if (updateError) {
          throw new Error(updateError.message);
        }
      }

      updated += existingSet.size;
      imported += newRows.length;
    }

    const summary: RosterSyncSummary = {
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

    return {
      syncRun: doneRun,
      summary,
    };
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

    throw new Error(message);
  }
}
