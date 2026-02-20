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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST() {
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Missing Supabase env vars." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let runId: string | null = null;

  try {
    const { data: insertedRun, error: insertError } = await supabase
      .from("sync_runs")
      .insert({ status: "RUNNING" })
      .select("id")
      .single<{ id: string }>();

    if (insertError || !insertedRun) {
      return NextResponse.json({ error: "Could not create sync run." }, { status: 500 });
    }

    runId = insertedRun.id;

    await new Promise((resolve) => {
      setTimeout(resolve, 1200);
    });

    const summary = {
      source: "MOCK",
      competitions_checked: 4,
      matches_found: 12,
      matches_imported: 12,
      players_linked: 0,
    };

    const { data: updatedRun, error: updateError } = await supabase
      .from("sync_runs")
      .update({
        status: "DONE",
        finished_at: new Date().toISOString(),
        summary_json: summary,
      })
      .eq("id", runId)
      .select("id,started_at,finished_at,status,summary_json,error_text")
      .single<SyncRunRow>();

    if (updateError || !updatedRun) {
      throw new Error(updateError?.message ?? "Could not finalize sync run.");
    }

    return NextResponse.json({ sync_run: updatedRun }, { status: 200 });
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
