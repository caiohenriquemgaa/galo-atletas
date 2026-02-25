export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import type { CanonicalAthlete, CanonicalReport, IngestDocumentRow, MatchKey } from "@/lib/sumula/types";
import type { SyncRunRow } from "@/lib/sync/runRoster";

type IngestStage =
  | "REQUEST"
  | "AUTH"
  | "LOAD_DOCUMENT"
  | "DELETE_EXISTING"
  | "INSERT_EVENTS"
  | "SAVE_DOCUMENT"
  | "SYNC_RUN";

type IngestApiError = {
  code: string;
  message: string;
  stage: IngestStage;
  documentId?: string;
};

type IngestBody = {
  documentId?: string;
};

type LineupInsertRow = {
  match_id: string | null;
  team_side: "HOME" | "AWAY";
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  role: "STARTER" | "RESERVE";
  is_captain: boolean;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type GoalInsertRow = {
  match_id: string | null;
  team_side: "HOME" | "AWAY";
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  half: 1 | 2;
  minute: number;
  kind: string;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type CardInsertRow = {
  match_id: string | null;
  team_side: "HOME" | "AWAY";
  athlete_id: string | null;
  athlete_name_raw: string | null;
  half: 1 | 2;
  minute: number;
  card_type: "YELLOW" | "RED" | "SECOND_YELLOW";
  reason: string | null;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type SubstitutionInsertRow = {
  match_id: string | null;
  team_side: "HOME" | "AWAY";
  half: 1 | 2;
  minute: number;
  athlete_out_id: string | null;
  athlete_in_id: string | null;
  athlete_out_name_raw: string | null;
  athlete_in_name_raw: string | null;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type CanonicalEventMap = {
  goals: GoalInsertRow[];
  cards: CardInsertRow[];
  substitutions: SubstitutionInsertRow[];
};

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildError(error: IngestApiError, status: number) {
  return NextResponse.json({ error }, { status });
}

function stableEventUid(kind: string, matchKey: string, fields: Array<string | number | boolean | null | undefined>) {
  const payload = [kind, matchKey, ...fields.map((field) => (field === null || field === undefined ? "" : String(field)))].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseCanonical(input: unknown): CanonicalReport | null {
  if (!input || typeof input !== "object") return null;
  const parsed = input as Partial<CanonicalReport>;
  if (!parsed.match_meta || !parsed.lineups || !Array.isArray(parsed.events)) return null;
  if (!parsed.lineups.home || !parsed.lineups.away) return null;
  if (!Array.isArray(parsed.lineups.home.starters) || !Array.isArray(parsed.lineups.home.reserves)) return null;
  if (!Array.isArray(parsed.lineups.away.starters) || !Array.isArray(parsed.lineups.away.reserves)) return null;
  return parsed as CanonicalReport;
}

function parseHalf(input: unknown): 1 | 2 | null {
  if (input === 1 || input === "1") return 1;
  if (input === 2 || input === "2") return 2;
  return null;
}

function parseMinute(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) return Math.floor(input);
  if (typeof input === "string" && /^\d{1,3}$/.test(input.trim())) return Number(input.trim());
  return null;
}

function parseTeamSide(input: unknown): "HOME" | "AWAY" | null {
  if (input === "HOME" || input === "AWAY") return input;
  if (typeof input === "string") {
    const upper = input.toUpperCase().trim();
    if (upper === "HOME" || upper === "AWAY") return upper;
  }
  return null;
}

function parseCanonicalEvents(input: {
  events: unknown[];
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
}): CanonicalEventMap {
  const goals: GoalInsertRow[] = [];
  const cards: CardInsertRow[] = [];
  const substitutions: SubstitutionInsertRow[] = [];

  for (const raw of input.events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    const eventType = typeof event.type === "string" ? event.type.toUpperCase().trim() : "";
    const teamSide = parseTeamSide(event.team_side);
    const half = parseHalf(event.half);
    const minute = parseMinute(event.minute);
    if (!teamSide || !half || minute === null) continue;

    if (eventType === "GOAL") {
      const athleteName = typeof event.athlete_name === "string" ? normalizeName(event.athlete_name) : "";
      const shirtNumber = typeof event.shirt_number === "number" ? event.shirt_number : null;
      const kind = typeof event.kind === "string" && event.kind.trim() ? event.kind.trim().toUpperCase() : "GOAL";
      goals.push({
        match_id: input.matchId,
        team_side: teamSide,
        athlete_id: null,
        athlete_name_raw: athleteName || null,
        cbf_registry: typeof event.cbf_registry === "string" ? event.cbf_registry.trim() || null : null,
        shirt_number: shirtNumber,
        half,
        minute,
        kind,
        source: "FPF_SUMULA_CANONICAL",
        document_id: input.documentId,
        match_key: input.matchKey,
        event_uid: stableEventUid("goal", input.matchKey, [teamSide, half, minute, kind, athleteName || ""]),
      });
      continue;
    }

    if (eventType === "CARD") {
      const cardTypeCandidate = typeof event.card_type === "string" ? event.card_type.toUpperCase().trim() : "";
      if (cardTypeCandidate !== "YELLOW" && cardTypeCandidate !== "RED" && cardTypeCandidate !== "SECOND_YELLOW") {
        continue;
      }
      const athleteName = typeof event.athlete_name === "string" ? normalizeName(event.athlete_name) : "";
      const reason = typeof event.reason === "string" ? normalizeName(event.reason) : null;
      cards.push({
        match_id: input.matchId,
        team_side: teamSide,
        athlete_id: null,
        athlete_name_raw: athleteName || null,
        half,
        minute,
        card_type: cardTypeCandidate,
        reason: reason || null,
        source: "FPF_SUMULA_CANONICAL",
        document_id: input.documentId,
        match_key: input.matchKey,
        event_uid: stableEventUid("card", input.matchKey, [teamSide, half, minute, cardTypeCandidate, athleteName || "", reason || ""]),
      });
      continue;
    }

    if (eventType === "SUBSTITUTION") {
      const athleteOut = typeof event.athlete_out_name === "string" ? normalizeName(event.athlete_out_name) : "";
      const athleteIn = typeof event.athlete_in_name === "string" ? normalizeName(event.athlete_in_name) : "";
      if (!athleteOut || !athleteIn) continue;
      substitutions.push({
        match_id: input.matchId,
        team_side: teamSide,
        half,
        minute,
        athlete_out_id: null,
        athlete_in_id: null,
        athlete_out_name_raw: athleteOut,
        athlete_in_name_raw: athleteIn,
        source: "FPF_SUMULA_CANONICAL",
        document_id: input.documentId,
        match_key: input.matchKey,
        event_uid: stableEventUid("substitution", input.matchKey, [teamSide, half, minute, athleteOut, athleteIn]),
      });
    }
  }

  return { goals, cards, substitutions };
}

function toLineupRows(input: {
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
  side: "HOME" | "AWAY";
  role: "STARTER" | "RESERVE";
  athletes: CanonicalAthlete[];
}) {
  return input.athletes
    .map((athlete) => {
      const athleteName = normalizeName(athlete.name ?? "");
      if (!athleteName) return null;

      const uid = stableEventUid("lineup", input.matchKey, [input.side, input.role, athleteName, athlete.shirt_number ?? "", false]);

      const row: LineupInsertRow = {
        match_id: input.matchId,
        team_side: input.side,
        athlete_id: null,
        athlete_name_raw: athleteName,
        cbf_registry: null,
        shirt_number: athlete.shirt_number ?? null,
        role: input.role,
        is_captain: false,
        source: "FPF_SUMULA_CANONICAL",
        document_id: input.documentId,
        match_key: input.matchKey,
        event_uid: uid,
      };
      return row;
    })
    .filter((row): row is LineupInsertRow => row !== null);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return buildError(
      {
        code: "SUMULA_INGEST_UNAUTHORIZED",
        message: "Unauthorized",
        stage: "AUTH",
      },
      401
    );
  }

  const supabase = getSupabaseAdmin();
  let runId: string | null = null;
  let documentId: string | undefined;
  let stage: IngestStage = "REQUEST";

  try {
    const body = (await request.json()) as IngestBody;
    documentId = body.documentId?.trim();

    if (!documentId || !isUuid(documentId)) {
      return buildError(
        {
          code: "SUMULA_INGEST_INVALID_INPUT",
          message: "documentId must be a valid UUID.",
          stage: "REQUEST",
          documentId,
        },
        400
      );
    }

    stage = "SYNC_RUN";
    const { data: run, error: runError } = await supabase
      .from("sync_runs")
      .insert({ status: "RUNNING" })
      .select("id")
      .single<{ id: string }>();

    if (runError || !run) {
      return buildError(
        {
          code: "SUMULA_INGEST_SYNC_RUN_CREATE_FAILED",
          message: "Could not create sync run.",
          stage: "SYNC_RUN",
          documentId,
        },
        500
      );
    }

    runId = run.id;
    console.info("[sumula.ingest] start", { documentId, runId });

    stage = "LOAD_DOCUMENT";
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id,match_id,match_key,status,canonical_json")
      .eq("id", documentId)
      .single<IngestDocumentRow>();

    if (documentError || !document) {
      throw new Error("Document not found.");
    }

    const canonical = parseCanonical(document.canonical_json);
    if (!canonical) {
      throw new Error("documents.canonical_json is missing or invalid.");
    }

    const matchKey = document.match_key;
    const matchId = document.match_id ?? null;

    stage = "DELETE_EXISTING";
    const deleteRequests = [
      supabase.from("match_goals").delete().eq("match_key", matchKey),
      supabase.from("match_cards").delete().eq("match_key", matchKey),
      supabase.from("match_substitutions").delete().eq("match_key", matchKey),
      supabase.from("match_lineups").delete().eq("match_key", matchKey),
    ];

    const deleteResults = await Promise.all(deleteRequests);
    const deleteError = deleteResults.find((result) => result.error)?.error;
    if (deleteError) {
      throw new Error(`Could not delete previous events for match_key: ${deleteError.message}`);
    }

    const lineupRows = [
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "HOME",
        role: "STARTER",
        athletes: canonical.lineups.home.starters,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "HOME",
        role: "RESERVE",
        athletes: canonical.lineups.home.reserves,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "AWAY",
        role: "STARTER",
        athletes: canonical.lineups.away.starters,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "AWAY",
        role: "RESERVE",
        athletes: canonical.lineups.away.reserves,
      }),
    ];

    const parsedEvents = parseCanonicalEvents({
      events: canonical.events,
      documentId,
      matchId,
      matchKey,
    });

    stage = "INSERT_EVENTS";
    if (lineupRows.length > 0) {
      const { error: lineupsError } = await supabase.from("match_lineups").insert(lineupRows);
      if (lineupsError) {
        throw new Error(`Could not insert lineup events: ${lineupsError.message}`);
      }
    }

    if (parsedEvents.goals.length > 0) {
      const { error: goalsError } = await supabase.from("match_goals").insert(parsedEvents.goals);
      if (goalsError) {
        throw new Error(`Could not insert goal events: ${goalsError.message}`);
      }
    }

    if (parsedEvents.cards.length > 0) {
      const { error: cardsError } = await supabase.from("match_cards").insert(parsedEvents.cards);
      if (cardsError) {
        throw new Error(`Could not insert card events: ${cardsError.message}`);
      }
    }

    if (parsedEvents.substitutions.length > 0) {
      const { error: substitutionsError } = await supabase.from("match_substitutions").insert(parsedEvents.substitutions);
      if (substitutionsError) {
        throw new Error(`Could not insert substitution events: ${substitutionsError.message}`);
      }
    }

    stage = "SAVE_DOCUMENT";
    const { error: saveDocumentError } = await supabase
      .from("documents")
      .update({
        status: "EVENTS_SAVED",
        parse_error: null,
      })
      .eq("id", documentId);

    if (saveDocumentError) {
      throw new Error(`Could not update document status: ${saveDocumentError.message}`);
    }

    const summary = {
      source: "SUMULA_INGEST",
      document_id: documentId,
      match_key: matchKey,
      lineups_inserted: lineupRows.length,
      goals_inserted: parsedEvents.goals.length,
      cards_inserted: parsedEvents.cards.length,
      substitutions_inserted: parsedEvents.substitutions.length,
    };

    const { data: doneRun, error: doneError } = await supabase
      .from("sync_runs")
      .update({
        status: "DONE",
        finished_at: new Date().toISOString(),
        summary_json: summary,
        error_text: null,
      })
      .eq("id", runId)
      .select("id,started_at,finished_at,status,summary_json,error_text")
      .single<SyncRunRow>();

    if (doneError || !doneRun) {
      throw new Error(doneError?.message ?? "Could not finalize sync run.");
    }

    console.info("[sumula.ingest] completed", { documentId, runId, lineups: lineupRows.length });
    return NextResponse.json(
      {
        ok: true,
        documentId,
        match_key: matchKey,
        status: "EVENTS_SAVED",
        inserted: {
          lineups: lineupRows.length,
          goals: parsedEvents.goals.length,
          cards: parsedEvents.cards.length,
          substitutions: parsedEvents.substitutions.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected ingest error.";
    const safeMessage = message.slice(0, 300);

    if (documentId && isUuid(documentId)) {
      await supabase
        .from("documents")
        .update({
          status: "ERROR",
          parse_error: safeMessage,
        })
        .eq("id", documentId);
    }

    if (runId) {
      stage = "SYNC_RUN";
      await supabase
        .from("sync_runs")
        .update({
          status: "ERROR",
          finished_at: new Date().toISOString(),
          error_text: safeMessage,
        })
        .eq("id", runId);
    }

    console.error("[sumula.ingest] failed", { documentId, runId, reason: safeMessage });
    return buildError(
      {
        code: "SUMULA_INGEST_FAILED",
        message: "Ingestion failed. Check server logs for details.",
        stage,
        documentId,
      },
      500
    );
  }
}
