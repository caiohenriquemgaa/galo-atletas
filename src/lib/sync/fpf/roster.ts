import { load } from "cheerio";

export type FpfRosterAthlete = {
  cbf_registry: string;
  name: string;
  nickname: string;
  habilitation_date: string;
  club_name: string;
};

export type FpfRosterDebug = {
  rows_total: number;
  galo_rows: number;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeClubForFilter(value: string) {
  const normalized = normalizeText(value);
  return normalized.includes("GALO") && normalized.includes("MARINGA");
}

function parseDate(value: string) {
  const text = sanitizeText(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function findGaloRosterTable($: ReturnType<typeof load>) {
  const headings = $("h1, h2, h3").toArray();
  for (const heading of headings) {
    const title = sanitizeText($(heading).text());
    if (!normalizeClubForFilter(title)) continue;

    const nextTable = $(heading).nextAll("table").first();
    if (nextTable.length > 0) return nextTable;

    const parentTable = $(heading).parent().nextAll("table").first();
    if (parentTable.length > 0) return parentTable;
  }
  return null;
}

function cleanCbfRegistry(value: string) {
  const onlyDigits = sanitizeText(value).replace(/\D/g, "");
  return /^\d+$/.test(onlyDigits) ? onlyDigits : "";
}

function resolveHeaderIndex(headers: string[], matcher: (header: string) => boolean, fallback: number) {
  const idx = headers.findIndex((header) => matcher(normalizeText(header)));
  return idx >= 0 ? idx : fallback;
}

function resolveCompetitionRosterUrl(base: string) {
  return `${base.replace(/\/+$/, "")}/atletas-habilitados`;
}

export async function fetchEligibleAthletesWithDebug(competitionUrlBase: string): Promise<{
  athletes: FpfRosterAthlete[];
  debug: FpfRosterDebug;
}> {
  const rosterUrl = resolveCompetitionRosterUrl(competitionUrlBase);

  try {
    const response = await fetch(rosterUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GaloAtletasSync/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`FPF roster request failed (${response.status}) for ${rosterUrl}`);
    }

    const html = await response.text();
    const $ = load(html);

    const galoTable = findGaloRosterTable($);
    if (!galoTable || galoTable.length === 0) {
      return {
        athletes: [],
        debug: {
          rows_total: 0,
          galo_rows: 0,
        },
      };
    }

    const athletes: FpfRosterAthlete[] = [];
    let rows_total = 0;
    let galo_rows = 0;

    const headerCells = galoTable
      .find("thead tr th")
      .toArray()
      .map((cell) => sanitizeText($(cell).text()))
      .filter(Boolean);

    const fallbackHeaderCells =
      headerCells.length > 0
        ? headerCells
        : galoTable
            .find("tr")
            .first()
            .find("th,td")
            .toArray()
            .map((cell) => sanitizeText($(cell).text()))
            .filter(Boolean);

    const nicknameIdx = resolveHeaderIndex(
      fallbackHeaderCells,
      (header) => header.includes("APELIDO"),
      0
    );
    const nameIdx = resolveHeaderIndex(
      fallbackHeaderCells,
      (header) => header.includes("NOME"),
      1
    );
    const cbfIdx = resolveHeaderIndex(
      fallbackHeaderCells,
      (header) => header.includes("REGISTRO") || header.includes("CBF"),
      2
    );
    const habilitationIdx = resolveHeaderIndex(
      fallbackHeaderCells,
      (header) => header.includes("HABILIT"),
      3
    );

    galoTable.find("tbody tr, tr").each((_, row) => {
      const cells = $(row)
        .find("td,th")
        .toArray()
        .map((cell) => sanitizeText($(cell).text()))
        .filter(Boolean);

      if (cells.length < 3) return;
      if (normalizeText(cells.join(" ")).includes("REGISTRO CBF")) return;

      rows_total += 1;

      const cbf_registry = cleanCbfRegistry(cells[cbfIdx] ?? "");
      const name = sanitizeText(cells[nameIdx] ?? "");
      const nickname = sanitizeText(cells[nicknameIdx] ?? "");
      const habilitation_date = parseDate(cells[habilitationIdx] ?? "");

      if (!cbf_registry || !name) return;
      if (name.length > 100 || nickname.length > 100) return;

      galo_rows += 1;

      athletes.push({
        cbf_registry,
        name,
        nickname,
        habilitation_date,
        club_name: "GALO MARINGA",
      });
    });

    const deduped = new Map<string, FpfRosterAthlete>();
    for (const athlete of athletes) {
      if (!deduped.has(athlete.cbf_registry)) {
        deduped.set(athlete.cbf_registry, athlete);
      }
    }

    return {
      athletes: Array.from(deduped.values()),
      debug: {
        rows_total,
        galo_rows,
      },
    };
  } catch {
    return {
      athletes: [],
      debug: {
        rows_total: 0,
        galo_rows: 0,
      },
    };
  }
}

export async function fetchEligibleAthletes(competitionUrlBase: string): Promise<FpfRosterAthlete[]> {
  const { athletes } = await fetchEligibleAthletesWithDebug(competitionUrlBase);
  return athletes;
}
