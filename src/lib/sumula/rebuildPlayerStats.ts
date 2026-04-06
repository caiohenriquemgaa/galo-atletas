import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { linkAthlete } from "@/lib/linking/linkAthlete";
import type { Database } from "@/lib/supabase/database.types";
import type { CanonicalCardPhase, CanonicalSubstitutionPhase, MatchKey } from "@/lib/sumula/types";

type TeamSide = "HOME" | "AWAY";

type LineupRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  role: string;
  is_captain: boolean;
};

type GoalRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  half: number;
  minute: number;
  kind: string;
};

type CardRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  shirt_number: number | null;
  half: number;
  minute: number;
  raw_phase: CanonicalCardPhase | null;
  card_type: "YELLOW" | "RED" | "SECOND_YELLOW";
};

type SubstitutionRow = {
  match_id: string | null;
  team_side: TeamSide;
  half: number;
  minute: number;
  raw_phase: CanonicalSubstitutionPhase | null;
  athlete_out_id: string | null;
  athlete_in_id: string | null;
  athlete_out_name_raw: string | null;
  athlete_in_name_raw: string | null;
  athlete_out_shirt_number: number | null;
  athlete_in_shirt_number: number | null;
};

type MatchClockDocumentRow = {
  canonical_json: {
    match_meta?: {
      clock?: {
        official_total_minutes?: number | null;
      } | null;
    } | null;
  } | null;
};

type PlayerInterval = {
  start: number;
  end: number;
  reason: string;
};

type PlayerAccumulator = {
  key: string;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  shirt_number: number | null;
  started: boolean;
  is_captain: boolean;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  intervals: PlayerInterval[];
  active_from: number | null;
  participated_observed: boolean;
  was_subbed_in: boolean;
};

type StatsInsertRow = {
  match_id: string | null;
  athlete_id: string | null;
  cbf_registry: string | null;
  athlete_name_raw: string | null;
  minutes: number;
  minutes_played: number;
  started: boolean;
  is_captain: boolean;
  participated: boolean;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  yellow_cards: number;
  red_cards: number;
  team_side: TeamSide;
  source: "DERIVED";
  updated_at: string;
  document_id: string | null;
  match_key: MatchKey;
  event_uid: string;
};

export type RebuildPlayerStatsResult = {
  match_key: MatchKey;
  document_id: string | null;
  match_id: string | null;
  deleted_rows: number;
  inserted_rows: number;
};

function normalizeName(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean : null;
}

function clampMinute(value: number, totalMinutes: number) {
  return Math.max(0, Math.min(totalMinutes, Math.floor(value)));
}

function getMatchTotalMinutes(input: { officialTotalMinutes: number | null; strategy?: "default" | "official" }) {
  // For now the product rule is still "close at 90", but the helper already supports switching to official time later.
  if (input.strategy === "official" && typeof input.officialTotalMinutes === "number" && input.officialTotalMinutes >= 90) {
    return input.officialTotalMinutes;
  }
  return 90;
}

function toAbsoluteMinute(input: {
  half: number;
  minute: number;
  rawPhase?: CanonicalCardPhase | CanonicalSubstitutionPhase | null;
  totalMinutes: number;
}) {
  if (input.rawPhase === "INT") return 45;
  if (input.rawPhase === "POS") return input.totalMinutes;

  const baseOffset = input.half === 2 ? 45 : 0;
  return clampMinute(baseOffset + Math.max(0, input.minute), input.totalMinutes);
}

function stableUid(matchKey: string, fields: Array<string | number | null>) {
  return createHash("sha256")
    .update(["player_stats", matchKey, ...fields.map((field) => (field === null ? "" : String(field)))].join("|"))
    .digest("hex");
}

function createAliasKeys(input: {
  teamSide: TeamSide;
  athleteId: string | null;
  athleteNameRaw: string | null;
  cbfRegistry: string | null;
  shirtNumber: number | null;
}) {
  const normalizedName = normalizeName(input.athleteNameRaw);
  const keys: string[] = [];

  if (input.athleteId) keys.push(`id:${input.athleteId}`);
  if (input.cbfRegistry) keys.push(`cbf:${input.teamSide}:${input.cbfRegistry}`);
  if (input.shirtNumber !== null) keys.push(`shirt:${input.teamSide}:${input.shirtNumber}`);
  if (input.shirtNumber !== null && normalizedName) keys.push(`shirt-name:${input.teamSide}:${input.shirtNumber}:${normalizedName.toUpperCase()}`);
  if (normalizedName) keys.push(`name:${input.teamSide}:${normalizedName.toUpperCase()}`);

  return keys;
}

