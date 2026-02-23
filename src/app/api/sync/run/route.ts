import { NextResponse } from "next/server";
import { runMatchesSync } from "@/lib/sync/runMatches";

export async function POST() {
  try {
    const { syncRun } = await runMatchesSync();
    return NextResponse.json({ sync_run: syncRun }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected sync error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
