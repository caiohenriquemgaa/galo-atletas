import type { SupabaseClient } from "@supabase/supabase-js";

type LinkAthleteInput = {
  supabase: SupabaseClient;
  cbf_registry?: string | null;
  name_raw?: string | null;
  match_id?: string | null;
  competition_name?: string | null;
  season_year?: number | null;
};

type AthleteLookupRow = {
  id: string;
  name: string;
};

type MatchScopeRow = {
  competition_name: string | null;
  season_year: number | null;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveMatchScope(input: LinkAthleteInput): Promise<MatchScopeRow | null> {
  if (input.competition_name && input.season_year) {
    return {
      competition_name: input.competition_name,
      season_year: input.season_year,
    };
  }

  if (!input.match_id) return null;

  const { data, error } = await input.supabase
    .from("matches")
    .select("competition_name,season_year")
    .eq("id", input.match_id)
    .maybeSingle<MatchScopeRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function linkAthlete(input: LinkAthleteInput): Promise<string | null> {
  const { supabase, cbf_registry, name_raw } = input;
  const cbf = cbf_registry?.trim() ?? "";
  const rawName = name_raw?.trim() ?? "";
  const scope = await resolveMatchScope(input);
  const hasCompetitionScope = !!scope?.competition_name && typeof scope.season_year === "number";

  if (cbf) {
    let query = supabase
      .from("athletes")
      .select("id")
      .eq("source", "FPF")
      .eq("cbf_registry", cbf);

    if (hasCompetitionScope) {
      query = query.eq("competition_name", scope.competition_name!).eq("season_year", scope.season_year!);
    }

    const { data, error } = await query.limit(1).maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (data?.id) return data.id;
  }

  if (!rawName) return null;

  const normalizedInput = normalizeText(rawName);
  if (!normalizedInput) return null;

  let query = supabase
    .from("athletes")
    .select("id,name")
    .eq("club_name", "GALO MARINGA")
    .limit(1000);

  if (hasCompetitionScope) {
    query = query.eq("competition_name", scope.competition_name!).eq("season_year", scope.season_year!);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  const rows = (data as AthleteLookupRow[]) ?? [];

  for (const athlete of rows) {
    if (normalizeText(athlete.name) === normalizedInput) {
      return athlete.id;
    }
  }

  return null;
}
