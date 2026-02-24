export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "API test route working",
    timestamp: new Date().toISOString()
  });
}
