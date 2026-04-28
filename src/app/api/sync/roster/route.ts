import { NextResponse } from "next/server";
import { runRosterSync } from "@/lib/sync/runRoster";
import { RUNNING_SYNC_ERROR } from "@/lib/sync/syncRun";

type SyncRequestBody = {
  competition_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const competitionId = typeof body.competition_id === "string" && body.competition_id ? body.competition_id : null;
    const { syncRun } = await runRosterSync({ competitionId });
    return NextResponse.json({ sync_run: syncRun }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected roster sync error.";
    return NextResponse.json({ error: message }, { status: message === RUNNING_SYNC_ERROR ? 409 : 500 });
  }
}
