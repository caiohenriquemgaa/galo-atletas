import { load } from "cheerio";
import type { AnyNode } from "domhandler";

export type FpfNormalizedMatch = {
  competition_name: string;
  season_year: number;
  match_date: Date;
  home_team: string;
  away_team: string;
  goals_home: number | null;
  goals_away: number | null;
  details_url: string | null;
};

export type FpfAdapterDebug = {
  fetched_bytes: number;
  anchors_found: number;
  candidates_parsed: number;
  candidates_discarded_too_long: number;
  imported: number;
  rows_with_x_found: number;
  galo_rows_found: number;
};

export type FpfMatchDetails = {
  goals_home?: number;
  goals_away?: number;
  venue?: string;
  kickoff_time?: string;
  referee?: string;
  home_team?: string;
  away_team?: string;
};

const SCORE_EXACT_REGEX = /^\s*\d{1,2}\s*[x×]\s*\d{1,2}\s*$/;
const SCORE_CAPTURE_REGEX = /(\d{1,2})\s*[x×]\s*(\d{1,2})/;
const BANNED_TEAM_WORDS = ["federacao", "cookies", "diretoria", "menu", "politica"];

type ParsedLine = {
  match_date: Date;
  home_team: string;
  away_team: string;
  goals_home: number | null;
  goals_away: number | null;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTeamName(value: string) {
  return value
    .replace(/\b(SOBRE O JOGO|ESTADIO|ESTÁDIO|LOCAL|RODADA|HORARIO|HORÁRIO|HORA|DATA|ARBITRO|ÁRBITRO|ARBITRAGEM)\b/gi, " ")
    .replace(/[0-9]{1,2}\s*[x×]\s*[0-9]{1,2}/g, " ")
    .replace(/\d{2}\/\d{2}(?:\/\d{4})?/g, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[|•]/g, " ")
    .replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+$/g, "")
    .trim();
}

function containsGaloMaringa(teamName: string) {
  const normalized = normalizeText(teamName);
  return normalized.includes("GALO") && normalized.includes("MARINGA");
}

