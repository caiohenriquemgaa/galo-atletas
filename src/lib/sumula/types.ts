export type DocumentScope = "PROD" | "SANDBOX";
export type DocumentStatus = "UPLOADED" | "PARSED_RAW" | "CANONICAL" | "EVENTS_SAVED" | "ERROR";

export type MatchKey = `${DocumentScope}:${string}`;

export type SumulaDocumentUpsert = {
  source: "FPF";
  doc_type: "FPF_SUMULA";
  scope: DocumentScope;
  match_id: string | null;
  sandbox_match_id: string | null;
  match_key: MatchKey;
  storage_bucket: string;
  storage_path: string;
  parser_version: string | null;
  sha256: string | null;
  uploaded_at: string;
};

export type MatchScopedEventBase = {
  match_key: MatchKey;
  event_uid: string;
  document_id: string | null;
};

export type MatchPlayerStatScoped = MatchScopedEventBase & {
  match_id: string | null;
  athlete_id: string;
  source: string;
};

export type CanonicalTeamSide = "HOME" | "AWAY";
export type CanonicalLineupRole = "STARTER" | "RESERVE" | "GK_STARTER" | "GK_RESERVE";
export type CanonicalMatchPhase = "1T" | "2T";
export type CanonicalCardPhase = CanonicalMatchPhase | "INT" | "POS";
export type CanonicalSubstitutionPhase = CanonicalMatchPhase | "INT";

export type CanonicalAthlete = {
  name: string;
  full_name?: string | null;
  shirt_number: number | null;
  cbf_registry?: string | null;
  role?: CanonicalLineupRole;
  is_captain?: boolean;
};

export type CanonicalTeamLineup = {
  team_name?: string | null;
  starters: CanonicalAthlete[];
  reserves: CanonicalAthlete[];
};

export type CanonicalGoalEvent = {
  type: "GOAL";
  team_side: CanonicalTeamSide;
  half: 1 | 2;
  minute: number;
  raw_phase: CanonicalMatchPhase;
  athlete_name: string;
  shirt_number: number | null;
  cbf_registry?: string | null;
  kind: "GOAL";
};

export type CanonicalCardEvent = {
  type: "CARD";
  team_side: CanonicalTeamSide;
  half: 1 | 2;
  minute: number;
  raw_phase: CanonicalCardPhase;
  athlete_name: string;
  shirt_number: number | null;
  card_type: "YELLOW" | "RED" | "SECOND_YELLOW";
  reason: string | null;
};

export type CanonicalSubstitutionEvent = {
  type: "SUBSTITUTION";
  team_side: CanonicalTeamSide;
  half: 1 | 2;
  minute: number;
  raw_phase: CanonicalSubstitutionPhase;
  athlete_out_name: string;
  athlete_out_shirt_number: number | null;
  athlete_in_name: string;
  athlete_in_shirt_number: number | null;
};

export type CanonicalMatchClock = {
  first_half_added_minutes: number | null;
  second_half_added_minutes: number | null;
  nominal_total_minutes: 90;
  official_total_minutes: number | null;
};

export type CanonicalMatchMeta = {
  home_team: string | null;
  away_team: string | null;
  final_score: {
    home: number;
    away: number;
  } | null;
  competition_name?: string | null;
  round_label?: string | null;
  venue?: string | null;
  played_at?: string | null;
  clock?: CanonicalMatchClock;
};

export type CanonicalEvent = CanonicalGoalEvent | CanonicalCardEvent | CanonicalSubstitutionEvent;

export type CanonicalReport = {
  match_meta: CanonicalMatchMeta;
  lineups: {
    home: CanonicalTeamLineup;
    away: CanonicalTeamLineup;
  };
  events: CanonicalEvent[];
};

export type IngestDocumentRow = {
  id: string;
  match_id: string | null;
  match_key: MatchKey;
  status: DocumentStatus;
  canonical_json: CanonicalReport | null;
};
