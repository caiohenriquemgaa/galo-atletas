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

export type CanonicalAthlete = {
  name: string;
  shirt_number: number | null;
};

export type CanonicalTeamLineup = {
  starters: CanonicalAthlete[];
  reserves: CanonicalAthlete[];
};

export type CanonicalMatchMeta = {
  home_team: string | null;
  away_team: string | null;
  final_score: {
    home: number;
    away: number;
  } | null;
};

export type CanonicalReport = {
  match_meta: CanonicalMatchMeta;
  lineups: {
    home: CanonicalTeamLineup;
    away: CanonicalTeamLineup;
  };
  events: unknown[];
};

export type IngestDocumentRow = {
  id: string;
  match_id: string | null;
  match_key: MatchKey;
  status: DocumentStatus;
  canonical_json: CanonicalReport | null;
};
