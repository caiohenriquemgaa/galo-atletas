export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import type {
  CanonicalAthlete,
  CanonicalCardEvent,
  CanonicalCardPhase,
  CanonicalEvent,
  CanonicalGoalEvent,
  CanonicalLineupRole,
  CanonicalReport,
  CanonicalSubstitutionEvent,
  CanonicalSubstitutionPhase,
  IngestDocumentRow,
  MatchKey,
  CanonicalTeamSide,
} from "@/lib/sumula/types";
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
  team_side: CanonicalTeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  role: CanonicalLineupRole;
  is_captain: boolean;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type GoalInsertRow = {
  match_id: string | null;
  team_side: CanonicalTeamSide;
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
  team_side: CanonicalTeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  shirt_number: number | null;
  half: 1 | 2;
  minute: number;
  raw_phase: CanonicalCardPhase;
  card_type: "YELLOW" | "RED" | "SECOND_YELLOW";
  reason: string | null;
  source: string;
  document_id: string;
  match_key: MatchKey;
  event_uid: string;
};

type SubstitutionInsertRow = {
  match_id: string | null;
  team_side: CanonicalTeamSide;
  half: 1 | 2;
  minute: number;
  raw_phase: CanonicalSubstitutionPhase;
  athlete_out_id: string | null;
  athlete_in_id: string | null;
  athlete_out_name_raw: string | null;
  athlete_in_name_raw: string | null;
  athlete_out_shirt_number: number | null;
  athlete_in_shirt_number: number | null;
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

const INGEST_SOURCE = "FPF_SUMULA_CANONICAL";

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

function normalizeName(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function isLineupRole(value: unknown): value is CanonicalLineupRole {
  return value === "STARTER" || value === "RESERVE" || value === "GK_STARTER" || value === "GK_RESERVE";
}

function isTeamSide(value: unknown): value is CanonicalTeamSide {
  return value === "HOME" || value === "AWAY";
}

function isGoalEvent(value: unknown): value is CanonicalGoalEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalGoalEvent>;
  return (
    candidate.type === "GOAL" &&
    isTeamSide(candidate.team_side) &&
    (candidate.half === 1 || candidate.half === 2) &&
    typeof candidate.minute === "number" &&
    (candidate.raw_phase === "1T" || candidate.raw_phase === "2T") &&
    typeof candidate.athlete_name === "string"
  );
}

function isCardEvent(value: unknown): value is CanonicalCardEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalCardEvent>;
  return (
    candidate.type === "CARD" &&
    isTeamSide(candidate.team_side) &&
    (candidate.half === 1 || candidate.half === 2) &&
    typeof candidate.minute === "number" &&
    (candidate.raw_phase === "1T" || candidate.raw_phase === "2T" || candidate.raw_phase === "INT" || candidate.raw_phase === "POS") &&
    typeof candidate.athlete_name === "string" &&
    (candidate.card_type === "YELLOW" || candidate.card_type === "RED" || candidate.card_type === "SECOND_YELLOW")
  );
}

function isSubstitutionEvent(value: unknown): value is CanonicalSubstitutionEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalSubstitutionEvent>;
  return (
    candidate.type === "SUBSTITUTION" &&
    isTeamSide(candidate.team_side) &&
    (candidate.half === 1 || candidate.half === 2) &&
    typeof candidate.minute === "number" &&
    (candidate.raw_phase === "1T" || candidate.raw_phase === "2T" || candidate.raw_phase === "INT") &&
    typeof candidate.athlete_out_name === "string" &&
    typeof candidate.athlete_in_name === "string"
  );
}

function isCanonicalAthlete(value: unknown): value is CanonicalAthlete {
  if (!value || typeof value !== "object") return false;
  const athlete = value as Partial<CanonicalAthlete>;
  return typeof athlete.name === "string" && (athlete.shirt_number === null || typeof athlete.shirt_number === "number");
}

function parseCanonical(input: unknown): CanonicalReport | null {
  if (!input || typeof input !== "object") return null;

  const parsed = input as Partial<CanonicalReport>;
  if (!parsed.match_meta || !parsed.lineups || !Array.isArray(parsed.events)) return null;
  if (!parsed.lineups.home || !parsed.lineups.away) return null;
  if (!Array.isArray(parsed.lineups.home.starters) || !Array.isArray(parsed.lineups.home.reserves)) return null;
  if (!Array.isArray(parsed.lineups.away.starters) || !Array.isArray(parsed.lineups.away.reserves)) return null;

  const athletes = [
    ...parsed.lineups.home.starters,
    ...parsed.lineups.home.reserves,
    ...parsed.lineups.away.starters,
    ...parsed.lineups.away.reserves,
  ];

  if (!athletes.every((athlete) => isCanonicalAthlete(athlete))) return null;
  if (!parsed.events.every((event) => isGoalEvent(event) || isCardEvent(event) || isSubstitutionEvent(event))) return null;

  return parsed as CanonicalReport;
}

function lineupRoleFromAthlete(athlete: CanonicalAthlete, fallback: CanonicalLineupRole) {
  return isLineupRole(athlete.role) ? athlete.role : fallback;
}

