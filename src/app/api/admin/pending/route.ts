import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PendingPayload = {
  match_id?: string;
  athlete_name_raw?: string | null;
  cbf_registry?: string | null;
};

type PendingRow = {
  id: string;
  source: string;
  kind: string;
  payload: PendingPayload;
  created_at: string;
  resolved_at: string | null;
};

type AthleteRow = {
  id: string;
  name: string;
  cbf_registry: string | null;
};

type ResolveBody = {
  pending_id?: string;
  athlete_id?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getServerSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

export async function GET() {
  try {
    const supabase = getServerSupabase();

    const [{ data: pendingData, error: pendingError }, { data: athletesData, error: athletesError }] = await Promise.all([
      supabase
        .from("sync_pending_links")
        .select("id,source,kind,payload,created_at,resolved_at")
        .eq("source", "FPF")
        .eq("kind", "athlete_stat")
        .is("resolved_at", null)
        .order("created_at", { ascending: true })
        .limit(500),
      supabase.from("athletes").select("id,name,cbf_registry").order("name", { ascending: true }).limit(1000),
    ]);

    if (pendingError || athletesError) {
      throw new Error(pendingError?.message ?? athletesError?.message ?? "Could not load pending links.");
    }

    return NextResponse.json(
      {
        pending: (pendingData as PendingRow[]) ?? [],
        athletes: (athletesData as AthleteRow[]) ?? [],
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected pending links error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getServerSupabase();
    const body = (await request.json()) as ResolveBody;

    const pendingId = body.pending_id?.trim();
    const athleteId = body.athlete_id?.trim();

    if (!pendingId || !athleteId) {
      return NextResponse.json({ error: "pending_id and athlete_id are required." }, { status: 400 });
    }

    const { data: pendingRow, error: pendingError } = await supabase
      .from("sync_pending_links")
      .select("id,kind,payload,resolved_at")
      .eq("id", pendingId)
      .maybeSingle<{ id: string; kind: string; payload: PendingPayload; resolved_at: string | null }>();

    if (pendingError) {
      throw new Error(pendingError.message);
    }

    if (!pendingRow) {
      return NextResponse.json({ error: "Pending item not found." }, { status: 404 });
    }

    if (pendingRow.resolved_at) {
      return NextResponse.json({ error: "Pending item is already resolved." }, { status: 409 });
    }
    if (pendingRow.kind !== "athlete_stat") {
      return NextResponse.json({ error: "Only athlete_stat pending items can be resolved here." }, { status: 400 });
    }

    const payload = pendingRow.payload ?? {};
    const matchId = payload.match_id?.trim();
    const athleteNameRaw = payload.athlete_name_raw?.trim();
    const cbfRegistry = payload.cbf_registry?.trim();

    if (!matchId) {
      return NextResponse.json({ error: "Pending payload missing match_id." }, { status: 400 });
    }
    if (!athleteNameRaw && !cbfRegistry) {
      return NextResponse.json({ error: "Pending payload missing athlete reference (name/cbf)." }, { status: 400 });
    }

    let query = supabase
      .from("match_player_stats")
      .select("id")
      .eq("match_id", matchId)
      .is("athlete_id", null);

    if (cbfRegistry) {
      query = query.eq("cbf_registry", cbfRegistry);
    }

    if (athleteNameRaw) {
      query = query.eq("athlete_name_raw", athleteNameRaw);
    }

    const { data: statRows, error: statsQueryError } = await query;

    if (statsQueryError) {
      throw new Error(statsQueryError.message);
    }

    const statIds = ((statRows as { id: string }[]) ?? []).map((row) => row.id);

    if (statIds.length === 0) {
      return NextResponse.json({ error: "No unresolved stat rows matched this pending payload." }, { status: 404 });
    }

    const { error: updateStatsError } = await supabase
      .from("match_player_stats")
      .update({ athlete_id: athleteId })
      .in("id", statIds);

    if (updateStatsError) {
      throw new Error(updateStatsError.message);
    }

    const { error: resolveError } = await supabase
      .from("sync_pending_links")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", pendingId);

    if (resolveError) {
      throw new Error(resolveError.message);
    }

    return NextResponse.json({ status: "resolved", updated_rows: statIds.length }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected pending resolve error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
