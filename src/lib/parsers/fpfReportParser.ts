import type { CanonicalAthlete, CanonicalReport } from "@/lib/sumula/types";

type TeamSide = "HOME" | "AWAY";
type LineupRole = "STARTER" | "RESERVE";

const TEAM_NAME_MAX = 80;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeTeamName(value: string) {
  return normalizeWhitespace(value).replace(/[^\p{L}\p{N} .'\-()/]/gu, "").slice(0, TEAM_NAME_MAX);
}

function parseScore(lines: string[]) {
  const scorePatterns = [
    /(?:placar|resultado)\s*(?:final)?[^\d]{0,20}(\d{1,2})\s*[-xX:]\s*(\d{1,2})/i,
    /(\d{1,2})\s*[-xX:]\s*(\d{1,2})/,
  ];

  for (const line of lines) {
    for (const pattern of scorePatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      return {
        home: Number(match[1]),
        away: Number(match[2]),
      };
    }
  }

  return null;
}

function parseTeams(lines: string[]) {
  let home: string | null = null;
  let away: string | null = null;

  for (const line of lines) {
    if (!home) {
      const homeMatch = line.match(/(?:equipe|clube)?\s*(?:mandante|home)\s*[:\-]\s*(.+)$/i);
      if (homeMatch) home = sanitizeTeamName(homeMatch[1]);
    }

    if (!away) {
      const awayMatch = line.match(/(?:equipe|clube)?\s*(?:visitante|away)\s*[:\-]\s*(.+)$/i);
      if (awayMatch) away = sanitizeTeamName(awayMatch[1]);
    }

    if (!home || !away) {
      const versusMatch = line.match(/^\s*([^\d].{2,80}?)\s+[xX]\s+([^\d].{2,80}?)\s*$/);
      if (versusMatch) {
        home ??= sanitizeTeamName(versusMatch[1]);
        away ??= sanitizeTeamName(versusMatch[2]);
      }
    }
  }

  return {
    home_team: home,
    away_team: away,
  };
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parseAthleteLine(line: string): CanonicalAthlete | null {
  const clean = normalizeWhitespace(line.replace(/\b(CBF|REGISTRO|RG|CPF)\b.*$/i, ""));
  if (!clean || clean.length < 3) return null;

  const match = clean.match(/^(?:(\d{1,2})\s*[-.)]?\s*)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]{1,60})$/);
  if (!match) return null;

  const name = normalizeWhitespace(match[2]);
  if (name.length < 3) return null;

  return {
    shirt_number: match[1] ? Number(match[1]) : null,
    name,
  };
}

function parseLineups(lines: string[]) {
  const homeStarters: CanonicalAthlete[] = [];
  const awayStarters: CanonicalAthlete[] = [];
  const homeReserves: CanonicalAthlete[] = [];
  const awayReserves: CanonicalAthlete[] = [];

  let currentTeam: TeamSide | null = null;
  let currentRole: LineupRole | null = null;

  for (const line of lines) {
    const header = normalizeHeader(line);

    if (header.includes("MANDANTE") || header.includes("HOME")) {
      currentTeam = "HOME";
    } else if (header.includes("VISITANTE") || header.includes("AWAY")) {
      currentTeam = "AWAY";
    }

    if (header.includes("TITULARES") || header.includes("TITULAR")) {
      currentRole = "STARTER";
      continue;
    }

    if (header.includes("RESERVAS") || header.includes("RESERVA")) {
      currentRole = "RESERVE";
      continue;
    }

    if (!currentTeam || !currentRole) continue;

    const athlete = parseAthleteLine(line);
    if (!athlete) continue;

    if (currentTeam === "HOME" && currentRole === "STARTER") homeStarters.push(athlete);
    if (currentTeam === "AWAY" && currentRole === "STARTER") awayStarters.push(athlete);
    if (currentTeam === "HOME" && currentRole === "RESERVE") homeReserves.push(athlete);
    if (currentTeam === "AWAY" && currentRole === "RESERVE") awayReserves.push(athlete);
  }

  return {
    home: {
      starters: homeStarters,
      reserves: homeReserves,
    },
    away: {
      starters: awayStarters,
      reserves: awayReserves,
    },
  };
}

export function parseToCanonical(rawText: string): CanonicalReport {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);

  return {
    match_meta: {
      ...parseTeams(lines),
      final_score: parseScore(lines),
    },
    lineups: parseLineups(lines),
    events: [],
  };
}
