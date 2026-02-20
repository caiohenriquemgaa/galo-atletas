import { createHash } from "node:crypto";
import { load } from "cheerio";

export type FpfNormalizedMatch = {
  source: "FPF";
  competition_name: string;
  season_year: number;
  match_date: Date;
  home_team: string;
  away_team: string;
  goals_home: number | null;
  goals_away: number | null;
  details_url: string | null;
  external_id: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isGaloMaringa(teamName: string) {
  const normalized = normalizeText(teamName);
  return normalized.includes("GALO") && normalized.includes("MARING");
}

function parseDate(raw: string): Date | null {
  const match = raw.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseScore(raw: string): { goalsHome: number | null; goalsAway: number | null } {
  const match = raw.match(/(\d+)\s*[xX\-]\s*(\d+)/);
  if (!match) return { goalsHome: null, goalsAway: null };

  return {
    goalsHome: Number(match[1]),
    goalsAway: Number(match[2]),
  };
}

function extractTeamsFromText(raw: string): { homeTeam: string; awayTeam: string } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();

  const match = cleaned.match(/([A-Za-zÀ-ÿ0-9 .'\-]{3,})\s+(?:x|vs|v)\s+([A-Za-zÀ-ÿ0-9 .'\-]{3,})/i);
  if (!match) return null;

  return {
    homeTeam: match[1].trim(),
    awayTeam: match[2].trim(),
  };
}

function extractTeamsFromCells(cells: string[]): { homeTeam: string; awayTeam: string } | null {
  const candidates = cells
    .map((cell) => cell.replace(/\s+/g, " ").trim())
    .filter((cell) => cell.length >= 3)
    .filter((cell) => !/(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/.test(cell))
    .filter((cell) => !/(\d+\s*[xX\-]\s*\d+)/.test(cell));

  if (candidates.length < 2) return null;

  return {
    homeTeam: candidates[0],
    awayTeam: candidates[1],
  };
}

function absoluteUrl(urlBase: string, href: string) {
  try {
    return new URL(href, urlBase).toString();
  } catch {
    return null;
  }
}

function deriveExternalId(detailsUrl: string | null, fallbackSeed: string) {
  if (detailsUrl) {
    const idFromUrl = detailsUrl.match(/(?:jogo|partida|match|id)[=\/-](\d+)/i)?.[1];
    if (idFromUrl) return idFromUrl;
  }

  return createHash("sha256").update(detailsUrl ?? fallbackSeed).digest("hex").slice(0, 24);
}

function deriveCompetitionMeta(pageTitle: string) {
  const title = pageTitle.replace(/\s+/g, " ").trim();
  const year = Number(title.match(/(20\d{2})/)?.[1] ?? "0");

  return {
    competitionName: title || "FPF",
    seasonYear: Number.isFinite(year) && year > 0 ? year : new Date().getFullYear(),
  };
}

export async function fetchCompetitionMatches(url_base: string): Promise<FpfNormalizedMatch[]> {
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
  const $ = load(html);

  const pageTitle = $("h1").first().text() || $("title").text() || "FPF";
  const meta = deriveCompetitionMeta(pageTitle);

  const parsedRows: FpfNormalizedMatch[] = [];

  $("tr").each((_, row) => {
    try {
      const rowText = $(row).text().replace(/\s+/g, " ").trim();
      if (!rowText) return;

      const date = parseDate(rowText);
      if (!date) return;

      const cells = $(row)
        .find("td")
        .map((__, cell) => $(cell).text())
        .get();

      const teams = extractTeamsFromCells(cells) ?? extractTeamsFromText(rowText);
      if (!teams) return;

      if (!isGaloMaringa(teams.homeTeam) && !isGaloMaringa(teams.awayTeam)) return;

      const score = parseScore(rowText);

      const detailsHref =
        $(row).find('a[href*="jogo"], a[href*="sumula"], a[href*="partida"], a[href]').first().attr("href") ?? null;
      const detailsUrl = detailsHref ? absoluteUrl(url_base, detailsHref) : null;

      const fallbackSeed = `${date.toISOString()}|${teams.homeTeam}|${teams.awayTeam}`;
      const externalId = deriveExternalId(detailsUrl, fallbackSeed);

      parsedRows.push({
        source: "FPF",
        competition_name: meta.competitionName,
        season_year: meta.seasonYear,
        match_date: date,
        home_team: teams.homeTeam,
        away_team: teams.awayTeam,
        goals_home: score.goalsHome,
        goals_away: score.goalsAway,
        details_url: detailsUrl,
        external_id: externalId,
      });
    } catch {
      // tolerant parser: ignore malformed rows
    }
  });

  return parsedRows;
}
