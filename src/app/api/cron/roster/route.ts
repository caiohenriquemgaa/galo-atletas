export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { runRosterSync } from "@/lib/sync/runRoster";
import { RUNNING_SYNC_ERROR } from "@/lib/sync/syncRun";

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
    const { syncRun, summary } = await runRosterSync({ competitionId });
    return NextResponse.json(
      {
        status: syncRun.status,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected roster sync error.";
    return NextResponse.json({ status: "ERROR", error: message }, { status: message === RUNNING_SYNC_ERROR ? 409 : 500 });
  }
}
