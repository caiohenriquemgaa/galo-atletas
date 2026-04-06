import type {
  CanonicalAthlete,
  CanonicalCardEvent,
  CanonicalCardPhase,
  CanonicalMatchClock,
  CanonicalMatchMeta,
  CanonicalMatchPhase,
  CanonicalReport,
  CanonicalSubstitutionEvent,
  CanonicalSubstitutionPhase,
  CanonicalTeamLineup,
  CanonicalTeamSide,
} from "@/lib/sumula/types";

type SectionBlock = {
  title: string;
  lines: string[];
};

type RawPlayerEntry = {
  team_side: CanonicalTeamSide;
  shirt_number: number | null;
  cbf_registry: string | null;
  role: CanonicalAthlete["role"];
  is_captain: boolean;
  name: string;
  full_name: string | null;
};

type TeamLookup = {
  byShirt: Map<number, CanonicalAthlete>;
  byName: Map<string, CanonicalAthlete>;
};

type TeamContext = {
  home_team: string | null;
  away_team: string | null;
  home_lookup: TeamLookup;
  away_lookup: TeamLookup;
};

const SECTION_HEADER_REGEX = /^(\d{1,2}\.\d)\s*-\s*(.*)$/;
const TIMED_WITH_SHIRT_REGEX = /^(\d{1,3})(1T|2T|INT|POS)(\d{1,2})(.*)$/i;
const TIMED_WITH_TEAM_REGEX = /^(\d{1,3})(1T|2T|INT|POS)(.+)$/i;
const SUB_PLAYER_REGEX = /^(\d{1,2})\s*-\s*(.+)$/;

function foldForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizePdfText(rawText: string) {
  return rawText
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/\u00ad/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function normalizeInlineText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizePersonName(value: string | null | undefined) {
  return normalizeInlineText(value).replace(/^[\-:;,.\s]+|[\-:;,.\s]+$/g, "").trim();
}

function toLines(rawText: string) {
  return normalizePdfText(rawText)
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter((line) => line.length > 0);
}

function splitSections(lines: string[]) {
  const sections = new Map<string, SectionBlock>();
  const preamble: SectionBlock = { title: "PREAMBLE", lines: [] };
  let current = preamble;

  for (const line of lines) {
    const headerMatch = line.match(SECTION_HEADER_REGEX);
    if (headerMatch) {
      current = {
        title: normalizeInlineText(headerMatch[2] || headerMatch[1]),
        lines: [],
      };
      sections.set(headerMatch[1], current);
      continue;
    }

    current.lines.push(line);
  }

  sections.set("PREAMBLE", preamble);
  return sections;
}

function getSectionLines(sections: Map<string, SectionBlock>, key: string) {
  return sections.get(key)?.lines ?? [];
}

function extractMatchTeams(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^(.+?)\s+[xX]\s+(.+)$/);
    if (!match) continue;

    const home = normalizeInlineText(match[1]);
    const away = normalizeInlineText(match[2]);
    if (!home || !away) continue;
    return {
      home_team: home,
      away_team: away,
    };
  }

  return {
    home_team: null,
    away_team: null,
  };
}

function parseScore(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/(?:RESULTADO|PLACAR)(?: FINAL)?[^\d]{0,20}(\d{1,2})\s*[-xX:]\s*(\d{1,2})/i);
    if (match) {
      return {
        home: Number(match[1]),
        away: Number(match[2]),
      };
    }
  }

  return null;
}

