import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MatchKey } from "@/lib/sumula/types";

type TeamSide = "HOME" | "AWAY";

type LineupRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  role: string;
  is_captain: boolean;
};

type GoalRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  half: number;
  minute: number;
  kind: string;
};

type CardRow = {
  match_id: string | null;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  half: number;
  minute: number;
  card_type: "YELLOW" | "RED" | "SECOND_YELLOW";
};

type SubstitutionRow = {
  match_id: string | null;
  team_side: TeamSide;
  half: number;
  minute: number;
  athlete_out_id: string | null;
  athlete_in_id: string | null;
  athlete_out_name_raw: string | null;
  athlete_in_name_raw: string | null;
};

type PlayerAccumulator = {
  key: string;
  team_side: TeamSide;
  athlete_id: string | null;
  athlete_name_raw: string | null;
  cbf_registry: string | null;
  started: boolean;
  is_captain: boolean;
  participated: boolean;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  sub_in_minutes: number[];
  sub_out_minutes: number[];
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

function stableUid(matchKey: string, fields: Array<string | null>) {
  return createHash("sha256")
    .update(["player_stats", matchKey, ...fields.map((field) => field ?? "")].join("|"))
    .digest("hex");
}

function toMatchMinute(half: number, minute: number) {
  const halfOffset = half === 2 ? 45 : 0;
  const value = halfOffset + Math.max(0, minute);
  return Math.min(120, value);
}

function createPlayerKey(teamSide: TeamSide, athleteId: string | null, athleteNameRaw: string | null) {
  if (athleteId) return `id:${athleteId}`;
  const normalizedName = normalizeName(athleteNameRaw);
  if (!normalizedName) return null;
  return `name:${teamSide}:${normalizedName.toUpperCase()}`;
}

function ensurePlayer(
  players: Map<string, PlayerAccumulator>,
  input: {
    team_side: TeamSide;
    athlete_id: string | null;
    athlete_name_raw: string | null;
    cbf_registry: string | null;
  }
) {
  const key = createPlayerKey(input.team_side, input.athlete_id, input.athlete_name_raw);
  if (!key) return null;

  const current = players.get(key);
  if (current) {
    current.athlete_name_raw = current.athlete_name_raw ?? normalizeName(input.athlete_name_raw);
    current.cbf_registry = current.cbf_registry ?? (input.cbf_registry?.trim() || null);
    return current;
  }

  const created: PlayerAccumulator = {
    key,
    team_side: input.team_side,
    athlete_id: input.athlete_id,
    athlete_name_raw: normalizeName(input.athlete_name_raw),
    cbf_registry: input.cbf_registry?.trim() || null,
    started: false,
    is_captain: false,
    participated: false,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    sub_in_minutes: [],
    sub_out_minutes: [],
  };

  players.set(key, created);
  return created;
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

  const [lineupsRes, goalsRes, cardsRes, substitutionsRes] = await Promise.all([
    supabase
      .from("match_lineups")
      .select("match_id,team_side,athlete_id,athlete_name_raw,cbf_registry,role,is_captain")
      .eq("match_key", input.match_key),
    supabase
      .from("match_goals")
      .select("match_id,team_side,athlete_id,athlete_name_raw,cbf_registry,half,minute,kind")
      .eq("match_key", input.match_key),
    supabase
      .from("match_cards")
      .select("match_id,team_side,athlete_id,athlete_name_raw,half,minute,card_type")
      .eq("match_key", input.match_key),
    supabase
      .from("match_substitutions")
      .select("match_id,team_side,half,minute,athlete_out_id,athlete_in_id,athlete_out_name_raw,athlete_in_name_raw")
      .eq("match_key", input.match_key),
  ]);

  if (lineupsRes.error || goalsRes.error || cardsRes.error || substitutionsRes.error) {
    throw new Error(
      lineupsRes.error?.message ??
        goalsRes.error?.message ??
        cardsRes.error?.message ??
        substitutionsRes.error?.message ??
        "Could not load events."
    );
  }

  const lineups = (lineupsRes.data as LineupRow[] | null) ?? [];
  const goals = (goalsRes.data as GoalRow[] | null) ?? [];
  const cards = (cardsRes.data as CardRow[] | null) ?? [];
  const substitutions = (substitutionsRes.data as SubstitutionRow[] | null) ?? [];

  const players = new Map<string, PlayerAccumulator>();

  for (const lineup of lineups) {
    const player = ensurePlayer(players, {
      team_side: lineup.team_side,
      athlete_id: lineup.athlete_id,
      athlete_name_raw: lineup.athlete_name_raw,
      cbf_registry: lineup.cbf_registry,
    });
    if (!player) continue;
    const roleUpper = lineup.role.toUpperCase();
    player.started = player.started || roleUpper === "STARTER" || roleUpper === "GK_STARTER";
    player.is_captain = player.is_captain || lineup.is_captain;
    player.participated = true;
  }

  for (const goal of goals) {
    const player = ensurePlayer(players, {
      team_side: goal.team_side,
      athlete_id: goal.athlete_id,
      athlete_name_raw: goal.athlete_name_raw,
      cbf_registry: goal.cbf_registry,
    });
    if (!player) continue;
    const kindUpper = (goal.kind ?? "GOAL").toUpperCase();
    if (kindUpper === "ASSIST") {
      player.assists += 1;
    } else {
      player.goals += 1;
    }
    player.participated = true;
  }

  for (const card of cards) {
    const player = ensurePlayer(players, {
      team_side: card.team_side,
      athlete_id: card.athlete_id,
      athlete_name_raw: card.athlete_name_raw,
      cbf_registry: null,
    });
    if (!player) continue;
    if (card.card_type === "YELLOW") player.yellow_cards += 1;
    if (card.card_type === "RED") player.red_cards += 1;
    if (card.card_type === "SECOND_YELLOW") {
      player.yellow_cards += 1;
      player.red_cards += 1;
    }
    player.participated = true;
  }

  for (const substitution of substitutions) {
    const minute = toMatchMinute(substitution.half, substitution.minute);

    const playerOut = ensurePlayer(players, {
      team_side: substitution.team_side,
      athlete_id: substitution.athlete_out_id,
      athlete_name_raw: substitution.athlete_out_name_raw,
      cbf_registry: null,
    });
    if (playerOut) {
      playerOut.sub_out_minutes.push(minute);
      playerOut.participated = true;
    }

    const playerIn = ensurePlayer(players, {
      team_side: substitution.team_side,
      athlete_id: substitution.athlete_in_id,
      athlete_name_raw: substitution.athlete_in_name_raw,
      cbf_registry: null,
    });
    if (playerIn) {
      playerIn.sub_in_minutes.push(minute);
      playerIn.participated = true;
    }
  }

  const nowIso = new Date().toISOString();
  const rows: StatsInsertRow[] = [];

  for (const player of players.values()) {
    const firstInMinute = player.sub_in_minutes.length > 0 ? Math.min(...player.sub_in_minutes) : null;
    const firstOutMinute = player.sub_out_minutes.length > 0 ? Math.min(...player.sub_out_minutes) : null;

    let startMinute: number | null = player.started ? 0 : firstInMinute;
    if (startMinute === null && firstOutMinute !== null) {
      startMinute = 0;
    }

    const endMinute = firstOutMinute !== null ? Math.min(90, firstOutMinute) : 90;
    const minutesPlayed = startMinute === null ? 0 : Math.max(0, endMinute - startMinute);

    rows.push({
      match_id: input.match_id,
      athlete_id: player.athlete_id,
      cbf_registry: player.cbf_registry,
      athlete_name_raw: player.athlete_name_raw,
      minutes: minutesPlayed,
      minutes_played: minutesPlayed,
      started: player.started,
      is_captain: player.is_captain,
      participated: player.participated,
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
      event_uid: stableUid(input.match_key, [player.team_side, player.athlete_id, player.athlete_name_raw]),
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