function parseDate(raw: string, fallbackYear: number): Date | null {
  const fullMatch = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (fullMatch) {
    const [, dd, mm, yyyy] = fullMatch;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const shortMatch = raw.match(/(\d{2})\/(\d{2})/);
  if (shortMatch) {
    const [, dd, mm] = shortMatch;
    const date = new Date(fallbackYear, Number(mm) - 1, Number(dd));
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function parseScore(raw: string): { goalsHome: number | null; goalsAway: number | null } {
  const scoreMatch = raw.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!scoreMatch) return { goalsHome: null, goalsAway: null };

  return {
    goalsHome: Number(scoreMatch[1]),
    goalsAway: Number(scoreMatch[2]),
  };
}

function parseTeams(raw: string): { homeTeam: string; awayTeam: string } | null {
  let working = raw.replace(/\s+/g, " ").trim();
  working = working.replace(/\bSOBRE O JOGO\b/gi, " ");
  working = working.replace(/\b\d{1,2}\s*[x×]\s*\d{1,2}\b/g, " ");
  working = working.replace(/\b\d{2}\/\d{2}(?:\/\d{4})?\b/g, " ");
  working = working.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  working = working.replace(/\s+/g, " ").trim();

  const splitMatch = /\s([x×])\s/i.exec(working);
  if (!splitMatch || splitMatch.index < 0) return null;

  const separator = splitMatch[0];
  const leftRaw = working.slice(0, splitMatch.index).trim();
  const rightRaw = working.slice(splitMatch.index + separator.length).trim();

  if (!leftRaw || !rightRaw) return null;

  const left = cleanTeamName(leftRaw.split(/(?:\||•| - )/).pop() ?? "");
  const right = cleanTeamName(rightRaw.split(/(?:\||•| - )/)[0] ?? "");

  if (!/[A-Za-zÀ-ÿ]/.test(left) || !/[A-Za-zÀ-ÿ]/.test(right)) return null;
  if (left.length > 80 || right.length > 80) return null;

  return { homeTeam: left, awayTeam: right };
}

function absoluteUrl(urlBase: string, href: string | null) {
  if (!href) return null;
  try {
    return new URL(href, urlBase).toString();
  } catch {
    return null;
  }
}

function deriveMetaFromPage(urlBase: string, title: string) {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const seasonFromTitle = Number(cleanTitle.match(/(20\d{2})/)?.[1] ?? "0");
  const seasonFromUrl = Number(urlBase.match(/\/(20\d{2})\//)?.[1] ?? "0");
  const season = seasonFromTitle || seasonFromUrl || new Date().getFullYear();

  return {
    competition_name: cleanTitle || "FPF",
    season_year: season,
  };
}

function parseLine(text: string, fallbackYear: number): ParsedLine | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;

  if (!/[x×]/i.test(compact)) return null;

  const date = parseDate(compact, fallbackYear);
  if (!date) return null;

  const teams = parseTeams(compact);
  if (!teams) return null;

  const score = parseScore(compact);

  return {
    match_date: date,
    home_team: teams.homeTeam,
    away_team: teams.awayTeam,
    goals_home: score.goalsHome,
    goals_away: score.goalsAway,
  };
}

function dedupeMatches(matches: FpfNormalizedMatch[]) {
  const map = new Map<string, FpfNormalizedMatch>();

  for (const match of matches) {
    const key = `${match.match_date.toISOString().slice(0, 10)}|${normalizeText(match.home_team)}|${normalizeText(match.away_team)}`;
    if (!map.has(key)) map.set(key, match);
  }

  return Array.from(map.values());
}

function sanitizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hasBannedTeamWord(value: string) {
  const normalized = normalizeText(value).toLowerCase();
  return BANNED_TEAM_WORDS.some((word) => normalized.includes(word));
}

function isValidTeamCandidate(value: string) {
  if (!value) return false;
  if (value.length >= 60) return false;
  if (hasBannedTeamWord(value)) return false;
  if (SCORE_EXACT_REGEX.test(value)) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(value)) return false;
  return true;
}

function pushUniqueShortText(target: string[], raw: string, maxLength = 50) {
  const text = sanitizeText(raw);
  if (!text || text.length > maxLength) return;
  if (target.includes(text)) return;
  target.push(text);
}

function extractLabeledSibling(
  $: ReturnType<typeof load>,
  root: ReturnType<ReturnType<typeof load>>,
  labels: string[]
) {
  const nodes = root
    .find("label,strong,b,span,p,dt,th,td")
    .toArray();

  for (const node of nodes) {
    const labelText = sanitizeText($(node).text());
    if (!labelText) continue;

    const matchesLabel = labels.some((label) =>
      normalizeText(labelText).includes(normalizeText(label))
    );
    if (!matchesLabel) continue;

    const siblingText = sanitizeText($(node).next().text());
    if (siblingText && siblingText.length <= 100) return siblingText;
  }

  return undefined;
}

function pickRowFromLink($: ReturnType<typeof load>, link: AnyNode) {
  const byTr = $(link).closest("tr");
  if (byTr.length > 0) return byTr;

  const byRow = $(link).closest(".row");
  if (byRow.length > 0) return byRow;

  const byArticle = $(link).closest("article");
  if (byArticle.length > 0) return byArticle;

  const parent = $(link).parent();
  if (parent.length > 0 && parent.parent().length > 0) return parent.parent();

  const byDiv = $(link).closest("div");
  if (byDiv.length > 0) return byDiv;

  return parent;
}

function hasTeamsContext(text: string) {
  return /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,60}\s*[x×]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,60}/i.test(text);
}