function parseAddedMinutesFromText(input: { text: string; phase: 1 | 2 }) {
  const baseMinute = input.phase === 1 ? 45 : 90;
  const phaseTokens = input.phase === 1 ? ["1T", "1 TEMPO", "1º TEMPO", "1O TEMPO"] : ["2T", "2 TEMPO", "2º TEMPO", "2O TEMPO"];

  const plusPatterns = phaseTokens.map(
    (token) => new RegExp(`${token.replace(/\s+/g, "\\s+")}[^\\d]{0,30}${baseMinute}\\s*\\+\\s*(\\d{1,2})`, "iu")
  );
  const directPatterns = phaseTokens.map(
    (token) => new RegExp(`${token.replace(/\s+/g, "\\s+")}[^\\d]{0,40}(\\d{1,3})\\s*MIN`, "iu")
  );
  const labelPatterns = phaseTokens.map(
    (token) => new RegExp(`${token.replace(/\s+/g, "\\s+")}[^\\d]{0,40}(?:ACRESCIMOS?|ACR[EÉ]SCIMOS?)[^\\d]{0,15}(\\d{1,2})`, "iu")
  );

  for (const pattern of plusPatterns) {
    const match = input.text.match(pattern);
    if (match) return Number(match[1]);
  }

  for (const pattern of directPatterns) {
    const match = input.text.match(pattern);
    if (!match) continue;
    const absoluteMinute = Number(match[1]);
    if (absoluteMinute >= baseMinute) {
      return absoluteMinute - baseMinute;
    }
  }

  for (const pattern of labelPatterns) {
    const match = input.text.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}

function parseMatchClock(sectionLines: string[]) {
  const text = sectionLines.join(" ");
  const firstHalfAddedMinutes = parseAddedMinutesFromText({ text, phase: 1 });
  const secondHalfAddedMinutes = parseAddedMinutesFromText({ text, phase: 2 });

  const clock: CanonicalMatchClock = {
    first_half_added_minutes: firstHalfAddedMinutes,
    second_half_added_minutes: secondHalfAddedMinutes,
    nominal_total_minutes: 90,
    official_total_minutes:
      firstHalfAddedMinutes !== null && secondHalfAddedMinutes !== null ? 90 + firstHalfAddedMinutes + secondHalfAddedMinutes : null,
  };

  return clock;
}

function parseMatchMeta(preambleLines: string[], chronologyLines: string[]): CanonicalMatchMeta {
  const teams = extractMatchTeams(preambleLines);
  const score = parseScore(preambleLines);
  const clock = parseMatchClock(chronologyLines);

  const competitionLine =
    preambleLines.find((line) => {
      const folded = foldForMatch(line);
      return (
        !folded.includes("SUMULA") &&
        !folded.includes("RESULTADO") &&
        !folded.startsWith("FASE:") &&
        !folded.startsWith("JOGO Nº") &&
        !folded.includes(" X ") &&
        /(PARANAENSE|CAMPEONATO|COPA|TORNEIO)/i.test(line)
      );
    }) ?? null;

  const roundLine = preambleLines.find((line) => foldForMatch(line).startsWith("FASE:")) ?? null;
  const matchLine = preambleLines.find((line) => foldForMatch(line).startsWith("JOGO Nº")) ?? null;
  const matchMetaMatch = matchLine?.match(/Data\/hora:\s*([0-9/]+\s+[0-9:]+)\s*-\s*Local:\s*(.+)$/i) ?? null;

  return {
    home_team: teams.home_team,
    away_team: teams.away_team,
    final_score: score,
    competition_name: normalizeInlineText(competitionLine) || null,
    round_label: normalizeInlineText(roundLine) || null,
    venue: normalizeInlineText(matchMetaMatch?.[2]) || null,
    played_at: normalizeInlineText(matchMetaMatch?.[1]) || null,
    clock,
  };
}

function isLineupNoise(line: string) {
  const folded = foldForMatch(line);
  return (
    folded.includes("RELAÇÃO DE JOGADORES") ||
    folded.includes("RELACAO DE JOGADORES") ||
    folded.includes("NºNOME") ||
    folded.includes("NOMET/R") ||
    folded.includes("*T = TITULAR") ||
    folded.includes("CAPITÃOCAPITÃO") ||
    folded === "CAPITÃO" ||
    folded === "CAPITAO"
  );
}

function roleFromToken(token: string) {
  if (token === "T") return "STARTER";
  if (token === "R") return "RESERVE";
  if (token === "GT") return "GK_STARTER";
  if (token === "GR") return "GK_RESERVE";
  return null;
}

function isTokenLine(line: string) {
  return /^(GT|GR|T|R)\d+$/i.test(line.replace(/\s+/g, ""));
}

function parseTokenLine(line: string, allowTrailingShirt: boolean) {
  const compact = line.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^(GT|GR|T|R)(\d+)$/);
  if (!match) return null;

  let digits = match[2];
  let trailingShirt: number | null = null;

  if (allowTrailingShirt && digits.length >= 5) {
    const lastTwo = Number(digits.slice(-2));
    if (lastTwo >= 1 && lastTwo <= 30 && digits.slice(0, -2).length >= 4) {
      trailingShirt = lastTwo;
      digits = digits.slice(0, -2);
    } else {
      const lastOne = Number(digits.slice(-1));
      if (lastOne >= 1 && lastOne <= 30 && digits.slice(0, -1).length >= 4) {
        trailingShirt = lastOne;
        digits = digits.slice(0, -1);
      }
    }
  }

  return {
    role: roleFromToken(match[1]),
    cbf_registry: digits || null,
    trailing_shirt: trailingShirt,
  };
}

