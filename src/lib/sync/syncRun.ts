import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const RUNNING_SYNC_ERROR =
  "Já existe uma sincronização em andamento. Aguarde finalizar ou encerre manualmente.";

export type SyncRunOptions = {
  competitionId?: string | null;
  force?: boolean;
  timeoutMs?: number;
};

export type CompetitionSummary = {
  competition_id: string;
  competition_name: string;
  category: string | null;
  season_year: number;
};

const configuredTimeoutMs = Number(process.env.SYNC_RUN_TIMEOUT_MS);
const DEFAULT_SYNC_TIMEOUT_MS =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 240_000;

export function getSyncTimeoutMs(options?: SyncRunOptions) {
  return options?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
}

export async function assertNoRunningSync(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("id")
    .eq("status", "RUNNING")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    throw new Error(RUNNING_SYNC_ERROR);
  }
}

export async function createSyncRun(supabase: SupabaseClient<Database>) {
  await assertNoRunningSync(supabase);

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ status: "RUNNING" })
    .select("id")
    .single<{ id: string }>();

  if (runError || !run) {
    throw new Error("Could not create sync run.");
  }

  return run.id;
}

export async function markSyncRunError(supabase: SupabaseClient<Database>, runId: string, message: string) {
  await supabase
    .from("sync_runs")
    .update({
      status: "ERROR",
      finished_at: new Date().toISOString(),
      error_text: message,
    })
    .eq("id", runId);
}

export async function withSyncTimeout<T>(work: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} excedeu o tempo limite de execução.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function buildCompetitionSummary(
  selectedCompetitionId: string | null | undefined,
  competitions: Array<{ id: string; name: string; category?: string | null; season_year: number }>
) {
  const selected = selectedCompetitionId ? competitions[0] : null;

  return {
    competition_id: selected?.id ?? selectedCompetitionId ?? null,
    competition_name: selected?.name ?? null,
    category: selected?.category ?? null,
    season_year: selected?.season_year ?? null,
    competitions: competitions.map((competition): CompetitionSummary => ({
      competition_id: competition.id,
      competition_name: competition.name,
      category: competition.category ?? null,
      season_year: competition.season_year,
    })),
  };
}
