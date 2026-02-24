export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { runMatchesSync } from "@/lib/sync/runMatches";

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { syncRun, summary } = await runMatchesSync();
    return NextResponse.json(
      {
        status: syncRun.status,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected sync error.";
    return NextResponse.json({ status: "ERROR", error: message }, { status: 500 });
  }
}
