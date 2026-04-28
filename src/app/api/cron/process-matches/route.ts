export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { processPendingMatchesSync } from "@/lib/sync/runMatches";
import { RUNNING_SYNC_ERROR } from "@/lib/sync/syncRun";

type SyncRequestBody = {
  competition_id?: unknown;
};

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const competitionId = new URL(request.url).searchParams.get("competition_id");
    const { syncRun, summary } = await processPendingMatchesSync({ competitionId });
    return NextResponse.json(
      {
        status: syncRun.status,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected match processing error.";
    return NextResponse.json({ status: "ERROR", error: message }, { status: message === RUNNING_SYNC_ERROR ? 409 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const competitionId = typeof body.competition_id === "string" && body.competition_id ? body.competition_id : null;
    const { syncRun, summary } = await processPendingMatchesSync({ competitionId });
    return NextResponse.json(
      {
        status: syncRun.status,
        sync_run: syncRun,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected match processing error.";
    return NextResponse.json({ status: "ERROR", error: message }, { status: message === RUNNING_SYNC_ERROR ? 409 : 500 });
  }
}
