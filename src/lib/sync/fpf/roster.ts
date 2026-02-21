import { load } from "cheerio";

export type FpfRosterAthlete = {
  cbf_registry: string;
  name: string;
  birth_date?: string;
  position?: string;
  club_name: string;
};

export type FpfRosterDebug = {
  rows_total: number;
  rows_discarded: number;
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

function parseBirthDate(value: string) {
  const text = sanitizeText(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function looksLikeHeader(values: string[]) {
  const line = normalizeText(values.join(" "));
  return (
    line.includes("NOME") ||
    line.includes("ATLETA") ||
    line.includes("REGISTRO") ||
    line.includes("POSICAO") ||
    line.includes("CLUBE")
  );
}

function parseRowByHeader(headers: string[], values: string[]) {
  let cbf_registry = "";
  let name = "";
  let birthDate: string | undefined;
  let position: string | undefined;
  let clubName = "";

  headers.forEach((header, index) => {
    const value = sanitizeText(values[index] ?? "");
    const key = normalizeText(header);

    if (key.includes("REGISTRO") || key.includes("CBF")) cbf_registry = value;
    else if (key.includes("NOME") || key.includes("ATLETA")) name = value;
    else if (key.includes("NASC")) birthDate = parseBirthDate(value);
    else if (key.includes("POSICAO") || key.includes("POSI")) position = value;
    else if (key.includes("CLUBE") || key.includes("EQUIPE") || key.includes("TIME")) clubName = value;
  });

  return {
    cbf_registry: sanitizeText(cbf_registry),
    name: sanitizeText(name),
    birth_date: birthDate,
    position: position ? sanitizeText(position) : undefined,
    club_name: sanitizeText(clubName),
  };
}

function parseRowByGuess(values: string[]) {
  const sanitized = values.map((value) => sanitizeText(value));

  const cbf_registry = sanitized.find((value) => /\d{4,}/.test(value)) ?? "";
  const name = sanitized.find((value) => /[A-Za-zÀ-ÿ]/.test(value) && !/\d{2}\/\d{2}\/\d{4}/.test(value)) ?? "";
  const birthRaw = sanitized.find((value) => /\d{2}\/\d{2}\/\d{4}/.test(value));
  const club_name =
    sanitized.find((value) => normalizeText(value).includes("MARINGA") || normalizeText(value).includes("GALO")) ??
    "";
  const position =
    sanitized.find((value) =>
      ["GOLEIRO", "ZAGUEIRO", "LATERAL", "MEIA", "VOLANTE", "ATACANTE", "PONTA", "ALA"].some((pos) =>
        normalizeText(value).includes(pos)
      )
    ) ?? undefined;

  return {
    cbf_registry: sanitizeText(cbf_registry),
    name: sanitizeText(name),
    birth_date: birthRaw ? parseBirthDate(birthRaw) : undefined,
    position: position ? sanitizeText(position) : undefined,
    club_name: sanitizeText(club_name),
  };
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

    const athletes: FpfRosterAthlete[] = [];
    let rows_total = 0;
    let rows_discarded = 0;
    let galo_rows = 0;

    const tables = $("table").toArray();

    for (const table of tables) {
      const headerCells = $(table)
        .find("thead tr th")
        .toArray()
        .map((cell) => sanitizeText($(cell).text()))
        .filter(Boolean);

      const hasHeader = headerCells.length > 0;
      const headers = hasHeader ? headerCells : [];

      $(table)
        .find("tbody tr, tr")
        .each((_, row) => {
          const rowText = sanitizeText($(row).text());
          if (!rowText) return;

          rows_total += 1;

          if (rowText.length > 400) {
            rows_discarded += 1;
            return;
          }

          const cells = $(row)
            .find("td,th")
            .toArray()
            .map((cell) => sanitizeText($(cell).text()))
            .filter(Boolean);

          if (cells.length < 3) {
            rows_discarded += 1;
            return;
          }

          if (looksLikeHeader(cells)) {
            rows_discarded += 1;
            return;
          }

          const parsed = headers.length > 0 ? parseRowByHeader(headers, cells) : parseRowByGuess(cells);

          if (!parsed.cbf_registry || !parsed.name) {
            rows_discarded += 1;
            return;
          }

          if (!parsed.club_name || !normalizeClubForFilter(parsed.club_name)) {
            rows_discarded += 1;
            return;
          }

          if (parsed.name.length > 100) {
            rows_discarded += 1;
            return;
          }

          galo_rows += 1;

          athletes.push({
            cbf_registry: parsed.cbf_registry,
            name: parsed.name,
            birth_date: parsed.birth_date,
            position: parsed.position,
            club_name: "GALO MARINGA",
          });
        });
    }

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
        rows_discarded,
        galo_rows,
      },
    };
  } catch {
    return {
      athletes: [],
      debug: {
        rows_total: 0,
        rows_discarded: 0,
        galo_rows: 0,
      },
    };
  }
}

export async function fetchEligibleAthletes(competitionUrlBase: string): Promise<FpfRosterAthlete[]> {
  const { athletes } = await fetchEligibleAthletesWithDebug(competitionUrlBase);
  return athletes;
}

