import { NextResponse } from "next/server";
import { runRosterSync } from "@/lib/sync/runRoster";

export async function POST() {
  try {
    const { syncRun } = await runRosterSync();
    return NextResponse.json({ sync_run: syncRun }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected roster sync error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
