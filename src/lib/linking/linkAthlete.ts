import type { SupabaseClient } from "@supabase/supabase-js";

type LinkAthleteInput = {
  supabase: SupabaseClient;
  cbf_registry?: string | null;
  name_raw?: string | null;
};

type AthleteLookupRow = {
  id: string;
  name: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function linkAthlete({ supabase, cbf_registry, name_raw }: LinkAthleteInput): Promise<string | null> {
  const cbf = cbf_registry?.trim() ?? "";
  const rawName = name_raw?.trim() ?? "";

  if (cbf) {
    const { data, error } = await supabase
      .from("athletes")
      .select("id")
      .eq("source", "FPF")
      .eq("cbf_registry", cbf)
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(error.message);
    if (data?.id) return data.id;
  }

  if (!rawName) return null;

  const normalizedInput = normalizeText(rawName);
  if (!normalizedInput) return null;

  const { data, error } = await supabase
    .from("athletes")
    .select("id,name")
    .eq("club_name", "GALO MARINGA")
    .limit(1000);

  if (error) throw new Error(error.message);

  const rows = (data as AthleteLookupRow[]) ?? [];

  for (const athlete of rows) {
    if (normalizeText(athlete.name) === normalizedInput) {
      return athlete.id;
    }
  }

  return null;
}
