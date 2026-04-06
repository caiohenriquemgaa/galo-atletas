import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseToCanonical } from "@/lib/parsers/fpfReportParser";
import { rebuildPlayerStats } from "@/lib/sumula/rebuildPlayerStats";
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
  CanonicalTeamSide,
  MatchKey,
  SumulaDocumentUpsert,
} from "@/lib/sumula/types";
import type { Database } from "@/lib/supabase/database.types";

const STORAGE_BUCKET = "match-reports";
const DOC_TYPE = "FPF_SUMULA";
const SOURCE = "FPF";
const PARSER_VERSION = "v1";
const INGEST_SOURCE = "FPF_SUMULA_CANONICAL";

type SyncDocumentRow = {
  id: string;
  match_id: string | null;
  match_key: MatchKey;
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

function normalizeName(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function isLineupRole(value: unknown): value is CanonicalLineupRole {
  return value === "STARTER" || value === "RESERVE" || value === "GK_STARTER" || value === "GK_RESERVE";
}

function stableEventUid(kind: string, matchKey: string, fields: Array<string | number | boolean | null | undefined>) {
  const payload = [kind, matchKey, ...fields.map((field) => (field === null || field === undefined ? "" : String(field)))].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function lineupRoleFromAthlete(athlete: CanonicalAthlete, fallback: CanonicalLineupRole) {
  return isLineupRole(athlete.role) ? athlete.role : fallback;
}

function toLineupRows(input: {
  documentId: string;
  matchId: string;
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
  matchId: string;
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
  matchId: string;
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
  matchId: string;
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
  matchId: string;
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

async function extractPdfRawText(buffer: Buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const parsed = await pdfParse(buffer);
  const text = parsed.text?.trim();
  if (!text) {
    throw new Error("PDF text extraction returned empty content.");
  }
  return text;
}

export async function syncFinishedMatchReport(
  supabase: SupabaseClient<Database>,
  input: {
    matchId: string;
    sumulaUrl: string;
  }
) {
  const response = await fetch(input.sumulaUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GaloAtletasSync/1.0)",
      Accept: "application/pdf",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not download sumula PDF (${response.status}).`);
  }

  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
  const storage_path = `sumulas/prod/${input.matchId}/${DOC_TYPE}.pdf`;

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storage_path, pdfBuffer, {
    upsert: true,
    contentType: "application/pdf",
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const payload: SumulaDocumentUpsert = {
    source: SOURCE,
    doc_type: DOC_TYPE,
    scope: "PROD",
    match_id: input.matchId,
    sandbox_match_id: null,
    match_key: `PROD:${input.matchId}` as MatchKey,
    storage_bucket: STORAGE_BUCKET,
    storage_path,
    parser_version: PARSER_VERSION,
    sha256,
    uploaded_at: new Date().toISOString(),
  };

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .upsert(payload, { onConflict: "source,doc_type,match_key" })
    .select("id,match_id,match_key")
    .single<SyncDocumentRow>();

  if (documentError || !document) {
    throw new Error(documentError?.message ?? "Could not upsert sumula document.");
  }

  const rawText = await extractPdfRawText(pdfBuffer);
  const canonical: CanonicalReport = parseToCanonical(rawText);

  const { error: saveDocumentError } = await supabase
    .from("documents")
    .update({
      raw_text: rawText,
      canonical_json: canonical,
      status: "CANONICAL",
      parse_error: null,
      parsed_at: new Date().toISOString(),
      canonical_at: new Date().toISOString(),
      sha256,
    })
    .eq("id", document.id);

  if (saveDocumentError) {
    throw new Error(`Could not persist canonical sumula: ${saveDocumentError.message}`);
  }

  const deleteResults = await Promise.all([
    supabase.from("match_goals").delete().eq("match_key", document.match_key),
    supabase.from("match_cards").delete().eq("match_key", document.match_key),
    supabase.from("match_substitutions").delete().eq("match_key", document.match_key),
    supabase.from("match_lineups").delete().eq("match_key", document.match_key),
  ]);
  const deleteError = deleteResults.find((result) => result.error)?.error;
  if (deleteError) {
    throw new Error(`Could not clear previous match events: ${deleteError.message}`);
  }

  const lineupRows = [
    ...toLineupRows({
      documentId: document.id,
      matchId: input.matchId,
      matchKey: document.match_key,
      side: "HOME",
      fallbackRole: "STARTER",
      athletes: canonical.lineups.home.starters,
    }),
    ...toLineupRows({
      documentId: document.id,
      matchId: input.matchId,
      matchKey: document.match_key,
      side: "HOME",
      fallbackRole: "RESERVE",
      athletes: canonical.lineups.home.reserves,
    }),
    ...toLineupRows({
      documentId: document.id,
      matchId: input.matchId,
      matchKey: document.match_key,
      side: "AWAY",
      fallbackRole: "STARTER",
      athletes: canonical.lineups.away.starters,
    }),
    ...toLineupRows({
      documentId: document.id,
      matchId: input.matchId,
      matchKey: document.match_key,
      side: "AWAY",
      fallbackRole: "RESERVE",
      athletes: canonical.lineups.away.reserves,
    }),
  ];

  const parsedEvents = parseCanonicalEvents({
    events: canonical.events,
    documentId: document.id,
    matchId: input.matchId,
    matchKey: document.match_key,
  });

  if (lineupRows.length > 0) {
    const { error } = await supabase.from("match_lineups").insert(lineupRows);
    if (error) throw new Error(`Could not insert lineup events: ${error.message}`);
  }

  if (parsedEvents.goals.length > 0) {
    const { error } = await supabase.from("match_goals").insert(parsedEvents.goals);
    if (error) throw new Error(`Could not insert goal events: ${error.message}`);
  }

  if (parsedEvents.cards.length > 0) {
    const { error } = await supabase.from("match_cards").insert(parsedEvents.cards);
    if (error) throw new Error(`Could not insert card events: ${error.message}`);
  }

  if (parsedEvents.substitutions.length > 0) {
    const { error } = await supabase.from("match_substitutions").insert(parsedEvents.substitutions);
    if (error) throw new Error(`Could not insert substitution events: ${error.message}`);
  }

  const { error: finalizeDocumentError } = await supabase
    .from("documents")
    .update({
      status: "EVENTS_SAVED",
      parse_error: null,
    })
    .eq("id", document.id);

  if (finalizeDocumentError) {
    throw new Error(`Could not finalize document status: ${finalizeDocumentError.message}`);
  }

  const statsResult = await rebuildPlayerStats(supabase, {
    match_key: document.match_key,
    document_id: document.id,
    match_id: document.match_id,
  });

  return {
    document_id: document.id,
    match_key: document.match_key,
    lineups_inserted: lineupRows.length,
    goals_inserted: parsedEvents.goals.length,
    cards_inserted: parsedEvents.cards.length,
    substitutions_inserted: parsedEvents.substitutions.length,
    stats_inserted: statsResult.inserted_rows,
  };
}
