export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";

type AthleteRow = {
  id: string;
  name: string;
};

type MatchRow = {
  id: string;
  competition_name: string;
  season_year: number;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  match_duration_minutes: number | null;
};

type StatRow = {
  athlete_id: string | null;
  match_id: string | null;
  source: string | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
};

function normalizeFilterValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesCompetitionFilter(match: MatchRow, selectedCompetition: string) {
  if (selectedCompetition === "ALL") return true;
  if (match.competition_name === selectedCompetition) return true;
  return normalizeFilterValue(match.competition_name) === normalizeFilterValue(selectedCompetition);
}

function matchesSeasonFilter(match: MatchRow, selectedSeason: string) {
  return selectedSeason === "ALL" || String(match.season_year) === selectedSeason;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const selectedCompetition = url.searchParams.get("competition")?.trim() || "ALL";
  const selectedSeason = url.searchParams.get("season")?.trim() || "ALL";

  const supabase = getSupabaseAdmin();
  const statsQuery =
    "match_player_stats select athlete_id,match_id,source,minutes,goals,assists,yellow_cards,red_cards; join in memory on match_player_stats.match_id = matches.id";

  const [{ data: athletesData, error: athletesError }, { data: statsData, error: statsError }, { data: matchesData, error: matchesError }, { data: competitionsData, error: competitionsError }] =
    await Promise.all([
      supabase.from("athletes").select("id,name"),
      supabase.from("match_player_stats").select("athlete_id,match_id,source,minutes,goals,assists,yellow_cards,red_cards"),
      supabase
        .from("matches")
        .select("id,competition_name,season_year,match_date,opponent,home,goals_for,goals_against,match_duration_minutes")
        .order("match_date", { ascending: false }),
      supabase.from("competitions_registry").select("name").eq("is_active", true),
    ]);

  if (athletesError || statsError || matchesError || competitionsError) {
    return NextResponse.json(
      {
        error: "Nao foi possivel carregar os dados de analytics.",
        details: athletesError?.message ?? statsError?.message ?? matchesError?.message ?? competitionsError?.message,
      },
      { status: 500 }
    );
  }

  const athletes = (athletesData as AthleteRow[] | null) ?? [];
  const stats = (statsData as StatRow[] | null) ?? [];
  const matches = (matchesData as MatchRow[] | null) ?? [];
  const activeCompetitions = (competitionsData as { name: string }[] | null)?.map(c => c.name) ?? [];

  // Filtrar matches apenas para competições ativas
  const activeMatches = matches.filter(match => activeCompetitions.includes(match.competition_name));
  const matchesById = new Map(activeMatches.map((match) => [match.id, match]));
  const matchIdsWithStats = new Set(stats.map((row) => row.match_id).filter((matchId): matchId is string => !!matchId));

  const matchesWithStats = activeMatches.filter((match) => matchIdsWithStats.has(match.id));
  const competitionOptions = Array.from(new Set(matchesWithStats.map((match) => match.competition_name))).sort();
  const seasonOptions = Array.from(new Set(matchesWithStats.map((match) => match.season_year)))
    .sort((a, b) => b - a)
    .map((season) => String(season));

  const filteredMatches = activeMatches.filter(
    (match) => matchesCompetitionFilter(match, selectedCompetition) && matchesSeasonFilter(match, selectedSeason)
  );
  const filteredMatchIds = new Set(filteredMatches.map((match) => match.id));

  const joinedStats = stats
    .filter((row) => !!row.match_id && filteredMatchIds.has(row.match_id))
    .map((row) => ({
      athlete_id: row.athlete_id,
      source: row.source,
      minutes: row.minutes,
      goals: row.goals,
      assists: row.assists,
      yellow_cards: row.yellow_cards,
      red_cards: row.red_cards,
      match: row.match_id ? matchesById.get(row.match_id) ?? null : null,
    }))
    .filter((row) => row.match !== null);

  console.info("[analytics] stats query", {
    selectedCompetition,
    selectedSeason,
    totalStatsFound: joinedStats.length,
    query: statsQuery,
  });

  return NextResponse.json({
    athletes,
    statsRows: joinedStats,
    matches: filteredMatches,
    competitionOptions,
    seasonOptions,
  });
}
