import { load } from "cheerio";

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
  rows_with_x_found: number;
  galo_rows_found: number;
};

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
    .replace(/\s+/g, " ")
    .replace(/[|•]/g, " ")
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
  const normalizedX = raw.replace(/[×]/g, "x");
  const parts = normalizedX.split(/\sx\s/i).map((part) => cleanTeamName(part));

  if (parts.length < 2) return null;

  const left = parts[0];
  const right = parts[1];

  if (!/[A-Za-zÀ-ÿ]/.test(left) || !/[A-Za-zÀ-ÿ]/.test(right)) return null;

  const leftNoScore = left.replace(/\b\d+\b/g, "").trim();
  const rightNoScore = right.replace(/\b\d+\b/g, "").trim();

  if (!leftNoScore || !rightNoScore) return null;

  return {
    homeTeam: leftNoScore,
    awayTeam: rightNoScore,
  };
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
  let rows_with_x_found = 0;

  // Strategy A: anchor text / row text around links "SOBRE O JOGO"
  const aboutLinks = $("a")
    .filter((_, el) => normalizeText($(el).text()).includes("SOBRE O JOGO"))
    .toArray();

  anchors_found = aboutLinks.length;

  for (const link of aboutLinks) {
    const href = $(link).attr("href") ?? null;
    const details_url = absoluteUrl(url_base, href);

    const rowText = $(link).closest("tr").text().trim();
    const parentText = $(link).parent().text().trim();
    const fullText = $(link).closest("li,div,section,article").text().trim();

    const sourceText = [rowText, parentText, fullText, $(link).text()].find(
      (chunk) => chunk && /[x×]/i.test(chunk)
    );

    if (!sourceText) continue;

    rows_with_x_found += 1;

    const parsed = parseLine(sourceText, meta.season_year);
    if (!parsed) continue;

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
  }

  // Strategy B fallback: sweep body chunks for pattern "×" + "SOBRE O JOGO"
  if (candidates.length === 0) {
    $("tr, li, p, div").each((_, el) => {
      try {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (!text) return;

        const hasGameWord = normalizeText(text).includes("SOBRE O JOGO");
        if (!hasGameWord || !/[x×]/i.test(text)) return;

        rows_with_x_found += 1;

        const parsed = parseLine(text, meta.season_year);
        if (!parsed) return;

        const detailsHref = $(el).find("a[href]").first().attr("href") ?? null;
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
      rows_with_x_found,
      galo_rows_found,
    } as FpfAdapterDebug,
  };
}

export async function fetchCompetitionMatches(url_base: string): Promise<FpfNormalizedMatch[]> {
  const { matches } = await fetchCompetitionMatchesWithDebug(url_base);
  return matches;
}
