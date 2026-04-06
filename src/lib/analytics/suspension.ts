"use client";

export type SuspensionMatchInfo = {
  id: string;
  competition_name: string;
  season_year: number;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number | null;
  goals_against: number | null;
};

export type SuspensionStatRow = {
  athlete_id: string | null;
  yellow_cards: number | null;
  red_cards: number | null;
  match: SuspensionMatchInfo | null;
};

export type SuspensionAlert = {
  athleteId: string;
  reason: string;
  yellowCountInCycle: number;
};

export type SuspensionRiskAlert = {
  athleteId: string;
  yellowCountInCycle: number;
};

export type AthleteSuspensionHistoryItem = {
  athleteId: string;
  reason: string;
  yellowCountInCycle: number;
  triggerMatch: SuspensionMatchInfo;
  targetMatch: SuspensionMatchInfo;
  status: "served" | "pending";
};

export type NextMatchSuspensionsResult = {
  supported: boolean;
  nextMatch: SuspensionMatchInfo | null;
  alerts: SuspensionAlert[];
  risks: SuspensionRiskAlert[];
};

const REC_COMPETITION_NAME = "Paranaense Sub-20 2026 - 1a Divisao";
const REC_SEASON = 2026;

function normalizeCompetitionName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ª/g, "a")
    .replace(/º/g, "o")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSupportedRecCompetition(match: SuspensionMatchInfo) {
  return (
    match.season_year === REC_SEASON &&
    normalizeCompetitionName(match.competition_name) === normalizeCompetitionName(REC_COMPETITION_NAME)
  );
}

function isCompletedMatch(match: SuspensionMatchInfo) {
  return match.goals_for !== null && match.goals_against !== null;
}

function getYellowCycleStartMatchIndex(matchIndex: number) {
  if (matchIndex <= 11) return 1;
  if (matchIndex <= 15) return 12;
  return 16;
}

function getSuspensionReason(input: { latestYellowTriggered: boolean; latestRed: number }) {
  if (input.latestRed > 0 && input.latestYellowTriggered) {
    return "Vermelho e 3o amarelo";
  }
  if (input.latestRed > 0) {
    return "Cartao vermelho";
  }
  if (input.latestYellowTriggered) {
    return "3o amarelo";
  }
  return null;
}

function getSupportedCompetitionMatches(matches: SuspensionMatchInfo[]) {
  return matches.filter(isSupportedRecCompetition).sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());
}

function getRelevantRows(input: { matches: SuspensionMatchInfo[]; statsRows: SuspensionStatRow[] }) {
  const supportedMatchIds = new Set(input.matches.map((match) => match.id));

  return input.statsRows.filter((row): row is SuspensionStatRow & { athlete_id: string; match: SuspensionMatchInfo } => {
    return !!row.athlete_id && !!row.match && supportedMatchIds.has(row.match.id);
  });
}