export async function fetchMatchDetails(detailsUrl: string): Promise<FpfMatchDetails> {
  try {
    const response = await fetch(detailsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GaloAtletasSync/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Match details request failed (${response.status})`);
    }

    const html = await response.text();
    const $ = load(html);
    const scoreElements = $("section,div,span,p,strong,h1,h2,h3,h4,h5,h6,td")
      .filter((_, el) => SCORE_EXACT_REGEX.test(sanitizeText($(el).text())))
      .toArray();

    for (const scoreEl of scoreElements) {
      const scoreText = sanitizeText($(scoreEl).text());
      const scoreMatch = scoreText.match(SCORE_CAPTURE_REGEX);
      if (!scoreMatch) continue;

      const scoreBlock = $(scoreEl).closest("section, div");
      if (!scoreBlock.length) continue;

      const candidates: string[] = [];

      $(scoreEl)
        .parent()
        .children()
        .each((_, node) => {
          pushUniqueShortText(candidates, $(node).text(), 50);
        });

      scoreBlock
        .find("h1,h2,h3,h4,h5,h6,p,span,strong,a,td")
        .each((_, node) => {
          pushUniqueShortText(candidates, $(node).text(), 50);
        });

      const teamCandidates = candidates.filter(isValidTeamCandidate).slice(0, 6);
      if (teamCandidates.length < 2) continue;

      const homeTeam = sanitizeText(teamCandidates[0]);
      const awayTeam = sanitizeText(teamCandidates[1]);

      if (!isValidTeamCandidate(homeTeam) || !isValidTeamCandidate(awayTeam)) continue;
      if (homeTeam.length > 100 || awayTeam.length > 100) continue;

      const blockText = sanitizeText(scoreBlock.text());
      const kickoffTimeMatch = blockText.match(/\b\d{2}:\d{2}\b/);

      const venue =
        extractLabeledSibling($, scoreBlock, ["Estádio", "Estadio", "Local"])?.slice(0, 100) ??
        undefined;
      const referee =
        extractLabeledSibling($, scoreBlock, ["Árbitro", "Arbitro", "Arbitragem"])?.slice(0, 100) ??
        undefined;

      return {
        goals_home: Number.parseInt(scoreMatch[1], 10),
        goals_away: Number.parseInt(scoreMatch[2], 10),
        venue,
        kickoff_time: kickoffTimeMatch?.[0],
        referee,
        home_team: homeTeam,
        away_team: awayTeam,
      };
    }

    return {};
  } catch {
    return {};
  }
}

export async function fetchCompetitionMatchesWithDebug(url_base: string) {
  const response = await fetch(url_base, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GaloAtletasSync/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`FPF request failed (${response.status}) for ${url_base}`);
  }

  const html = await response.text();
  const fetched_bytes = Buffer.byteLength(html, "utf8");
  const $ = load(html);

  const title = $("h1").first().text() || $("title").text() || "FPF";
  const meta = deriveMetaFromPage(url_base, title);

  const candidates: FpfNormalizedMatch[] = [];
  let anchors_found = 0;
  let candidates_parsed = 0;
  let candidates_discarded_too_long = 0;
  let rows_with_x_found = 0;

  // Strategy A: row text around links exactly "SOBRE O JOGO"
  const aboutLinks = $("a")
    .filter((_, el) => normalizeText($(el).text()) === "SOBRE O JOGO")
    .toArray();

  anchors_found = aboutLinks.length;

  for (const link of aboutLinks) {
    try {
    const href = $(link).attr("href") ?? null;
    const details_url = absoluteUrl(url_base, href);

    const row = pickRowFromLink($, link);
    const rowText = row.text().replace(/\s+/g, " ").trim();

    if (!rowText) continue;
    if (rowText.length > 400) {
      candidates_discarded_too_long += 1;
      continue;
    }
    if (!hasTeamsContext(rowText)) continue;

    rows_with_x_found += 1;

    const parsed = parseLine(rowText, meta.season_year);
    if (!parsed) continue;
    candidates_parsed += 1;

    candidates.push({
      competition_name: meta.competition_name,
      season_year: meta.season_year,
      match_date: parsed.match_date,
      home_team: parsed.home_team,
      away_team: parsed.away_team,
      goals_home: parsed.goals_home,
      goals_away: parsed.goals_away,
      details_url,
    });
    } catch {
      // tolerant parser
    }
  }

  // Strategy B fallback: sweep body chunks for pattern "×" + "SOBRE O JOGO"
  if (candidates.length === 0) {
    $("tr, article, .row, section, div").each((_, el) => {
      try {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (!text) return;
        if (text.length > 400) {
          candidates_discarded_too_long += 1;
          return;
        }

        const hasGameWord = normalizeText(text).includes("SOBRE O JOGO");
        if (!hasGameWord || !hasTeamsContext(text)) return;

        rows_with_x_found += 1;

        const parsed = parseLine(text, meta.season_year);
        if (!parsed) return;
        candidates_parsed += 1;

        const detailsHref = $(el)
          .find("a")
          .filter((__, anchor) => normalizeText($(anchor).text()) === "SOBRE O JOGO")
          .first()
          .attr("href") ?? null;
        const details_url = absoluteUrl(url_base, detailsHref);

        candidates.push({
          competition_name: meta.competition_name,
          season_year: meta.season_year,
          match_date: parsed.match_date,
          home_team: parsed.home_team,
          away_team: parsed.away_team,
          goals_home: parsed.goals_home,
          goals_away: parsed.goals_away,
          details_url,
        });
      } catch {
        // tolerant parser
      }
    });
  }

  const deduped = dedupeMatches(candidates);
  const filtered = deduped.filter(
    (match) => containsGaloMaringa(match.home_team) || containsGaloMaringa(match.away_team)
  );

  const galo_rows_found = filtered.length;

  return {
    matches: filtered,
    debug: {
      fetched_bytes,
      anchors_found,
      candidates_parsed,
      candidates_discarded_too_long,
      imported: filtered.length,
      rows_with_x_found,
      galo_rows_found,
    } as FpfAdapterDebug,
  };
}

export async function fetchCompetitionMatches(url_base: string): Promise<FpfNormalizedMatch[]> {
  const { matches } = await fetchCompetitionMatchesWithDebug(url_base);
  return matches;
}
