const LEGACY_COMPETITION_PATH_REGEX =
  /^https?:\/\/(?:www\.)?federacaopr\.com\.br\/competicoes\/([^/]+)\/(\d{4})\/(\d+)\/?$/i;
const CURRENT_COMPETITION_PATH_REGEX =
  /^https?:\/\/(?:www\.)?federacaopr\.com\.br\/campeonato\/([^/]+)\/(\d{4})\/(\d+)\/?$/i;

type CompetitionCategory = "PROFISSIONAL" | "BASE" | string | null | undefined;

function sanitizeCategorySegment(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveCategorySegment(rawSegment: string, category: CompetitionCategory) {
  const normalizedCategory = sanitizeCategorySegment(category ?? "");
  if (normalizedCategory === "base") return "base";
  if (normalizedCategory === "profissional") return "profissional";

  const normalizedSegment = sanitizeCategorySegment(rawSegment);
  if (normalizedSegment === "base") return "base";
  if (normalizedSegment === "profissional") return "profissional";
  if (normalizedSegment === "amador") return "amador";
  if (normalizedSegment === "feminino") return "feminino";

  return normalizedSegment || "base";
}

function removeSearchAndHash(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeCompetitionUrlBase(rawUrl: string | null | undefined, category?: CompetitionCategory) {
  if (!rawUrl?.trim()) return null;

  const trimmed = removeSearchAndHash(rawUrl);
  const currentMatch = trimmed.match(CURRENT_COMPETITION_PATH_REGEX);
  if (currentMatch) {
    const [, rawSegment, seasonYear, competitionId] = currentMatch;
    const categorySegment = resolveCategorySegment(rawSegment, category);
    return `https://federacaopr.com.br/campeonato/${categorySegment}/${seasonYear}/${competitionId}/`;
  }

  const legacyMatch = trimmed.match(LEGACY_COMPETITION_PATH_REGEX);
  if (legacyMatch) {
    const [, rawSegment, seasonYear, competitionId] = legacyMatch;
    const categorySegment = resolveCategorySegment(rawSegment, category);
    return `https://federacaopr.com.br/campeonato/${categorySegment}/${seasonYear}/${competitionId}/`;
  }

  return trimmed.replace(/\/+$/, "") + "/";
}

export function extractCompetitionId(rawUrl: string | null | undefined) {
  const normalized = normalizeCompetitionUrlBase(rawUrl);
  if (!normalized) return null;

  const match = normalized.match(/\/(\d+)\/?$/);
  return match?.[1] ?? null;
}