function createCanonicalKey(input: {
  teamSide: TeamSide;
  athleteId: string | null;
  athleteNameRaw: string | null;
  cbfRegistry: string | null;
  shirtNumber: number | null;
}) {
  return (
    createAliasKeys(input)[0] ??
    `unknown:${input.teamSide}:${Math.random().toString(36).slice(2)}`
  );
}

function ensurePlayer(
  players: Map<string, PlayerAccumulator>,
  aliases: Map<string, string>,
  input: {
    team_side: TeamSide;
    athlete_id: string | null;
    athlete_name_raw: string | null;
    cbf_registry: string | null;
    shirt_number: number | null;
  }
) {
  const aliasKeys = createAliasKeys({
    teamSide: input.team_side,
    athleteId: input.athlete_id,
    athleteNameRaw: input.athlete_name_raw,
    cbfRegistry: input.cbf_registry,
    shirtNumber: input.shirt_number,
  });

  const existingKey = aliasKeys.map((alias) => aliases.get(alias)).find((key): key is string => !!key);
  if (existingKey) {
    const existing = players.get(existingKey);
    if (!existing) return null;
    existing.athlete_id = existing.athlete_id ?? input.athlete_id;
    existing.athlete_name_raw = existing.athlete_name_raw ?? normalizeName(input.athlete_name_raw);
    existing.cbf_registry = existing.cbf_registry ?? (input.cbf_registry?.trim() || null);
    existing.shirt_number = existing.shirt_number ?? input.shirt_number;

    for (const alias of aliasKeys) {
      aliases.set(alias, existingKey);
    }

    return existing;
  }

  const canonicalKey = createCanonicalKey({
    teamSide: input.team_side,
    athleteId: input.athlete_id,
    athleteNameRaw: input.athlete_name_raw,
    cbfRegistry: input.cbf_registry,
    shirtNumber: input.shirt_number,
  });

  const created: PlayerAccumulator = {
    key: canonicalKey,
    team_side: input.team_side,
    athlete_id: input.athlete_id,
    athlete_name_raw: normalizeName(input.athlete_name_raw),
    cbf_registry: input.cbf_registry?.trim() || null,
    shirt_number: input.shirt_number,
    started: false,
    is_captain: false,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    intervals: [],
    active_from: null,
    participated_observed: false,
    was_subbed_in: false,
  };

  players.set(canonicalKey, created);
  for (const alias of aliasKeys) {
    aliases.set(alias, canonicalKey);
  }

  return created;
}

function openInterval(player: PlayerAccumulator, minute: number, reason: string) {
  if (player.active_from !== null) {
    console.warn("[sumula.stats] player already active", { player: player.key, minute, reason });
    return;
  }

  player.active_from = minute;
}

function closeInterval(player: PlayerAccumulator, minute: number, totalMinutes: number, reason: string) {
  if (player.active_from === null) {
    console.warn("[sumula.stats] player not active when closing interval", { player: player.key, minute, reason });
    return;
  }

  const start = clampMinute(player.active_from, totalMinutes);
  const end = clampMinute(minute, totalMinutes);
  player.intervals.push({
    start,
    end: Math.max(start, end),
    reason,
  });
  player.active_from = null;
}

function ensureObservedParticipation(player: PlayerAccumulator, minute: number, totalMinutes: number, reason: string) {
  player.participated_observed = true;

  if (player.active_from !== null) return;

  if (player.intervals.length === 0) {
    // Sensitive rule: when the source event proves the athlete was on the field but lineup/sub data is missing,
    // we backfill from minute 0 to avoid losing participation entirely.
    console.warn("[sumula.stats] synthesizing opening interval from event", { player: player.key, minute, reason });
    openInterval(player, 0, `synthetic_${reason}`);
    return;
  }

  console.warn("[sumula.stats] reopening interval from observed event after closed stint", {
    player: player.key,
    minute,
    reason,
  });
  openInterval(player, minute, `synthetic_${reason}`);
}

function applySubstitution(input: {
  playerOut: PlayerAccumulator | null;
  playerIn: PlayerAccumulator | null;
  minute: number;
  totalMinutes: number;
}) {
  if (input.playerOut) {
    input.playerOut.participated_observed = true;
    closeInterval(input.playerOut, input.minute, input.totalMinutes, "substitution_out");
  }

  if (input.playerIn) {
    input.playerIn.participated_observed = true;
    input.playerIn.was_subbed_in = true;
    openInterval(input.playerIn, input.minute, "substitution_in");
  }
}

function applyDismissal(input: {
  player: PlayerAccumulator;
  minute: number;
  totalMinutes: number;
  reason: string;
}) {
  ensureObservedParticipation(input.player, input.minute, input.totalMinutes, input.reason);
  closeInterval(input.player, input.minute, input.totalMinutes, input.reason);
}