export function getNextMatchSuspensions(input: {
  matches: SuspensionMatchInfo[];
  statsRows: SuspensionStatRow[];
}): NextMatchSuspensionsResult {
  const competitionMatches = getSupportedCompetitionMatches(input.matches);

  if (competitionMatches.length === 0) {
    return {
      supported: false,
      nextMatch: null,
      alerts: [],
      risks: [],
    };
  }

  const lastCompletedIndex = competitionMatches.reduce((acc, match, index) => (isCompletedMatch(match) ? index : acc), -1);
  const nextMatch = competitionMatches.slice(lastCompletedIndex + 1).find((match) => !isCompletedMatch(match)) ?? null;

  if (lastCompletedIndex < 0 || !nextMatch) {
    return {
      supported: true,
      nextMatch,
      alerts: [],
      risks: [],
    };
  }

  const latestCompletedMatch = competitionMatches[lastCompletedIndex];
  const latestMatchNumber = lastCompletedIndex + 1;
  const latestCycleStartMatchNumber = getYellowCycleStartMatchIndex(latestMatchNumber);
  const nextMatchNumber = competitionMatches.findIndex((match) => match.id === nextMatch.id) + 1;
  const nextCycleStartMatchNumber = getYellowCycleStartMatchIndex(nextMatchNumber);

  const latestCycleMatchIds = new Set(
    competitionMatches.slice(latestCycleStartMatchNumber - 1, lastCompletedIndex + 1).map((match) => match.id)
  );
  const relevantRows = getRelevantRows({
    matches: competitionMatches,
    statsRows: input.statsRows,
  });

  const latestMatchRows = relevantRows.filter((row) => row.match.id === latestCompletedMatch.id);
  const rowsByAthlete = relevantRows.reduce<Map<string, Array<SuspensionStatRow & { athlete_id: string; match: SuspensionMatchInfo }>>>(
    (acc, row) => {
      const current = acc.get(row.athlete_id) ?? [];
      current.push(row);
      acc.set(row.athlete_id, current);
      return acc;
    },
    new Map()
  );

  const alerts: SuspensionAlert[] = [];

  for (const latestRow of latestMatchRows) {
    const athleteRowsInCycle = (rowsByAthlete.get(latestRow.athlete_id) ?? []).filter((row) => latestCycleMatchIds.has(row.match.id));
    const yellowCountInCycle = athleteRowsInCycle.reduce((acc, row) => acc + (row.yellow_cards ?? 0), 0);
    const latestYellow = latestRow.yellow_cards ?? 0;
    const latestRed = latestRow.red_cards ?? 0;
    const previousYellowCount = yellowCountInCycle - latestYellow;
    const latestYellowTriggered =
      latestYellow > 0 && Math.floor(previousYellowCount / 3) < Math.floor(yellowCountInCycle / 3) && yellowCountInCycle >= 3;
    const reason = getSuspensionReason({
      latestYellowTriggered,
      latestRed,
    });

    if (!reason) continue;

    alerts.push({
      athleteId: latestRow.athlete_id,
      reason,
      yellowCountInCycle,
    });
  }

  const suspendedIds = new Set(alerts.map((alert) => alert.athleteId));
  const risks: SuspensionRiskAlert[] = [];

  if (latestCycleStartMatchNumber === nextCycleStartMatchNumber) {
    for (const [athleteId, athleteRows] of rowsByAthlete.entries()) {
      if (suspendedIds.has(athleteId)) continue;

      const yellowCountInCycle = athleteRows
        .filter((row) => latestCycleMatchIds.has(row.match.id))
        .reduce((acc, row) => acc + (row.yellow_cards ?? 0), 0);

      if (yellowCountInCycle > 0 && yellowCountInCycle % 3 === 2) {
        risks.push({
          athleteId,
          yellowCountInCycle,
        });
      }
    }
  }

  alerts.sort((a, b) => a.athleteId.localeCompare(b.athleteId));
  risks.sort((a, b) => a.athleteId.localeCompare(b.athleteId));

  return {
    supported: true,
    nextMatch,
    alerts,
    risks,
  };
}

export function getAthleteSuspensionHistory(input: {
  athleteId: string;
  matches: SuspensionMatchInfo[];
  statsRows: SuspensionStatRow[];
}) {
  const competitionMatches = getSupportedCompetitionMatches(input.matches);

  if (competitionMatches.length === 0) {
    return {
      supported: false,
      history: [] as AthleteSuspensionHistoryItem[],
    };
  }

  const relevantRows = getRelevantRows({
    matches: competitionMatches,
    statsRows: input.statsRows,
  }).filter((row) => row.athlete_id === input.athleteId);

  const athleteRowsByMatchId = relevantRows.reduce<Map<string, SuspensionStatRow & { athlete_id: string; match: SuspensionMatchInfo }>>((acc, row) => {
    acc.set(row.match.id, row);
    return acc;
  }, new Map());

  const history: AthleteSuspensionHistoryItem[] = [];

  for (const [index, match] of competitionMatches.entries()) {
    if (!isCompletedMatch(match)) continue;

    const currentRow = athleteRowsByMatchId.get(match.id);
    if (!currentRow) continue;

    const matchNumber = index + 1;
    const cycleStartMatchNumber = getYellowCycleStartMatchIndex(matchNumber);
    const cycleMatchIds = new Set(competitionMatches.slice(cycleStartMatchNumber - 1, index + 1).map((item) => item.id));
    const yellowCountInCycle = relevantRows
      .filter((row) => cycleMatchIds.has(row.match.id))
      .reduce((acc, row) => acc + (row.yellow_cards ?? 0), 0);
    const latestYellow = currentRow.yellow_cards ?? 0;
    const latestRed = currentRow.red_cards ?? 0;
    const previousYellowCount = yellowCountInCycle - latestYellow;
    const latestYellowTriggered =
      latestYellow > 0 && Math.floor(previousYellowCount / 3) < Math.floor(yellowCountInCycle / 3) && yellowCountInCycle >= 3;
    const reason = getSuspensionReason({
      latestYellowTriggered,
      latestRed,
    });
    const targetMatch = competitionMatches[index + 1] ?? null;

    if (!reason || !targetMatch) continue;

    history.push({
      athleteId: input.athleteId,
      reason,
      yellowCountInCycle,
      triggerMatch: match,
      targetMatch,
      status: isCompletedMatch(targetMatch) ? "served" : "pending",
    });
  }

  return {
    supported: true,
    history,
  };
}