function buildCanonicalNameFromLines(lines: string[]) {
  const cleaned = lines.map((line) => normalizePersonName(line)).filter((line) => line.length > 0);
  if (cleaned.length === 0) return { name: "", full_name: null };
  if (cleaned.length === 1) return { name: cleaned[0], full_name: cleaned[0] };

  const preferred = cleaned.slice(1).join(" ").trim() || cleaned.join(" ").trim();
  return {
    name: preferred,
    full_name: preferred,
  };
}

function parseSequentialLineupEntries(sectionLines: string[]) {
  const effectiveLines: string[] = [];
  for (const line of sectionLines) {
    const folded = foldForMatch(line);
    if (folded.includes("CAPIT") || folded.startsWith("*T = TITULAR")) {
      break;
    }
    effectiveLines.push(line);
  }

  const lines = effectiveLines.filter((line) => !isLineupNoise(line));
  const entries: RawPlayerEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    const leftShirt = lines[i]?.match(/^\d{1,2}$/) ? Number(lines[i]) : null;
    if (leftShirt === null) {
      i += 1;
      continue;
    }

    i += 1;
    const leftNameLines: string[] = [];
    while (i < lines.length && !isTokenLine(lines[i])) {
      leftNameLines.push(lines[i]);
      i += 1;
    }
    if (i >= lines.length || !isTokenLine(lines[i])) break;

    const leftToken = parseTokenLine(lines[i], true);
    i += 1;
    if (!leftToken?.role) continue;

    const rightShirt = leftToken.trailing_shirt;
    const rightNameLines: string[] = [];
    while (i < lines.length && !isTokenLine(lines[i])) {
      rightNameLines.push(lines[i]);
      i += 1;
    }
    if (i >= lines.length || !isTokenLine(lines[i])) break;

    const rightToken = parseTokenLine(lines[i], false);
    i += 1;
    if (!rightToken?.role || rightShirt === null) continue;

    const leftIdentity = buildCanonicalNameFromLines(leftNameLines);
    const rightIdentity = buildCanonicalNameFromLines(rightNameLines);

    if (leftIdentity.name) {
      entries.push({
        team_side: "HOME",
        shirt_number: leftShirt,
        cbf_registry: leftToken.cbf_registry,
        role: leftToken.role,
        is_captain: false,
        name: leftIdentity.name,
        full_name: leftIdentity.full_name,
      });
    }

    if (rightIdentity.name) {
      entries.push({
        team_side: "AWAY",
        shirt_number: rightShirt,
        cbf_registry: rightToken.cbf_registry,
        role: rightToken.role,
        is_captain: false,
        name: rightIdentity.name,
        full_name: rightIdentity.full_name,
      });
    }
  }

  return entries;
}

