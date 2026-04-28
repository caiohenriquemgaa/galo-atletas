function normalizeCompetitionName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function getHalfDurationByCompetition(competitionName: string | null | undefined) {
  const normalized = normalizeCompetitionName(competitionName);
  if (/\bSUB[- ]?15\b/.test(normalized)) return 35;
  if (/\bSUB[- ]?20\b/.test(normalized)) return 45;
  return 45;
}

export function getNominalTotalMinutesByCompetition(competitionName: string | null | undefined) {
  return getHalfDurationByCompetition(competitionName) * 2;
}