function shouldDismissPlayer(rawPhase: CanonicalCardPhase | null, cardType: CardRow["card_type"]) {
  if (cardType !== "RED" && cardType !== "SECOND_YELLOW") return false;
  return rawPhase !== "POS";
}

function sumIntervals(intervals: PlayerInterval[], totalMinutes: number) {
  return intervals.reduce((acc, interval) => {
    const start = clampMinute(interval.start, totalMinutes);
    const end = clampMinute(interval.end, totalMinutes);
    return acc + Math.max(0, end - start);
  }, 0);
}

export async function rebuildPlayerStats(
  supabase: SupabaseClient<Database>,
  input: {
    match_key: MatchKey;
    document_id: string | null;
    match_id: string | null;
  }
): Promise<RebuildPlayerStatsResult> {
  const { data: existingStats, error: existingStatsError } = await supabase
    .from("match_player_stats")
    .select("id")
    .eq("match_key", input.match_key);

  if (existingStatsError) {
    throw new Error(`Could not read existing stats: ${existingStatsError.message}`);
  }

  const deletedRows = (existingStats as { id: string }[] | null)?.length ?? 0;

  const { error: deleteError } = await supabase.from("match_player_stats").delete().eq("match_key", input.match_key);
  if (deleteError) {
    throw new Error(`Could not delete existing stats: ${deleteError.message}`);
  }

  const [lineupsRes, goalsRes, cardsRes, substitutionsRes, documentRes] = await Promise.all([
    supabase
      .from("match_lineups")
      .select("match_id,team_side,athlete_id,athlete_name_raw,cbf_registry,shirt_number,role,is_captain")
      .eq("match_key", input.match_key),
    supabase
      .from("match_goals")
      .select("match_id,team_side,athlete_id,athlete_name_raw,cbf_registry,shirt_number,half,minute,kind")
      .eq("match_key", input.match_key),
    supabase
      .from("match_cards")
      .select("match_id,team_side,athlete_id,athlete_name_raw,shirt_number,half,minute,raw_phase,card_type")
      .eq("match_key", input.match_key),
    supabase
      .from("match_substitutions")
      .select(
        "match_id,team_side,half,minute,raw_phase,athlete_out_id,athlete_in_id,athlete_out_name_raw,athlete_in_name_raw,athlete_out_shirt_number,athlete_in_shirt_number"
      )
      .eq("match_key", input.match_key),
    input.document_id
      ? supabase.from("documents").select("canonical_json").eq("id", input.document_id).maybeSingle<MatchClockDocumentRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (lineupsRes.error || goalsRes.error || cardsRes.error || substitutionsRes.error || documentRes.error) {
    throw new Error(
      lineupsRes.error?.message ??
        goalsRes.error?.message ??
        cardsRes.error?.message ??
        substitutionsRes.error?.message ??
        documentRes.error?.message ??
        "Could not load events."
    );
  }

  const lineups = (lineupsRes.data as LineupRow[] | null) ?? [];
  const goals = (goalsRes.data as GoalRow[] | null) ?? [];
  const cards = (cardsRes.data as CardRow[] | null) ?? [];
  const substitutions = (substitutionsRes.data as SubstitutionRow[] | null) ?? [];
  const officialTotalMinutes = documentRes.data?.canonical_json?.match_meta?.clock?.official_total_minutes ?? null;
  const totalMinutes = getMatchTotalMinutes({ officialTotalMinutes, strategy: "default" });

  const players = new Map<string, PlayerAccumulator>();
  const aliases = new Map<string, string>();

  for (const lineup of lineups) {
    const player = ensurePlayer(players, aliases, {
      team_side: lineup.team_side,
      athlete_id: lineup.athlete_id,
      athlete_name_raw: lineup.athlete_name_raw,
      cbf_registry: lineup.cbf_registry,
      shirt_number: lineup.shirt_number,
    });
    if (!player) continue;

    const roleUpper = lineup.role.toUpperCase();
    player.started = player.started || roleUpper === "STARTER" || roleUpper === "GK_STARTER";
    player.is_captain = player.is_captain || lineup.is_captain;

    if (player.started && player.active_from === null) {
      player.participated_observed = true;
      openInterval(player, 0, "lineup_starter");
    }
  }

  const orderedSubstitutions = [...substitutions].sort((a, b) => {
    const left = toAbsoluteMinute({ half: a.half, minute: a.minute, rawPhase: a.raw_phase, totalMinutes });
    const right = toAbsoluteMinute({ half: b.half, minute: b.minute, rawPhase: b.raw_phase, totalMinutes });
    return left - right;
  });

  for (const substitution of orderedSubstitutions) {
    const minute = toAbsoluteMinute({
      half: substitution.half,
      minute: substitution.minute,
      rawPhase: substitution.raw_phase,
      totalMinutes,
    });

    const playerOut = ensurePlayer(players, aliases, {
      team_side: substitution.team_side,
      athlete_id: substitution.athlete_out_id,
      athlete_name_raw: substitution.athlete_out_name_raw,
      cbf_registry: null,
      shirt_number: substitution.athlete_out_shirt_number,
    });
    const playerIn = ensurePlayer(players, aliases, {
      team_side: substitution.team_side,
      athlete_id: substitution.athlete_in_id,
      athlete_name_raw: substitution.athlete_in_name_raw,
      cbf_registry: null,
      shirt_number: substitution.athlete_in_shirt_number,
    });

    applySubstitution({
      playerOut,
      playerIn,
      minute,
      totalMinutes,
    });
  }

  for (const goal of goals) {
    const player = ensurePlayer(players, aliases, {
      team_side: goal.team_side,
      athlete_id: goal.athlete_id,
      athlete_name_raw: goal.athlete_name_raw,
      cbf_registry: goal.cbf_registry,
      shirt_number: goal.shirt_number,
    });
    if (!player) continue;

    ensureObservedParticipation(
      player,
      toAbsoluteMinute({ half: goal.half, minute: goal.minute, totalMinutes }),
      totalMinutes,
      "goal"
    );

    const kindUpper = (goal.kind ?? "GOAL").toUpperCase();
    if (kindUpper === "ASSIST") {
      player.assists += 1;
    } else {
      player.goals += 1;
    }
  }

  const orderedCards = [...cards].sort((a, b) => {
    const left = toAbsoluteMinute({ half: a.half, minute: a.minute, rawPhase: a.raw_phase, totalMinutes });
    const right = toAbsoluteMinute({ half: b.half, minute: b.minute, rawPhase: b.raw_phase, totalMinutes });
    return left - right;
  });

  for (const card of orderedCards) {
    const player = ensurePlayer(players, aliases, {
      team_side: card.team_side,
      athlete_id: card.athlete_id,
      athlete_name_raw: card.athlete_name_raw,
      cbf_registry: null,
      shirt_number: card.shirt_number,
    });
    if (!player) continue;

    const minute = toAbsoluteMinute({
      half: card.half,
      minute: card.minute,
      rawPhase: card.raw_phase,
      totalMinutes,
    });

    ensureObservedParticipation(player, minute, totalMinutes, "card");

    if (card.card_type === "YELLOW") player.yellow_cards += 1;
    if (card.card_type === "RED") player.red_cards += 1;
    if (card.card_type === "SECOND_YELLOW") {
      player.yellow_cards += 1;
      player.red_cards += 1;
    }

    if (shouldDismissPlayer(card.raw_phase, card.card_type)) {
      applyDismissal({
        player,
        minute,
        totalMinutes,
        reason: `dismissal_${card.card_type.toLowerCase()}`,
      });
    }
  }

  for (const player of players.values()) {
    if (player.active_from !== null) {
      closeInterval(player, totalMinutes, totalMinutes, "full_time");
    }
  }

  for (const player of players.values()) {
    if (player.athlete_id) continue;
    player.athlete_id = await linkAthlete({
      supabase,
      cbf_registry: player.cbf_registry,
      name_raw: player.athlete_name_raw,
    });
  }

  const nowIso = new Date().toISOString();
  const rows: StatsInsertRow[] = [];

  for (const player of players.values()) {
    if (!player.athlete_id) continue;

    const minutesPlayed = sumIntervals(player.intervals, totalMinutes);
    const participated = player.started || player.was_subbed_in || player.participated_observed;

    rows.push({
      match_id: input.match_id,
      athlete_id: player.athlete_id,
      cbf_registry: player.cbf_registry,
      athlete_name_raw: player.athlete_name_raw,
      minutes: minutesPlayed,
      minutes_played: minutesPlayed,
      started: player.started,
      is_captain: player.is_captain,
      participated,
      goals: player.goals,
      assists: player.assists,
      yellow: player.yellow_cards,
      red: player.red_cards,
      yellow_cards: player.yellow_cards,
      red_cards: player.red_cards,
      team_side: player.team_side,
      source: "DERIVED",
      updated_at: nowIso,
      document_id: input.document_id,
      match_key: input.match_key,
      event_uid: stableUid(input.match_key, [
        player.team_side,
        player.athlete_id,
        player.cbf_registry,
        player.shirt_number,
        player.athlete_name_raw,
        "DERIVED",
      ]),
    });
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("match_player_stats").insert(rows);
    if (insertError) {
      throw new Error(`Could not insert rebuilt stats: ${insertError.message}`);
    }
  }

  return {
    match_key: input.match_key,
    document_id: input.document_id,
    match_id: input.match_id,
    deleted_rows: deletedRows,
    inserted_rows: rows.length,
  };
}
