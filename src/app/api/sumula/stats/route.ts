export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rebuildPlayerStats } from "@/lib/sumula/rebuildPlayerStats";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import type { MatchKey } from "@/lib/sumula/types";
import type { SyncRunRow } from "@/lib/sync/runRoster";

type StatsStage = "REQUEST" | "AUTH" | "LOAD_DOCUMENT" | "REBUILD" | "SYNC_RUN";

type StatsBody = {
  match_key?: string;
  documentId?: string;
};

type StatsDocumentRow = {
  id: string;
  match_id: string | null;
  match_key: MatchKey;
};

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMatchKey(value: string): value is MatchKey {
  return /^(PROD|SANDBOX):[0-9a-f-]{36}$/i.test(value.trim());
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: { code: "SUMULA_STATS_UNAUTHORIZED", stage: "AUTH", message: "Unauthorized" } }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  let runId: string | null = null;
  let stage: StatsStage = "REQUEST";

  try {
    const body = (await request.json()) as StatsBody;
    const rawMatchKey = body.match_key?.trim();
    const documentId = body.documentId?.trim();

    if (!rawMatchKey && !documentId) {
      return NextResponse.json(
        { error: { code: "SUMULA_STATS_INVALID_INPUT", stage: "REQUEST", message: "Provide match_key or documentId." } },
        { status: 400 }
      );
    }

    if (documentId && !isUuid(documentId)) {
      return NextResponse.json(
        { error: { code: "SUMULA_STATS_INVALID_DOCUMENT_ID", stage: "REQUEST", message: "documentId must be a valid UUID." } },
        { status: 400 }
      );
    }

    if (rawMatchKey && !isMatchKey(rawMatchKey)) {
      return NextResponse.json(
        { error: { code: "SUMULA_STATS_INVALID_MATCH_KEY", stage: "REQUEST", message: "match_key must be PROD:<uuid> or SANDBOX:<uuid>." } },
        { status: 400 }
      );
    }

    stage = "SYNC_RUN";
    const { data: run, error: runError } = await supabase
      .from("sync_runs")
      .insert({ status: "RUNNING" })
      .select("id")
      .single<{ id: string }>();

    if (runError || !run) {
      throw new Error("Could not create sync run.");
    }

    runId = run.id;

    stage = "LOAD_DOCUMENT";
    let document: StatsDocumentRow | null = null;

    if (documentId) {
      const { data, error } = await supabase
        .from("documents")
        .select("id,match_id,match_key")
        .eq("id", documentId)
        .single<StatsDocumentRow>();

      if (error || !data) {
        throw new Error("Document not found.");
      }
      document = data;
    } else {
      const { data, error } = await supabase
        .from("documents")
        .select("id,match_id,match_key")
        .eq("match_key", rawMatchKey!)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle<StatsDocumentRow>();

      if (error || !data) {
        throw new Error("No document found for match_key.");
      }
      document = data;
    }

    stage = "REBUILD";
    const result = await rebuildPlayerStats(supabase, {
      match_key: document.match_key,
      document_id: document.id,
      match_id: document.match_id,
    });

    stage = "SYNC_RUN";
    const { data: doneRun, error: doneError } = await supabase
      .from("sync_runs")
      .update({
        status: "DONE",
        finished_at: new Date().toISOString(),
        summary_json: {
          source: "SUMULA_STATS_REBUILD",
          ...result,
        },
        error_text: null,
      })
      .eq("id", runId)
      .select("id,started_at,finished_at,status,summary_json,error_text")
      .single<SyncRunRow>();

    if (doneError || !doneRun) {
      throw new Error(doneError?.message ?? "Could not finalize sync run.");
    }

    return NextResponse.json(
      {
        ok: true,
        stage: "REBUILD",
        ...result,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected stats rebuild error.";
    const safeMessage = message.slice(0, 300);

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "ERROR",
          finished_at: new Date().toISOString(),
          error_text: safeMessage,
        })
        .eq("id", runId);
    }

    return NextResponse.json(
      {
        error: {
          code: "SUMULA_STATS_REBUILD_FAILED",
          stage,
          message: "Stats rebuild failed. Check server logs for details.",
        },
      },
      { status: 500 }
    );
  }
}