function toLineupRows(input: {
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
  side: CanonicalTeamSide;
  fallbackRole: CanonicalLineupRole;
  athletes: CanonicalAthlete[];
}) {
  return input.athletes
    .map((athlete) => {
      const athleteName = normalizeName(athlete.full_name ?? athlete.name);
      if (!athleteName) return null;

      const role = lineupRoleFromAthlete(athlete, input.fallbackRole);
      const uid = stableEventUid("lineup", input.matchKey, [
        input.side,
        role,
        athleteName,
        athlete.shirt_number ?? "",
        athlete.cbf_registry ?? "",
        athlete.is_captain ?? false,
      ]);

      const row: LineupInsertRow = {
        match_id: input.matchId,
        team_side: input.side,
        athlete_id: null,
        athlete_name_raw: athleteName,
        cbf_registry: athlete.cbf_registry ?? null,
        shirt_number: athlete.shirt_number ?? null,
        role,
        is_captain: athlete.is_captain ?? false,
        source: INGEST_SOURCE,
        document_id: input.documentId,
        match_key: input.matchKey,
        event_uid: uid,
      };

      return row;
    })
    .filter((row): row is LineupInsertRow => row !== null);
}

function mapGoalEvent(input: {
  event: CanonicalGoalEvent;
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
}) {
  const athleteName = normalizeName(input.event.athlete_name);
  if (!athleteName) return null;

  const row: GoalInsertRow = {
    match_id: input.matchId,
    team_side: input.event.team_side,
    athlete_id: null,
    athlete_name_raw: athleteName,
    cbf_registry: input.event.cbf_registry ?? null,
    shirt_number: input.event.shirt_number ?? null,
    half: input.event.half,
    minute: input.event.minute,
    kind: input.event.kind,
    source: INGEST_SOURCE,
    document_id: input.documentId,
    match_key: input.matchKey,
    event_uid: stableEventUid("goal", input.matchKey, [
      input.event.team_side,
      input.event.raw_phase,
      input.event.half,
      input.event.minute,
      athleteName,
      input.event.shirt_number ?? "",
      input.event.cbf_registry ?? "",
      input.event.kind,
    ]),
  };

  return row;
}

function mapCardEvent(input: {
  event: CanonicalCardEvent;
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
}) {
  const athleteName = normalizeName(input.event.athlete_name);
  if (!athleteName) return null;

  const row: CardInsertRow = {
    match_id: input.matchId,
    team_side: input.event.team_side,
    athlete_id: null,
    athlete_name_raw: athleteName,
    shirt_number: input.event.shirt_number ?? null,
    half: input.event.half,
    minute: input.event.minute,
    raw_phase: input.event.raw_phase,
    card_type: input.event.card_type,
    reason: normalizeName(input.event.reason) || null,
    source: INGEST_SOURCE,
    document_id: input.documentId,
    match_key: input.matchKey,
    event_uid: stableEventUid("card", input.matchKey, [
      input.event.team_side,
      input.event.raw_phase,
      input.event.half,
      input.event.minute,
      athleteName,
      input.event.shirt_number ?? "",
      input.event.card_type,
      normalizeName(input.event.reason) || "",
    ]),
  };

  return row;
}

function mapSubstitutionEvent(input: {
  event: CanonicalSubstitutionEvent;
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
}) {
  const athleteOutName = normalizeName(input.event.athlete_out_name);
  const athleteInName = normalizeName(input.event.athlete_in_name);
  if (!athleteOutName || !athleteInName) return null;

  const row: SubstitutionInsertRow = {
    match_id: input.matchId,
    team_side: input.event.team_side,
    half: input.event.half,
    minute: input.event.minute,
    raw_phase: input.event.raw_phase,
    athlete_out_id: null,
    athlete_in_id: null,
    athlete_out_name_raw: athleteOutName,
    athlete_in_name_raw: athleteInName,
    athlete_out_shirt_number: input.event.athlete_out_shirt_number ?? null,
    athlete_in_shirt_number: input.event.athlete_in_shirt_number ?? null,
    source: INGEST_SOURCE,
    document_id: input.documentId,
    match_key: input.matchKey,
    event_uid: stableEventUid("substitution", input.matchKey, [
      input.event.team_side,
      input.event.raw_phase,
      input.event.half,
      input.event.minute,
      athleteOutName,
      input.event.athlete_out_shirt_number ?? "",
      athleteInName,
      input.event.athlete_in_shirt_number ?? "",
    ]),
  };

  return row;
}

function parseCanonicalEvents(input: {
  events: CanonicalEvent[];
  documentId: string;
  matchId: string | null;
  matchKey: MatchKey;
}): CanonicalEventMap {
  const goals = input.events
    .filter((event): event is CanonicalGoalEvent => event.type === "GOAL")
    .map((event) => mapGoalEvent({ event, ...input }))
    .filter((row): row is GoalInsertRow => row !== null);

  const cards = input.events
    .filter((event): event is CanonicalCardEvent => event.type === "CARD")
    .map((event) => mapCardEvent({ event, ...input }))
    .filter((row): row is CardInsertRow => row !== null);

  const substitutions = input.events
    .filter((event): event is CanonicalSubstitutionEvent => event.type === "SUBSTITUTION")
    .map((event) => mapSubstitutionEvent({ event, ...input }))
    .filter((row): row is SubstitutionInsertRow => row !== null);

  return { goals, cards, substitutions };
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
        fallbackRole: "STARTER",
        athletes: canonical.lineups.home.starters,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "HOME",
        fallbackRole: "RESERVE",
        athletes: canonical.lineups.home.reserves,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "AWAY",
        fallbackRole: "STARTER",
        athletes: canonical.lineups.away.starters,
      }),
      ...toLineupRows({
        documentId,
        matchId,
        matchKey,
        side: "AWAY",
        fallbackRole: "RESERVE",
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