function buildLineup(entries: RawPlayerEntry[], teamSide: CanonicalTeamSide, teamName: string | null): CanonicalTeamLineup {
  const starters: CanonicalAthlete[] = [];
  const reserves: CanonicalAthlete[] = [];
  const seen = new Set<string>();

  for (const entry of entries.filter((item) => item.team_side === teamSide)) {
    const dedupeKey = `${entry.shirt_number ?? "na"}|${foldForMatch(entry.full_name ?? entry.name)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const athlete: CanonicalAthlete = {
      name: entry.name,
      full_name: entry.full_name,
      shirt_number: entry.shirt_number,
      cbf_registry: entry.cbf_registry,
      role: entry.role ?? undefined,
      is_captain: entry.is_captain,
    };

    if (entry.role === "STARTER" || entry.role === "GK_STARTER") {
      starters.push(athlete);
    } else {
      reserves.push(athlete);
    }
  }

  return {
    team_name: teamName,
    starters,
    reserves,
  };
}

function buildTeamLookup(lineup: CanonicalTeamLineup): TeamLookup {
  const byShirt = new Map<number, CanonicalAthlete>();
  const byName = new Map<string, CanonicalAthlete>();

  for (const athlete of [...lineup.starters, ...lineup.reserves]) {
    if (typeof athlete.shirt_number === "number") {
      if (!byShirt.has(athlete.shirt_number)) {
        byShirt.set(athlete.shirt_number, athlete);
      }
    }

    if (!byName.has(foldForMatch(athlete.name))) {
      byName.set(foldForMatch(athlete.name), athlete);
    }
    if (athlete.full_name) {
      if (!byName.has(foldForMatch(athlete.full_name))) {
        byName.set(foldForMatch(athlete.full_name), athlete);
      }
    }
  }

  return { byShirt, byName };
}

function createTeamContext(meta: CanonicalMatchMeta, lineups: CanonicalReport["lineups"]): TeamContext {
  return {
    home_team: meta.home_team ?? lineups.home.team_name ?? null,
    away_team: meta.away_team ?? lineups.away.team_name ?? null,
    home_lookup: buildTeamLookup(lineups.home),
    away_lookup: buildTeamLookup(lineups.away),
  };
}

function getLookupForSide(context: TeamContext, side: CanonicalTeamSide) {
  return side === "HOME" ? context.home_lookup : context.away_lookup;
}

function resolveTeamSide(context: TeamContext, raw: string | null | undefined): CanonicalTeamSide | null {
  const folded = foldForMatch(raw ?? "");
  if (!folded) return null;

  const home = foldForMatch(context.home_team ?? "");
  const away = foldForMatch(context.away_team ?? "");

  if (home && (folded.includes(home) || home.includes(folded))) return "HOME";
  if (away && (folded.includes(away) || away.includes(folded))) return "AWAY";

  return null;
}

function findAthlete(context: TeamContext, side: CanonicalTeamSide, shirtNumber: number | null, nameLines: string[]) {
  const lookup = getLookupForSide(context, side);
  if (shirtNumber !== null && lookup.byShirt.has(shirtNumber)) {
    return lookup.byShirt.get(shirtNumber) ?? null;
  }

  const fullName = buildCanonicalNameFromLines(nameLines).name;
  const foldedName = foldForMatch(fullName);
  if (!foldedName) return null;

  if (lookup.byName.has(foldedName)) {
    return lookup.byName.get(foldedName) ?? null;
  }

  for (const [key, athlete] of lookup.byName.entries()) {
    if (key.includes(foldedName) || foldedName.includes(key)) {
      return athlete;
    }
  }

  return null;
}

function parseTimedWithShirt(line: string) {
  const match = line.match(TIMED_WITH_SHIRT_REGEX);
  if (!match) return null;

  const rawPhase = match[2].toUpperCase() as CanonicalCardPhase | CanonicalMatchPhase;
  const half = rawPhase === "2T" || rawPhase === "POS" ? 2 : 1;
  const minute = rawPhase === "INT" ? 45 : rawPhase === "POS" ? 90 : Number(match[1]);

  return {
    half: half as 1 | 2,
    minute,
    raw_phase: rawPhase,
    shirt_number: Number(match[3]),
    remainder: normalizeInlineText(match[4]),
  };
}

function isFootnoteLine(line: string) {
  return line.startsWith("**1T =");
}

function isSectionBoundary(line: string) {
  return SECTION_HEADER_REGEX.test(line);
}

function parseSequentialGoals(sectionLines: string[], context: TeamContext) {
  const events: CanonicalReport["events"] = [];
  let i = 0;

  while (i < sectionLines.length) {
    const parsed = parseTimedWithShirt(sectionLines[i]);
    if (!parsed || (parsed.raw_phase !== "1T" && parsed.raw_phase !== "2T")) {
      i += 1;
      continue;
    }

    i += 1;
    const chunk: string[] = [];
    while (
      i < sectionLines.length &&
      !parseTimedWithShirt(sectionLines[i]) &&
      !isFootnoteLine(sectionLines[i]) &&
      !isSectionBoundary(sectionLines[i])
    ) {
      chunk.push(sectionLines[i]);
      i += 1;
    }

    const teamLine = chunk.findLast((line) => resolveTeamSide(context, line) !== null) ?? null;
    const teamSide = resolveTeamSide(context, teamLine);
    if (!teamSide) continue;

    const nameLines = chunk.filter((line) => line !== teamLine);
    const athlete = findAthlete(context, teamSide, parsed.shirt_number, nameLines);
    const identity = buildCanonicalNameFromLines(nameLines);

    events.push({
      type: "GOAL",
      team_side: teamSide,
      half: parsed.half,
      minute: parsed.minute,
      raw_phase: parsed.raw_phase as CanonicalMatchPhase,
      athlete_name: athlete?.name ?? identity.name,
      shirt_number: parsed.shirt_number,
      cbf_registry: athlete?.cbf_registry ?? null,
      kind: "GOAL",
    });
  }

  return events;
}

function parseSequentialCards(sectionLines: string[], context: TeamContext, fallbackCardType: "YELLOW" | "RED") {
  const events: CanonicalCardEvent[] = [];
  let i = 0;

  while (i < sectionLines.length) {
    const parsed = parseTimedWithShirt(sectionLines[i]);
    if (!parsed) {
      i += 1;
      continue;
    }

    i += 1;
    const chunk: string[] = [];
    while (
      i < sectionLines.length &&
      !parseTimedWithShirt(sectionLines[i]) &&
      !isFootnoteLine(sectionLines[i]) &&
      !isSectionBoundary(sectionLines[i])
    ) {
      chunk.push(sectionLines[i]);
      i += 1;
    }

    const teamLine = chunk.findLast((line) => resolveTeamSide(context, line) !== null) ?? null;
    const teamSide = resolveTeamSide(context, teamLine);
    if (!teamSide) continue;

    const contentLines = chunk.filter((line) => line !== teamLine);
    const athlete = findAthlete(context, teamSide, parsed.shirt_number, contentLines);
    const identity = buildCanonicalNameFromLines(contentLines);
    const reason = normalizePersonName(contentLines.slice(Math.min(contentLines.length, 2)).join(" ")) || null;
    const joined = foldForMatch([parsed.remainder, ...contentLines].join(" "));
    const cardType =
      fallbackCardType === "RED" && joined.includes("2CA") ? "SECOND_YELLOW" : fallbackCardType;

    events.push({
      type: "CARD",
      team_side: teamSide,
      half: parsed.half,
      minute: parsed.minute,
      raw_phase: parsed.raw_phase as CanonicalCardPhase,
      athlete_name: athlete?.name ?? identity.name,
      shirt_number: parsed.shirt_number,
      card_type: cardType,
      reason,
    });
  }

  return events;
}

function parseSubPlayer(lines: string[], startIndex: number) {
  const header = lines[startIndex]?.match(SUB_PLAYER_REGEX);
  if (!header) return null;

  const shirt_number = Number(header[1]);
  const nameLines = [header[2]];
  let nextIndex = startIndex + 1;

  while (nextIndex < lines.length && !SUB_PLAYER_REGEX.test(lines[nextIndex])) {
    nameLines.push(lines[nextIndex]);
    nextIndex += 1;
  }

  return {
    shirt_number,
    nameLines,
    nextIndex,
  };
}

function parseSequentialSubstitutions(sectionLines: string[], context: TeamContext) {
  const events: CanonicalSubstitutionEvent[] = [];
  let i = 0;

  while (i < sectionLines.length) {
    const header = sectionLines[i].match(TIMED_WITH_TEAM_REGEX);
    if (!header) {
      i += 1;
      continue;
    }

    const rawPhase = header[2].toUpperCase() as CanonicalSubstitutionPhase;
    if (rawPhase === "POS") {
      i += 1;
      continue;
    }

    const half = rawPhase === "2T" ? 2 : 1;
    const minute = rawPhase === "INT" ? 45 : Number(header[1]);
    const teamSide = resolveTeamSide(context, header[3]);
    i += 1;

    const chunk: string[] = [];
    while (
      i < sectionLines.length &&
      !sectionLines[i].match(TIMED_WITH_TEAM_REGEX) &&
      !isFootnoteLine(sectionLines[i]) &&
      !isSectionBoundary(sectionLines[i])
    ) {
      chunk.push(sectionLines[i]);
      i += 1;
    }

    if (!teamSide || chunk.length < 2) continue;

    const outPlayer = parseSubPlayer(chunk, 0);
    if (!outPlayer) continue;
    const inPlayer = parseSubPlayer(chunk, outPlayer.nextIndex);
    if (!inPlayer) continue;

    const athleteOut = findAthlete(context, teamSide, outPlayer.shirt_number, outPlayer.nameLines);
    const athleteIn = findAthlete(context, teamSide, inPlayer.shirt_number, inPlayer.nameLines);
    const outIdentity = buildCanonicalNameFromLines(outPlayer.nameLines);
    const inIdentity = buildCanonicalNameFromLines(inPlayer.nameLines);

    events.push({
      type: "SUBSTITUTION",
      team_side: teamSide,
      half,
      minute,
      raw_phase: rawPhase,
      athlete_out_name: athleteOut?.name ?? outIdentity.name,
      athlete_out_shirt_number: outPlayer.shirt_number,
      athlete_in_name: athleteIn?.name ?? inIdentity.name,
      athlete_in_shirt_number: inPlayer.shirt_number,
    });
  }

  return events;
}

export function parseToCanonical(rawText: string): CanonicalReport {
  const lines = toLines(rawText);
  const sections = splitSections(lines);
  const meta = parseMatchMeta(getSectionLines(sections, "PREAMBLE"), getSectionLines(sections, "2.0"));
  const lineupEntries = parseSequentialLineupEntries(getSectionLines(sections, "4.0"));
  const lineups = {
    home: buildLineup(lineupEntries, "HOME", meta.home_team),
    away: buildLineup(lineupEntries, "AWAY", meta.away_team),
  };
  const context = createTeamContext(meta, lineups);

  const events = [
    ...parseSequentialGoals(getSectionLines(sections, "6.0"), context),
    ...parseSequentialCards(getSectionLines(sections, "7.0"), context, "YELLOW"),
    ...parseSequentialCards(getSectionLines(sections, "8.0"), context, "RED"),
    ...parseSequentialSubstitutions(getSectionLines(sections, "11.0"), context),
  ];

  return {
    match_meta: meta,
    lineups,
    events,
  };
}
