import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe2,
  LayoutDashboard,
  ListFilter,
  Loader2,
  RefreshCcw,
  Search,
  Shield,
  Star,
  Users,
  X,
} from "lucide-react";
import { BlogView } from "./blog/BlogView";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { calculateMatchAveragePositions, renderSeasonHeatmap } from "./lib/seasonHeatmap";
import {
  LocaleContext,
  categoryName,
  localeCode,
  localizedStageName,
  localizedStatus,
  metricGroupName,
  metricName,
  per90Name,
  positionName,
  qualificationUnit,
  ratioPartName,
  textByLanguage,
  useLocale,
  type Language,
} from "./lib/i18n";
import type {
  Club,
  Competition,
  Legionnaire,
  Match,
  MatchPlayerHeatmap,
  MatchPlayerStat,
  MatchShot,
  MatchTeamStat,
  Metric,
  PlayerLoan,
  PlayerLeaderboardRow,
  PlayerHistory,
  PlayerSeasonHeatmap,
  PlayerValuation,
  Round,
  Season,
  SeasonPlayer,
  TeamAsset,
  TeamRosterMember,
} from "./lib/types";

type View = "overview" | "matches" | "clubs" | "players" | "legionnaires" | "blog";
type RoleFilter = "All" | SeasonPlayer["role_group"];
type PlayerHistoryRange = "latest" | "all";
type TournamentScope = "selected" | "all";
type ShotSideFilter = "all" | "home" | "away";
type DeepLinkState = {
  language: Language | null;
  view: View;
  competitionId: string;
  seasonId: string;
  roundId: string;
  matchId: string;
  matchPlayerId: string;
  matchSide: "home" | "away";
  shotSide: ShotSideFilter;
  shotPlayerId: string;
  clubId: string;
  playerId: string;
  comparisonPlayerIds: string[];
  metricCode: string;
  playerHistoryRange: PlayerHistoryRange;
  leaderMetricCode: string;
  leaderMinimum: number | null;
  leaderRatingMinimumMinutes: number;
  squadMetricCode: string;
  squadMinimum: number | null;
  squadRatingMinimumMinutes: number;
  explorerMetricCode: string;
  explorerMinimum: number | null;
  explorerRatingMinimumMinutes: number;
  roleFilter: RoleFilter;
  positionFilter: string;
  clubFilter: string;
  clubTournamentScope: TournamentScope;
  playerTournamentScope: TournamentScope;
  clubQuery: string;
  playerQuery: string;
  attributeQuery: string;
  legionnaireSeasonName: string;
  legionnaireMetricCode: string;
  legionnaireMinimum: number | null;
  legionnaireRatingMinimumMinutes: number;
  legionnaireQuery: string;
};
type PlayerPivot = MatchPlayerStat & { values: Record<string, number> };
type LeaderboardMetricOption = Pick<Metric, "code" | "name" | "value_type" | "denominator_metric_code"> & { kind: "season" | "match" };
type LeaderboardQualification = {
  source: "minutes" | "denominator" | "matches";
  unit: string;
  defaultValue: number;
  step: number;
};
type OverviewGroup = "topMen" | "lowerMen" | "youth" | "women";
type OverviewLeagueTarget = {
  key: OverviewGroup;
  competition: Competition;
  season: Season;
};
type OverviewLeagueEntry = OverviewLeagueTarget & {
  players: SeasonPlayer[];
  leaders: PlayerLeaderboardRow[];
  loading: boolean;
  error: string | null;
};
type PlayerChartMetric = Metric & {
  chartKey: string;
  chartMode: "single" | "paired";
  normalization: "raw" | "per90";
  minimumMatchMinutes?: number;
};

const overviewLeagueCompetitionNames: Record<OverviewGroup, string> = {
  topMen: "Israeli Premier League",
  lowerMen: "Liga Leumit",
  youth: "Youth League",
  women: "Women's Premier League",
};
type PlayerChartPoint = {
  match: number;
  matchId: string;
  scheduledAt: string | null;
  date: string;
  value: number | null;
  opponent: string;
  opponentTeamId: string | null;
  score: string;
  minutes: number | null;
  numerator: number | null;
  denominator: number | null;
};
type PlayerComparisonChartPoint = {
  match: number;
  date: string;
  timestamp: number;
  primaryPoint: PlayerChartPoint | null;
  comparisonPoint: PlayerChartPoint | null;
  primaryValue: number | null;
  primaryNumerator: number | null;
  primaryDenominator: number | null;
  comparisonValue: number | null;
  comparisonNumerator: number | null;
  comparisonDenominator: number | null;
};
type MultiPlayerChartPoint = {
  date: string;
  timestamp: number;
  [key: string]: string | number | PlayerChartPoint | null;
};
type PlayerAttributeSummary = {
  chartKey: string;
  name: string;
  category: PlayerAttributeCategory;
  value: string;
  comparisonValue: number | null;
};
type PlayerAttributeCategory = (typeof playerAttributeCategories)[number];
type PlayerPositionDetail = { code: string; label: string };
type MatchPlayerAttribute = { code: string; name: string; value: string; category: PlayerAttributeCategory };
type ValuationChartPoint = {
  date: string;
  timestamp: number;
  [key: string]: string | number | PlayerValuation | null;
};
type PlayerValuationSeries = {
  key: string;
  name: string;
  color: string;
  valuations: PlayerValuation[];
};

const numberFormatter = new Intl.NumberFormat("en-US");
const allTournamentsValue = "all-tournaments";
const roleFilters: RoleFilter[] = ["All", "Goalkeepers", "Defenders", "Midfielders", "Attackers"];
const playerAttributeCategories = ["General", "Attacking", "Passing", "Possession & duels", "Defending", "Discipline", "Goalkeeping"] as const;
const goalkeeperMetricCodes = new Set([
  "expected_goals_on_target_conceded",
  "expected_goals_prevented",
  "goalkeeper_saves",
  "goals_conceded",
  "high_claims",
  "penalties_faced",
  "penalties_saved",
  "played_sweeper",
  "punches",
]);
const lowerIsBetterMetricCodes = new Set([
  "backward_passes",
  "big_chances_missed",
  "errors_leading_to_goal",
  "errors_leading_to_shot",
  "fouls_committed",
  "fouls_made",
  "goals_conceded",
  "offsides",
  "penalties_committed",
  "possession_lost",
  "red_cards",
  "shots_off_target",
  "was_dribbled_past",
  "yellow_cards",
]);
const specificPositionDetails: Record<string, PlayerPositionDetail> = {
  "gk": { code: "GK", label: "Goalkeeper" },
  "goalkeeper": { code: "GK", label: "Goalkeeper" },
  "lb": { code: "LB", label: "Left Back" },
  "left-back": { code: "LB", label: "Left Back" },
  "left back": { code: "LB", label: "Left Back" },
  "lwb": { code: "LWB", label: "Left Wing Back" },
  "left wing back": { code: "LWB", label: "Left Wing Back" },
  "cb": { code: "CB", label: "Centre Back" },
  "centre-back": { code: "CB", label: "Centre Back" },
  "centre back": { code: "CB", label: "Centre Back" },
  "center back": { code: "CB", label: "Centre Back" },
  "rb": { code: "RB", label: "Right Back" },
  "right-back": { code: "RB", label: "Right Back" },
  "right back": { code: "RB", label: "Right Back" },
  "rwb": { code: "RWB", label: "Right Wing Back" },
  "right wing back": { code: "RWB", label: "Right Wing Back" },
  "lm": { code: "LM", label: "Left Midfield" },
  "left midfield": { code: "LM", label: "Left Midfield" },
  "dm": { code: "DM", label: "Defensive Midfield" },
  "cdm": { code: "DM", label: "Defensive Midfield" },
  "defensive midfield": { code: "DM", label: "Defensive Midfield" },
  "cm": { code: "CM", label: "Central Midfield" },
  "central midfield": { code: "CM", label: "Central Midfield" },
  "am": { code: "AM", label: "Attacking Midfield" },
  "cam": { code: "AM", label: "Attacking Midfield" },
  "attacking midfield": { code: "AM", label: "Attacking Midfield" },
  "rm": { code: "RM", label: "Right Midfield" },
  "right midfield": { code: "RM", label: "Right Midfield" },
  "lw": { code: "LW", label: "Left Wing" },
  "left forward": { code: "LW", label: "Left Forward" },
  "left wing": { code: "LW", label: "Left Wing" },
  "ss": { code: "SS", label: "Secondary Striker" },
  "secondary striker": { code: "SS", label: "Secondary Striker" },
  "st": { code: "CF", label: "Centre Forward" },
  "cf": { code: "CF", label: "Centre Forward" },
  "centre forward": { code: "CF", label: "Centre Forward" },
  "center forward": { code: "CF", label: "Centre Forward" },
  "rw": { code: "RW", label: "Right Wing" },
  "right forward": { code: "RW", label: "Right Forward" },
  "right wing": { code: "RW", label: "Right Wing" },
};
const positionCodeOrder = ["GK", "LB", "LWB", "CB", "RB", "RWB", "LM", "DM", "CM", "AM", "RM", "LW", "SS", "CF", "RW", "Other"];
const seasonLeaderboardMetrics: LeaderboardMetricOption[] = [
  { code: "season_appearances", name: "Appearances", value_type: "count", denominator_metric_code: null, kind: "season" },
  { code: "season_starts", name: "Starts", value_type: "count", denominator_metric_code: null, kind: "season" },
  { code: "season_minutes", name: "Minutes played", value_type: "count", denominator_metric_code: null, kind: "season" },
  { code: "current_valuation", name: "Estimated transfer value", value_type: "currency", denominator_metric_code: null, kind: "season" },
];
const comparisonMetrics = [
  "team_possession",
  "team_total_shots",
  "team_shots_on_target",
  "team_expected_goals",
  "team_big_chances_created",
  "team_corners",
  "team_passes_completed",
];
const matchPlayerMetrics = [
  "rating_365",
  "goals",
  "assists",
  "pass_completion_pct",
  "passes_completed",
  "passes_attempted",
  "total_shots",
  "tackles_won",
  "minutes",
];

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "matches", label: "Matches", icon: CalendarDays },
  { id: "clubs", label: "Clubs", icon: Shield },
  { id: "players", label: "Players", icon: Users },
  { id: "legionnaires", label: "Legionnaires", icon: Globe2 },
  { id: "blog", label: "Stories", icon: BookOpen },
];

const demoCompetition: Competition = {
  competition_id: "demo-competition",
  name: "Israeli Premier League",
  name_he: "ליגת העל",
  competition_type: "league",
  country_name: "Israel",
  season_count: 1,
  latest_season_id: "demo-season",
  latest_season_name: "2025/26",
  scope: "domestic",
  gender: "men",
  age_group: "senior",
  participant_type: "club",
};

const demoSeason: Season = {
  season_id: "demo-season",
  competition_id: "demo-competition",
  competition_name: "Israeli Premier League",
  competition_name_he: "ליגת העל",
  season_name: "2025/26",
  start_date: "2025-08-23",
  end_date: "2026-05-24",
  match_count: 240,
  completed_match_count: 218,
  team_count: 14,
  player_count: 525,
  goals_scored: 582,
  first_match_at: "2025-08-23T17:15:00Z",
  latest_match_at: "2026-05-24T17:00:00Z",
  is_latest: true,
};

const demoRounds: Round[] = Array.from({ length: 5 }, (_, index) => ({
  round_id: `demo-round-${index + 25}`,
  season_id: "demo-season",
  stage_id: "demo-stage",
  stage_name: index > 1 ? "Playoffs" : "Regular Season",
  stage_type: index > 1 ? "playoff" : "regular",
  stage_number: index > 1 ? 2 : 1,
  round_number: index + 25,
  round_name: "Round",
  match_count: 7,
  completed_match_count: 7,
  first_match_at: `2026-04-${10 + index}T17:00:00Z`,
  last_match_at: `2026-04-${12 + index}T20:00:00Z`,
}));

const demoClubNames = ["Maccabi Tel Aviv FC", "Hapoel Be'er Sheva FC", "Maccabi Haifa FC", "Beitar Jerusalem FC"];
const demoClubs: Club[] = demoClubNames.map((team_name, index) => ({
  season_id: "demo-season",
  competition_id: "demo-competition",
  team_id: `demo-team-${index}`,
  team_name,
  team_name_he: null,
  short_name: null,
  city: null,
  founded_year: null,
  primary_color: null,
  secondary_color: null,
  logo_url: null,
  played: 30,
  won: 20 - index * 2,
  drawn: 5 + index,
  lost: 5 + index,
  goals_for: 61 - index * 6,
  goals_against: 25 + index * 4,
  goal_difference: 36 - index * 10,
  points: 65 - index * 7,
  last_played_at: "2026-04-18T17:00:00Z",
}));

const demoMatches: Match[] = Array.from({ length: 8 }, (_, index) => ({
  match_id: `demo-match-${index}`,
  season_id: "demo-season",
  season_name: "2025/26",
  competition_id: "demo-competition",
  competition_name: "Israeli Premier League",
  competition_name_he: "ליגת העל",
  stage_id: "demo-stage",
  stage_name: "Playoffs",
  stage_number: 2,
  round_id: "demo-round-29",
  round_number: 29,
  round_name: "Round",
  scheduled_at: `2026-04-${18 + index}T17:00:00Z`,
  status: "Ended",
  home_team_id: `demo-team-${index % 4}`,
  home_team_name: demoClubNames[index % 4],
  home_team_name_he: null,
  home_team_short_name: null,
  home_team_color: null,
  home_team_logo_url: null,
  away_team_id: `demo-team-${(index + 1) % 4}`,
  away_team_name: demoClubNames[(index + 1) % 4],
  away_team_name_he: null,
  away_team_short_name: null,
  away_team_color: null,
  away_team_logo_url: null,
  home_score: index % 4,
  away_score: (index + 1) % 3,
}));

const demoPlayers: SeasonPlayer[] = [
  ["Dor Peretz", "Midfielders", 11, 7, 7.31],
  ["Omer Atzili", "Attackers", 14, 8, 7.48],
  ["Miguel Silva", "Goalkeepers", 0, 0, 7.08],
  ["Or Blorian", "Defenders", 3, 1, 7.16],
  ["Yarden Shua", "Attackers", 12, 10, 7.42],
].map(([display_name, role_group, goals, assists, average_rating], index) => ({
  season_id: "demo-season",
  competition_id: "demo-competition",
  player_id: `demo-player-${index}`,
  display_name: String(display_name),
  display_name_he: null,
  primary_position: String(role_group).replace(/s$/, ""),
  specific_position: demoSpecificPosition(String(role_group), index),
  role_group: role_group as SeasonPlayer["role_group"],
  team_id: `demo-team-${index % 4}`,
  team_name: demoClubNames[index % 4],
  appearances: 28,
  starts: 25,
  minutes: 2250 - index * 90,
  goals: Number(goals),
  assists: Number(assists),
  average_rating: Number(average_rating),
}));

const demoMetrics: Metric[] = [
  { metric_id: "rating", code: "rating_365", name: "Rating (365Score)", subject_type: "player_match", value_type: "rating", numerator_metric_code: null, denominator_metric_code: null },
  { metric_id: "passes", code: "pass_completion_pct", name: "Pass completion", subject_type: "player_match", value_type: "percentage", numerator_metric_code: "passes_completed", denominator_metric_code: "passes_attempted" },
  { metric_id: "goals", code: "goals", name: "Goals", subject_type: "player_match", value_type: "count", numerator_metric_code: null, denominator_metric_code: null },
  { metric_id: "shots", code: "total_shots", name: "Total shots", subject_type: "player_match", value_type: "count", numerator_metric_code: null, denominator_metric_code: null },
];

function isSchemaCacheMiss(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202" || error?.message?.toLowerCase().includes("schema cache") === true;
}

function isRetryableSupabaseError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return isSchemaCacheMiss(error)
    || message.includes("statement timeout")
    || message.includes("canceling statement");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchPlayerHistoryRows(competitionId: string, playerId: string, allTournaments = false) {
  if (!supabase) return { rows: [] as PlayerHistory[], error: "Supabase is not configured." };

  const rows: PlayerHistory[] = [];
  const pageSize = 1000;
  let page = 0;
  let useFastRpc = true;
  while (true) {
    let result = useFastRpc
      ? await supabase
          .rpc(allTournaments ? "api_player_history_for_player_all_tournaments" : "api_player_history_for_player", allTournaments ? {
            p_player_id: playerId,
          } : {
            p_competition_id: competitionId,
            p_player_id: playerId,
          })
          .order("scheduled_at")
          .order("match_id")
          .order("metric_code")
          .order("source_id")
          .range(page * pageSize, (page + 1) * pageSize - 1)
      : await supabase
          .from("api_player_history")
          .select("*")
          .eq("player_id", playerId)
          .match(allTournaments ? {} : { competition_id: competitionId })
          .order("scheduled_at")
          .order("match_id")
          .order("metric_code")
          .order("source_id")
          .range(page * pageSize, (page + 1) * pageSize - 1);
    if (useFastRpc && isSchemaCacheMiss(result.error)) {
      useFastRpc = false;
      result = await supabase
        .from("api_player_history")
        .select("*")
        .eq("player_id", playerId)
        .match(allTournaments ? {} : { competition_id: competitionId })
        .order("scheduled_at")
        .order("match_id")
        .order("metric_code")
        .order("source_id")
        .range(page * pageSize, (page + 1) * pageSize - 1);
    }
    if (result.error) return { rows: [] as PlayerHistory[], error: result.error.message };
    const pageRows = (result.data ?? []) as PlayerHistory[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { rows, error: null };
    page += 1;
  }
}

async function fetchPlayerValuationRows(playerId: string) {
  if (!supabase) return { rows: [] as PlayerValuation[], error: "Supabase is not configured." };
  const result = await supabase
    .from("api_player_valuations")
    .select("*")
    .eq("player_id", playerId)
    .order("valuation_date");
  return {
    rows: (result.error ? [] : result.data ?? []) as PlayerValuation[],
    error: isSchemaCacheMiss(result.error) ? null : result.error?.message ?? null,
  };
}

async function fetchPlayerSeasonHeatmapRows(
  playerId: string,
  seasonId: string,
  matches: Match[],
  allTournamentSeason?: { name: string; ids: string[] },
) {
  if (!supabase) return { rows: [] as PlayerSeasonHeatmap[], error: "Supabase is not configured." };

  let result = allTournamentSeason
    ? await supabase
        .rpc("api_player_heatmaps_for_player_season", {
          p_player_id: playerId,
          p_season_name: allTournamentSeason.name,
        })
        .order("scheduled_at")
        .limit(500)
    : await supabase
        .from("api_player_season_heatmaps")
        .select("*")
        .eq("season_id", seasonId)
        .eq("player_id", playerId)
        .order("scheduled_at")
        .limit(100);

  if (isSchemaCacheMiss(result.error)) {
    result = await supabase
      .from("api_player_season_heatmaps")
      .select("*")
      .eq("player_id", playerId)
      .in("season_id", allTournamentSeason?.ids.length ? allTournamentSeason.ids : [seasonId])
      .order("scheduled_at")
      .limit(500);
    if (isSchemaCacheMiss(result.error)) {
      const matchById = new Map(matches.map((match) => [match.match_id, match]));
      const fallback = await supabase
        .from("api_match_player_heatmaps")
        .select("*")
        .eq("player_id", playerId)
        .limit(500);
      result = {
        ...fallback,
        data: (fallback.data ?? []).flatMap((row) => {
          const match = matchById.get(row.match_id);
          return match ? [{ ...row, season_id: match.season_id, scheduled_at: match.scheduled_at, minutes_played: null }] : [];
        }),
      } as typeof result;
    }
  }

  return {
    rows: (result.error ? [] : result.data ?? []) as PlayerSeasonHeatmap[],
    error: result.error?.message ?? null,
  };
}

function readDeepLinkState(): DeepLinkState {
  const params = new URLSearchParams(window.location.search);
  const view = readViewFromHash();
  const language = params.get("lang");
  const side = params.get("side");
  const shotSide = params.get("shotSide");
  const history = params.get("history");
  const role = params.get("role") as RoleFilter | null;
  const comparisonPlayerIds = [...new Set((params.get("comparePlayers") ?? params.get("comparePlayer") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean))].slice(0, 4);
  const readNumber = (key: string, fallback: number | null) => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  return {
    language: language === "he" || language === "en" ? language : null,
    view,
    competitionId: params.get("competition") ?? "",
    seasonId: params.get("season") ?? "",
    roundId: params.get("round") ?? "",
    matchId: params.get("match") ?? "",
    matchPlayerId: params.get("matchPlayer") ?? "",
    matchSide: side === "away" ? "away" : "home",
    shotSide: shotSide === "home" || shotSide === "away" ? shotSide : "all",
    shotPlayerId: params.get("shotPlayer") ?? "all",
    clubId: params.get("club") ?? "",
    playerId: params.get("player") ?? "",
    comparisonPlayerIds,
    metricCode: params.get("metric") ?? "",
    playerHistoryRange: history === "all" ? "all" : "latest",
    leaderMetricCode: params.get("leaderMetric") ?? "goals",
    leaderMinimum: readNumber("leaderMin", null),
    leaderRatingMinimumMinutes: readNumber("leaderRatingMin", 60) ?? 60,
    squadMetricCode: params.get("squadMetric") ?? "season_minutes",
    squadMinimum: readNumber("squadMin", null),
    squadRatingMinimumMinutes: readNumber("squadRatingMin", 60) ?? 60,
    explorerMetricCode: params.get("rankingMetric") ?? "season_minutes",
    explorerMinimum: readNumber("rankingMin", null),
    explorerRatingMinimumMinutes: readNumber("rankingRatingMin", 60) ?? 60,
    roleFilter: role && roleFilters.includes(role) ? role : "All",
    positionFilter: params.get("position") ?? "All",
    clubFilter: params.get("clubFilter") ?? "all",
    clubTournamentScope: params.get("clubTournaments") === "all" || (view === "overview" && !params.has("clubTournaments")) ? "all" : "selected",
    playerTournamentScope: params.get("playerTournaments") === "all"
      || (view === "players" && comparisonPlayerIds.length > 0 && !params.has("playerTournaments"))
      ? "all"
      : "selected",
    clubQuery: params.get("clubSearch") ?? "",
    playerQuery: params.get("playerSearch") ?? "",
    attributeQuery: params.get("attributeSearch") ?? "",
    legionnaireSeasonName: params.get("legionSeason") ?? "",
    legionnaireMetricCode: params.get("legionMetric") ?? "season_minutes",
    legionnaireMinimum: readNumber("legionMin", null),
    legionnaireRatingMinimumMinutes: readNumber("legionRatingMin", 60) ?? 60,
    legionnaireQuery: params.get("legionSearch") ?? "",
  };
}

function writeDeepLinkState(state: DeepLinkState) {
  const params = new URLSearchParams();
  const setString = (key: string, value: string) => {
    if (value) params.set(key, value);
  };
  const setNumber = (key: string, value: number | null) => {
    if (value !== null && Number.isFinite(value)) params.set(key, String(value));
  };

  setString("lang", state.language ?? "");
  setString("competition", state.competitionId);
  setString("season", state.seasonId);
  setString("round", state.roundId);
  setString("match", state.matchId);
  setString("matchPlayer", state.matchPlayerId);
  setString("side", state.matchSide);
  setString("shotSide", state.shotSide);
  setString("shotPlayer", state.shotPlayerId);
  setString("club", state.clubId);
  setString("player", state.playerId);
  if (state.comparisonPlayerIds.length === 1) {
    setString("comparePlayer", state.comparisonPlayerIds[0]);
  } else if (state.comparisonPlayerIds.length > 1) {
    setString("comparePlayers", state.comparisonPlayerIds.join(","));
  }
  setString("metric", state.metricCode);
  setString("history", state.playerHistoryRange);
  setString("leaderMetric", state.leaderMetricCode);
  setNumber("leaderMin", state.leaderMinimum);
  setNumber("leaderRatingMin", state.leaderRatingMinimumMinutes);
  setString("squadMetric", state.squadMetricCode);
  setNumber("squadMin", state.squadMinimum);
  setNumber("squadRatingMin", state.squadRatingMinimumMinutes);
  setString("rankingMetric", state.explorerMetricCode);
  setNumber("rankingMin", state.explorerMinimum);
  setNumber("rankingRatingMin", state.explorerRatingMinimumMinutes);
  setString("role", state.roleFilter);
  setString("position", state.positionFilter);
  setString("clubFilter", state.clubFilter);
  setString("clubTournaments", state.clubTournamentScope);
  setString("playerTournaments", state.playerTournamentScope);
  setString("clubSearch", state.clubQuery);
  setString("playerSearch", state.playerQuery);
  setString("attributeSearch", state.attributeQuery);
  setString("legionSeason", state.legionnaireSeasonName);
  setString("legionMetric", state.legionnaireMetricCode);
  setNumber("legionMin", state.legionnaireMinimum);
  setNumber("legionRatingMin", state.legionnaireRatingMinimumMinutes);
  setString("legionSearch", state.legionnaireQuery);

  const search = params.size ? `?${params.toString()}` : "";
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}#${state.view}`);
}

function minimumMap(metricCode: string, minimum: number | null) {
  return minimum === null ? {} : { [metricCode]: minimum };
}

function applyMinimumToMap(current: Record<string, number>, metricCode: string, minimum: number | null) {
  const next = { ...current };
  if (minimum === null) delete next[metricCode];
  else next[metricCode] = minimum;
  return next;
}

function isClubLeagueCompetition(competition?: Competition) {
  return Boolean(
    competition
    && competition.participant_type === "club"
    && competition.competition_type === "league"
    && (competition.scope === "domestic" || competition.scope === "foreign_club"),
  );
}

export function App() {
  const [initialDeepLink] = useState(readDeepLinkState);
  const [language, setLanguage] = useState<Language>(initialDeepLink.language ?? readLanguage);
  const text = textByLanguage[language];
  const [view, setView] = useState<View>(initialDeepLink.view);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<SeasonPlayer[]>([]);
  const [playerLoans, setPlayerLoans] = useState<PlayerLoan[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterMember[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [playerHistory, setPlayerHistory] = useState<PlayerHistory[]>([]);
  const [comparisonPlayerHistories, setComparisonPlayerHistories] = useState<Record<string, PlayerHistory[]>>({});
  const [comparisonCohortPlayers, setComparisonCohortPlayers] = useState<SeasonPlayer[]>([]);
  const [playerValuations, setPlayerValuations] = useState<PlayerValuation[]>([]);
  const [comparisonPlayerValuations, setComparisonPlayerValuations] = useState<Record<string, PlayerValuation[]>>({});
  const [matchPlayerStats, setMatchPlayerStats] = useState<MatchPlayerStat[]>([]);
  const [matchTeamStats, setMatchTeamStats] = useState<MatchTeamStat[]>([]);
  const [matchPlayerHeatmaps, setMatchPlayerHeatmaps] = useState<MatchPlayerHeatmap[]>([]);
  const [playerSeasonHeatmaps, setPlayerSeasonHeatmaps] = useState<PlayerSeasonHeatmap[]>([]);
  const [comparisonPlayerSeasonHeatmaps, setComparisonPlayerSeasonHeatmaps] = useState<Record<string, PlayerSeasonHeatmap[]>>({});
  const [matchShots, setMatchShots] = useState<MatchShot[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [squadLeaderboardRows, setSquadLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [explorerLeaderboardRows, setExplorerLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [legionnaires, setLegionnaires] = useState<Legionnaire[]>([]);
  const [legionnaireLeaderboardRows, setLegionnaireLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [competitionId, setCompetitionId] = useState(initialDeepLink.competitionId);
  const [seasonId, setSeasonId] = useState(initialDeepLink.seasonId);
  const [roundId, setRoundId] = useState(initialDeepLink.roundId);
  const [matchId, setMatchId] = useState(initialDeepLink.matchId);
  const [matchPlayerId, setMatchPlayerId] = useState(initialDeepLink.matchPlayerId);
  const [clubId, setClubId] = useState(initialDeepLink.clubId);
  const [playerId, setPlayerId] = useState(initialDeepLink.playerId);
  const [comparisonPlayerIds, setComparisonPlayerIds] = useState<string[]>(initialDeepLink.comparisonPlayerIds);
  const [metricCode, setMetricCode] = useState(initialDeepLink.metricCode);
  const [playerHistoryRange, setPlayerHistoryRange] = useState<PlayerHistoryRange>(initialDeepLink.playerHistoryRange);
  const [leaderMetricCode, setLeaderMetricCode] = useState(initialDeepLink.leaderMetricCode);
  const [squadMetricCode, setSquadMetricCode] = useState(initialDeepLink.squadMetricCode);
  const [explorerMetricCode, setExplorerMetricCode] = useState(initialDeepLink.explorerMetricCode);
  const [leaderMinimums, setLeaderMinimums] = useState<Record<string, number>>(() => minimumMap(initialDeepLink.leaderMetricCode, initialDeepLink.leaderMinimum));
  const [squadMinimums, setSquadMinimums] = useState<Record<string, number>>(() => minimumMap(initialDeepLink.squadMetricCode, initialDeepLink.squadMinimum));
  const [explorerMinimums, setExplorerMinimums] = useState<Record<string, number>>(() => minimumMap(initialDeepLink.explorerMetricCode, initialDeepLink.explorerMinimum));
  const [leaderRatingMinimumMinutes, setLeaderRatingMinimumMinutes] = useState(initialDeepLink.leaderRatingMinimumMinutes);
  const [squadRatingMinimumMinutes, setSquadRatingMinimumMinutes] = useState(initialDeepLink.squadRatingMinimumMinutes);
  const [explorerRatingMinimumMinutes, setExplorerRatingMinimumMinutes] = useState(initialDeepLink.explorerRatingMinimumMinutes);
  const [matchSide, setMatchSide] = useState<"home" | "away">(initialDeepLink.matchSide);
  const [shotSide, setShotSide] = useState<ShotSideFilter>(initialDeepLink.shotSide);
  const [shotPlayerId, setShotPlayerId] = useState(initialDeepLink.shotPlayerId);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(initialDeepLink.roleFilter);
  const [positionFilter, setPositionFilter] = useState(initialDeepLink.positionFilter);
  const [clubFilter, setClubFilter] = useState(initialDeepLink.clubFilter);
  const [clubTournamentScope, setClubTournamentScope] = useState<TournamentScope>(initialDeepLink.clubTournamentScope);
  const [playerTournamentScope, setPlayerTournamentScope] = useState<TournamentScope>(initialDeepLink.playerTournamentScope);
  const [clubQuery, setClubQuery] = useState(initialDeepLink.clubQuery);
  const [playerQuery, setPlayerQuery] = useState(initialDeepLink.playerQuery);
  const [attributeQuery, setAttributeQuery] = useState(initialDeepLink.attributeQuery);
  const [legionnaireSeasonName, setLegionnaireSeasonName] = useState(initialDeepLink.legionnaireSeasonName);
  const [legionnaireMetricCode, setLegionnaireMetricCode] = useState(initialDeepLink.legionnaireMetricCode);
  const [legionnaireMinimums, setLegionnaireMinimums] = useState<Record<string, number>>(() => minimumMap(initialDeepLink.legionnaireMetricCode, initialDeepLink.legionnaireMinimum));
  const [legionnaireRatingMinimumMinutes, setLegionnaireRatingMinimumMinutes] = useState(initialDeepLink.legionnaireRatingMinimumMinutes);
  const [legionnaireQuery, setLegionnaireQuery] = useState(initialDeepLink.legionnaireQuery);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonPlayerLoadSucceeded, setSeasonPlayerLoadSucceeded] = useState(false);
  const [playerContextLoading, setPlayerContextLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [playerValuationLoading, setPlayerValuationLoading] = useState(false);
  const [comparisonValuationLoading, setComparisonValuationLoading] = useState(false);
  const [playerHeatmapLoading, setPlayerHeatmapLoading] = useState(false);
  const [comparisonPlayerHeatmapLoading, setComparisonPlayerHeatmapLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [squadLeaderboardLoading, setSquadLeaderboardLoading] = useState(false);
  const [squadLeaderboardError, setSquadLeaderboardError] = useState<string | null>(null);
  const [explorerLeaderboardLoading, setExplorerLeaderboardLoading] = useState(false);
  const [explorerLeaderboardError, setExplorerLeaderboardError] = useState<string | null>(null);
  const [legionnaireLoading, setLegionnaireLoading] = useState(false);
  const [legionnaireError, setLegionnaireError] = useState<string | null>(null);
  const [legionnaireLeaderboardLoading, setLegionnaireLeaderboardLoading] = useState(false);
  const [legionnaireLeaderboardError, setLegionnaireLeaderboardError] = useState<string | null>(null);
  const [allTournamentClubMatches, setAllTournamentClubMatches] = useState<Match[]>([]);
  const [allTournamentClubs, setAllTournamentClubs] = useState<Club[]>([]);
  const [allTournamentOverviewMatches, setAllTournamentOverviewMatches] = useState<Match[]>([]);
  const [overviewLeaguePlayers, setOverviewLeaguePlayers] = useState<Partial<Record<OverviewGroup, SeasonPlayer[]>>>({});
  const [overviewLeagueLeaders, setOverviewLeagueLeaders] = useState<Partial<Record<OverviewGroup, PlayerLeaderboardRow[]>>>({});
  const [overviewLeagueErrors, setOverviewLeagueErrors] = useState<Partial<Record<OverviewGroup, string | null>>>({});
  const [overviewLeaguePlayersLoading, setOverviewLeaguePlayersLoading] = useState(false);
  const [overviewLeagueLeadersLoading, setOverviewLeagueLeadersLoading] = useState(false);
  const [allTournamentClubsLoading, setAllTournamentClubsLoading] = useState(false);
  const [allTournamentOverviewLoading, setAllTournamentOverviewLoading] = useState(false);
  const [clubMatchesLoading, setClubMatchesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overviewSeasonDefaultApplied = useRef(Boolean(initialDeepLink.seasonId));
  const pendingMatchSelection = useRef<{ seasonId: string; matchId: string; roundId: string | null } | null>(null);
  const pendingPlayerSelection = useRef<{ seasonId: string; playerId: string } | null>(
    initialDeepLink.seasonId && initialDeepLink.playerId
      ? { seasonId: initialDeepLink.seasonId, playerId: initialDeepLink.playerId }
      : null,
  );
  const playerContextRequest = useRef(0);

  useEffect(() => {
    if (view === "players") return;
    playerContextRequest.current += 1;
    setPlayerContextLoading(false);
  }, [view]);

  async function loadReferenceData() {
    setLoading(true);
    setError(null);

    if (!hasSupabaseConfig || !supabase) {
      setCompetitions([demoCompetition]);
      setSeasons([demoSeason]);
      setMetrics(demoMetrics);
      setCompetitionId((current) => current === demoCompetition.competition_id ? current : demoCompetition.competition_id);
      setSeasonId((current) => current === demoSeason.season_id ? current : demoSeason.season_id);
      setMetricCode((current) => current || preferredMetric(demoMetrics));
      setLeaderMetricCode((current) => current || preferredMetric(demoMetrics));
      setLoading(false);
      return;
    }

    const [competitionResult, seasonResult, metricResult] = await Promise.all([
      supabase.from("api_competitions").select("*").order("name"),
      supabase.from("api_seasons").select("*").order("start_date", { ascending: false }),
      supabase.from("api_metrics").select("*").eq("subject_type", "player_match").order("name"),
    ]);
    const firstError = competitionResult.error ?? seasonResult.error ?? metricResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const nextCompetitions = (competitionResult.data ?? []) as Competition[];
    const nextSeasons = (seasonResult.data ?? []) as Season[];
    const nextMetrics = (metricResult.data ?? []) as Metric[];
    const defaultCompetition = nextCompetitions.find((item) => item.name.toLowerCase().includes("premier")) ?? nextCompetitions[0];
    const defaultSeason = latestSeasonWithData(nextSeasons.filter((item) => item.competition_id === defaultCompetition?.competition_id));

    setCompetitions(nextCompetitions);
    setSeasons(nextSeasons);
    setMetrics(nextMetrics);
    setCompetitionId((current) => current || defaultCompetition?.competition_id || "");
    setSeasonId((current) => current || defaultSeason?.season_id || "");
    setMetricCode((current) => current || preferredMetric(nextMetrics));
    setLeaderMetricCode((current) => isValuationMetricCode(current)
      || nextMetrics.some((metric) => metric.code === leaderboardSourceMetricCode(current))
      ? current
      : preferredMetric(nextMetrics));
    setLoading(false);
  }

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "he" ? "rtl" : "ltr";
    document.title = view === "blog" ? "לא הכמות, אלא האיכות | כדורדאטה" : text.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute("content", view === "blog"
      ? "ניתוח הנתונים המלא של הניצחון 5:2 של מכבי תל אביב על הפועל ירושלים."
      : text.metaDescription);
    window.localStorage.setItem("kadurdata-language", language);
    if (language === "en" && view === "blog") setView("overview");
  }, [language, text, view]);

  useEffect(() => {
    const restoreDeepLink = () => {
      const next = readDeepLinkState();
      if (next.language) setLanguage(next.language);
      setView(next.view);
      if (next.competitionId) setCompetitionId(next.competitionId);
      if (next.seasonId) setSeasonId(next.seasonId);
      setRoundId(next.roundId);
      setMatchId(next.matchId);
      setMatchPlayerId(next.matchPlayerId);
      setMatchSide(next.matchSide);
      setShotSide(next.shotSide);
      setShotPlayerId(next.shotPlayerId);
      setClubId(next.clubId);
      pendingPlayerSelection.current = next.seasonId && next.playerId
        ? { seasonId: next.seasonId, playerId: next.playerId }
        : null;
      setPlayerId(next.playerId);
      setComparisonPlayerIds(next.comparisonPlayerIds);
      if (next.metricCode) setMetricCode(next.metricCode);
      setPlayerHistoryRange(next.playerHistoryRange);
      setLeaderMetricCode(next.leaderMetricCode);
      setLeaderMinimums((current) => applyMinimumToMap(current, next.leaderMetricCode, next.leaderMinimum));
      setLeaderRatingMinimumMinutes(next.leaderRatingMinimumMinutes);
      setSquadMetricCode(next.squadMetricCode);
      setSquadMinimums((current) => applyMinimumToMap(current, next.squadMetricCode, next.squadMinimum));
      setSquadRatingMinimumMinutes(next.squadRatingMinimumMinutes);
      setExplorerMetricCode(next.explorerMetricCode);
      setExplorerMinimums((current) => applyMinimumToMap(current, next.explorerMetricCode, next.explorerMinimum));
      setExplorerRatingMinimumMinutes(next.explorerRatingMinimumMinutes);
      setRoleFilter(next.roleFilter);
      setPositionFilter(next.positionFilter);
      setClubFilter(next.clubFilter);
      setClubTournamentScope(next.clubTournamentScope);
      setPlayerTournamentScope(next.playerTournamentScope);
      setClubQuery(next.clubQuery);
      setPlayerQuery(next.playerQuery);
      setAttributeQuery(next.attributeQuery);
      setLegionnaireSeasonName(next.legionnaireSeasonName);
      setLegionnaireMetricCode(next.legionnaireMetricCode);
      setLegionnaireMinimums((current) => applyMinimumToMap(current, next.legionnaireMetricCode, next.legionnaireMinimum));
      setLegionnaireRatingMinimumMinutes(next.legionnaireRatingMinimumMinutes);
      setLegionnaireQuery(next.legionnaireQuery);
    };

    window.addEventListener("popstate", restoreDeepLink);
    window.addEventListener("hashchange", restoreDeepLink);
    return () => {
      window.removeEventListener("popstate", restoreDeepLink);
      window.removeEventListener("hashchange", restoreDeepLink);
    };
  }, []);

  const availableSeasons = useMemo(
    () => seasons.filter((season) => season.competition_id === competitionId),
    [competitionId, seasons],
  );
  const currentCompetition = competitions.find((competition) => competition.competition_id === competitionId);
  const currentSeason = seasons.find((season) => season.season_id === seasonId) ?? demoSeason;
  const currentRound = rounds.find((round) => round.round_id === roundId);
  const latestDataSeason = useMemo(
    () => latestSeasonWithData(availableSeasons),
    [availableSeasons],
  );
  const playerAllTournamentSeasonOptions = useMemo(() => {
    const byName = new Map<string, Season>();
    seasons
      .filter((season) => /^\d{4}\/\d{4}$/.test(season.season_name) && Number(season.match_count) > 0)
      .sort((a, b) => Number(b.season_name.slice(0, 4)) - Number(a.season_name.slice(0, 4))
        || Number(b.competition_id === competitionId) - Number(a.competition_id === competitionId)
        || Number(b.competition_name === "Israeli Premier League") - Number(a.competition_name === "Israeli Premier League")
        || dateValue(b.start_date) - dateValue(a.start_date))
      .forEach((season) => {
        if (!byName.has(season.season_name)) byName.set(season.season_name, season);
      });
    return [...byName.values()];
  }, [competitionId, seasons]);
  const currentPlayerAllTournamentSeasonIds = useMemo(() => seasons
    .filter((season) => season.season_name === currentSeason.season_name)
    .map((season) => season.season_id), [currentSeason.season_name, seasons]);
  const legionnaireSeasonOptions = useMemo(() => {
    const foreignCompetitionIds = new Set(competitions
      .filter((competition) => competition.scope === "foreign_club")
      .map((competition) => competition.competition_id));
    const grouped = new Map<string, { name: string; latestAt: number; hasData: boolean }>();
    seasons
      .filter((season) => foreignCompetitionIds.has(season.competition_id))
      .forEach((season) => {
        const current = grouped.get(season.season_name);
        const latestAt = Math.max(dateValue(season.latest_match_at), dateValue(season.start_date));
        grouped.set(season.season_name, {
          name: season.season_name,
          latestAt: Math.max(current?.latestAt ?? 0, latestAt),
          hasData: Boolean(current?.hasData || Number(season.player_count) > 0 || Number(season.completed_match_count) > 0),
        });
      });
    return [...grouped.values()].sort((a, b) => Number(b.hasData) - Number(a.hasData) || b.latestAt - a.latestAt);
  }, [competitions, seasons]);

  useEffect(() => {
    if (loading || !legionnaireSeasonOptions.length) return;
    if (legionnaireSeasonOptions.some((season) => season.name === legionnaireSeasonName)) return;
    setLegionnaireSeasonName(legionnaireSeasonOptions[0].name);
  }, [legionnaireSeasonName, legionnaireSeasonOptions, loading]);

  useEffect(() => {
    if (loading || !competitionId || !availableSeasons.length || availableSeasons.some((season) => season.season_id === seasonId)) return;
    setSeasonId(latestDataSeason?.season_id ?? "");
  }, [availableSeasons, competitionId, latestDataSeason, loading, seasonId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSeasonData() {
      if (!seasonId) return;
      setSeasonLoading(true);
      setSeasonPlayerLoadSucceeded(false);
      setError(null);

      const client = supabase;
      if (!hasSupabaseConfig || !client) {
        setRounds(demoRounds);
        setMatches(demoMatches);
        setClubs(demoClubs);
        setPlayers(demoPlayers);
        setPlayerLoans([]);
        setTeamRoster([]);
        setSeasonPlayerLoadSucceeded(true);
        setRoundId((current) => demoRounds.some((round) => round.round_id === current) ? current : demoRounds[demoRounds.length - 1]?.round_id ?? "");
        setClubId((current) => demoClubs.some((club) => club.team_id === current) ? current : demoClubs[0]?.team_id ?? "");
        setPlayerId((current) => demoPlayers.some((player) => player.player_id === current) ? current : demoPlayers[0]?.player_id ?? "");
        setSeasonLoading(false);
        return;
      }
      const liveClient = client;

      async function loadSeasonPlayers() {
        let result = await liveClient
          .rpc("api_season_players_for_season", { p_season_id: seasonId })
          .order("minutes", { ascending: false })
          .limit(1000);

        for (const delayMs of [500, 1500, 3000]) {
          if (!isSchemaCacheMiss(result.error)) break;
          await delay(delayMs);
          result = await liveClient
            .rpc("api_season_players_for_season", { p_season_id: seasonId })
            .order("minutes", { ascending: false })
            .limit(1000);
        }

        return result;
      }

      const [roundResult, matchResult, clubResult, playerResult, loanResult, rosterResult, teamAssetResult] = await Promise.all([
        liveClient.from("api_rounds").select("*").eq("season_id", seasonId).order("stage_number").order("round_number"),
        liveClient.from("api_matches").select("*").eq("season_id", seasonId).order("scheduled_at"),
        liveClient.from("api_clubs").select("*").eq("season_id", seasonId).order("points", { ascending: false }),
        loadSeasonPlayers(),
        liveClient.rpc("api_player_loans_for_season", { p_season_id: seasonId }),
        liveClient.rpc("api_team_rosters_for_season", { p_season_id: seasonId }),
        liveClient.from("api_team_assets").select("*"),
      ]);
      if (cancelled) return;
      const firstError = roundResult.error ?? matchResult.error ?? clubResult.error ?? playerResult.error ?? teamAssetResult.error;
      if (firstError) setError(firstError.message);

      const nextRounds = (roundResult.error ? [] : roundResult.data ?? []) as Round[];
      const teamAssets = (teamAssetResult.error ? [] : teamAssetResult.data ?? []) as TeamAsset[];
      const assetByTeamId = new Map(teamAssets.map((asset) => [asset.team_id, asset]));
      const nextMatches = ((matchResult.error ? [] : matchResult.data ?? []) as Omit<Match, "home_team_logo_url" | "away_team_logo_url">[]).map((match) => ({
        ...match,
        home_team_logo_url: assetByTeamId.get(match.home_team_id)?.logo_url ?? null,
        away_team_logo_url: assetByTeamId.get(match.away_team_id)?.logo_url ?? null,
      }));
      const nextClubs = ((clubResult.error ? [] : clubResult.data ?? []) as Omit<Club, "logo_url">[]).map((club) => ({
        ...club,
        logo_url: assetByTeamId.get(club.team_id)?.logo_url ?? null,
      }));
      const nextPlayers = (playerResult.error ? [] : playerResult.data ?? []) as SeasonPlayer[];
      const nextPlayerLoans = (loanResult.error ? [] : loanResult.data ?? []) as PlayerLoan[];
      const nextTeamRoster = (rosterResult.error ? [] : rosterResult.data ?? []) as TeamRosterMember[];
      const latestPlayedRound = [...nextRounds].reverse().find((round) => round.completed_match_count > 0) ?? nextRounds[nextRounds.length - 1];

      setRounds(nextRounds);
      setMatches(nextMatches);
      setClubs(nextClubs);
      setPlayers(nextPlayers);
      setPlayerLoans(nextPlayerLoans);
      setTeamRoster(nextTeamRoster);
      setSeasonPlayerLoadSucceeded(!playerResult.error);
      setRoundId((current) => nextRounds.some((round) => round.round_id === current) ? current : latestPlayedRound?.round_id ?? "");
      setClubId((current) => nextClubs.some((club) => club.team_id === current) ? current : nextClubs[0]?.team_id ?? "");
      setPlayerId((current) => {
        const pendingPlayer = pendingPlayerSelection.current;
        if (pendingPlayer?.seasonId === seasonId) {
          return pendingPlayer.playerId;
        }
        return current || (nextPlayers[0]?.player_id ?? nextTeamRoster[0]?.player_id ?? nextPlayerLoans[0]?.player_id ?? "");
      });
      setSeasonLoading(false);
    }

    void loadSeasonData();
    return () => { cancelled = true; };
  }, [refreshToken, seasonId]);

  const roundMatches = useMemo(
    () => matches.filter((match) => match.round_id === roundId),
    [matches, roundId],
  );
  useEffect(() => {
    if (seasonLoading || !roundId || !matches.length) return;
    const pending = pendingMatchSelection.current;
    if (pending?.seasonId === seasonId) {
      const pendingMatch = matches.find((match) => match.match_id === pending.matchId);
      if (!pendingMatch) return;
      pendingMatchSelection.current = null;
      setRoundId(pendingMatch.round_id ?? pending.roundId ?? "");
      setMatchId(pending.matchId);
      return;
    }
    setMatchId((current) => roundMatches.some((match) => match.match_id === current) ? current : roundMatches[0]?.match_id ?? "");
  }, [matches, roundId, roundMatches, seasonId, seasonLoading]);

  useEffect(() => {
    async function loadMatchDetail() {
      if (view !== "matches" || !matchId) {
        setMatchPlayerStats([]);
        setMatchTeamStats([]);
        setMatchPlayerHeatmaps([]);
        setMatchShots([]);
        return;
      }
      if (!hasSupabaseConfig || !supabase) return;
      setDetailLoading(true);
      const [playersResult, teamsResult, heatmapsResult, shotsResult] = await Promise.all([
        supabase
          .from("api_match_player_stats")
          .select("*")
          .eq("match_id", matchId)
          .in("metric_code", matchPlayerMetrics)
          .limit(1000),
        supabase.from("api_match_team_stats").select("*").eq("match_id", matchId).limit(500),
        supabase.from("api_match_player_heatmaps").select("*").eq("match_id", matchId).limit(100),
        supabase.from("api_match_shots").select("*").eq("match_id", matchId).order("minute").limit(500),
      ]);
      const firstError = playersResult.error ?? teamsResult.error;
      if (firstError) setError(firstError.message);
      setMatchPlayerStats((playersResult.data ?? []) as MatchPlayerStat[]);
      setMatchTeamStats((teamsResult.data ?? []) as MatchTeamStat[]);
      setMatchPlayerHeatmaps((heatmapsResult.data ?? []) as MatchPlayerHeatmap[]);
      setMatchShots((shotsResult.data ?? []) as MatchShot[]);
      setDetailLoading(false);
    }

    void loadMatchDetail();
  }, [matchId, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayerDetail() {
      if (view !== "players" || !competitionId || !playerId) {
        setPlayerHistory([]);
        setDetailLoading(false);
        return;
      }
      const client = supabase;
      if (!hasSupabaseConfig || !client) {
        setPlayerHistory(demoMetrics.flatMap((metric) => makeDemoHistory(playerId, metric)));
        return;
      }
      setDetailLoading(true);
      const result = await fetchPlayerHistoryRows(competitionId, playerId, playerTournamentScope === "all");
      if (cancelled) return;
      if (result.error) setError(result.error);
      setPlayerHistory(result.rows);
      setDetailLoading(false);
    }

    void loadPlayerDetail();
    return () => { cancelled = true; };
  }, [competitionId, playerId, playerTournamentScope, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadComparisonPlayerDetail() {
      const playerIds = comparisonPlayerIds.filter((id) => id !== playerId).slice(0, 4);
      const contextsReady = playerTournamentScope !== "all" || playerIds.every((id) => (
        comparisonCohortPlayers.some((player) => player.player_id === id)
        || players.some((player) => player.player_id === id)
        || teamRoster.some((player) => player.player_id === id)
      ));
      if (view !== "players" || !competitionId || !playerIds.length || !contextsReady) {
        setComparisonPlayerHistories({});
        setComparisonLoading(false);
        setComparisonError(null);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setComparisonPlayerHistories(Object.fromEntries(playerIds.map((id) => [
          id,
          demoMetrics.flatMap((metric) => makeDemoHistory(id, metric)),
        ])));
        return;
      }
      setComparisonLoading(true);
      setComparisonError(null);
      const results = await Promise.all(playerIds.map(async (id) => {
        const playerCompetitionId = comparisonCohortPlayers.find((player) => player.player_id === id)?.competition_id ?? competitionId;
        return [id, await fetchPlayerHistoryRows(playerCompetitionId, id, playerTournamentScope === "all")] as const;
      }));
      if (cancelled) return;
      setComparisonPlayerHistories(Object.fromEntries(results.map(([id, result]) => [id, result.rows])));
      setComparisonError(results.find(([, result]) => result.error)?.[1].error ?? null);
      setComparisonLoading(false);
    }

    void loadComparisonPlayerDetail();
    return () => { cancelled = true; };
  }, [comparisonCohortPlayers, comparisonPlayerIds, competitionId, playerId, playerTournamentScope, players, teamRoster, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayerValuations() {
      if (view !== "players" || !playerId || !hasSupabaseConfig || !supabase) {
        setPlayerValuations([]);
        setPlayerValuationLoading(false);
        return;
      }
      setPlayerValuationLoading(true);
      const result = await fetchPlayerValuationRows(playerId);
      if (cancelled) return;
      setPlayerValuations(result.rows);
      if (result.error) setError(result.error);
      setPlayerValuationLoading(false);
    }

    void loadPlayerValuations();
    return () => { cancelled = true; };
  }, [playerId, refreshToken, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadComparisonPlayerValuations() {
      const playerIds = comparisonPlayerIds.filter((id) => id !== playerId).slice(0, 4);
      const contextsReady = playerTournamentScope !== "all" || playerIds.every((id) => (
        comparisonCohortPlayers.some((player) => player.player_id === id)
        || players.some((player) => player.player_id === id)
        || teamRoster.some((player) => player.player_id === id)
      ));
      if (view !== "players" || !playerIds.length || !contextsReady || !hasSupabaseConfig || !supabase) {
        setComparisonPlayerValuations({});
        setComparisonValuationLoading(false);
        return;
      }
      setComparisonValuationLoading(true);
      const results = await Promise.all(playerIds.map(async (id) => [id, await fetchPlayerValuationRows(id)] as const));
      if (cancelled) return;
      setComparisonPlayerValuations(Object.fromEntries(results.map(([id, result]) => [id, result.rows])));
      const firstError = results.find(([, result]) => result.error)?.[1].error;
      if (firstError) setError(firstError);
      setComparisonValuationLoading(false);
    }

    void loadComparisonPlayerValuations();
    return () => { cancelled = true; };
  }, [comparisonCohortPlayers, comparisonPlayerIds, playerId, playerTournamentScope, players, refreshToken, teamRoster, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayerSeasonHeatmaps() {
      if (view !== "players" || !playerId || !seasonId) {
        setPlayerSeasonHeatmaps([]);
        setPlayerHeatmapLoading(false);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setPlayerSeasonHeatmaps([]);
        setPlayerHeatmapLoading(false);
        return;
      }

      setPlayerHeatmapLoading(true);
      const result = await fetchPlayerSeasonHeatmapRows(
        playerId,
        seasonId,
        matches,
        playerTournamentScope === "all"
          ? { name: currentSeason.season_name, ids: currentPlayerAllTournamentSeasonIds }
          : undefined,
      );
      if (cancelled) return;
      setPlayerSeasonHeatmaps(result.rows);
      setPlayerHeatmapLoading(false);
    }

    void loadPlayerSeasonHeatmaps();
    return () => { cancelled = true; };
  }, [currentPlayerAllTournamentSeasonIds, currentSeason.season_name, matches, playerId, playerTournamentScope, refreshToken, seasonId, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadComparisonPlayerSeasonHeatmaps() {
      const playerIds = comparisonPlayerIds.filter((id) => id !== playerId).slice(0, 4);
      const contextsReady = playerTournamentScope !== "all" || playerIds.every((id) => (
        comparisonCohortPlayers.some((player) => player.player_id === id)
        || players.some((player) => player.player_id === id)
        || teamRoster.some((player) => player.player_id === id)
      ));
      if (view !== "players" || !playerIds.length || !seasonId || !contextsReady) {
        setComparisonPlayerSeasonHeatmaps({});
        setComparisonPlayerHeatmapLoading(false);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setComparisonPlayerSeasonHeatmaps({});
        setComparisonPlayerHeatmapLoading(false);
        return;
      }

      setComparisonPlayerHeatmapLoading(true);
      const results = await Promise.all(playerIds.map(async (id) => {
        const playerSeasonId = comparisonCohortPlayers.find((player) => player.player_id === id)?.season_id ?? seasonId;
        return [
          id,
          await fetchPlayerSeasonHeatmapRows(
            id,
            playerSeasonId,
            playerSeasonId === seasonId ? matches : [],
            playerTournamentScope === "all"
              ? { name: currentSeason.season_name, ids: currentPlayerAllTournamentSeasonIds }
              : undefined,
          ),
        ] as const;
      }));
      if (cancelled) return;
      setComparisonPlayerSeasonHeatmaps(Object.fromEntries(results.map(([id, result]) => [id, result.rows])));
      setComparisonPlayerHeatmapLoading(false);
    }

    void loadComparisonPlayerSeasonHeatmaps();
    return () => { cancelled = true; };
  }, [comparisonCohortPlayers, comparisonPlayerIds, currentPlayerAllTournamentSeasonIds, currentSeason.season_name, matches, playerId, playerTournamentScope, players, refreshToken, seasonId, teamRoster, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeaderboard() {
      if (view !== "overview" || clubTournamentScope === "all" || !seasonId || !leaderMetricCode) {
        setLeaderboardRows([]);
        setLeaderboardLoading(false);
        return;
      }

      setLeaderboardLoading(true);
      setLeaderboardError(null);

      if (leaderMetricCode.startsWith("season_")) {
        setLeaderboardRows(makeSeasonSummaryLeaderboard(players, seasonId, leaderMetricCode));
        setLeaderboardLoading(false);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setLeaderboardRows(makeDemoLeaderboard(players, seasonId, leaderMetricCode));
        setLeaderboardLoading(false);
        return;
      }

      const result = isValuationMetricCode(leaderMetricCode)
        ? await supabase.rpc("api_player_valuation_leaderboard", { p_season_id: seasonId })
        : await supabase.rpc("api_player_leaderboard", {
          p_season_id: seasonId,
          p_metric_code: leaderboardSourceMetricCode(leaderMetricCode),
          p_min_minutes: ratingMinimumForMetric(leaderMetricCode, leaderRatingMinimumMinutes),
        });
      if (cancelled) return;
      if (result.error) {
        setLeaderboardError(result.error.message);
        setLeaderboardRows([]);
      } else {
        setLeaderboardRows(prepareLeaderboardRows((result.data ?? []) as PlayerLeaderboardRow[], players, leaderMetricCode));
      }
      setLeaderboardLoading(false);
    }

    void loadLeaderboard();
    return () => { cancelled = true; };
  }, [clubTournamentScope, leaderMetricCode, leaderRatingMinimumMinutes, players, seasonId, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadSquadLeaderboard() {
      if (view !== "clubs" || !seasonId || !squadMetricCode) return;

      setSquadLeaderboardLoading(true);
      setSquadLeaderboardError(null);

      if (squadMetricCode.startsWith("season_")) {
        setSquadLeaderboardRows(makeSeasonSummaryLeaderboard(players, seasonId, squadMetricCode));
        setSquadLeaderboardLoading(false);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setSquadLeaderboardRows(makeDemoLeaderboard(players, seasonId, squadMetricCode));
        setSquadLeaderboardLoading(false);
        return;
      }

      const result = isValuationMetricCode(squadMetricCode)
        ? await supabase.rpc("api_player_valuation_leaderboard", { p_season_id: seasonId })
        : await supabase.rpc("api_player_leaderboard", {
          p_season_id: seasonId,
          p_metric_code: leaderboardSourceMetricCode(squadMetricCode),
          p_min_minutes: ratingMinimumForMetric(squadMetricCode, squadRatingMinimumMinutes),
        });
      if (cancelled) return;
      if (result.error) {
        setSquadLeaderboardError(result.error.message);
        setSquadLeaderboardRows([]);
      } else {
        setSquadLeaderboardRows(prepareLeaderboardRows((result.data ?? []) as PlayerLeaderboardRow[], players, squadMetricCode));
      }
      setSquadLeaderboardLoading(false);
    }

    void loadSquadLeaderboard();
    return () => { cancelled = true; };
  }, [clubTournamentScope, players, seasonId, squadMetricCode, squadRatingMinimumMinutes, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadExplorerLeaderboard() {
      if (view !== "players" || !seasonId || !explorerMetricCode) return;

      setExplorerLeaderboardLoading(true);
      setExplorerLeaderboardError(null);

      if (explorerMetricCode.startsWith("season_")) {
        setExplorerLeaderboardRows(makeSeasonSummaryLeaderboard(players, seasonId, explorerMetricCode));
        setExplorerLeaderboardLoading(false);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setExplorerLeaderboardRows(makeDemoLeaderboard(players, seasonId, explorerMetricCode));
        setExplorerLeaderboardLoading(false);
        return;
      }

      const result = isValuationMetricCode(explorerMetricCode)
        ? await supabase.rpc("api_player_valuation_leaderboard", { p_season_id: seasonId })
        : await supabase.rpc("api_player_leaderboard", {
          p_season_id: seasonId,
          p_metric_code: leaderboardSourceMetricCode(explorerMetricCode),
          p_min_minutes: ratingMinimumForMetric(explorerMetricCode, explorerRatingMinimumMinutes),
        });
      if (cancelled) return;
      if (result.error) {
        setExplorerLeaderboardError(result.error.message);
        setExplorerLeaderboardRows([]);
      } else {
        setExplorerLeaderboardRows(prepareLeaderboardRows((result.data ?? []) as PlayerLeaderboardRow[], players, explorerMetricCode));
      }
      setExplorerLeaderboardLoading(false);
    }

    void loadExplorerLeaderboard();
    return () => { cancelled = true; };
  }, [explorerMetricCode, explorerRatingMinimumMinutes, players, seasonId, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadLegionnaires() {
      if (view !== "legionnaires" || !legionnaireSeasonName) return;
      setLegionnaireLoading(true);
      setLegionnaireError(null);

      if (!hasSupabaseConfig || !supabase) {
        setLegionnaires(demoPlayers.map((player) => ({
          ...player,
          competition_name: "Eredivisie",
          competition_name_he: null,
          team_logo_url: null,
        })));
        setLegionnaireLoading(false);
        return;
      }

      let result = await supabase.rpc("api_legionnaires", { p_season_name: legionnaireSeasonName });
      for (const delayMs of [500, 1500, 3000]) {
        if (!isRetryableSupabaseError(result.error)) break;
        await delay(delayMs);
        result = await supabase.rpc("api_legionnaires", { p_season_name: legionnaireSeasonName });
      }
      if (cancelled) return;
      if (result.error) {
        setLegionnaireError(result.error.message);
        setLegionnaires([]);
      } else {
        setLegionnaires((result.data ?? []) as Legionnaire[]);
      }
      setLegionnaireLoading(false);
    }

    void loadLegionnaires();
    return () => { cancelled = true; };
  }, [legionnaireSeasonName, refreshToken, view]);

  const overviewMatches = useMemo(
    () => currentRound
      ? roundMatches
      : [...matches]
        .sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""))
        .slice(0, 7),
    [currentRound, matches, roundMatches],
  );
  const overviewCompetitionIds = useMemo(() => new Set(competitions
    .filter((competition) => competition.scope !== "foreign_club")
    .map((competition) => competition.competition_id)), [competitions]);
  const allTournamentOverviewSeasonIds = useMemo(() => {
    const selectedStartYear = Number(currentSeason.season_name.slice(0, 4)) || new Date().getFullYear();
    const selectedStart = dateValue(currentSeason.start_date) || Date.UTC(selectedStartYear, 6, 1);
    const selectedEnd = dateValue(currentSeason.end_date) || Date.UTC(selectedStartYear + 1, 5, 30, 23, 59, 59);
    return seasons.filter((season) => {
      if (!overviewCompetitionIds.has(season.competition_id)) return false;
      if (season.season_name === currentSeason.season_name) return true;
      const seasonYear = Number(season.season_name.slice(0, 4));
      const calendarSeason = /^\d{4}$/.test(season.season_name);
      const seasonStart = dateValue(season.start_date)
        || (seasonYear ? Date.UTC(seasonYear, calendarSeason ? 0 : 6, 1) : 0);
      const seasonEnd = dateValue(season.end_date)
        || (seasonYear ? Date.UTC(calendarSeason ? seasonYear : seasonYear + 1, calendarSeason ? 11 : 5, calendarSeason ? 31 : 30, 23, 59, 59) : 0);
      return seasonStart > 0 && seasonEnd >= selectedStart && seasonStart <= selectedEnd;
    }).map((season) => season.season_id);
  }, [currentSeason.end_date, currentSeason.season_name, currentSeason.start_date, overviewCompetitionIds, seasons]);
  const allTournamentSeasonOptions = useMemo(() => {
    const byName = new Map<string, Season>();
    seasons
      .filter((season) => overviewCompetitionIds.has(season.competition_id)
        && /^\d{4}\/\d{4}$/.test(season.season_name)
        && Number(season.match_count) > 0)
      .sort((a, b) => Number(b.season_name.slice(0, 4)) - Number(a.season_name.slice(0, 4))
        || Number(b.competition_name === "Israeli Premier League") - Number(a.competition_name === "Israeli Premier League")
        || dateValue(b.start_date) - dateValue(a.start_date))
      .forEach((season) => {
        if (!byName.has(season.season_name)) byName.set(season.season_name, season);
      });
    return [...byName.values()];
  }, [overviewCompetitionIds, seasons]);
  const overviewLeagueTargets = useMemo<OverviewLeagueTarget[]>(() => (
    (Object.entries(overviewLeagueCompetitionNames) as Array<[OverviewGroup, string]>).flatMap(([key, competitionName]) => {
      const competition = competitions.find((item) => item.name === competitionName);
      const season = competition && seasons.find((item) => item.competition_id === competition.competition_id && item.season_name === currentSeason.season_name);
      return competition && season ? [{ key, competition, season }] : [];
    })
  ), [competitions, currentSeason.season_name, seasons]);

  useEffect(() => {
    if (loading || overviewSeasonDefaultApplied.current || view !== "overview" || clubTournamentScope !== "all") return;
    const latestSeasonName = allTournamentSeasonOptions[0]?.season_name;
    const premierLeague = competitions.find((competition) => competition.name === "Israeli Premier League");
    const latestPremierSeason = premierLeague && seasons.find((season) => season.competition_id === premierLeague.competition_id && season.season_name === latestSeasonName);
    overviewSeasonDefaultApplied.current = true;
    if (!premierLeague || !latestPremierSeason) return;
    setCompetitionId(premierLeague.competition_id);
    setSeasonId(latestPremierSeason.season_id);
  }, [allTournamentSeasonOptions, clubTournamentScope, competitions, loading, seasons, view]);
  const allTournamentSeasonIds = useMemo(() => {
    const domesticClubCompetitionIds = new Set(competitions
      .filter((competition) => (competition.scope || "domestic") === "domestic" && competition.participant_type === "club")
      .map((competition) => competition.competition_id));
    return seasons
      .filter((season) => season.season_name === currentSeason.season_name && domesticClubCompetitionIds.has(season.competition_id))
      .map((season) => season.season_id);
  }, [competitions, currentSeason.season_name, seasons]);
  useEffect(() => {
    let cancelled = false;

    async function loadAllTournamentOverview() {
      if (view !== "overview" || clubTournamentScope !== "all") {
        setAllTournamentOverviewMatches([]);
        setAllTournamentOverviewLoading(false);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setAllTournamentOverviewMatches(demoMatches);
        setAllTournamentOverviewLoading(false);
        return;
      }
      if (!allTournamentOverviewSeasonIds.length) {
        setAllTournamentOverviewMatches([]);
        setAllTournamentOverviewLoading(false);
        return;
      }

      setAllTournamentOverviewLoading(true);
      const [matchResult, teamAssetResult] = await Promise.all([
        supabase.from("api_matches").select("*").in("season_id", allTournamentOverviewSeasonIds).order("scheduled_at").limit(3000),
        supabase.from("api_team_assets").select("*"),
      ]);
      if (cancelled) return;
      const firstError = matchResult.error ?? teamAssetResult.error;
      if (firstError) {
        setError(firstError.message);
        setAllTournamentOverviewMatches([]);
        setAllTournamentOverviewLoading(false);
        return;
      }
      const assets = (teamAssetResult.data ?? []) as TeamAsset[];
      const assetByTeamId = new Map(assets.map((asset) => [asset.team_id, asset]));
      setAllTournamentOverviewMatches(((matchResult.data ?? []) as Omit<Match, "home_team_logo_url" | "away_team_logo_url">[]).map((match) => ({
        ...match,
        home_team_logo_url: assetByTeamId.get(match.home_team_id)?.logo_url ?? null,
        away_team_logo_url: assetByTeamId.get(match.away_team_id)?.logo_url ?? null,
      })));
      setAllTournamentOverviewLoading(false);
    }

    void loadAllTournamentOverview();
    return () => { cancelled = true; };
  }, [allTournamentOverviewSeasonIds, clubTournamentScope, refreshToken, view]);
  useEffect(() => {
    let cancelled = false;

    async function loadOverviewLeaguePlayers() {
      if (view !== "overview" || clubTournamentScope !== "all") {
        setOverviewLeaguePlayers({});
        setOverviewLeaguePlayersLoading(false);
        return;
      }
      setOverviewLeaguePlayersLoading(true);
      if (!hasSupabaseConfig || !supabase) {
        setOverviewLeaguePlayers(Object.fromEntries(overviewLeagueTargets.map((target) => [target.key, demoPlayers])));
        setOverviewLeaguePlayersLoading(false);
        return;
      }

      const client = supabase;
      const results = await Promise.all(overviewLeagueTargets.map(async (target) => {
        let result = await client
          .rpc("api_season_players_for_season", { p_season_id: target.season.season_id })
          .order("minutes", { ascending: false })
          .limit(1000);
        for (const delayMs of [500, 1500, 3000]) {
          if (!isSchemaCacheMiss(result.error)) break;
          await delay(delayMs);
          result = await client
            .rpc("api_season_players_for_season", { p_season_id: target.season.season_id })
            .order("minutes", { ascending: false })
            .limit(1000);
        }
        return [target.key, result.error ? [] : (result.data ?? []) as SeasonPlayer[]] as const;
      }));
      if (cancelled) return;
      setOverviewLeaguePlayers(Object.fromEntries(results));
      setOverviewLeaguePlayersLoading(false);
    }

    void loadOverviewLeaguePlayers();
    return () => { cancelled = true; };
  }, [clubTournamentScope, overviewLeagueTargets, refreshToken, view]);

  useEffect(() => {
    let cancelled = false;

    async function loadOverviewLeagueLeaderboards() {
      if (view !== "overview" || clubTournamentScope !== "all" || !leaderMetricCode) {
        setOverviewLeagueLeaders({});
        setOverviewLeagueLeadersLoading(false);
        return;
      }
      if (overviewLeaguePlayersLoading) return;
      setOverviewLeagueLeadersLoading(true);
      setOverviewLeagueErrors({});

      if (leaderMetricCode.startsWith("season_")) {
        setOverviewLeagueLeaders(Object.fromEntries(overviewLeagueTargets.map((target) => [
          target.key,
          makeSeasonSummaryLeaderboard(overviewLeaguePlayers[target.key] ?? [], target.season.season_id, leaderMetricCode),
        ])));
        setOverviewLeagueLeadersLoading(false);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setOverviewLeagueLeaders(Object.fromEntries(overviewLeagueTargets.map((target) => [
          target.key,
          makeDemoLeaderboard(overviewLeaguePlayers[target.key] ?? demoPlayers, target.season.season_id, leaderMetricCode),
        ])));
        setOverviewLeagueLeadersLoading(false);
        return;
      }

      const client = supabase;
      const results = await Promise.all(overviewLeagueTargets.map(async (target) => {
        const result = isValuationMetricCode(leaderMetricCode)
          ? await client.rpc("api_player_valuation_leaderboard", { p_season_id: target.season.season_id })
          : await client.rpc("api_player_leaderboard", {
            p_season_id: target.season.season_id,
            p_metric_code: leaderboardSourceMetricCode(leaderMetricCode),
            p_min_minutes: ratingMinimumForMetric(leaderMetricCode, leaderRatingMinimumMinutes),
          });
        const playersForLeague = overviewLeaguePlayers[target.key] ?? [];
        return {
          key: target.key,
          rows: result.error ? [] : prepareLeaderboardRows((result.data ?? []) as PlayerLeaderboardRow[], playersForLeague, leaderMetricCode),
          error: result.error?.message ?? null,
        };
      }));
      if (cancelled) return;
      setOverviewLeagueLeaders(Object.fromEntries(results.map((result) => [result.key, result.rows])));
      setOverviewLeagueErrors(Object.fromEntries(results.map((result) => [result.key, result.error])));
      setOverviewLeagueLeadersLoading(false);
    }

    void loadOverviewLeagueLeaderboards();
    return () => { cancelled = true; };
  }, [clubTournamentScope, leaderMetricCode, leaderRatingMinimumMinutes, overviewLeaguePlayers, overviewLeaguePlayersLoading, overviewLeagueTargets, view]);
  useEffect(() => {
    let cancelled = false;

    async function loadAllTournamentClubs() {
      if (view !== "clubs" || clubTournamentScope !== "all") {
        setAllTournamentClubs([]);
        setAllTournamentClubsLoading(false);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setAllTournamentClubs(demoClubs);
        setAllTournamentClubsLoading(false);
        return;
      }

      if (!allTournamentSeasonIds.length) {
        setAllTournamentClubs([]);
        setAllTournamentClubsLoading(false);
        return;
      }

      setAllTournamentClubsLoading(true);
      const [clubResult, teamAssetResult] = await Promise.all([
        supabase.from("api_clubs").select("*").in("season_id", allTournamentSeasonIds).limit(2000),
        supabase.from("api_team_assets").select("*"),
      ]);
      if (cancelled) return;
      const firstError = clubResult.error ?? teamAssetResult.error;
      if (firstError) {
        setError(firstError.message);
        setAllTournamentClubs([]);
        setAllTournamentClubsLoading(false);
        return;
      }

      const assets = (teamAssetResult.data ?? []) as TeamAsset[];
      const assetByTeamId = new Map(assets.map((asset) => [asset.team_id, asset]));
      const clubByTeamId = new Map<string, Club>();
      ((clubResult.data ?? []) as Omit<Club, "logo_url">[]).forEach((club) => {
        const withLogo = { ...club, logo_url: assetByTeamId.get(club.team_id)?.logo_url ?? null };
        if (!clubByTeamId.has(club.team_id) || club.season_id === seasonId) clubByTeamId.set(club.team_id, withLogo);
      });
      setAllTournamentClubs([...clubByTeamId.values()]);
      setAllTournamentClubsLoading(false);
    }

    void loadAllTournamentClubs();
    return () => { cancelled = true; };
  }, [allTournamentSeasonIds, clubTournamentScope, refreshToken, seasonId, view]);
  useEffect(() => {
    let cancelled = false;

    async function loadAllTournamentClubMatches() {
      if (view !== "clubs" || clubTournamentScope !== "all" || !clubId || !currentSeason.season_name) {
        setAllTournamentClubMatches([]);
        setClubMatchesLoading(false);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setAllTournamentClubMatches(demoMatches
          .filter((match) => match.season_name === currentSeason.season_name)
          .filter((match) => match.home_team_id === clubId || match.away_team_id === clubId)
          .sort((a, b) => dateValue(b.scheduled_at) - dateValue(a.scheduled_at)));
        return;
      }

      setClubMatchesLoading(true);
      const [matchResult, teamAssetResult] = await Promise.all([
        supabase
          .from("api_matches")
          .select("*")
          .eq("season_name", currentSeason.season_name)
          .or(`home_team_id.eq.${clubId},away_team_id.eq.${clubId}`)
          .order("scheduled_at", { ascending: false })
          .limit(1000),
        supabase.from("api_team_assets").select("*"),
      ]);
      if (cancelled) return;
      const firstError = matchResult.error ?? teamAssetResult.error;
      if (firstError) {
        setError(firstError.message);
        setAllTournamentClubMatches([]);
        setClubMatchesLoading(false);
        return;
      }

      const assets = (teamAssetResult.data ?? []) as TeamAsset[];
      const assetByTeamId = new Map(assets.map((asset) => [asset.team_id, asset]));
      setAllTournamentClubMatches(((matchResult.data ?? []) as Omit<Match, "home_team_logo_url" | "away_team_logo_url">[]).map((match) => ({
        ...match,
        home_team_logo_url: assetByTeamId.get(match.home_team_id)?.logo_url ?? null,
        away_team_logo_url: assetByTeamId.get(match.away_team_id)?.logo_url ?? null,
      })));
      setClubMatchesLoading(false);
    }

    void loadAllTournamentClubMatches();
    return () => { cancelled = true; };
  }, [clubId, clubTournamentScope, currentSeason.season_name, refreshToken, view]);
  const selectedMatch = matches.find((match) => match.match_id === matchId);
  const selectedClub = (clubTournamentScope === "all" ? allTournamentClubs.find((club) => club.team_id === clubId) : undefined)
    ?? clubs.find((club) => club.team_id === clubId);
  const loanProfilePlayers = useMemo(() => playerLoans.map((loan): SeasonPlayer => {
    const seasonPlayer = players.find((player) => player.player_id === loan.player_id);
    return seasonPlayer ?? {
      season_id: loan.season_id,
      competition_id: competitionId,
      player_id: loan.player_id,
      display_name: loan.display_name,
      display_name_he: loan.display_name_he,
      primary_position: loan.primary_position,
      specific_position: loan.specific_position,
      role_group: loan.role_group,
      team_id: loan.destination_team_id,
      team_name: loan.destination_team_name,
      appearances: 0,
      starts: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
      average_rating: null,
    };
  }), [competitionId, playerLoans, players]);
  const profilePlayers = useMemo(() => {
    const byPlayerId = new Map(players.map((player) => [player.player_id, player]));
    teamRoster.forEach((player) => {
      if (!byPlayerId.has(player.player_id)) byPlayerId.set(player.player_id, player);
    });
    loanProfilePlayers.forEach((player) => {
      if (!byPlayerId.has(player.player_id)) byPlayerId.set(player.player_id, player);
    });
    comparisonCohortPlayers.forEach((player) => {
      if (!byPlayerId.has(player.player_id)) byPlayerId.set(player.player_id, player);
    });
    return [...byPlayerId.values()];
  }, [comparisonCohortPlayers, loanProfilePlayers, players, teamRoster]);
  useEffect(() => {
    let cancelled = false;

    async function hydrateLinkedPlayerContexts() {
      if (view !== "players" || loading || seasonLoading || !hasSupabaseConfig || !supabase) return;
      const knownIds = new Set(profilePlayers.map((player) => player.player_id));
      const missingIds = [playerId, ...comparisonPlayerIds]
        .filter((id, index, ids) => id && !knownIds.has(id) && ids.indexOf(id) === index)
        .slice(0, 5);
      if (!missingIds.length) return;

      const contexts = await Promise.all(missingIds.map(async (missingPlayerId) => {
        let result = await supabase!.rpc("api_player_context_for_season", {
          p_player_id: missingPlayerId,
          p_season_name: currentSeason.season_name,
        });
        for (const delayMs of [500, 1500, 3000]) {
          if (!isRetryableSupabaseError(result.error)) break;
          await delay(delayMs);
          result = await supabase!.rpc("api_player_context_for_season", {
            p_player_id: missingPlayerId,
            p_season_name: currentSeason.season_name,
          });
        }
        return result.error ? null : ((result.data ?? [])[0] as SeasonPlayer | undefined) ?? null;
      }));
      if (cancelled) return;
      const resolved = contexts.filter((player): player is SeasonPlayer => Boolean(player));
      if (!resolved.length) return;
      setComparisonCohortPlayers((current) => [...new Map(
        [...current, ...resolved].map((player) => [player.player_id, player]),
      ).values()].slice(0, 5));
    }

    void hydrateLinkedPlayerContexts();
    return () => { cancelled = true; };
  }, [comparisonPlayerIds, currentSeason.season_name, loading, playerId, profilePlayers, seasonLoading, view]);
  const selectedPlayer = profilePlayers.find((player) => player.player_id === playerId);
  useEffect(() => {
    let cancelled = false;

    async function loadLegionnaireProfileFallback() {
      if (
        view !== "players"
        || loading
        || selectedPlayer
        || !playerId
        || currentSeason.season_id !== seasonId
        || currentCompetition?.scope !== "foreign_club"
        || !hasSupabaseConfig
        || !supabase
      ) return;

      let result = await supabase.rpc("api_legionnaires", { p_season_name: currentSeason.season_name });
      for (const delayMs of [500, 1500, 3000]) {
        if (!isRetryableSupabaseError(result.error)) break;
        await delay(delayMs);
        result = await supabase.rpc("api_legionnaires", { p_season_name: currentSeason.season_name });
      }
      if (cancelled) return;

      const fallback = ((result.data ?? []) as Legionnaire[]).find((player) => player.player_id === playerId);
      if (fallback) {
        setComparisonCohortPlayers((current) => [
          fallback,
          ...current.filter((player) => player.player_id !== fallback.player_id),
        ].slice(0, 5));
      } else if (pendingPlayerSelection.current?.playerId === playerId) {
        pendingPlayerSelection.current = null;
        setComparisonCohortPlayers((current) => [...current]);
      }
    }

    void loadLegionnaireProfileFallback();
    return () => { cancelled = true; };
  }, [currentCompetition?.scope, currentSeason.season_id, currentSeason.season_name, loading, playerId, seasonId, selectedPlayer, view]);
  const selectedPlayerLoan = useMemo(() => playerLoans
    .filter((loan) => loan.player_id === playerId)
    .sort((a, b) => dateValue(b.started_on) - dateValue(a.started_on))[0], [playerId, playerLoans]);
  const comparisonPlayers = useMemo(() => comparisonPlayerIds.flatMap((id) => {
    const player = profilePlayers.find((item) => item.player_id === id);
    return player ? [player] : [];
  }), [comparisonPlayerIds, profilePlayers]);
  const comparisonPlayer = comparisonPlayers[0];
  useEffect(() => {
    if (!comparisonPlayerIds.length || loading || seasonLoading) return;
    const validIds = comparisonPlayerIds.filter((id, index) => id !== playerId
      && (playerTournamentScope === "all" || !seasonPlayerLoadSucceeded || profilePlayers.some((player) => player.player_id === id))
      && comparisonPlayerIds.indexOf(id) === index).slice(0, 4);
    if (validIds.length !== comparisonPlayerIds.length || validIds.some((id, index) => id !== comparisonPlayerIds[index])) {
      setComparisonPlayerIds(validIds);
    }
  }, [comparisonPlayerIds, loading, playerId, playerTournamentScope, profilePlayers, seasonLoading, seasonPlayerLoadSucceeded]);
  const playerMetrics = useMemo(
    () => metrics.filter((metric) => metric.subject_type === "player_match"),
    [metrics],
  );
  const playerChartMetrics = useMemo(() => {
    const ratioComponentCodes = new Set(playerMetrics.flatMap((metric) => [
      metric.numerator_metric_code,
      metric.denominator_metric_code,
    ].filter((code): code is string => Boolean(code))));
    return playerMetrics
      .filter((metric) => !ratioComponentCodes.has(metric.code))
      .flatMap((metric): PlayerChartMetric[] => {
        const localizedName = metricName(metric.code, metric.name, language);
        if (metric.value_type !== "percentage") {
          const rawMetric: PlayerChartMetric = {
            ...metric,
            name: localizedName,
            chartKey: metric.code,
            chartMode: "single",
            normalization: "raw",
          };
          if (metric.code === "rating_365") {
            return [
              rawMetric,
              {
                ...rawMetric,
                name: text.ratingFull90,
                chartKey: `${metric.code}::full90`,
                minimumMatchMinutes: 90,
              },
            ];
          }
          return metric.value_type === "count" && metric.code !== "minutes"
            ? [
                rawMetric,
                { ...rawMetric, name: per90Name(localizedName, language), chartKey: `${metric.code}::per90`, normalization: "per90" },
              ]
            : [rawMetric];
        }
        const groupName = metricGroupName(metric.code, percentageMetricGroupName(metric), language);
        return [
          { ...metric, name: groupName, chartKey: `${metric.code}::paired`, chartMode: "paired", normalization: "raw" },
          { ...metric, name: `${groupName} (%)`, chartKey: metric.code, chartMode: "single", normalization: "raw" },
          { ...metric, name: per90Name(groupName, language), chartKey: `${metric.code}::per90`, chartMode: "paired", normalization: "per90" },
        ];
      });
  }, [language, playerMetrics, text.ratingFull90]);
  const playerViewMetrics = useMemo(
    () => selectedPlayer?.role_group === "Goalkeepers" && comparisonPlayers.every((player) => player.role_group === "Goalkeepers")
      ? playerChartMetrics
      : playerChartMetrics.filter((metric) => !isGoalkeepingMetricCode(metric.code)),
    [comparisonPlayers, playerChartMetrics, selectedPlayer?.role_group],
  );
  useEffect(() => {
    if (!playerViewMetrics.length) return;
    if (playerViewMetrics.some((metric) => metric.chartKey === metricCode)) return;
    const preferred = playerViewMetrics.find((metric) => metric.code === preferredMetric(playerMetrics));
    setMetricCode(preferred?.chartKey ?? playerViewMetrics[0]?.chartKey ?? "");
  }, [metricCode, playerMetrics, playerViewMetrics]);
  const leaderboardMetrics = useMemo<LeaderboardMetricOption[]>(
    () => [
      ...seasonLeaderboardMetrics.map((metric) => ({
        ...metric,
        name: metric.code === "current_valuation"
          ? text.estimatedTransferValue
          : metricName(metric.code, metric.name, language),
      })),
      ...playerMetrics.flatMap((metric): LeaderboardMetricOption[] => {
        const localizedName = metricName(metric.code, metric.name, language);
        const rawMetric: LeaderboardMetricOption = {
          code: metric.code,
          name: localizedName,
          value_type: metric.value_type,
          denominator_metric_code: metric.denominator_metric_code,
          kind: "match",
        };
        if (metric.code === "rating_365") {
          return [rawMetric, { ...rawMetric, code: `${metric.code}::full90`, name: text.ratingFull90 }];
        }
        return metric.value_type === "count" && metric.code !== "minutes"
          ? [rawMetric, { ...rawMetric, code: `${metric.code}::per90`, name: per90Name(localizedName, language), value_type: "rate" }]
          : [rawMetric];
      }),
    ],
    [language, playerMetrics, text.estimatedTransferValue, text.ratingFull90],
  );
  const explorerLeaderboardMetrics = useMemo(() => {
    if (roleFilter === "All") return leaderboardMetrics;
    const seasonMetrics = leaderboardMetrics.filter((metric) => metric.kind === "season");
    const matchMetrics = leaderboardMetrics.filter((metric) => metric.kind === "match");
    if (roleFilter === "Goalkeepers") {
      return [
        ...seasonMetrics,
        ...matchMetrics.filter((metric) => isGoalkeepingMetricCode(metric.code)),
        ...matchMetrics.filter((metric) => !isGoalkeepingMetricCode(metric.code)),
      ];
    }
    return [...seasonMetrics, ...matchMetrics.filter((metric) => !isGoalkeepingMetricCode(metric.code))];
  }, [leaderboardMetrics, roleFilter]);
  useEffect(() => {
    if (loading || !metrics.length) return;
    if (explorerLeaderboardMetrics.some((metric) => metric.code === explorerMetricCode)) return;
    setExplorerMetricCode("season_minutes");
  }, [explorerLeaderboardMetrics, explorerMetricCode, loading, metrics.length]);
  useEffect(() => {
    if (loading || !metrics.length) return;
    if (leaderboardMetrics.some((metric) => metric.code === legionnaireMetricCode)) return;
    setLegionnaireMetricCode("season_minutes");
  }, [leaderboardMetrics, legionnaireMetricCode, loading, metrics.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadLegionnaireLeaderboard() {
      if (view !== "legionnaires" || !legionnaireSeasonName || !legionnaireMetricCode) return;
      setLegionnaireLeaderboardLoading(true);
      setLegionnaireLeaderboardError(null);

      if (legionnaireMetricCode.startsWith("season_")) {
        setLegionnaireLeaderboardRows(makeSeasonSummaryLeaderboard(
          legionnaires,
          legionnaires[0]?.season_id ?? legionnaireSeasonName,
          legionnaireMetricCode,
        ));
        setLegionnaireLeaderboardLoading(false);
        return;
      }
      if (!hasSupabaseConfig || !supabase) {
        setLegionnaireLeaderboardRows(makeDemoLeaderboard(
          legionnaires,
          legionnaires[0]?.season_id ?? "demo-season",
          legionnaireMetricCode,
        ));
        setLegionnaireLeaderboardLoading(false);
        return;
      }

      const client = supabase;
      const requestLeaderboard = () => isValuationMetricCode(legionnaireMetricCode)
        ? client.rpc("api_legionnaire_valuation_leaderboard", { p_season_name: legionnaireSeasonName })
        : client.rpc("api_legionnaire_leaderboard", {
          p_season_name: legionnaireSeasonName,
          p_metric_code: leaderboardSourceMetricCode(legionnaireMetricCode),
          p_min_minutes: ratingMinimumForMetric(legionnaireMetricCode, legionnaireRatingMinimumMinutes),
        });
      let result = await requestLeaderboard();
      for (const delayMs of [500, 1500, 3000]) {
        if (!isRetryableSupabaseError(result.error)) break;
        await delay(delayMs);
        result = await requestLeaderboard();
      }
      if (cancelled) return;
      if (result.error) {
        setLegionnaireLeaderboardError(result.error.message);
        setLegionnaireLeaderboardRows([]);
      } else {
        setLegionnaireLeaderboardRows(prepareLeaderboardRows(
          (result.data ?? []) as PlayerLeaderboardRow[],
          legionnaires,
          legionnaireMetricCode,
        ));
      }
      setLegionnaireLeaderboardLoading(false);
    }

    void loadLegionnaireLeaderboard();
    return () => { cancelled = true; };
  }, [legionnaireMetricCode, legionnaireRatingMinimumMinutes, legionnaireSeasonName, legionnaires, view]);
  const leaderQualification = getLeaderboardQualification(leaderboardMetrics.find((metric) => metric.code === leaderMetricCode));
  const squadQualification = getLeaderboardQualification(leaderboardMetrics.find((metric) => metric.code === squadMetricCode));
  const explorerQualification = getLeaderboardQualification(explorerLeaderboardMetrics.find((metric) => metric.code === explorerMetricCode));
  const legionnaireQualification = getLeaderboardQualification(leaderboardMetrics.find((metric) => metric.code === legionnaireMetricCode));
  const leaderMinimum = leaderQualification ? leaderMinimums[leaderMetricCode] ?? leaderQualification.defaultValue : 0;
  const squadMinimum = squadQualification ? squadMinimums[squadMetricCode] ?? squadQualification.defaultValue : 0;
  const explorerMinimum = explorerQualification ? explorerMinimums[explorerMetricCode] ?? explorerQualification.defaultValue : 0;
  const legionnaireMinimum = legionnaireQualification ? legionnaireMinimums[legionnaireMetricCode] ?? legionnaireQualification.defaultValue : 0;
  const qualifiedLeaderboardRows = filterLeaderboardRows(leaderboardRows, players, leaderQualification, leaderMinimum);
  const overviewLeagueEntries = overviewLeagueTargets.map<OverviewLeagueEntry>((target) => ({
    ...target,
    players: overviewLeaguePlayers[target.key] ?? [],
    leaders: overviewLeagueLeaders[target.key] ?? [],
    loading: overviewLeaguePlayersLoading || overviewLeagueLeadersLoading,
    error: overviewLeagueErrors[target.key] ?? null,
  }));
  const filteredLegionnaires = useMemo(() => {
    const query = legionnaireQuery.trim().toLowerCase();
    return legionnaires.filter((player) => !query || [
      player.display_name,
      player.display_name_he,
      player.team_name,
      player.competition_name,
      player.competition_name_he,
      player.primary_position,
      player.specific_position,
    ].filter(Boolean).some((value) => value!.toLowerCase().includes(query)));
  }, [legionnaireQuery, legionnaires]);
  const filteredLegionnaireIds = new Set(filteredLegionnaires.map((player) => player.player_id));
  const qualifiedLegionnaireRows = filterLeaderboardRows(
    legionnaireLeaderboardRows.filter((row) => filteredLegionnaireIds.has(row.player_id)),
    legionnaires,
    legionnaireQualification,
    legionnaireMinimum,
  );
  const legionnaireById = new Map(legionnaires.map((player) => [player.player_id, player]));
  const rankedLegionnaires = qualifiedLegionnaireRows.flatMap((row) => {
    const player = legionnaireById.get(row.player_id);
    return player ? [{ player, ranking: row }] : [];
  });

  const standings = useMemo(
    () => [...clubs].sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference),
    [clubs],
  );
  const positionOptions = useMemo(() => {
    if (!["Defenders", "Midfielders", "Attackers"].includes(roleFilter)) return [];
    const options = new Map<string, PlayerPositionDetail>();
    players
      .filter((player) => player.role_group === roleFilter)
      .forEach((player) => {
        const position = playerPositionFilterDetail(player);
        options.set(position.code, position);
      });
    return [...options.values()].sort((a, b) => {
      const aOrder = positionCodeOrder.indexOf(a.code);
      const bOrder = positionCodeOrder.indexOf(b.code);
      return (aOrder < 0 ? positionCodeOrder.length : aOrder)
        - (bOrder < 0 ? positionCodeOrder.length : bOrder)
        || a.label.localeCompare(b.label);
    });
  }, [players, roleFilter]);
  const filteredPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    return players.filter((player) => {
      const detailedPosition = playerPositionDetail(player);
      const club = clubs.find((item) => item.team_id === player.team_id);
      const matchesRole = roleFilter === "All" || player.role_group === roleFilter;
      const matchesPosition = positionFilter === "All" || playerPositionFilterDetail(player).code === positionFilter;
      const matchesClub = clubFilter === "all" || player.team_id === clubFilter;
      const matchesQuery = !query || [player.display_name, player.display_name_he, player.team_name, club?.team_name_he, player.primary_position, detailedPosition.code, detailedPosition.label]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
      return matchesRole && matchesPosition && matchesClub && matchesQuery;
    });
  }, [clubFilter, clubs, playerQuery, players, positionFilter, roleFilter]);
  const filteredPlayerIds = new Set(filteredPlayers.map((player) => player.player_id));
  const filteredExplorerRows = explorerLeaderboardRows.filter((row) => filteredPlayerIds.has(row.player_id));
  const qualifiedExplorerRows = filterLeaderboardRows(filteredExplorerRows, players, explorerQualification, explorerMinimum);
  const filteredPlayersById = new Map(filteredPlayers.map((player) => [player.player_id, player]));
  const rankedExplorerPlayers = qualifiedExplorerRows.flatMap((row) => {
    const player = filteredPlayersById.get(row.player_id);
    return player ? [player] : [];
  });
  useEffect(() => {
    const hasPinnedProfile = comparisonCohortPlayers.some((player) => player.player_id === playerId);
    const hasPendingProfile = pendingPlayerSelection.current?.playerId === playerId;
    if (view !== "players" || playerId || explorerLeaderboardLoading || selectedPlayerLoan || hasPinnedProfile || hasPendingProfile || !rankedExplorerPlayers.length) return;
    setComparisonPlayerIds([]);
    setPlayerId(rankedExplorerPlayers[0].player_id);
  }, [comparisonCohortPlayers, explorerLeaderboardLoading, playerId, rankedExplorerPlayers, selectedPlayerLoan, view]);
  const clubMatches = useMemo(
    () => clubTournamentScope === "all" && view === "clubs"
      ? allTournamentClubMatches
      : [...matches]
        .filter((match) => match.home_team_id === clubId || match.away_team_id === clubId)
        .sort((a, b) => dateValue(b.scheduled_at) - dateValue(a.scheduled_at)),
    [allTournamentClubMatches, clubId, clubTournamentScope, matches, view],
  );
  const clubLoans = useMemo(() => {
    const latestByPlayerId = new Map<string, PlayerLoan>();
    playerLoans
      .filter((loan) => loan.parent_team_id === clubId)
      .sort((a, b) => dateValue(a.started_on) - dateValue(b.started_on))
      .forEach((loan) => latestByPlayerId.set(loan.player_id, loan));
    return [...latestByPlayerId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [clubId, playerLoans]);
  const clubSquad = useMemo(
    () => {
      const loanedPlayerIds = new Set(clubLoans.map((loan) => loan.player_id));
      const byPlayerId = new Map<string, SeasonPlayer>();
      teamRoster
        .filter((player) => player.team_id === clubId && !isManagementPlayer(player) && !loanedPlayerIds.has(player.player_id))
        .forEach((player) => byPlayerId.set(player.player_id, player));
      players
        .filter((player) => player.team_id === clubId && !isManagementPlayer(player) && !loanedPlayerIds.has(player.player_id))
        .forEach((player) => byPlayerId.set(player.player_id, player));
      return [...byPlayerId.values()];
    },
    [clubId, clubLoans, players, teamRoster],
  );
  const clubManagement = useMemo(() => {
    const byPlayerId = new Map<string, SeasonPlayer>();
    players
      .filter((player) => player.team_id === clubId && isManagementPlayer(player))
      .forEach((player) => byPlayerId.set(player.player_id, player));
    teamRoster
      .filter((player) => player.team_id === clubId && isManagementPlayer(player))
      .forEach((player) => byPlayerId.set(player.player_id, player));
    return [...byPlayerId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [clubId, players, teamRoster]);
  const clubSquadLeaderboardRows = useMemo(() => {
    const squadPlayerIds = new Set(clubSquad.map((player) => player.player_id));
    return squadLeaderboardRows.filter((player) => squadPlayerIds.has(player.player_id));
  }, [clubSquad, squadLeaderboardRows]);
  const clubSquadLeaders = filterLeaderboardRows(clubSquadLeaderboardRows, players, squadQualification, squadMinimum);
  const clubSquadRows = useMemo(() => {
    const playerById = new Map(clubSquad.map((player) => [player.player_id, player]));
    const rankedPlayerIds = new Set(clubSquadLeaders.map((row) => row.player_id));
    const ranked = clubSquadLeaders.flatMap((ranking) => {
      const player = playerById.get(ranking.player_id);
      return player ? [{ player, ranking }] : [];
    });
    const unranked = clubSquad
      .filter((player) => !rankedPlayerIds.has(player.player_id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((player) => ({ player, ranking: null }));
    return [...ranked, ...unranked];
  }, [clubSquad, clubSquadLeaders]);
  const clubLoanLeaderboardRows = useMemo(() => {
    const loanPlayerIds = new Set(clubLoans.map((loan) => loan.player_id));
    return squadLeaderboardRows.filter((row) => loanPlayerIds.has(row.player_id));
  }, [clubLoans, squadLeaderboardRows]);
  const selectedPlayerMetric = playerViewMetrics.find((metric) => metric.chartKey === metricCode);
  const seasonNameById = useMemo(() => new Map(seasons.map((season) => [season.season_id, season.season_name])), [seasons]);
  const comparisonSeasonIdsByPlayer = useMemo(() => Object.fromEntries(
    comparisonCohortPlayers.map((player) => [player.player_id, player.season_id]),
  ), [comparisonCohortPlayers]);
  const visiblePlayerHistory = useMemo(
    () => playerHistoryRange === "all"
      ? playerHistory
      : playerHistory.filter((row) => playerTournamentScope === "all"
        ? seasonNameById.get(row.season_id) === currentSeason.season_name
        : row.season_id === seasonId),
    [currentSeason.season_name, playerHistory, playerHistoryRange, playerTournamentScope, seasonId, seasonNameById],
  );
  const visibleComparisonPlayerHistories = useMemo(() => Object.fromEntries(
    Object.entries(comparisonPlayerHistories).map(([id, rows]) => [
      id,
      playerHistoryRange === "all" ? rows : rows.filter((row) => playerTournamentScope === "all"
        ? seasonNameById.get(row.season_id) === currentSeason.season_name
        : row.season_id === (comparisonSeasonIdsByPlayer[id] ?? seasonId)),
    ]),
  ), [comparisonPlayerHistories, comparisonSeasonIdsByPlayer, currentSeason.season_name, playerHistoryRange, playerTournamentScope, seasonId, seasonNameById]);
  const visibleComparisonPlayerHistory = comparisonPlayer ? visibleComparisonPlayerHistories[comparisonPlayer.player_id] ?? [] : [];
  const playerHistorySeasonCount = useMemo(
    () => new Set([
      ...playerHistory.map((row) => seasonNameById.get(row.season_id) ?? row.season_id),
      ...Object.values(comparisonPlayerHistories).flat().map((row) => seasonNameById.get(row.season_id) ?? row.season_id),
    ]).size,
    [comparisonPlayerHistories, playerHistory, seasonNameById],
  );
  useEffect(() => {
    if (playerHistory.length && playerHistoryRange === "all" && playerHistorySeasonCount <= 1) setPlayerHistoryRange("latest");
  }, [playerHistory.length, playerHistoryRange, playerHistorySeasonCount]);
  const playerChartData = useMemo(
    () => selectedPlayerMetric
      ? aggregatePlayerHistory(visiblePlayerHistory, selectedPlayerMetric, playerHistoryRange === "all", language)
      : [],
    [language, playerHistoryRange, selectedPlayerMetric, visiblePlayerHistory],
  );
  const comparisonPlayerChartData = useMemo(
    () => selectedPlayerMetric && comparisonPlayer
      ? aggregatePlayerHistory(visibleComparisonPlayerHistory, selectedPlayerMetric, playerHistoryRange === "all", language)
      : [],
    [comparisonPlayer, language, playerHistoryRange, selectedPlayerMetric, visibleComparisonPlayerHistory],
  );
  const comparisonPlayerChartDataById = useMemo(() => selectedPlayerMetric
    ? Object.fromEntries(comparisonPlayers.map((player) => [
        player.player_id,
        aggregatePlayerHistory(
          visibleComparisonPlayerHistories[player.player_id] ?? [],
          selectedPlayerMetric,
          playerHistoryRange === "all",
          language,
        ),
      ]))
    : {}, [comparisonPlayers, language, playerHistoryRange, selectedPlayerMetric, visibleComparisonPlayerHistories]);
  const playerRatioNumerator = playerChartData.reduce((total, point) => total + Number(point.numerator ?? 0), 0);
  const playerRatioDenominator = playerChartData.reduce((total, point) => total + Number(point.denominator ?? 0), 0);
  const observedPlayerValues = playerChartData
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const playerAverage = playerChartData.length
    ? selectedPlayerMetric?.value_type === "percentage" && playerRatioDenominator > 0
      ? playerRatioNumerator * 100 / playerRatioDenominator
      : observedPlayerValues.length
        ? observedPlayerValues.reduce((total, value) => total + value, 0) / observedPlayerValues.length
        : null
    : null;
  const matchPlayers = useMemo(() => pivotMatchPlayers(matchPlayerStats), [matchPlayerStats]);
  const visibleMatchPlayers = matchPlayers.filter((player) => player.side === matchSide);
  const teamComparisons = useMemo(() => buildTeamComparisons(matchTeamStats, language), [language, matchTeamStats]);

  useEffect(() => {
    if (loading) return;
    writeDeepLinkState({
      language,
      view,
      competitionId,
      seasonId,
      roundId,
      matchId,
      matchPlayerId,
      matchSide,
      shotSide,
      shotPlayerId,
      clubId,
      playerId,
      comparisonPlayerIds,
      metricCode,
      playerHistoryRange,
      leaderMetricCode,
      leaderMinimum,
      leaderRatingMinimumMinutes,
      squadMetricCode,
      squadMinimum,
      squadRatingMinimumMinutes,
      explorerMetricCode,
      explorerMinimum,
      explorerRatingMinimumMinutes,
      roleFilter,
      positionFilter,
      clubFilter,
      clubTournamentScope,
      playerTournamentScope,
      clubQuery,
      playerQuery,
      attributeQuery,
      legionnaireSeasonName,
      legionnaireMetricCode,
      legionnaireMinimum,
      legionnaireRatingMinimumMinutes,
      legionnaireQuery,
    });
  }, [
    attributeQuery,
    clubFilter,
    clubId,
    clubQuery,
    clubTournamentScope,
    competitionId,
    comparisonPlayerIds,
    explorerMetricCode,
    explorerMinimum,
    explorerRatingMinimumMinutes,
    language,
    leaderMetricCode,
    leaderMinimum,
    leaderRatingMinimumMinutes,
    legionnaireMetricCode,
    legionnaireMinimum,
    legionnaireQuery,
    legionnaireRatingMinimumMinutes,
    legionnaireSeasonName,
    loading,
    matchId,
    matchPlayerId,
    matchSide,
    shotPlayerId,
    shotSide,
    metricCode,
    playerHistoryRange,
    playerId,
    playerQuery,
    playerTournamentScope,
    positionFilter,
    roleFilter,
    roundId,
    seasonId,
    squadMetricCode,
    squadMinimum,
    squadRatingMinimumMinutes,
    view,
  ]);

  function selectAllTournamentOverview() {
    setClubTournamentScope("all");
    const premierLeague = competitions.find((competition) => competition.name === "Israeli Premier League");
    if (!premierLeague) return;
    const latestSeasonName = allTournamentSeasonOptions[0]?.season_name;
    const matchingSeason = seasons.find((season) => season.competition_id === premierLeague.competition_id && season.season_name === latestSeasonName)
      ?? latestSeasonWithData(seasons.filter((season) => season.competition_id === premierLeague.competition_id));
    setCompetitionId(premierLeague.competition_id);
    if (matchingSeason) setSeasonId(matchingSeason.season_id);
  }

  function navigate(nextView: View) {
    if (nextView === "overview") selectAllTournamentOverview();
    setView(nextView);
    window.history.pushState(null, "", `#${nextView}`);
  }

  function clearPinnedPlayerProfile() {
    pendingPlayerSelection.current = null;
    setComparisonCohortPlayers([]);
  }

  function preparePlayerContextChange() {
    pendingPlayerSelection.current = null;
    const preservedPlayers = [selectedPlayer, ...comparisonPlayers].filter((player): player is SeasonPlayer => Boolean(player));
    if (preservedPlayers.length) {
      setComparisonCohortPlayers([...new Map(preservedPlayers.map((player) => [player.player_id, player])).values()]);
    }
  }

  async function changePlayerSeason(targetSeason: Season, requestedScope = playerTournamentScope) {
    preparePlayerContextChange();
    if (!playerId || !hasSupabaseConfig || !supabase) {
      pendingPlayerSelection.current = playerId ? { seasonId: targetSeason.season_id, playerId } : null;
      setPlayerTournamentScope(comparisonPlayerIds.length ? "all" : requestedScope);
      setSeasonId(targetSeason.season_id);
      return;
    }

    const requestId = ++playerContextRequest.current;
    const requestedIds = [playerId, ...comparisonPlayerIds];
    const fallbackById = new Map(profilePlayers.map((player) => [player.player_id, player]));
    const client = supabase;
    setPlayerContextLoading(true);

    const resolved = await Promise.all(requestedIds.map(async (requestedPlayerId) => {
      try {
        let result = await client.rpc("api_player_context_for_season", {
          p_player_id: requestedPlayerId,
          p_season_name: targetSeason.season_name,
        });
        for (const delayMs of [500, 1500, 3000]) {
          if (!isRetryableSupabaseError(result.error)) break;
          await delay(delayMs);
          result = await client.rpc("api_player_context_for_season", {
            p_player_id: requestedPlayerId,
            p_season_name: targetSeason.season_name,
          });
        }
        return result.error ? null : ((result.data ?? [])[0] as SeasonPlayer | undefined) ?? null;
      } catch {
        return null;
      }
    }));

    if (playerContextRequest.current !== requestId) return;
    const primaryContext = resolved[0];
    const resolvedPlayers = resolved.map((player, index) => player ?? fallbackById.get(requestedIds[index])).filter((player): player is SeasonPlayer => Boolean(player));
    setComparisonCohortPlayers([...new Map(resolvedPlayers.map((player) => [player.player_id, player])).values()]);

    if (primaryContext) {
      const primaryCompetition = competitions.find((competition) => competition.competition_id === primaryContext.competition_id);
      const nextTournamentScope = requestedIds.length > 1
        || requestedScope === "all"
        || !isClubLeagueCompetition(primaryCompetition)
        ? "all"
        : "selected";
      const nextComparisonIds = resolved.slice(1).map((player, index) => (
        player?.player_id ?? comparisonPlayerIds[index]
      )).filter((id, index, ids) => Boolean(id) && id !== primaryContext.player_id && ids.indexOf(id) === index).slice(0, 4);
      pendingPlayerSelection.current = { seasonId: primaryContext.season_id, playerId: primaryContext.player_id };
      setSeasonPlayerLoadSucceeded(false);
      setPlayerTournamentScope(nextTournamentScope);
      setCompetitionId(primaryContext.competition_id);
      setSeasonId(primaryContext.season_id);
      setPlayerId(primaryContext.player_id);
      setComparisonPlayerIds(nextComparisonIds);
    } else {
      pendingPlayerSelection.current = { seasonId: targetSeason.season_id, playerId };
      setSeasonPlayerLoadSucceeded(false);
      setPlayerTournamentScope("all");
      setSeasonId(targetSeason.season_id);
    }
    setPlayerContextLoading(false);
  }

  function openMatch(match: Match) {
    if (match.competition_id !== competitionId || match.season_id !== seasonId) {
      pendingMatchSelection.current = {
        seasonId: match.season_id,
        matchId: match.match_id,
        roundId: match.round_id,
      };
      setClubTournamentScope("selected");
      setCompetitionId(match.competition_id);
      setSeasonId(match.season_id);
    } else {
      pendingMatchSelection.current = null;
    }
    if (match.round_id) setRoundId(match.round_id);
    setMatchId(match.match_id);
    setMatchPlayerId("");
    setMatchSide("home");
    navigate("matches");
  }

  function openPlayer(nextPlayerId: string, targetSeasonId?: string, profileFallback?: SeasonPlayer) {
    pendingPlayerSelection.current = targetSeasonId ? { seasonId: targetSeasonId, playerId: nextPlayerId } : null;
    setComparisonCohortPlayers(profileFallback ? [profileFallback] : []);
    setComparisonPlayerIds([]);
    setPlayerTournamentScope("selected");
    setRoleFilter("All");
    setPositionFilter("All");
    setClubFilter("all");
    setPlayerQuery("");
    setExplorerMetricCode("season_minutes");
    setExplorerMinimums((current) => ({ ...current, season_minutes: 0 }));
    setPlayerId(nextPlayerId);
    navigate("players");
  }

  function openOverviewPlayer(nextPlayerId: string, season: Season) {
    setCompetitionId(season.competition_id);
    setSeasonId(season.season_id);
    openPlayer(nextPlayerId, season.season_id);
  }

  function openLegionnaire(player: Legionnaire) {
    setCompetitionId(player.competition_id);
    setSeasonId(player.season_id);
    openPlayer(player.player_id, player.season_id, player);
  }

  function compareTopPlayers(nextPlayers: SeasonPlayer[], nextMetricCode: string) {
    const uniquePlayers = [...new Map(nextPlayers.map((player) => [player.player_id, player])).values()].slice(0, 5);
    if (uniquePlayers.length < 2) return;
    const primaryPlayer = uniquePlayers[0];
    const sourceMetricCode = leaderboardSourceMetricCode(nextMetricCode);
    const desiredChartMetricCode = sourceMetricCode === "season_minutes" ? "minutes" : nextMetricCode;
    const chartMetric = playerChartMetrics.find((metric) => metric.chartKey === desiredChartMetricCode)
      ?? playerChartMetrics.find((metric) => metric.chartKey === sourceMetricCode);

    setComparisonCohortPlayers(uniquePlayers);
    setPlayerTournamentScope("all");
    if (primaryPlayer.season_id !== seasonId) {
      pendingPlayerSelection.current = { seasonId: primaryPlayer.season_id, playerId: primaryPlayer.player_id };
      setSeasonPlayerLoadSucceeded(false);
    }
    setCompetitionId(primaryPlayer.competition_id);
    setSeasonId(primaryPlayer.season_id);
    setRoleFilter("All");
    setPositionFilter("All");
    setClubFilter("all");
    setPlayerQuery("");
    setAttributeQuery("");
    setExplorerMetricCode(nextMetricCode);
    setPlayerId(primaryPlayer.player_id);
    setComparisonPlayerIds(uniquePlayers.slice(1).map((player) => player.player_id));
    if (chartMetric) setMetricCode(chartMetric.chartKey);
    navigate("players");
  }

  function openClub(nextClubId: string) {
    setClubId(nextClubId);
    setClubTournamentScope("all");
    navigate("clubs");
  }

  const showingAllTournaments = ((view === "clubs" || view === "overview") && clubTournamentScope === "all")
    || (view === "players" && playerTournamentScope === "all");
  const showingLegionnaires = view === "legionnaires";

  return (
    <LocaleContext.Provider value={{ language, text }}>
    <div className="site-shell">
      <header className="site-header">
        <div className="header-main">
          <button className="brand" type="button" onClick={() => navigate("overview")}>
            <BrandMark />
            <span><strong>KADUR<span className="brand-data">DATA</span></strong><small>{text.brandTagline}</small></span>
          </button>

          <nav className="primary-nav" aria-label={text.primaryNavigation}>
            {navItems.filter((item) => item.id !== "blog" || language === "he").map((item) => {
              const Icon = item.icon;
              return (
                <button className={view === item.id ? "active" : ""} key={item.id} type="button" onClick={() => navigate(item.id)}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{text[item.id]}</span>
                </button>
              );
            })}
          </nav>

          <div className="header-actions">
            <div className="language-toggle" aria-label={text.language}>
              <button className={language === "he" ? "active" : ""} type="button" onClick={() => setLanguage("he")} aria-label={text.hebrew}>עב</button>
              <button className={language === "en" ? "active" : ""} type="button" onClick={() => setLanguage("en")} aria-label={text.english}>EN</button>
            </div>
            <button className="icon-button" type="button" onClick={() => { void loadReferenceData(); setRefreshToken((value) => value + 1); }} title={text.refreshData} aria-label={text.refreshData}>
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {view !== "blog" && <div className="context-bar">
          <div className="context-copy">
            <span>{text.viewing}</span>
            <strong>{showingLegionnaires ? text.allForeignLeagues : showingAllTournaments ? text.allTournaments : localizedCompetition(competitions.find((item) => item.competition_id === competitionId), language)}</strong>
          </div>
          <label className="context-select">
            <span>{text.competition}</span>
            <select
              value={showingLegionnaires ? "foreign-leagues" : showingAllTournaments ? allTournamentsValue : competitionId}
              disabled={showingLegionnaires}
              onChange={(event) => {
                if (view === "players") preparePlayerContextChange();
                if (event.target.value === allTournamentsValue) {
                  if (view === "overview") selectAllTournamentOverview();
                  else if (view === "players") setPlayerTournamentScope("all");
                  else setClubTournamentScope("all");
                  return;
                }
                if (view === "players") setPlayerTournamentScope("selected");
                else setClubTournamentScope("selected");
                setCompetitionId(event.target.value);
                const matchingSeason = seasons.find((season) => season.competition_id === event.target.value && season.season_name === currentSeason.season_name)
                  ?? latestSeasonWithData(seasons.filter((season) => season.competition_id === event.target.value));
                if (matchingSeason) {
                  if (view === "players" && playerId) pendingPlayerSelection.current = { seasonId: matchingSeason.season_id, playerId };
                  setSeasonId(matchingSeason.season_id);
                }
              }}
            >
              {showingLegionnaires && <option value="foreign-leagues">{text.allForeignLeagues}</option>}
              {!showingLegionnaires && (view === "clubs" || view === "overview" || view === "players") && <option value={allTournamentsValue}>{text.allTournaments}</option>}
              {!showingLegionnaires && ([
                ["domestic", text.domesticCompetitions],
                ["european_club", text.europeanClubCompetitions],
                ["national_team", text.nationalTeamCompetitions],
                ["national_youth", text.nationalYouthCompetitions],
                ["foreign_club", text.foreignLeagueCompetitions],
              ] as const).map(([scope, label]) => {
                const scopedCompetitions = competitions.filter((competition) => (competition.scope || "domestic") === scope);
                return scopedCompetitions.length ? (
                  <optgroup key={scope} label={label}>
                    {scopedCompetitions.map((competition) => (
                      <option key={competition.competition_id} value={competition.competition_id}>{localizedCompetition(competition, language)}</option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          <label className="context-select">
            <span>{text.season}</span>
            <select
              value={showingLegionnaires ? legionnaireSeasonName : showingAllTournaments ? currentSeason.season_name : seasonId}
              disabled={playerContextLoading}
              onChange={(event) => {
                if (showingLegionnaires) {
                  setLegionnaireSeasonName(event.target.value);
                  return;
                }
                if (showingAllTournaments) {
                  const selectedName = event.target.value;
                  const representative = seasons.find((season) => season.competition_id === competitionId && season.season_name === selectedName)
                    ?? (view === "players" ? playerAllTournamentSeasonOptions : allTournamentSeasonOptions).find((season) => season.season_name === selectedName);
                  if (representative) {
                    if (view === "players") void changePlayerSeason(representative, "all");
                    else {
                      setCompetitionId(representative.competition_id);
                      setSeasonId(representative.season_id);
                    }
                  }
                  return;
                }
                if (view === "players") {
                  const targetSeason = seasons.find((season) => season.season_id === event.target.value);
                  if (targetSeason) void changePlayerSeason(targetSeason);
                  return;
                }
                setSeasonId(event.target.value);
              }}
            >
              {showingLegionnaires ? legionnaireSeasonOptions.map((season, index) => (
                <option key={season.name} value={season.name}>{season.name}{index === 0 ? ` · ${text.latest}` : ""}</option>
              )) : showingAllTournaments ? (view === "players" ? playerAllTournamentSeasonOptions : allTournamentSeasonOptions).map((season, index) => (
                <option key={season.season_name} value={season.season_name}>{season.season_name}{index === 0 ? ` · ${text.latest}` : ""}</option>
              )) : availableSeasons.map((season) => (
                <option key={season.season_id} value={season.season_id}>{season.season_name}{season.season_id === latestDataSeason?.season_id ? ` · ${text.latest}` : ""}</option>
              ))}
            </select>
          </label>
        </div>}
      </header>

      <main className="page-shell">
        {error && view !== "legionnaires" && view !== "blog" && <div className="error-banner"><strong>{text.dataLoadError}</strong><span>{error}</span></div>}
        {!hasSupabaseConfig && view !== "blog" && <div className="demo-banner">{text.demoPreview}</div>}

        {view === "blog" ? (
          <BlogView onOpenMatch={(article) => openMatch({
            match_id: article.match.matchId,
            season_id: article.match.seasonId,
            season_name: article.match.seasonName,
            competition_id: article.match.competitionId,
            competition_name: "Israeli Premier League",
            competition_name_he: article.match.competitionNameHe,
            stage_id: null,
            stage_name: null,
            stage_number: null,
            round_id: article.match.roundId,
            round_number: article.match.roundNumber,
            round_name: "Round",
            scheduled_at: article.match.scheduledAt,
            status: article.match.status,
            home_team_id: article.teams.home.teamId,
            home_team_name: article.teams.home.name,
            home_team_name_he: article.teams.home.nameHe,
            home_team_short_name: null,
            home_team_color: article.teams.home.color,
            home_team_logo_url: article.teams.home.logoUrl,
            away_team_id: article.teams.away.teamId,
            away_team_name: article.teams.away.name,
            away_team_name_he: article.teams.away.nameHe,
            away_team_short_name: null,
            away_team_color: article.teams.away.color,
            away_team_logo_url: article.teams.away.logoUrl,
            home_score: article.teams.home.score,
            away_score: article.teams.away.score,
          })} />
        ) : loading || (seasonLoading && view !== "legionnaires") ? (
          <LoadingState />
        ) : view === "overview" ? (
          showingAllTournaments ? (
            <AllTournamentsOverview
              seasonName={currentSeason.season_name}
              competitions={competitions}
              matches={allTournamentOverviewMatches}
              leagues={overviewLeagueEntries}
              metrics={leaderboardMetrics}
              metricCode={leaderMetricCode}
              setMetricCode={setLeaderMetricCode}
              qualification={leaderQualification}
              minimum={leaderMinimum}
              setMinimum={(value) => setLeaderMinimums((current) => ({ ...current, [leaderMetricCode]: value }))}
              ratingMinimumMinutes={leaderRatingMinimumMinutes}
              setRatingMinimumMinutes={setLeaderRatingMinimumMinutes}
              loading={allTournamentOverviewLoading}
              openMatch={openMatch}
              openClub={openClub}
              openPlayer={openOverviewPlayer}
              compareTopPlayers={compareTopPlayers}
            />
          ) : (
            <OverviewView
              season={currentSeason}
              hasLeagueTable={hasOfficialLeagueTable(currentCompetition)}
              seasonPlayers={players}
              round={currentRound}
              roundMatches={overviewMatches}
              standings={standings}
              leaders={qualifiedLeaderboardRows}
              metrics={leaderboardMetrics}
              metricCode={leaderMetricCode}
              setMetricCode={setLeaderMetricCode}
              qualification={leaderQualification}
              minimum={leaderMinimum}
              setMinimum={(value) => setLeaderMinimums((current) => ({ ...current, [leaderMetricCode]: value }))}
              ratingMinimumMinutes={leaderRatingMinimumMinutes}
              setRatingMinimumMinutes={setLeaderRatingMinimumMinutes}
              loading={leaderboardLoading}
              error={leaderboardError}
              openMatch={openMatch}
              openClub={openClub}
              openPlayer={openPlayer}
              compareTopPlayers={compareTopPlayers}
              showMatches={() => navigate("matches")}
            />
          )
        ) : view === "matches" ? (
          <MatchesView
            rounds={rounds}
            round={currentRound}
            roundId={roundId}
            setRoundId={setRoundId}
            matches={roundMatches}
            selectedMatch={selectedMatch}
            selectMatch={(id) => { setMatchId(id); setMatchPlayerId(""); setMatchSide("home"); setShotPlayerId("all"); }}
            matchSide={matchSide}
            setMatchSide={setMatchSide}
            selectedMatchPlayerId={matchPlayerId}
            setSelectedMatchPlayerId={setMatchPlayerId}
            players={visibleMatchPlayers}
            seasonPlayers={players}
            metrics={metrics}
            comparisons={teamComparisons}
            heatmaps={matchPlayerHeatmaps}
            shots={matchShots}
            shotSide={shotSide}
            setShotSide={setShotSide}
            shotPlayerId={shotPlayerId}
            setShotPlayerId={setShotPlayerId}
            detailLoading={detailLoading}
            openPlayer={openPlayer}
          />
        ) : view === "clubs" ? (
          <ClubsView
            clubs={showingAllTournaments ? allTournamentClubs : standings}
            selectedClub={selectedClub}
            setClubId={setClubId}
            clubsLoading={allTournamentClubsLoading}
            query={clubQuery}
            setQuery={setClubQuery}
            matches={clubMatches}
            matchesLoading={clubMatchesLoading}
            allTournaments={showingAllTournaments}
            seasonName={currentSeason.season_name}
            squad={clubSquad}
            squadRows={clubSquadRows}
            qualifiedSquadCount={clubSquadLeaders.length}
            management={clubManagement}
            loans={clubLoans}
            loanLeaderboardRows={clubLoanLeaderboardRows}
            metrics={leaderboardMetrics}
            metricCode={squadMetricCode}
            setMetricCode={setSquadMetricCode}
            qualification={squadQualification}
            minimum={squadMinimum}
            setMinimum={(value) => setSquadMinimums((current) => ({ ...current, [squadMetricCode]: value }))}
            ratingMinimumMinutes={squadRatingMinimumMinutes}
            setRatingMinimumMinutes={setSquadRatingMinimumMinutes}
            leaderboardLoading={squadLeaderboardLoading}
            leaderboardError={squadLeaderboardError}
            openMatch={openMatch}
            openPlayer={openPlayer}
            compareTopPlayers={compareTopPlayers}
          />
        ) : view === "legionnaires" ? (
          <LegionnairesView
            seasonName={legionnaireSeasonName}
            players={rankedLegionnaires}
            totalPlayers={legionnaires.length}
            metrics={leaderboardMetrics}
            metricCode={legionnaireMetricCode}
            setMetricCode={setLegionnaireMetricCode}
            qualification={legionnaireQualification}
            minimum={legionnaireMinimum}
            setMinimum={(value) => setLegionnaireMinimums((current) => ({ ...current, [legionnaireMetricCode]: value }))}
            ratingMinimumMinutes={legionnaireRatingMinimumMinutes}
            setRatingMinimumMinutes={setLegionnaireRatingMinimumMinutes}
            query={legionnaireQuery}
            setQuery={setLegionnaireQuery}
            loading={legionnaireLoading || legionnaireLeaderboardLoading}
            error={legionnaireError ?? legionnaireLeaderboardError}
            openPlayer={openLegionnaire}
            compareTopPlayers={compareTopPlayers}
          />
        ) : (
          <PlayersView
            players={rankedExplorerPlayers}
            allSeasonPlayers={profilePlayers}
            rankingRows={qualifiedExplorerRows}
            rankingMetrics={explorerLeaderboardMetrics}
            rankingMetricCode={explorerMetricCode}
            setRankingMetricCode={setExplorerMetricCode}
            rankingQualification={explorerQualification}
            rankingMinimum={explorerMinimum}
            setRankingMinimum={(value) => setExplorerMinimums((current) => ({ ...current, [explorerMetricCode]: value }))}
            rankingRatingMinimumMinutes={explorerRatingMinimumMinutes}
            setRankingRatingMinimumMinutes={setExplorerRatingMinimumMinutes}
            rankingLoading={explorerLeaderboardLoading}
            rankingError={explorerLeaderboardError}
            compareTopPlayers={compareTopPlayers}
            allPlayersCount={players.length}
            selectedPlayer={selectedPlayer}
            selectedPlayerLoan={selectedPlayerLoan}
            comparisonPlayers={comparisonPlayers}
            setComparisonPlayerIds={(ids) => {
              setComparisonPlayerIds(ids);
              if (ids.length) setPlayerTournamentScope("all");
            }}
            season={currentSeason}
            seasonHeatmaps={playerSeasonHeatmaps}
            seasonHeatmapLoading={playerHeatmapLoading}
            comparisonSeasonHeatmaps={comparisonPlayerSeasonHeatmaps}
            comparisonSeasonHeatmapLoading={comparisonPlayerHeatmapLoading}
            selectPlayer={(nextPlayerId) => {
              clearPinnedPlayerProfile();
              setComparisonPlayerIds([]);
              setPlayerTournamentScope("selected");
              setPlayerId(nextPlayerId);
            }}
            replacePrimaryPlayer={(nextPlayerId) => {
              pendingPlayerSelection.current = null;
              setPlayerId(nextPlayerId);
            }}
            roles={roleFilters}
            roleFilter={roleFilter}
            setRoleFilter={(role) => { setRoleFilter(role); setPositionFilter("All"); }}
            positions={positionOptions}
            positionFilter={positionFilter}
            setPositionFilter={setPositionFilter}
            clubs={clubs}
            clubFilter={clubFilter}
            setClubFilter={setClubFilter}
            query={playerQuery}
            setQuery={setPlayerQuery}
            attributeQuery={attributeQuery}
            setAttributeQuery={setAttributeQuery}
            metrics={playerViewMetrics}
            metricCode={metricCode}
            setMetricCode={setMetricCode}
            historyRange={playerHistoryRange}
            setHistoryRange={setPlayerHistoryRange}
            latestHistorySeasonLabel={currentSeason.season_name || text.latestSeasonWithData}
            historySeasonCount={playerHistorySeasonCount}
            historyRows={visiblePlayerHistory}
            comparisonHistoryRows={visibleComparisonPlayerHistories}
            valuations={playerValuations}
            comparisonValuations={comparisonPlayerValuations}
            valuationLoading={playerValuationLoading || comparisonValuationLoading}
            chartData={playerChartData}
            comparisonChartData={comparisonPlayerChartData}
            comparisonChartDataById={comparisonPlayerChartDataById}
            average={playerAverage}
            averageNumerator={playerRatioDenominator > 0 ? playerRatioNumerator : null}
            averageDenominator={playerRatioDenominator > 0 ? playerRatioDenominator : null}
            detailLoading={detailLoading}
            comparisonLoading={comparisonLoading}
            comparisonError={comparisonError}
          />
        )}
      </main>
    </div>
    </LocaleContext.Provider>
  );
}

type OverviewAudience = "seniorMen" | "youth" | "women";

function competitionOverviewAudience(competition?: Competition): OverviewAudience {
  if (!competition) return "seniorMen";
  const ageGroup = (competition.age_group || "senior").toLowerCase();
  if (competition.scope === "national_youth" || ageGroup !== "senior") return "youth";
  return (competition.gender || "men").toLowerCase().startsWith("w") ? "women" : "seniorMen";
}

function matchHasResult(match: Match) {
  return match.home_score !== null
    && match.away_score !== null
    && match.home_score >= 0
    && match.away_score >= 0;
}

function aggregateOverviewStandings(matches: Match[]): Club[] {
  const teams = new Map<string, Club>();
  const ensureTeam = (match: Match, side: "home" | "away") => {
    const teamId = side === "home" ? match.home_team_id : match.away_team_id;
    const current = teams.get(teamId);
    if (current) return current;
    const team: Club = {
      season_id: match.season_id,
      competition_id: match.competition_id,
      team_id: teamId,
      team_name: side === "home" ? match.home_team_name : match.away_team_name,
      team_name_he: side === "home" ? match.home_team_name_he : match.away_team_name_he,
      short_name: side === "home" ? match.home_team_short_name : match.away_team_short_name,
      city: null,
      founded_year: null,
      primary_color: side === "home" ? match.home_team_color : match.away_team_color,
      secondary_color: null,
      logo_url: side === "home" ? match.home_team_logo_url : match.away_team_logo_url,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
      last_played_at: null,
    };
    teams.set(teamId, team);
    return team;
  };

  matches.forEach((match) => {
    const home = ensureTeam(match, "home");
    const away = ensureTeam(match, "away");
    if (!matchHasResult(match)) return;
    const homeScore = Number(match.home_score);
    const awayScore = Number(match.away_score);
    home.played += 1;
    away.played += 1;
    home.goals_for += homeScore;
    home.goals_against += awayScore;
    away.goals_for += awayScore;
    away.goals_against += homeScore;
    home.last_played_at = !home.last_played_at || dateValue(match.scheduled_at) > dateValue(home.last_played_at) ? match.scheduled_at : home.last_played_at;
    away.last_played_at = !away.last_played_at || dateValue(match.scheduled_at) > dateValue(away.last_played_at) ? match.scheduled_at : away.last_played_at;
    if (homeScore > awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (awayScore > homeScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
    home.goal_difference = home.goals_for - home.goals_against;
    away.goal_difference = away.goals_for - away.goals_against;
  });
  return [...teams.values()].sort((a, b) => b.points - a.points
    || b.goal_difference - a.goal_difference
    || b.goals_for - a.goals_for
    || a.team_name.localeCompare(b.team_name));
}

function AllTournamentsOverview({
  seasonName,
  competitions,
  matches,
  leagues,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  ratingMinimumMinutes,
  setRatingMinimumMinutes,
  loading,
  openMatch,
  openClub,
  openPlayer,
  compareTopPlayers,
}: {
  seasonName: string;
  competitions: Competition[];
  matches: Match[];
  leagues: OverviewLeagueEntry[];
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (metric: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  ratingMinimumMinutes: number;
  setRatingMinimumMinutes: (value: number) => void;
  loading: boolean;
  openMatch: (match: Match) => void;
  openClub: (id: string) => void;
  openPlayer: (id: string, season: Season) => void;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
}) {
  const { language, text } = useLocale();
  const competitionById = new Map(competitions.map((competition) => [competition.competition_id, competition]));
  const groups: Array<{ key: OverviewGroup; label: string }> = [
    { key: "topMen", label: text.topLeagueClubs },
    { key: "lowerMen", label: text.lowerLeagueClubs },
    { key: "youth", label: text.youthFootball },
    { key: "women", label: text.womensFootball },
  ];
  const leagueByGroup = new Map(leagues.map((league) => [league.key, league]));
  const topLeague = leagueByGroup.get("topMen");
  const topLeagueTeamIds = new Set(matches
    .filter((match) => match.competition_id === topLeague?.competition.competition_id)
    .flatMap((match) => [match.home_team_id, match.away_team_id]));
  const matchesByGroup = new Map<OverviewGroup, Match[]>(groups.map((group) => [group.key, []]));
  matches.forEach((match) => {
    const competition = competitionById.get(match.competition_id);
    const audience = competitionOverviewAudience(competition);
    if (audience === "youth" || audience === "women") {
      matchesByGroup.get(audience)?.push(match);
      return;
    }
    if (competition?.participant_type !== "club") return;
    const involvesTopLeagueClub = topLeagueTeamIds.has(match.home_team_id) || topLeagueTeamIds.has(match.away_team_id);
    matchesByGroup.get(involvesTopLeagueClub ? "topMen" : "lowerMen")?.push(match);
  });
  const completedMatches = matches.filter(matchHasResult);
  const upcomingMatches = matches.filter((match) => !matchHasResult(match) && dateValue(match.scheduled_at) >= Date.now() - 6 * 60 * 60 * 1000);
  const teamIds = new Set(matches.flatMap((match) => [match.home_team_id, match.away_team_id]));
  const competitionIds = new Set(matches.map((match) => match.competition_id));

  return (
    <>
      <PageHeading eyebrow={`${text.allTournaments} · ${seasonName}`} title={text.israeliFootballOverview} description={text.allTournamentsOverviewDescription} />
      <section className="stat-band" aria-label={text.seasonSummary}>
        <Stat label={text.tournaments} value={numberFormatter.format(competitionIds.size)} note={text.acrossIsraeliFootball} />
        <Stat label={text.results} value={numberFormatter.format(completedMatches.length)} note={text.completedMatches} />
        <Stat label={text.nextFixtures} value={numberFormatter.format(upcomingMatches.length)} note={text.scheduledFixtures} />
        <Stat label={text.teams} value={numberFormatter.format(teamIds.size)} note={text.acrossAllGroups} accent />
      </section>

      {loading ? <LoadingState /> : (
        <div className="overview-groups">
          {groups.map((group) => {
            const groupMatches = matchesByGroup.get(group.key) ?? [];
            const results = groupMatches.filter(matchHasResult).sort((a, b) => dateValue(b.scheduled_at) - dateValue(a.scheduled_at)).slice(0, 8);
            const fixtures = groupMatches
              .filter((match) => !matchHasResult(match) && dateValue(match.scheduled_at) >= Date.now() - 6 * 60 * 60 * 1000)
              .sort((a, b) => dateValue(a.scheduled_at) - dateValue(b.scheduled_at))
              .slice(0, 8);
            const league = leagueByGroup.get(group.key);
            const leagueCompetition = league?.competition;
            const leagueMatches = leagueCompetition
              ? matches.filter((match) => match.competition_id === leagueCompetition.competition_id)
              : [];
            const standings = aggregateOverviewStandings(leagueMatches);
            const qualifiedLeaders = filterLeaderboardRows(league?.leaders ?? [], league?.players ?? [], qualification, minimum);
            return (
              <section className="overview-group" key={group.key}>
                <div className="overview-group-heading">
                  <span>{text.competitionGroup}</span>
                  <h2>{group.label}</h2>
                  <small>{numberFormatter.format(groupMatches.length)} {text.matches.toLowerCase()}</small>
                </div>
                <div className="overview-group-grid">
                  <section className="surface overview-feed-surface">
                    <SectionHeading eyebrow={text.latestResults} title={text.lastPlayed} />
                    <div className="score-list">
                      {results.length ? results.map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} />) : <EmptyState text={text.noRecentResults} />}
                    </div>
                  </section>
                  <section className="surface overview-feed-surface">
                    <SectionHeading eyebrow={text.nextFixtures} title={text.comingUp} />
                    <div className="score-list">
                      {fixtures.length ? fixtures.map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} />) : <EmptyState text={text.noUpcomingFixtures} />}
                    </div>
                  </section>
                  <section className="surface overview-ranking-surface">
                    <SectionHeading eyebrow={text.leagueTable} title={leagueCompetition ? localizedCompetition(leagueCompetition, language) : group.label} />
                    <div className="mini-table" aria-label={`${leagueCompetition ? localizedCompetition(leagueCompetition, language) : group.label} ${text.leagueStandings}`}>
                      <div className="mini-table-head"><span>#</span><span>{text.team}</span><span>{text.goalDifferenceShort}</span><span>{text.pointsShort}</span></div>
                      <div className="mini-table-body">
                        {standings.length ? standings.map((club, index) => (
                          <button className="mini-table-row" key={club.team_id} type="button" onClick={() => openClub(club.team_id)}>
                            <span className="rank">{index + 1}</span>
                            <span className="club-cell"><ClubBadge name={localizedClubName(club, language)} logoUrl={club.logo_url} size="small" /><strong>{localizedClubName(club, language)}</strong></span>
                            <span>{signed(club.goal_difference)}</span>
                            <strong>{club.points}</strong>
                          </button>
                        )) : <EmptyState text={text.noLeaderboardData} />}
                      </div>
                    </div>
                  </section>
                  <section className="surface leaders-surface overview-group-leaders">
                    <PlayerLeaderboardPanel
                      scopeLabel={`${leagueCompetition ? localizedCompetition(leagueCompetition, language) : group.label} · ${text.playerLeaderboard}`}
                      seasonPlayers={league?.players ?? []}
                      standings={standings}
                      leaders={qualifiedLeaders}
                      metrics={metrics}
                      metricCode={metricCode}
                      setMetricCode={setMetricCode}
                      qualification={qualification}
                      minimum={minimum}
                      setMinimum={setMinimum}
                      ratingMinimumMinutes={ratingMinimumMinutes}
                      setRatingMinimumMinutes={setRatingMinimumMinutes}
                      loading={league?.loading ?? false}
                      error={league?.error ?? null}
                      openPlayer={(id) => { if (league) openPlayer(id, league.season); }}
                      compareTopPlayers={compareTopPlayers}
                    />
                  </section>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function CompareTopFiveButton({
  players,
  metricCode,
  loading = false,
  onCompare,
  compact = false,
}: {
  players: SeasonPlayer[];
  metricCode: string;
  loading?: boolean;
  onCompare: (players: SeasonPlayer[], metricCode: string) => void;
  compact?: boolean;
}) {
  const { text } = useLocale();
  const topPlayers = [...new Map(players.map((player) => [player.player_id, player])).values()].slice(0, 5);
  return (
    <button
      className={`compare-top-five${compact ? " compact" : ""}`}
      disabled={loading || topPlayers.length < 2}
      title={text.compareTopFive}
      type="button"
      onClick={() => onCompare(topPlayers, metricCode)}
    >
      <ArrowLeftRight size={14} aria-hidden="true" />
      <span>{text.compareTopFive}</span>
    </button>
  );
}

function PlayerLeaderboardPanel({
  scopeLabel,
  seasonPlayers,
  standings,
  leaders,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  ratingMinimumMinutes,
  setRatingMinimumMinutes,
  loading,
  error,
  openPlayer,
  compareTopPlayers,
}: {
  scopeLabel: string;
  seasonPlayers: SeasonPlayer[];
  standings: Club[];
  leaders: PlayerLeaderboardRow[];
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (metric: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  ratingMinimumMinutes: number;
  setRatingMinimumMinutes: (value: number) => void;
  loading: boolean;
  error: string | null;
  openPlayer: (id: string) => void;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
}) {
  const { language, text } = useLocale();
  const selectedMetric = metrics.find((metric) => metric.code === metricCode);
  const seasonMetrics = metrics.filter((metric) => metric.kind === "season");
  const matchMetrics = metrics.filter((metric) => metric.kind === "match");
  const minutesByPlayer = new Map(seasonPlayers.map((player) => [player.player_id, Number(player.minutes)]));
  const seasonPlayerById = new Map(seasonPlayers.map((player) => [player.player_id, player]));
  const rankedPlayers = leaders.flatMap((leader) => {
    const player = seasonPlayerById.get(leader.player_id);
    return player ? [player] : [];
  });

  return (
    <>
      <div className="leaderboard-heading">
        <div><span>{scopeLabel}</span><h2>{selectedMetric?.name ?? text.performance}</h2></div>
        <div className="leaderboard-actions">
          <label className="leader-metric-select">
            <span>{text.sortBy}</span>
            <select value={metricCode} onChange={(event) => setMetricCode(event.target.value)}>
              <optgroup label={text.seasonSummaryGroup}>{seasonMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
              <optgroup label={text.matchMetricsGroup}>{matchMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
            </select>
          </label>
          <CompareTopFiveButton players={rankedPlayers} metricCode={metricCode} loading={loading} onCompare={compareTopPlayers} />
        </div>
      </div>
      {qualification && <LeaderboardQualificationFilter qualification={qualification} minimum={minimum} setMinimum={setMinimum} qualifiedCount={leaders.length} loading={loading} ratingMinimumMinutes={hasConfigurableRatingMinimum(metricCode) ? ratingMinimumMinutes : null} setRatingMinimumMinutes={setRatingMinimumMinutes} />}
      <div className="leader-list">
        {loading ? <InlineLoading /> : error ? <EmptyState text={text.leaderboardLoadError} /> : leaders.length ? leaders.map((player, index) => {
          const seasonPlayer = seasonPlayerById.get(player.player_id);
          return (
            <button key={player.player_id} type="button" onClick={() => openPlayer(player.player_id)}>
              <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="leader-copy"><strong>{localizedPlayerName(seasonPlayer, player.display_name, language)}</strong><small>{localizedClubById(standings, player.team_id, player.team_name, language)}</small></span>
              <span className="leader-value"><strong>{formatLeaderboardValue(player, language)}</strong><small>{leaderboardSampleLabel(player, qualification, minutesByPlayer, language)}</small></span>
            </button>
          );
        }) : <EmptyState text={qualification ? text.noMinimumSamplePlayers : text.noLeaderboardData} />}
      </div>
    </>
  );
}

function OverviewView({
  season,
  hasLeagueTable,
  seasonPlayers,
  round,
  roundMatches,
  standings,
  leaders,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  ratingMinimumMinutes,
  setRatingMinimumMinutes,
  loading,
  error,
  openMatch,
  openClub,
  openPlayer,
  compareTopPlayers,
  showMatches,
}: {
  season: Season;
  hasLeagueTable: boolean;
  seasonPlayers: SeasonPlayer[];
  round?: Round;
  roundMatches: Match[];
  standings: Club[];
  leaders: PlayerLeaderboardRow[];
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (metric: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  ratingMinimumMinutes: number;
  setRatingMinimumMinutes: (value: number) => void;
  loading: boolean;
  error: string | null;
  openMatch: (match: Match) => void;
  openClub: (id: string) => void;
  openPlayer: (id: string) => void;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
  showMatches: () => void;
}) {
  const { language, text } = useLocale();
  const participantRows = [...standings].sort((a, b) => localizedClubName(a, language).localeCompare(localizedClubName(b, language), localeCode(language)));
  return (
    <>
      <PageHeading eyebrow={`${localizedSeasonCompetition(season, language)} · ${season.season_name}`} title={text.seasonOverview} description={hasLeagueTable ? text.seasonOverviewDescription : text.competitionOverviewDescription} />
      <section className="stat-band" aria-label={text.seasonSummary}>
        <Stat label={text.matchesPlayed} value={`${numberFormatter.format(season.completed_match_count)} / ${numberFormatter.format(season.match_count)}`} note={`${Math.round((season.completed_match_count / Math.max(season.match_count, 1)) * 100)}% ${text.complete}`} />
        <Stat label={hasLeagueTable ? text.clubs : text.teams} value={numberFormatter.format(season.team_count)} note={hasLeagueTable ? text.leagueParticipants : text.competitionParticipants} />
        <Stat label={text.playersUsed} value={numberFormatter.format(season.player_count)} note={hasLeagueTable ? text.acrossMatchdays : text.acrossCompetitionMatches} />
        <Stat label={text.goals} value={numberFormatter.format(season.goals_scored)} note={`${(season.goals_scored / Math.max(season.completed_match_count, 1)).toFixed(2)} ${text.perMatch}`} accent />
      </section>

      <div className="overview-grid">
        <section className="surface round-surface">
          <SectionHeading eyebrow={round?.stage_name ? localizedStageName(round.stage_name, language) : round ? text.latestMatchday : text.recentMatches} title={round ? `${text.round} ${round.round_number ?? round.round_name}` : text.fixturesResults} action={text.allMatches} onAction={showMatches} />
          <div className="score-list">
            {roundMatches.slice(0, 7).map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} />)}
          </div>
        </section>

        <section className="surface standings-surface">
          {hasLeagueTable ? (
            <>
              <SectionHeading eyebrow={text.leagueTable} title={text.leadingPack} action={text.allClubs} onAction={() => openClub(standings[0]?.team_id ?? "")} />
              <div className="mini-table" aria-label={text.leagueStandings}>
                <div className="mini-table-head"><span>#</span><span>{text.club}</span><span>{text.goalDifferenceShort}</span><span>{text.pointsShort}</span></div>
                <div className="mini-table-body">
                  {standings.map((club, index) => (
                    <button className="mini-table-row" key={club.team_id} type="button" onClick={() => openClub(club.team_id)}>
                      <span className="rank">{index + 1}</span>
                      <span className="club-cell"><ClubBadge name={localizedClubName(club, language)} logoUrl={club.logo_url} size="small" /><strong>{localizedClubName(club, language)}</strong></span>
                      <span>{signed(club.goal_difference)}</span>
                      <strong>{club.points}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <SectionHeading eyebrow={text.participants} title={text.teamsInData} />
              <div className="mini-table" aria-label={text.participantSummary}>
                <div className="mini-table-head participant-table-row"><span>{text.team}</span><span>{text.playedShort}</span><span>{text.winsDrawsLosses}</span><span>{text.forAgainst}</span></div>
                <div className="mini-table-body">
                  {participantRows.map((team) => (
                    <button className="mini-table-row participant-table-row" key={team.team_id} type="button" onClick={() => openClub(team.team_id)}>
                      <span className="club-cell"><ClubBadge name={localizedClubName(team, language)} logoUrl={team.logo_url} size="small" /><strong>{localizedClubName(team, language)}</strong></span>
                      <span>{team.played}</span>
                      <span>{team.won}-{team.drawn}-{team.lost}</span>
                      <strong>{team.goals_for}:{team.goals_against}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="surface leaders-surface">
          <PlayerLeaderboardPanel
            scopeLabel={text.playerLeaderboard}
            seasonPlayers={seasonPlayers}
            standings={standings}
            leaders={leaders}
            metrics={metrics}
            metricCode={metricCode}
            setMetricCode={setMetricCode}
            qualification={qualification}
            minimum={minimum}
            setMinimum={setMinimum}
            ratingMinimumMinutes={ratingMinimumMinutes}
            setRatingMinimumMinutes={setRatingMinimumMinutes}
            loading={loading}
            error={error}
            openPlayer={openPlayer}
            compareTopPlayers={compareTopPlayers}
          />
        </section>
      </div>
    </>
  );
}

function MatchesView({
  rounds,
  round,
  roundId,
  setRoundId,
  matches,
  selectedMatch,
  selectMatch,
  matchSide,
  setMatchSide,
  selectedMatchPlayerId,
  setSelectedMatchPlayerId,
  players,
  seasonPlayers,
  metrics,
  comparisons,
  heatmaps,
  shots,
  shotSide,
  setShotSide,
  shotPlayerId,
  setShotPlayerId,
  detailLoading,
  openPlayer,
}: {
  rounds: Round[];
  round?: Round;
  roundId: string;
  setRoundId: (id: string) => void;
  matches: Match[];
  selectedMatch?: Match;
  selectMatch: (id: string) => void;
  matchSide: "home" | "away";
  setMatchSide: (side: "home" | "away") => void;
  selectedMatchPlayerId: string;
  setSelectedMatchPlayerId: (id: string) => void;
  players: PlayerPivot[];
  seasonPlayers: SeasonPlayer[];
  metrics: Metric[];
  comparisons: Array<{ code: string; label: string; home: number; away: number; valueType: string }>;
  heatmaps: MatchPlayerHeatmap[];
  shots: MatchShot[];
  shotSide: ShotSideFilter;
  setShotSide: (side: ShotSideFilter) => void;
  shotPlayerId: string;
  setShotPlayerId: (id: string) => void;
  detailLoading: boolean;
  openPlayer: (id: string) => void;
}) {
  const { language, text } = useLocale();
  const roundIndex = rounds.findIndex((item) => item.round_id === roundId);
  const PreviousIcon = language === "he" ? ChevronRight : ChevronLeft;
  const NextIcon = language === "he" ? ChevronLeft : ChevronRight;
  const selectedMatchPlayer = players.find((player) => player.player_id === selectedMatchPlayerId);
  const selectedMatchSeasonPlayer = seasonPlayers.find((player) => player.player_id === selectedMatchPlayerId);
  const selectedMatchHeatmap = heatmaps.find((heatmap) =>
    heatmap.appearance_id === selectedMatchPlayer?.appearance_id
    || heatmap.player_id === selectedMatchPlayerId
  );
  useEffect(() => {
    if (!detailLoading && selectedMatchPlayerId && !selectedMatchPlayer) setSelectedMatchPlayerId("");
  }, [detailLoading, selectedMatchPlayer, selectedMatchPlayerId, setSelectedMatchPlayerId]);
  return (
    <>
      <PageHeading eyebrow={round?.stage_name ? localizedStageName(round.stage_name, language) : text.seasonSchedule} title={text.fixturesResults} description={text.fixturesDescription} />
      <div className="round-toolbar">
        <button className="icon-button compact" type="button" disabled={roundIndex <= 0} onClick={() => setRoundId(rounds[roundIndex - 1]?.round_id)} aria-label={text.previousRound}><PreviousIcon size={18} /></button>
        <label>
          <span>{text.matchday}</span>
          <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
            {rounds.map((item) => <option key={item.round_id} value={item.round_id}>{localizedStageName(item.stage_name, language)} · {text.round} {item.round_number}</option>)}
          </select>
        </label>
        <button className="icon-button compact" type="button" disabled={roundIndex < 0 || roundIndex >= rounds.length - 1} onClick={() => setRoundId(rounds[roundIndex + 1]?.round_id)} aria-label={text.nextRound}><NextIcon size={18} /></button>
        <span className="round-date">{formatDateRange(round?.first_match_at, round?.last_match_at, language)}</span>
      </div>

      <div className="match-workspace">
        <aside className="surface fixture-rail">
          <div className="rail-heading"><strong>{matches.length} {text.matches.toLowerCase()}</strong><span>{round?.completed_match_count ?? 0} {text.completed}</span></div>
          <div className="fixture-list">
            {matches.map((match) => (
              <button className={selectedMatch?.match_id === match.match_id ? "active" : ""} key={match.match_id} type="button" onClick={() => selectMatch(match.match_id)}>
                <time>{formatFixtureDate(match.scheduled_at, language)}</time>
                <span className="fixture-clubs"><span>{localizedMatchTeam(match, "home", language)}</span><span>{localizedMatchTeam(match, "away", language)}</span></span>
                <strong className="fixture-score"><span>{displayMatchScore(match.home_score)}</span><span>{displayMatchScore(match.away_score)}</span></strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>

        <section className="surface match-detail">
          {selectedMatch ? (
            <>
              <MatchScoreboard match={selectedMatch} />
              <div className="detail-grid">
                <div className="comparison-panel">
                  <SectionHeading eyebrow={text.teamComparison} title={text.matchProfile} />
                  {detailLoading ? <InlineLoading /> : comparisons.length ? comparisons.map((item) => <ComparisonBar key={item.code} {...item} />) : <EmptyState text={text.noTeamComparison} />}
                </div>
                <div className="lineup-panel">
                  <div className="lineup-heading">
                    <div><span>{text.playerStatistics}</span><strong>{localizedMatchTeam(selectedMatch, matchSide, language)}</strong></div>
                    <div className="segmented compact-segmented">
                      <button className={matchSide === "home" ? "active" : ""} type="button" onClick={() => { setSelectedMatchPlayerId(""); setMatchSide("home"); }}>{text.home}</button>
                      <button className={matchSide === "away" ? "active" : ""} type="button" onClick={() => { setSelectedMatchPlayerId(""); setMatchSide("away"); }}>{text.away}</button>
                    </div>
                  </div>
                  {detailLoading ? <InlineLoading /> : (
                    <>
                      <MatchAveragePositionPitch players={players} seasonPlayers={seasonPlayers} heatmaps={heatmaps} inspectPlayer={setSelectedMatchPlayerId} />
                      <PlayerMatchTable players={players} seasonPlayers={seasonPlayers} inspectPlayer={setSelectedMatchPlayerId} />
                    </>
                  )}
                </div>
              </div>
              <MatchShotMap
                match={selectedMatch}
                shots={shots}
                sideFilter={shotSide}
                setSideFilter={setShotSide}
                playerFilter={shotPlayerId}
                setPlayerFilter={setShotPlayerId}
                loading={detailLoading}
              />
            </>
          ) : <EmptyState text={text.selectMatch} />}
        </section>
      </div>
      {selectedMatch && selectedMatchPlayer && (
        <PlayerMatchInspector
          match={selectedMatch}
          player={selectedMatchPlayer}
          seasonPlayer={selectedMatchSeasonPlayer}
          heatmap={selectedMatchHeatmap}
          metrics={metrics}
          onClose={() => setSelectedMatchPlayerId("")}
          openPlayer={openPlayer}
        />
      )}
    </>
  );
}

function ClubsView({
  clubs,
  selectedClub,
  setClubId,
  clubsLoading,
  query,
  setQuery,
  matches,
  matchesLoading,
  allTournaments,
  seasonName,
  squad,
  squadRows,
  qualifiedSquadCount,
  management,
  loans,
  loanLeaderboardRows,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  ratingMinimumMinutes,
  setRatingMinimumMinutes,
  leaderboardLoading,
  leaderboardError,
  openMatch,
  openPlayer,
  compareTopPlayers,
}: {
  clubs: Club[];
  selectedClub?: Club;
  setClubId: (id: string) => void;
  clubsLoading: boolean;
  query: string;
  setQuery: (query: string) => void;
  matches: Match[];
  matchesLoading: boolean;
  allTournaments: boolean;
  seasonName: string;
  squad: SeasonPlayer[];
  squadRows: { player: SeasonPlayer; ranking: PlayerLeaderboardRow | null }[];
  qualifiedSquadCount: number;
  management: SeasonPlayer[];
  loans: PlayerLoan[];
  loanLeaderboardRows: PlayerLeaderboardRow[];
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (code: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  ratingMinimumMinutes: number;
  setRatingMinimumMinutes: (value: number) => void;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  openMatch: (match: Match) => void;
  openPlayer: (id: string) => void;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
}) {
  const { language, text } = useLocale();
  const recent = matches.filter(isCompletedMatch).slice(0, 5);
  const displayClub = selectedClub && allTournaments ? aggregateClubRecord(selectedClub, matches) : selectedClub;
  const loanLeaderboardByPlayerId = new Map(loanLeaderboardRows.map((row) => [row.player_id, row]));
  const seasonMetrics = metrics.filter((metric) => metric.kind === "season");
  const matchMetrics = metrics.filter((metric) => metric.kind === "match");
  const rankedSquadPlayers = squadRows.flatMap(({ player, ranking }) => ranking ? [player] : []);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleClubs = (allTournaments ? [...clubs].sort((a, b) => localizedClubName(a, language).localeCompare(localizedClubName(b, language), localeCode(language))) : clubs)
    .filter((club) => !normalizedQuery || [localizedClubName(club, language), club.team_name, club.team_name_he, club.city]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedQuery)));
  return (
    <>
      <PageHeading eyebrow={allTournaments ? `${text.allTournaments} · ${seasonName}` : text.seasonDirectory} title={text.clubs} description={allTournaments ? text.allTournamentsClubDescription : text.clubsDescription} />
      <div className={`club-workspace${allTournaments ? " all-tournaments" : ""}`}>
        <aside className={`surface club-directory${allTournaments ? " all-tournaments" : ""}`}>
          {allTournaments ? (
            <label className="club-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchClubs} aria-label={text.searchClubs} />
            </label>
          ) : <div className="club-table-head"><span>#</span><span>{text.club}</span><span>{text.playedShort}</span><span>{text.pointsShort}</span></div>}
          {clubsLoading ? <InlineLoading /> : visibleClubs.length ? visibleClubs.map((club, index) => (
            <button className={`${club.team_id === selectedClub?.team_id ? "active" : ""}${allTournaments ? " all-tournament-club-row" : ""}`} key={club.team_id} type="button" onClick={() => setClubId(club.team_id)}>
              {allTournaments ? <span className="club-cell"><ClubBadge name={localizedClubName(club, language)} logoUrl={club.logo_url} size="small" /><strong>{localizedClubName(club, language)}</strong></span> : <><span>{index + 1}</span><span className="club-cell"><ClubBadge name={localizedClubName(club, language)} logoUrl={club.logo_url} size="small" /><strong>{localizedClubName(club, language)}</strong></span><span>{club.played}</span><strong>{club.points}</strong></>}
            </button>
          )) : <EmptyState text={text.noClubsFound} />}
        </aside>

        <section className="club-detail">
          {displayClub ? (
            <>
              <div className="club-identity">
                <ClubBadge name={localizedClubName(displayClub, language)} logoUrl={displayClub.logo_url} size="large" />
                <div><span>{allTournaments ? `${text.allTournaments} · ${seasonName}` : `${text.leaguePosition} ${clubs.findIndex((club) => club.team_id === displayClub.team_id) + 1}`}</span><h2>{localizedClubName(displayClub, language)}</h2><p>{language === "he" ? text.israel : displayClub.city ?? text.israel} · {displayClub.played} {text.matchesPlayedSuffix}</p></div>
                <div className="form-strip" aria-label={text.recentForm}>
                  {recent.map((match) => <span className={clubResult(match, displayClub.team_id).toLowerCase()} key={match.match_id}>{localizedResult(clubResult(match, displayClub.team_id), language)}</span>)}
                </div>
              </div>
              <section className="stat-band club-stats">
                <Stat label={text.record} value={`${displayClub.won}-${displayClub.drawn}-${displayClub.lost}`} note={text.winsDrawsLosses} />
                <Stat label={text.goals} value={`${displayClub.goals_for}:${displayClub.goals_against}`} note={text.forAgainst} />
                <Stat label={text.goalDifference} value={signed(displayClub.goal_difference)} note={text.seasonTotal} />
                {allTournaments
                  ? <Stat label={text.fixtures} value={String(matches.length)} note={`${displayClub.played} ${text.completed}`} accent />
                  : <Stat label={text.points} value={String(displayClub.points)} note={`${(displayClub.points / Math.max(displayClub.played, 1)).toFixed(2)} ${text.perMatch}`} accent />}
              </section>
              <div className={`club-detail-grid${allTournaments ? " all-tournaments" : ""}`}>
                <section className="surface club-results">
                  <SectionHeading eyebrow={allTournaments ? text.allTournaments : text.seasonSchedule} title={text.fixturesResults} />
                  <div className="club-match-list">
                    {matchesLoading ? <InlineLoading /> : matches.length ? matches.map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} showCompetition={allTournaments} />) : <EmptyState text={text.noClubMatches} />}
                  </div>
                </section>
                <section className="surface squad-panel">
                  <div className="squad-leaderboard-heading">
                    <div><span>{squad.length} {text.players.toLowerCase()}, {loans.length} {text.loaned.toLowerCase()}</span><h2>{text.seasonSquad}</h2></div>
                    <div className="leaderboard-actions squad-leaderboard-actions">
                      <label className="leader-metric-select squad-metric-select">
                        <span>{text.rankBy}</span>
                        <select value={metricCode} onChange={(event) => setMetricCode(event.target.value)}>
                          <optgroup label={text.seasonSummaryGroup}>{seasonMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                          <optgroup label={text.matchMetricsGroup}>{matchMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                        </select>
                      </label>
                      <CompareTopFiveButton players={rankedSquadPlayers} metricCode={metricCode} loading={leaderboardLoading} onCompare={compareTopPlayers} />
                    </div>
                  </div>
                  {qualification && <LeaderboardQualificationFilter qualification={qualification} minimum={minimum} setMinimum={setMinimum} qualifiedCount={qualifiedSquadCount} loading={leaderboardLoading} ratingMinimumMinutes={hasConfigurableRatingMinimum(metricCode) ? ratingMinimumMinutes : null} setRatingMinimumMinutes={setRatingMinimumMinutes} />}
                  {leaderboardError && <p className="panel-inline-error">{text.squadLoadError}</p>}
                  <div className="squad-list">
                    {squadRows.length || loans.length ? <>
                      {squadRows.map(({ player, ranking }, index) => {
                        const playerName = localizedPlayerName(player, player.display_name, language);
                        return (
                          <button key={player.player_id} type="button" onClick={() => openPlayer(player.player_id)}>
                            <span className="squad-rank">{ranking ? String(index + 1).padStart(2, "0") : "--"}</span>
                            <span className="avatar">{initials(playerName)}</span>
                            <span><strong>{playerName}</strong><small>{`${playerPositionDetail(player).code} · ${localizedPlayerPosition(player, language).label}`}</small></span>
                            <em>{ranking ? formatLeaderboardValue(ranking, language) : leaderboardLoading ? <Loader2 className="spin" size={12} aria-label={text.updatingRanking} /> : "-"}</em>
                          </button>
                        );
                      })}
                      {loans.map((loan) => {
                        const ranking = loanLeaderboardByPlayerId.get(loan.player_id);
                        const playerName = language === "he" ? loan.display_name_he ?? loan.display_name : loan.display_name;
                        const destinationName = localizedClubById(
                          clubs,
                          loan.destination_team_id,
                          language === "he" ? loan.destination_team_name_he ?? loan.destination_team_name : loan.destination_team_name,
                          language,
                        );
                        const position = loan.specific_position ?? loan.primary_position ?? text.player;
                        return (
                          <button className="loaned-player" key={loan.loan_id} type="button" onClick={() => openPlayer(loan.player_id)}>
                            <span className="squad-rank" title={text.loaned}><ArrowUpRight size={12} aria-hidden="true" /></span>
                            <span className="avatar">{initials(playerName)}</span>
                            <span><strong>{playerName}</strong><small>{position} · ({text.loanedTo} {destinationName})</small></span>
                            <em>{ranking ? formatLeaderboardValue(ranking, language) : "-"}</em>
                          </button>
                        );
                      })}
                    </> : <EmptyState text={text.noSquadData} />}
                  </div>
                </section>
              </div>
              {management.length > 0 && (
                <section className="surface management-panel">
                  <SectionHeading eyebrow={text.seasonSquad} title={text.management} />
                  <p>{text.managementDescription}</p>
                  <div className="management-list">
                    {management.map((person) => {
                      const personName = localizedPlayerName(person, person.display_name, language);
                      return (
                        <div key={person.player_id}>
                          <span className="avatar">{initials(personName)}</span>
                          <span><strong>{personName}</strong><small>{person.primary_position ?? text.management}</small></span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : <EmptyState text={text.selectClub} />}
        </section>
      </div>
    </>
  );
}

function LeaderboardQualificationFilter({
  qualification,
  minimum,
  setMinimum,
  qualifiedCount,
  loading,
  ratingMinimumMinutes = null,
  setRatingMinimumMinutes,
}: {
  qualification: LeaderboardQualification;
  minimum: number;
  setMinimum: (value: number) => void;
  qualifiedCount: number;
  loading: boolean;
  ratingMinimumMinutes?: number | null;
  setRatingMinimumMinutes?: (value: number) => void;
}) {
  const { language, text } = useLocale();
  const unitLabel = qualificationUnit(qualification.unit, language);
  return (
    <div className={`qualification-filters${ratingMinimumMinutes !== null ? " has-rating-minutes" : ""}`}>
      <label className="qualification-filter">
        <span className="qualification-copy">
          <strong>{text.minimumSample}</strong>
          <small>{loading ? text.updatingRanking : `${qualifiedCount} ${qualifiedCount === 1 ? text.playerQualifies : text.playersQualify}`}</small>
        </span>
        <span className="qualification-input">
          <input
            type="number"
            min="0"
            step={qualification.step}
            value={minimum}
            onChange={(event) => {
              if (Number.isNaN(event.currentTarget.valueAsNumber)) return;
              setMinimum(Math.max(0, event.currentTarget.valueAsNumber));
            }}
            aria-label={`${text.minimumSample}: ${unitLabel}`}
          />
          <small>{unitLabel}</small>
        </span>
      </label>
      {ratingMinimumMinutes !== null && setRatingMinimumMinutes && (
        <label className="qualification-filter rating-minutes-filter">
          <span className="qualification-copy">
            <strong>{text.minimumMinutes}</strong>
            <small>{text.perRatedMatch}</small>
          </span>
          <span className="qualification-input">
            <input
              type="number"
              min="0"
              step="5"
              value={ratingMinimumMinutes}
              onChange={(event) => {
                if (Number.isNaN(event.currentTarget.valueAsNumber)) return;
                setRatingMinimumMinutes(Math.max(0, event.currentTarget.valueAsNumber));
              }}
              aria-label={text.minimumMinutesPerRatedMatch}
            />
            <small>{text.minutes}</small>
          </span>
        </label>
      )}
    </div>
  );
}

function LegionnairesView({
  seasonName,
  players,
  totalPlayers,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  ratingMinimumMinutes,
  setRatingMinimumMinutes,
  query,
  setQuery,
  loading,
  error,
  openPlayer,
  compareTopPlayers,
}: {
  seasonName: string;
  players: Array<{ player: Legionnaire; ranking: PlayerLeaderboardRow }>;
  totalPlayers: number;
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (code: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  ratingMinimumMinutes: number;
  setRatingMinimumMinutes: (value: number) => void;
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  error: string | null;
  openPlayer: (player: Legionnaire) => void;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
}) {
  const { language, text } = useLocale();
  const seasonMetrics = metrics.filter((metric) => metric.kind === "season");
  const matchMetrics = metrics.filter((metric) => metric.kind === "match");
  const selectedMetric = metrics.find((metric) => metric.code === metricCode);
  return (
    <>
      <PageHeading
        eyebrow={`${seasonName || text.latestSeasonWithData} · ${numberFormatter.format(totalPlayers)} ${text.legionnairesFound}`}
        title={text.legionnairesTitle}
        description={text.legionnairesDescription}
      />
      <section className="surface legionnaires-board">
        <div className="legionnaires-toolbar">
          <div className="legionnaires-title">
            <span>{text.playerLeaderboard}</span>
            <h2>{selectedMetric?.name ?? text.performance}</h2>
          </div>
          <label className="search-field legionnaire-search">
            <Search size={17} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchPlayers} />
          </label>
          <div className="leaderboard-actions legionnaire-ranking-actions">
            <label className="player-ranking-select legionnaire-metric-select">
              <span>{text.rankBy}</span>
              <select value={metricCode} onChange={(event) => setMetricCode(event.target.value)}>
                <optgroup label={text.seasonSummaryGroup}>{seasonMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                <optgroup label={text.matchMetricsGroup}>{matchMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
              </select>
            </label>
            <CompareTopFiveButton players={players.map(({ player }) => player)} metricCode={metricCode} loading={loading} onCompare={compareTopPlayers} />
          </div>
        </div>
        {qualification && (
          <LeaderboardQualificationFilter
            qualification={qualification}
            minimum={minimum}
            setMinimum={setMinimum}
            qualifiedCount={players.length}
            loading={loading}
            ratingMinimumMinutes={hasConfigurableRatingMinimum(metricCode) ? ratingMinimumMinutes : null}
            setRatingMinimumMinutes={setRatingMinimumMinutes}
          />
        )}
        <div className="legionnaire-table" role="table">
          <div className="legionnaire-table-head" role="row">
            <span>#</span>
            <span>{text.player}</span>
            <span>{text.club}</span>
            <span>{text.league}</span>
            <span>{selectedMetric?.name ?? text.value}</span>
          </div>
          <div className="legionnaire-table-body">
            {loading ? <InlineLoading /> : error ? <EmptyState text={text.legionnaireLoadError} /> : players.length ? players.map(({ player, ranking }, index) => {
              const displayName = localizedPlayerName(player, player.display_name, language);
              const competitionName = language === "he" ? player.competition_name_he || player.competition_name : player.competition_name;
              return (
                <button className="legionnaire-row" key={player.player_id} type="button" onClick={() => openPlayer(player)}>
                  <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="legionnaire-player">
                    <span className="avatar">{initials(displayName)}</span>
                    <span>
                      <strong>{displayName}</strong>
                      <small className="legionnaire-player-meta">
                        <bdi dir="ltr">{playerPositionDetail(player).code}</bdi>
                        <span aria-hidden="true">·</span>
                        <span className="legionnaire-minutes" dir={language === "he" ? "rtl" : "ltr"}>
                          <bdi dir="ltr">{numberFormatter.format(Number(player.minutes))}</bdi>
                          <span>{text.minShort}</span>
                        </span>
                      </small>
                    </span>
                  </span>
                  <span className="legionnaire-club"><ClubBadge name={player.team_name ?? text.freeAgent} logoUrl={player.team_logo_url} size="small" /><strong>{player.team_name ?? text.freeAgent}</strong></span>
                  <span className="legionnaire-league">{competitionName}</span>
                  <span className="legionnaire-value"><strong>{formatLeaderboardValue(ranking, language)}</strong><small>{explorerRankingSampleLabel(ranking, player, qualification, language)}</small></span>
                </button>
              );
            }) : <EmptyState text={qualification ? text.noMinimumSamplePlayers : text.noLegionnaires} />}
          </div>
        </div>
      </section>
    </>
  );
}

function SeasonHeatmapPanel({
  appearances,
  heatmaps,
  loading,
  playerName,
  seasonName,
}: {
  appearances: number;
  heatmaps: PlayerSeasonHeatmap[];
  loading: boolean;
  playerName: string;
  seasonName: string;
}) {
  const { text } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  const [renderedMatches, setRenderedMatches] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const controller = new AbortController();
    setRenderFailed(false);
    if (!canvas || !heatmaps.length) {
      setRendering(false);
      setRenderedMatches(0);
      return () => controller.abort();
    }

    setRendering(true);
    void renderSeasonHeatmap(canvas, heatmaps, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRenderedMatches(result.matchCount);
        setRenderFailed(result.matchCount === 0);
        setRendering(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setRenderedMatches(0);
        setRenderFailed(true);
        setRendering(false);
      });

    return () => controller.abort();
  }, [heatmaps]);

  const coverageTotal = Math.max(appearances, renderedMatches);
  const showEmpty = !loading && (!heatmaps.length || renderFailed);
  return (
    <section className="season-heatmap-panel">
      <header>
        <div><span>{text.seasonHeatmap}</span><h3>{playerName}</h3></div>
        <div className="season-heatmap-meta">
          <strong>{seasonName}</strong>
          <span>{renderedMatches || heatmaps.length} / {coverageTotal || appearances} {text.heatmapMatches}</span>
        </div>
      </header>
      {showEmpty ? <EmptyState text={text.noSeasonHeatmap} /> : (
        <div className={`season-heatmap-frame${rendering || loading ? " loading" : ""}`}>
          <canvas ref={canvasRef} role="img" aria-label={`${playerName} · ${text.seasonHeatmap} · ${seasonName}`} />
          {(rendering || loading) && <span className="season-heatmap-loading"><Loader2 size={18} /> {text.calculatingSeasonHeatmap}</span>}
        </div>
      )}
      {!showEmpty && !rendering && !loading && (
        <footer>
          <span>{text.positionDensity}</span>
          <span className="season-heatmap-scale"><i /> <small>{text.low}</small><small>{text.high}</small></span>
        </footer>
      )}
    </section>
  );
}

function PlayerComparisonPicker({
  players,
  selectedPlayers,
  clubs,
  onChange,
}: {
  players: SeasonPlayer[];
  selectedPlayers: SeasonPlayer[];
  clubs: Club[];
  onChange: (ids: string[]) => void;
}) {
  const { language, text } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlayers = useMemo(() => players.filter((player) => {
    if (!normalizedQuery) return true;
    const position = playerPositionDetail(player);
    return [
      player.display_name,
      player.display_name_he,
      player.team_name,
      localizedClubById(clubs, player.team_id, player.team_name, language),
      position.code,
      position.label,
    ].filter(Boolean).some((value) => value!.toLowerCase().includes(normalizedQuery));
  }).slice(0, 80), [clubs, language, normalizedQuery, players]);
  const selectedIds = selectedPlayers.map((player) => player.player_id);
  const selectedName = selectedPlayers.length === 1
    ? localizedPlayerName(selectedPlayers[0], selectedPlayers[0].display_name, language)
    : "";

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  return (
    <div className={`compare-player-picker${open ? " open" : ""}`} ref={rootRef}>
      <button
        className="compare-player-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <ArrowLeftRight size={15} aria-hidden="true" />
        <span>
          <small>{text.compareWith}</small>
          <strong>{selectedName || (selectedPlayers.length > 1 ? `${selectedPlayers.length + 1} / 5 ${text.players.toLowerCase()}` : text.selectComparisonPlayer)}</strong>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="compare-player-menu">
          <label>
            <Search size={15} aria-hidden="true" />
            <input autoFocus aria-label={text.searchPlayers} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchPlayers} />
          </label>
          <button className="compare-clear-all" disabled={!selectedPlayers.length} type="button" onClick={() => onChange([])}>
            <X size={14} aria-hidden="true" />
            {text.clearAllComparisons}
          </button>
          <div className="compare-player-options" role="listbox" aria-label={text.compareWith} aria-multiselectable="true">
            {filteredPlayers.length ? filteredPlayers.map((player) => {
              const displayName = localizedPlayerName(player, player.display_name, language);
              const selected = selectedIds.includes(player.player_id);
              const disabled = !selected && selectedPlayers.length >= 4;
              return (
                <button
                  aria-disabled={disabled}
                  aria-selected={selected}
                  disabled={disabled}
                  key={player.player_id}
                  role="option"
                  type="button"
                  onClick={() => onChange(selected
                    ? selectedIds.filter((id) => id !== player.player_id)
                    : [...selectedIds, player.player_id].slice(0, 4))}
                >
                  <span className="compare-checkbox" aria-hidden="true">{selected && <Check size={12} />}</span>
                  <span className="avatar">{initials(displayName)}</span>
                  <span><strong>{displayName}</strong><small>{localizedClubById(clubs, player.team_id, player.team_name, language)} · {playerPositionDetail(player).code}</small></span>
                </button>
              );
            }) : <span className="compare-player-empty">{text.noPlayersForMetric}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonSlotPicker({
  player,
  playerName,
  players,
  selectedPlayerIds,
  clubs,
  onChange,
}: {
  player: SeasonPlayer;
  playerName: string;
  players: SeasonPlayer[];
  selectedPlayerIds: Set<string>;
  clubs: Club[];
  onChange: (id: string) => void;
}) {
  const { language, text } = useLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlayers = useMemo(() => players.filter((option) => {
    if (!normalizedQuery) return true;
    const position = playerPositionDetail(option);
    return [
      option.display_name,
      option.display_name_he,
      option.team_name,
      localizedClubById(clubs, option.team_id, option.team_name, language),
      position.code,
      position.label,
    ].filter(Boolean).some((value) => value!.toLowerCase().includes(normalizedQuery));
  }).slice(0, 80), [clubs, language, normalizedQuery, players]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(310, window.innerWidth - 16);
      const menuHeight = 342;
      const left = Math.min(
        Math.max(8, language === "he" ? rect.right - width : rect.left),
        window.innerWidth - width - 8,
      );
      const top = window.innerHeight - rect.bottom >= menuHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - menuHeight - 6);
      setMenuPosition({ top, left });
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [language, open]);

  return (
    <>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${text.changeComparedPlayer}: ${playerName}`}
        className={`multi-comparison-player-trigger${open ? " open" : ""}`}
        title={`${text.changeComparedPlayer}: ${playerName}`}
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <strong>{playerName}</strong>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div className="comparison-slot-menu" ref={menuRef} style={menuPosition}>
          <label>
            <Search size={15} aria-hidden="true" />
            <input autoFocus aria-label={text.searchPlayers} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchPlayers} />
          </label>
          <div className="comparison-slot-options" role="listbox" aria-label={`${text.changeComparedPlayer}: ${playerName}`}>
            {filteredPlayers.length ? filteredPlayers.map((option) => {
              const displayName = localizedPlayerName(option, option.display_name, language);
              const selectedElsewhere = option.player_id !== player.player_id && selectedPlayerIds.has(option.player_id);
              const selected = option.player_id === player.player_id;
              return (
                <button
                  aria-disabled={selectedElsewhere}
                  aria-selected={selected}
                  disabled={selectedElsewhere}
                  key={option.player_id}
                  role="option"
                  type="button"
                  onClick={() => {
                    onChange(option.player_id);
                    setOpen(false);
                  }}
                >
                  <span className="avatar">{initials(displayName)}</span>
                  <span>
                    <strong>{displayName}</strong>
                    <small>{localizedClubById(clubs, option.team_id, option.team_name, language)} · {playerPositionDetail(option).code}</small>
                  </span>
                  {selected && <Check size={14} aria-hidden="true" />}
                </button>
              );
            }) : <span className="compare-player-empty">{text.noPlayersForMetric}</span>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function PlayersView({
  players,
  allSeasonPlayers,
  rankingRows,
  rankingMetrics,
  rankingMetricCode,
  setRankingMetricCode,
  rankingQualification,
  rankingMinimum,
  setRankingMinimum,
  rankingRatingMinimumMinutes,
  setRankingRatingMinimumMinutes,
  rankingLoading,
  rankingError,
  compareTopPlayers,
  allPlayersCount,
  selectedPlayer,
  selectedPlayerLoan,
  comparisonPlayers,
  setComparisonPlayerIds,
  season,
  seasonHeatmaps,
  seasonHeatmapLoading,
  comparisonSeasonHeatmaps,
  comparisonSeasonHeatmapLoading,
  selectPlayer,
  replacePrimaryPlayer,
  roles,
  roleFilter,
  setRoleFilter,
  positions,
  positionFilter,
  setPositionFilter,
  clubs,
  clubFilter,
  setClubFilter,
  query,
  setQuery,
  attributeQuery,
  setAttributeQuery,
  metrics,
  metricCode,
  setMetricCode,
  historyRange,
  setHistoryRange,
  latestHistorySeasonLabel,
  historySeasonCount,
  historyRows,
  comparisonHistoryRows,
  valuations,
  comparisonValuations,
  valuationLoading,
  chartData,
  comparisonChartData,
  comparisonChartDataById,
  average,
  averageNumerator,
  averageDenominator,
  detailLoading,
  comparisonLoading,
  comparisonError,
}: {
  players: SeasonPlayer[];
  allSeasonPlayers: SeasonPlayer[];
  rankingRows: PlayerLeaderboardRow[];
  rankingMetrics: LeaderboardMetricOption[];
  rankingMetricCode: string;
  setRankingMetricCode: (code: string) => void;
  rankingQualification: LeaderboardQualification | null;
  rankingMinimum: number;
  setRankingMinimum: (value: number) => void;
  rankingRatingMinimumMinutes: number;
  setRankingRatingMinimumMinutes: (value: number) => void;
  rankingLoading: boolean;
  rankingError: string | null;
  compareTopPlayers: (players: SeasonPlayer[], metricCode: string) => void;
  allPlayersCount: number;
  selectedPlayer?: SeasonPlayer;
  selectedPlayerLoan?: PlayerLoan;
  comparisonPlayers: SeasonPlayer[];
  setComparisonPlayerIds: (ids: string[]) => void;
  season: Season;
  seasonHeatmaps: PlayerSeasonHeatmap[];
  seasonHeatmapLoading: boolean;
  comparisonSeasonHeatmaps: Record<string, PlayerSeasonHeatmap[]>;
  comparisonSeasonHeatmapLoading: boolean;
  selectPlayer: (id: string) => void;
  replacePrimaryPlayer: (id: string) => void;
  roles: RoleFilter[];
  roleFilter: RoleFilter;
  setRoleFilter: (role: RoleFilter) => void;
  positions: PlayerPositionDetail[];
  positionFilter: string;
  setPositionFilter: (position: string) => void;
  clubs: Club[];
  clubFilter: string;
  setClubFilter: (id: string) => void;
  query: string;
  setQuery: (value: string) => void;
  attributeQuery: string;
  setAttributeQuery: (value: string) => void;
  metrics: PlayerChartMetric[];
  metricCode: string;
  setMetricCode: (code: string) => void;
  historyRange: PlayerHistoryRange;
  setHistoryRange: (range: PlayerHistoryRange) => void;
  latestHistorySeasonLabel: string;
  historySeasonCount: number;
  historyRows: PlayerHistory[];
  comparisonHistoryRows: Record<string, PlayerHistory[]>;
  valuations: PlayerValuation[];
  comparisonValuations: Record<string, PlayerValuation[]>;
  valuationLoading: boolean;
  chartData: PlayerChartPoint[];
  comparisonChartData: PlayerChartPoint[];
  comparisonChartDataById: Record<string, PlayerChartPoint[]>;
  average: number | null;
  averageNumerator: number | null;
  averageDenominator: number | null;
  detailLoading: boolean;
  comparisonLoading: boolean;
  comparisonError: string | null;
}) {
  const { language, text } = useLocale();
  const metric = metrics.find((item) => item.chartKey === metricCode);
  const rankingByPlayerId = new Map(rankingRows.map((row) => [row.player_id, row]));
  const seasonRankingMetrics = rankingMetrics.filter((item) => item.kind === "season");
  const matchRankingMetrics = rankingMetrics.filter((item) => item.kind === "match");
  const comparisonPlayer = comparisonPlayers[0];
  const comparisonHistory = comparisonPlayer ? comparisonHistoryRows[comparisonPlayer.player_id] ?? [] : [];
  const isMultiComparison = comparisonPlayers.length > 1;
  const selectedPosition = selectedPlayer ? localizedPlayerPosition(selectedPlayer, language) : null;
  const comparisonPosition = comparisonPlayer ? localizedPlayerPosition(comparisonPlayer, language) : null;
  const selectedPlayerName = selectedPlayer
    ? localizedPlayerName(selectedPlayer, selectedPlayer.display_name, language)
    : "";
  const selectedPlayerLoanParentName = selectedPlayerLoan
    ? localizedClubById(
        clubs,
        selectedPlayerLoan.parent_team_id,
        language === "he" ? selectedPlayerLoan.parent_team_name_he ?? selectedPlayerLoan.parent_team_name : selectedPlayerLoan.parent_team_name,
        language,
      )
    : "";
  const comparisonPlayerName = comparisonPlayer
    ? localizedPlayerName(comparisonPlayer, comparisonPlayer.display_name, language)
    : "";
  const comparedPlayers = selectedPlayer ? [selectedPlayer, ...comparisonPlayers] : comparisonPlayers;
  const comparedPlayerNames = comparedPlayers.map((player) => localizedPlayerName(player, player.display_name, language));
  const multiComparisonGridTemplate = `minmax(150px, 1.35fr) repeat(${comparedPlayers.length}, minmax(105px, 1fr))`;
  const comparablePlayers = [...allSeasonPlayers]
    .filter((player) => !isManagementPlayer(player))
    .sort((a, b) => localizedPlayerName(a, a.display_name, language).localeCompare(
      localizedPlayerName(b, b.display_name, language),
      localeCode(language),
    ));
  const comparisonOptions = comparablePlayers.filter((player) => player.player_id !== selectedPlayer?.player_id);
  const comparedPlayerIds = new Set(comparedPlayers.map((player) => player.player_id));
  const replaceComparedPlayer = (index: number, nextPlayerId: string) => {
    if (!nextPlayerId || comparedPlayers.some((player, playerIndex) => playerIndex !== index && player.player_id === nextPlayerId)) return;
    if (index === 0) {
      replacePrimaryPlayer(nextPlayerId);
      return;
    }
    const nextComparisonPlayerIds = comparisonPlayers.map((player) => player.player_id);
    nextComparisonPlayerIds[index - 1] = nextPlayerId;
    setComparisonPlayerIds(nextComparisonPlayerIds);
  };
  const { attributeGroups, chartableAttributeCount } = useMemo(() => {
    const normalizedQuery = attributeQuery.trim().toLowerCase();
    const categoryOrder = selectedPlayer?.role_group === "Goalkeepers"
      ? (["Goalkeeping", ...playerAttributeCategories.filter((category) => category !== "Goalkeeping")] as PlayerAttributeCategory[])
      : playerAttributeCategories.filter((category) => category !== "Goalkeeping");
    const observedAttributes = metrics
      .map((item) => ({
        metric: item,
        primary: summarizePlayerAttribute(historyRows, item),
        comparison: comparisonPlayer ? summarizePlayerAttribute(comparisonHistory, item) : null,
        players: [
          { player: selectedPlayer, summary: summarizePlayerAttribute(historyRows, item) },
          ...comparisonPlayers.map((player) => ({
            player,
            summary: summarizePlayerAttribute(comparisonHistoryRows[player.player_id] ?? [], item),
          })),
        ],
      }))
      .filter((attribute) => attribute.players.some((item) => item.summary.comparisonValue !== null));
    const attributes = observedAttributes
      .filter((attribute) => !normalizedQuery
        || attribute.primary.name.toLowerCase().includes(normalizedQuery)
        || attribute.primary.category.toLowerCase().includes(normalizedQuery)
        || categoryName(attribute.primary.category, language).includes(normalizedQuery));
    return {
      attributeGroups: categoryOrder
        .map((category) => ({ category, attributes: attributes.filter((attribute) => attribute.primary.category === category) }))
        .filter((group) => group.attributes.length > 0),
      chartableAttributeCount: observedAttributes.length,
    };
  }, [attributeQuery, comparisonHistory, comparisonHistoryRows, comparisonPlayer, comparisonPlayers, historyRows, language, metrics, selectedPlayer, selectedPlayer?.role_group]);
  const isPairedMetric = metric?.chartMode === "paired"
    && Boolean(metric.numerator_metric_code)
    && Boolean(metric.denominator_metric_code);
  const isPer90Metric = metric?.normalization === "per90";
  const numeratorLabel = ratioComponentLabel(metric?.numerator_metric_code, language);
  const denominatorLabel = ratioComponentLabel(metric?.denominator_metric_code, language);
  const prepareChartData = (points: PlayerChartPoint[]) => {
    const localized = points.map((point) => ({
      ...point,
      opponent: localizedClubById(clubs, point.opponentTeamId, point.opponent, language) || text.opponent,
    }));
    return isPer90Metric ? localized.flatMap((point) => {
      if (point.minutes === null || point.minutes <= 0) return [];
      const factor = 90 / point.minutes;
      return [{
        ...point,
        value: point.value === null ? null : isPairedMetric ? point.value : point.value * factor,
        numerator: point.numerator === null ? null : point.numerator * factor,
        denominator: point.denominator === null ? null : point.denominator * factor,
      }];
    }) : localized;
  };
  const plottedChartData = prepareChartData(chartData);
  const plottedComparisonChartData = prepareChartData(comparisonChartData);
  const comparisonPointsByDate = new Map<string, PlayerComparisonChartPoint>();
  const addComparisonPoint = (point: PlayerChartPoint, side: "primary" | "comparison") => {
    const dateKey = point.scheduledAt?.slice(0, 10) ?? point.date;
    const timestamp = point.scheduledAt
      ? Date.parse(`${dateKey}T00:00:00Z`)
      : dateValue(point.scheduledAt);
    const current = comparisonPointsByDate.get(dateKey) ?? {
      match: 0,
      date: point.date,
      timestamp,
      primaryPoint: null,
      comparisonPoint: null,
      primaryValue: null,
      primaryNumerator: null,
      primaryDenominator: null,
      comparisonValue: null,
      comparisonNumerator: null,
      comparisonDenominator: null,
    };
    if (side === "primary") {
      current.primaryPoint = point;
      current.primaryValue = point.value;
      current.primaryNumerator = point.numerator;
      current.primaryDenominator = point.denominator;
    } else {
      current.comparisonPoint = point;
      current.comparisonValue = point.value;
      current.comparisonNumerator = point.numerator;
      current.comparisonDenominator = point.denominator;
    }
    comparisonPointsByDate.set(dateKey, current);
  };
  if (comparisonPlayer) {
    plottedChartData.forEach((point) => addComparisonPoint(point, "primary"));
    plottedComparisonChartData.forEach((point) => addComparisonPoint(point, "comparison"));
  }
  const playerComparisonChartData = [...comparisonPointsByDate.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((point, index) => ({ ...point, match: index + 1 }));
  const comparisonChartColors = ["#35C9B6", "#F0B35A", "#65A7FF", "#F47A77", "#B7D55E"];
  const multiPlayerChartSeries = comparedPlayers.map((player, index) => ({
    player,
    name: comparedPlayerNames[index],
    key: `player${index}`,
    color: comparisonChartColors[index],
    points: prepareChartData(index === 0 ? chartData : comparisonChartDataById[player.player_id] ?? []),
  }));
  const multiPlayerPointsByDate = new Map<string, MultiPlayerChartPoint>();
  if (isMultiComparison) {
    multiPlayerChartSeries.forEach((series) => series.points.forEach((point) => {
      const dateKey = point.scheduledAt?.slice(0, 10) ?? point.date;
      const current = multiPlayerPointsByDate.get(dateKey) ?? {
        date: point.date,
        timestamp: Date.parse(`${dateKey}T00:00:00Z`),
      };
      current[`${series.key}Point`] = point;
      current[`${series.key}Value`] = point.value;
      current[`${series.key}Numerator`] = point.numerator;
      current[`${series.key}Denominator`] = point.denominator;
      multiPlayerPointsByDate.set(dateKey, current);
    }));
  }
  const multiPlayerChartData = [...multiPlayerPointsByDate.values()].sort((a, b) => a.timestamp - b.timestamp);
  const totalSampleMinutes = chartData.reduce((total, point) => total + Number(point.minutes ?? 0), 0);
  const per90Value = totalSampleMinutes > 0
    ? chartData.reduce((total, point) => total + Number(point.value ?? 0), 0) * 90 / totalSampleMinutes
    : null;
  const per90Numerator = totalSampleMinutes > 0
    ? chartData.reduce((total, point) => total + Number(point.numerator ?? 0), 0) * 90 / totalSampleMinutes
    : null;
  const per90Denominator = totalSampleMinutes > 0
    ? chartData.reduce((total, point) => total + Number(point.denominator ?? 0), 0) * 90 / totalSampleMinutes
    : null;
  const summaryValue = isPer90Metric
    ? isPairedMetric
      ? per90Numerator === null || per90Denominator === null ? "-" : formatMetricRatio(per90Numerator, per90Denominator)
      : formatMetric(per90Value)
    : average === null ? "-" : formatMetricWithRatio(average, metric?.value_type, averageNumerator, averageDenominator);
  const summaryNote = isPer90Metric
    ? isPairedMetric ? `${numeratorLabel} / ${denominatorLabel} ${text.numeratorDenominatorPer90}` : text.weightedPer90
    : historyRange === "all"
      ? `${chartData.length} ${text.matches.toLowerCase()} · ${historySeasonCount} ${historySeasonCount === 1 ? text.seasonSingular : text.seasons}`
      : `${chartData.length} ${text.matchesSampled}`;
  const formatChartPointValue = (point: PlayerChartPoint | null) => {
    if (!point) return "-";
    return isPer90Metric && isPairedMetric
      ? formatMetricRatio(point.numerator, point.denominator)
      : formatMetricWithRatio(point.value, metric?.value_type, point.numerator, point.denominator);
  };
  return (
    <>
      <PageHeading eyebrow={`${numberFormatter.format(allPlayersCount)} ${text.players.toLowerCase()}`} title={text.playerExplorer} description={text.playerExplorerDescription} />
      <div className="player-filters">
        <div className="role-filter-stack">
          <div className="segmented role-segments">
            {roles.map((role) => <button aria-label={localizedRoleName(role, language)} className={roleFilter === role ? "active" : ""} key={role} title={localizedRoleName(role, language)} type="button" onClick={() => setRoleFilter(role)}>{roleLabel(role, language)}</button>)}
          </div>
          {positions.length > 0 && (
            <div className="position-filter">
              <span>{text.position}</span>
              <div className="segmented compact-segmented position-segments" aria-label={`${localizedRoleName(roleFilter, language)} · ${text.position}`}>
                <button className={positionFilter === "All" ? "active" : ""} type="button" onClick={() => setPositionFilter("All")}>{text.all}</button>
                {positions.map((position) => (
                  <button className={positionFilter === position.code ? "active" : ""} key={position.code} title={positionName(position.code, position.label, language)} type="button" onClick={() => setPositionFilter(position.code)}>{position.code}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <label className="filter-select"><ListFilter size={16} /><select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}><option value="all">{text.allClubs}</option>{clubs.map((club) => <option key={club.team_id} value={club.team_id}>{localizedClubName(club, language)}</option>)}</select></label>
        <label className="search-field"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchPlayers} /></label>
      </div>

      <div className="player-workspace">
        <aside className="surface player-directory">
          <div className="rail-heading player-ranking-heading">
            <strong>{numberFormatter.format(players.length)} {text.results}</strong>
            <div className="player-ranking-controls">
              <label className="player-ranking-select">
                <span>{text.rankBy}</span>
                <select aria-label={text.rankPlayersBy} value={rankingMetricCode} onChange={(event) => setRankingMetricCode(event.target.value)}>
                  <optgroup label={text.seasonSummaryGroup}>{seasonRankingMetrics.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup>
                  <optgroup label={text.matchMetricsGroup}>{matchRankingMetrics.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup>
                </select>
              </label>
              <CompareTopFiveButton players={players} metricCode={rankingMetricCode} loading={rankingLoading} onCompare={compareTopPlayers} compact />
            </div>
          </div>
          {rankingQualification && (
            <div className="directory-qualification">
              <LeaderboardQualificationFilter qualification={rankingQualification} minimum={rankingMinimum} setMinimum={setRankingMinimum} qualifiedCount={players.length} loading={rankingLoading} ratingMinimumMinutes={hasConfigurableRatingMinimum(rankingMetricCode) ? rankingRatingMinimumMinutes : null} setRatingMinimumMinutes={setRankingRatingMinimumMinutes} />
            </div>
          )}
          <div className="player-list">
            {rankingLoading ? <InlineLoading /> : rankingError ? <EmptyState text={text.playerRankingLoadError} /> : players.length ? players.map((player) => {
              const ranking = rankingByPlayerId.get(player.player_id);
              const displayName = localizedPlayerName(player, player.display_name, language);
              return (
                <button className={player.player_id === selectedPlayer?.player_id ? "active" : ""} key={player.player_id} type="button" onClick={() => selectPlayer(player.player_id)}>
                  <span className="avatar">{initials(displayName)}</span>
                  <span className="player-copy"><strong>{displayName}</strong><small>{localizedClubById(clubs, player.team_id, player.team_name ?? text.freeAgent, language)} · {playerPositionDetail(player).code}</small></span>
                  <span className="player-numbers">
                    <strong>{ranking ? formatLeaderboardValue(ranking, language) : "-"}</strong>
                    <small>{ranking ? explorerRankingSampleLabel(ranking, player, rankingQualification, language) : ""}</small>
                  </span>
                </button>
              );
            }) : <EmptyState text={rankingQualification ? text.noMinimumSamplePlayers : text.noPlayersForMetric} />}
          </div>
        </aside>

        <section className="surface player-detail">
          {selectedPlayer ? (
            <>
              <div className="player-profile-head">
                <span className="avatar large">{initials(selectedPlayerName)}</span>
                <div>
                  <span className="player-position-line"><b title={selectedPosition?.label}>{selectedPosition?.code}</b><span>{selectedPosition?.label} · {localizedClubById(clubs, selectedPlayer.team_id, selectedPlayer.team_name, language)}</span></span>
                  <h2>{selectedPlayerName}</h2>
                  {selectedPlayerLoan && <p className="player-loan-status">{text.onLoanFrom} <strong>{selectedPlayerLoanParentName}</strong></p>}
                </div>
                <div className="compare-player-control">
                  <PlayerComparisonPicker players={comparisonOptions} selectedPlayers={comparisonPlayers} clubs={clubs} onChange={setComparisonPlayerIds} />
                </div>
              </div>
              <section className="stat-band player-stats">
                <Stat label={text.appearances} value={formatNumber(selectedPlayer.appearances)} note={`${formatNumber(selectedPlayer.starts)} ${text.starts}`} />
                <Stat label={text.minutes} value={numberFormatter.format(Math.round(Number(selectedPlayer.minutes)))} note={text.seasonTotal} />
                <Stat label={text.goalsAssists} value={formatNumber(Number(selectedPlayer.goals) + Number(selectedPlayer.assists))} note={`${formatNumber(selectedPlayer.goals)} ${text.goals.toLowerCase()} · ${formatNumber(selectedPlayer.assists)} ${text.assists}`} />
                <Stat label={metric?.name ?? text.average} value={summaryValue} note={summaryNote} accent />
              </section>
              <section className="player-attributes">
                <div className="attribute-heading">
                  <div><span>{comparisonPlayers.length ? text.playerComparison : text.playerAttributes}</span><h3>{chartableAttributeCount} {text.chartableMetrics}</h3></div>
                  <label className="attribute-search"><Search size={15} /><input aria-label={text.searchPlayerAttributes} type="search" value={attributeQuery} onChange={(event) => setAttributeQuery(event.target.value)} placeholder={text.findAttribute} /></label>
                </div>
                {comparisonPlayer && !isMultiComparison && (
                  <div className="comparison-player-headings">
                    <div><span className="avatar">{initials(selectedPlayerName)}</span><span><strong>{selectedPlayerName}</strong><small>{selectedPosition?.code} · {localizedClubById(clubs, selectedPlayer.team_id, selectedPlayer.team_name, language)}</small></span></div>
                    <ArrowLeftRight size={16} aria-hidden="true" />
                    <div><span className="avatar">{initials(comparisonPlayerName)}</span><span><strong>{comparisonPlayerName}</strong><small>{comparisonPosition?.code} · {localizedClubById(clubs, comparisonPlayer.team_id, comparisonPlayer.team_name, language)}</small></span></div>
                  </div>
                )}
                {comparisonLoading ? <InlineLoading /> : comparisonError && !isMultiComparison ? <EmptyState text={text.comparisonLoadError} /> : (
                  <>
                  {comparisonError && <p className="comparison-partial-error">{text.comparisonPartialLoadError}</p>}
                  <div className="attribute-scroll">
                    {isMultiComparison && (
                      <div className="multi-comparison-row multi-comparison-head" style={{ gridTemplateColumns: multiComparisonGridTemplate }}>
                        <span>{text.attribute}</span>
                        {comparedPlayers.map((player, index) => (
                          <span className="multi-comparison-player-heading" key={player.player_id} title={comparedPlayerNames[index]}>
                            <b>{initials(comparedPlayerNames[index])}</b>
                            <ComparisonSlotPicker
                              player={player}
                              playerName={comparedPlayerNames[index]}
                              players={comparablePlayers}
                              selectedPlayerIds={comparedPlayerIds}
                              clubs={clubs}
                              onChange={(nextPlayerId) => replaceComparedPlayer(index, nextPlayerId)}
                            />
                          </span>
                        ))}
                      </div>
                    )}
                    {attributeGroups.map((group) => (
                      <section className="attribute-group" key={group.category}>
                        <h4>{categoryName(group.category, language)}</h4>
                        {isMultiComparison ? (
                          <div className="multi-comparison-table">
                            {group.attributes.map((attribute) => {
                              const rankClasses = multiPlayerRankClasses(
                                attribute.players.map((item) => item.summary.comparisonValue),
                                attribute.metric.code,
                              );
                              return (
                                <button
                                  className={`multi-comparison-row${attribute.primary.chartKey === metricCode ? " active" : ""}`}
                                  key={attribute.primary.chartKey}
                                  style={{ gridTemplateColumns: multiComparisonGridTemplate }}
                                  title={`${text.showMetricMatchByMatch}: ${attribute.primary.name}`}
                                  type="button"
                                  onClick={() => setMetricCode(attribute.primary.chartKey)}
                                >
                                  <span className="multi-comparison-attribute">{attribute.primary.name}</span>
                                  {attribute.players.map((item, index) => (
                                    <strong className={rankClasses[index]} key={item.player?.player_id ?? index}>{item.summary.value}</strong>
                                  ))}
                                </button>
                              );
                            })}
                          </div>
                        ) : comparisonPlayer ? (
                          <div className="comparison-attribute-list">
                            {group.attributes.map((attribute) => {
                              const primaryClass = playerComparisonClass(attribute.primary.comparisonValue, attribute.comparison?.comparisonValue ?? null, attribute.metric.code);
                              const comparisonClass = playerComparisonClass(attribute.comparison?.comparisonValue ?? null, attribute.primary.comparisonValue, attribute.metric.code);
                              return (
                                <button
                                  className={attribute.primary.chartKey === metricCode ? "active" : ""}
                                  key={attribute.primary.chartKey}
                                  title={`${text.showMetricMatchByMatch}: ${attribute.primary.name}`}
                                  type="button"
                                  onClick={() => setMetricCode(attribute.primary.chartKey)}
                                >
                                  <strong className={primaryClass}>{attribute.primary.value}</strong>
                                  <span>{attribute.primary.name}</span>
                                  <strong className={comparisonClass}>{attribute.comparison?.value ?? "-"}</strong>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="attribute-grid">
                            {group.attributes.map((attribute) => (
                              <button
                                className={attribute.primary.chartKey === metricCode ? "active" : ""}
                                key={attribute.primary.chartKey}
                                title={`${text.showMetricMatchByMatch}: ${attribute.primary.name}`}
                                type="button"
                                onClick={() => setMetricCode(attribute.primary.chartKey)}
                              >
                                <span>{attribute.primary.name}</span>
                                <strong>{attribute.primary.value}</strong>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                    {!attributeGroups.length && <EmptyState text={text.noMatchingAttributes} />}
                  </div>
                  </>
                )}
              </section>
              <div className="trend-heading">
                <div><span>{text.matchByMatch}</span><h3>{metric?.name ?? text.performanceTrend}</h3></div>
                <div className="trend-actions">
                  <div className="segmented compact-segmented history-range" aria-label={text.matchHistoryRange}>
                    <button className={historyRange === "latest" ? "active" : ""} title={text.latestSeasonWithData} type="button" onClick={() => setHistoryRange("latest")}>{latestHistorySeasonLabel}</button>
                    <button
                      className={historyRange === "all" ? "active" : ""}
                      disabled={historySeasonCount <= 1}
                      title={historySeasonCount <= 1 ? text.onlyOneHistorySeason : `${text.allSeasons}: ${historySeasonCount}`}
                      type="button"
                      onClick={() => setHistoryRange("all")}
                    >
                      {text.allSeasons} ({historySeasonCount})
                    </button>
                  </div>
                  <div className="trend-keys">
                    {isMultiComparison ? multiPlayerChartSeries.flatMap((series) => isPairedMetric ? [
                      <span className="trend-key" key={`${series.key}-numerator`}><i style={{ backgroundColor: series.color }} /> {series.name} · {numeratorLabel}</span>,
                      <span className="trend-key denominator" key={`${series.key}-denominator`} style={{ color: series.color }}><i style={{ borderColor: series.color }} /> {series.name} · {denominatorLabel}</span>,
                    ] : [
                      <span className="trend-key" key={series.key}><i style={{ backgroundColor: series.color }} /> {series.name}</span>,
                    ]) : comparisonPlayer ? isPairedMetric ? (
                      <>
                        <span className="trend-key primary"><i /> {selectedPlayerName} · {numeratorLabel}</span>
                        <span className="trend-key primary denominator"><i /> {selectedPlayerName} · {denominatorLabel}</span>
                        <span className="trend-key comparison"><i /> {comparisonPlayerName} · {numeratorLabel}</span>
                        <span className="trend-key comparison denominator"><i /> {comparisonPlayerName} · {denominatorLabel}</span>
                      </>
                    ) : (
                      <>
                        <span className="trend-key primary"><i /> {selectedPlayerName}</span>
                        <span className="trend-key comparison"><i /> {comparisonPlayerName}</span>
                      </>
                    ) : isPairedMetric ? (
                      <>
                        <span className="trend-key completed"><i /> {numeratorLabel}</span>
                        <span className="trend-key attempted"><i /> {denominatorLabel}</span>
                      </>
                    ) : <span className="trend-key completed"><i /> {text.trend}</span>}
                  </div>
                </div>
              </div>
              <div className="chart-frame">
                {detailLoading || (comparisonPlayer && comparisonLoading) ? <InlineLoading /> : isMultiComparison && multiPlayerChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={multiPlayerChartData} margin={{ top: 18, right: 12, bottom: 4, left: -12 }}>
                      <CartesianGrid vertical={false} stroke="#293545" strokeDasharray="3 5" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        axisLine={false}
                        tick={{ fill: "#8B97A6", fontSize: 11 }}
                        tickFormatter={(value) => formatPlayerHistoryDate(new Date(Number(value)).toISOString(), historyRange === "all", language)}
                        tickLine={false}
                        minTickGap={28}
                      />
                      <YAxis axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} width={54} />
                      <Tooltip
                        contentStyle={{ color: "#F4F7FA", background: "#182432", border: "1px solid #354456", borderRadius: 6, boxShadow: "0 14px 34px rgba(0, 0, 0, .3)" }}
                        labelStyle={{ color: "#F4F7FA", fontWeight: 700 }}
                        formatter={(value, _, item) => {
                          const point = item.payload as MultiPlayerChartPoint;
                          const dataKey = String(item.dataKey);
                          const series = multiPlayerChartSeries.find((candidate) => dataKey.startsWith(candidate.key));
                          if (!series) return [formatMetric(Number(value)), text.value];
                          const playerPoint = point[`${series.key}Point`] as PlayerChartPoint | null;
                          const numerator = point[`${series.key}Numerator`] as number | null;
                          const denominator = point[`${series.key}Denominator`] as number | null;
                          const component = dataKey.endsWith("Numerator") ? numeratorLabel : dataKey.endsWith("Denominator") ? denominatorLabel : "";
                          const formattedValue = isPairedMetric
                            ? formatMetric(Number(value))
                            : formatMetricWithRatio(Number(value), metric?.value_type, numerator, denominator);
                          const context = playerPoint ? `${series.name} · ${playerPoint.date} · ${playerPoint.opponent}` : series.name;
                          return [formattedValue, component ? `${context} · ${component}` : context];
                        }}
                        labelFormatter={(_, payload) => (payload?.[0]?.payload as MultiPlayerChartPoint | undefined)?.date ?? text.match}
                      />
                      {multiPlayerChartSeries.flatMap((series) => isPairedMetric ? [
                        <Area key={`${series.key}-denominator`} type="monotone" dataKey={`${series.key}Denominator`} connectNulls stroke={series.color} strokeDasharray="6 4" strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 5, fill: series.color, stroke: "#080D14", strokeWidth: 3 }} />,
                        <Area key={`${series.key}-numerator`} type="monotone" dataKey={`${series.key}Numerator`} connectNulls stroke={series.color} strokeWidth={3} fill="transparent" dot={{ r: 3, fill: "#111923", stroke: series.color, strokeWidth: 2 }} activeDot={{ r: 6, fill: series.color, stroke: "#080D14", strokeWidth: 3 }} />,
                      ] : [
                        <Area key={series.key} type="monotone" dataKey={`${series.key}Value`} connectNulls stroke={series.color} strokeWidth={3} fill="transparent" dot={{ r: 3, fill: "#111923", stroke: series.color, strokeWidth: 2 }} activeDot={{ r: 6, fill: series.color, stroke: "#080D14", strokeWidth: 3 }} />,
                      ])}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : comparisonPlayer && playerComparisonChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={playerComparisonChartData} margin={{ top: 18, right: 12, bottom: 4, left: -12 }}>
                      <CartesianGrid vertical={false} stroke="#293545" strokeDasharray="3 5" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        axisLine={false}
                        tick={{ fill: "#8B97A6", fontSize: 11 }}
                        tickFormatter={(value) => formatPlayerHistoryDate(new Date(Number(value)).toISOString(), historyRange === "all", language)}
                        tickLine={false}
                        minTickGap={28}
                      />
                      <YAxis axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} width={54} />
                      <Tooltip contentStyle={{ color: "#F4F7FA", background: "#182432", border: "1px solid #354456", borderRadius: 6, boxShadow: "0 14px 34px rgba(0, 0, 0, .3)" }} labelStyle={{ color: "#F4F7FA", fontWeight: 700 }} formatter={(value, _, item) => {
                        const point = item.payload as PlayerComparisonChartPoint;
                        const dataKey = String(item.dataKey);
                        const isPrimary = dataKey.startsWith("primary");
                        const playerName = isPrimary ? selectedPlayerName : comparisonPlayerName;
                        const playerPoint = isPrimary ? point.primaryPoint : point.comparisonPoint;
                        const numerator = isPrimary ? point.primaryNumerator : point.comparisonNumerator;
                        const denominator = isPrimary ? point.primaryDenominator : point.comparisonDenominator;
                        const component = dataKey.endsWith("Numerator") ? numeratorLabel : dataKey.endsWith("Denominator") ? denominatorLabel : "";
                        const formattedValue = isPairedMetric
                          ? formatMetric(Number(value))
                          : formatMetricWithRatio(Number(value), metric?.value_type, numerator, denominator);
                        const context = playerPoint ? `${playerName} · ${playerPoint.date} · ${playerPoint.opponent}` : playerName;
                        return [formattedValue, component ? `${context} · ${component}` : context];
                      }} labelFormatter={(_, payload) => {
                        const point = payload?.[0]?.payload as PlayerComparisonChartPoint | undefined;
                        return point?.date ?? text.match;
                      }} />
                      {isPairedMetric ? (
                        <>
                          <Area type="monotone" dataKey="primaryDenominator" connectNulls stroke="#35C9B6" strokeDasharray="6 4" strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 5, fill: "#35C9B6", stroke: "#080D14", strokeWidth: 3 }} />
                          <Area type="monotone" dataKey="primaryNumerator" connectNulls stroke="#35C9B6" strokeWidth={3} fill="rgba(53, 201, 182, 0.08)" dot={{ r: 3, fill: "#111923", stroke: "#35C9B6", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#35C9B6", stroke: "#080D14", strokeWidth: 3 }} />
                          <Area type="monotone" dataKey="comparisonDenominator" connectNulls stroke="#F0B35A" strokeDasharray="6 4" strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 5, fill: "#F0B35A", stroke: "#080D14", strokeWidth: 3 }} />
                          <Area type="monotone" dataKey="comparisonNumerator" connectNulls stroke="#F0B35A" strokeWidth={3} fill="rgba(240, 179, 90, 0.06)" dot={{ r: 3, fill: "#111923", stroke: "#F0B35A", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#F0B35A", stroke: "#080D14", strokeWidth: 3 }} />
                        </>
                      ) : (
                        <>
                          <Area type="monotone" dataKey="primaryValue" connectNulls stroke="#35C9B6" strokeWidth={3} fill="rgba(53, 201, 182, 0.08)" dot={{ r: 3, fill: "#111923", stroke: "#35C9B6", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#35C9B6", stroke: "#080D14", strokeWidth: 3 }} />
                          <Area type="monotone" dataKey="comparisonValue" connectNulls stroke="#F0B35A" strokeWidth={3} fill="rgba(240, 179, 90, 0.06)" dot={{ r: 3, fill: "#111923", stroke: "#F0B35A", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#F0B35A", stroke: "#080D14", strokeWidth: 3 }} />
                        </>
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : plottedChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={plottedChartData} margin={{ top: 18, right: 12, bottom: 4, left: -12 }}>
                      <CartesianGrid vertical={false} stroke="#293545" strokeDasharray="3 5" />
                      <XAxis dataKey="date" axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} minTickGap={28} />
                      <YAxis axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} width={54} />
                      <Tooltip contentStyle={{ color: "#F4F7FA", background: "#182432", border: "1px solid #354456", borderRadius: 6, boxShadow: "0 14px 34px rgba(0, 0, 0, .3)" }} labelStyle={{ color: "#F4F7FA", fontWeight: 700 }} formatter={(value, name, item) => {
                        const point = item.payload as PlayerChartPoint;
                        return isPairedMetric
                          ? [formatMetric(Number(value)), String(name)]
                          : [formatMetricWithRatio(Number(value), metric?.value_type, point.numerator, point.denominator), metric?.name ?? text.value];
                      }} labelFormatter={(_, payload) => {
                        const point = payload?.[0]?.payload as PlayerChartPoint | undefined;
                        if (!point) return text.match;
                        const ratio = isPairedMetric
                          ? ` · ${formatMetricWithRatio(point.value, "percentage", point.numerator, point.denominator)}`
                          : "";
                        return `${point.date} · ${point.opponent}${ratio}`;
                      }} />
                      {isPairedMetric ? (
                        <>
                          <Area type="monotone" dataKey="denominator" name={denominatorLabel} connectNulls stroke="#F0B35A" strokeWidth={2.5} fill="rgba(240, 179, 90, 0.08)" dot={{ r: 3, fill: "#111923", stroke: "#F0B35A", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#F0B35A", stroke: "#080D14", strokeWidth: 3 }} />
                          <Area type="monotone" dataKey="numerator" name={numeratorLabel} connectNulls stroke="#35C9B6" strokeWidth={3} fill="rgba(53, 201, 182, 0.11)" dot={{ r: 3, fill: "#111923", stroke: "#35C9B6", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#35C9B6", stroke: "#080D14", strokeWidth: 3 }} />
                        </>
                      ) : <Area type="monotone" dataKey="value" stroke="#35C9B6" strokeWidth={3} fill="rgba(53, 201, 182, 0.08)" dot={{ r: 3, fill: "#111923", stroke: "#35C9B6", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#35C9B6", stroke: "#080D14", strokeWidth: 3 }} />}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <EmptyState text={text.noPlayerMetricData} />}
              </div>
              <div className={`history-strip${comparisonPlayer ? " comparison-history-strip" : ""}${isMultiComparison ? " multi-comparison-history-strip" : ""}`}>
                {isMultiComparison ? multiPlayerChartData.slice(-3).reverse().map((item) => (
                  <div key={item.timestamp as number}>
                    <span>{item.date as string}</span>
                    {multiPlayerChartSeries.map((series) => {
                      const point = item[`${series.key}Point`] as PlayerChartPoint | null;
                      return (
                        <strong key={series.key}>
                          <i style={{ backgroundColor: series.color }} />
                          {series.name}
                          <b>{formatChartPointValue(point)}</b>
                        </strong>
                      );
                    })}
                  </div>
                )) : comparisonPlayer ? playerComparisonChartData.slice(-6).reverse().map((item) => (
                  <div key={item.timestamp}>
                    <span>{item.date}</span>
                    <strong className="primary-history-value"><i />{selectedPlayerName}<b>{formatChartPointValue(item.primaryPoint)}</b></strong>
                    <small>{item.primaryPoint ? `${item.primaryPoint.date} · ${item.primaryPoint.opponent}` : "-"}</small>
                    <strong className="comparison-history-value"><i />{comparisonPlayerName}<b>{formatChartPointValue(item.comparisonPoint)}</b></strong>
                    <small>{item.comparisonPoint ? `${item.comparisonPoint.date} · ${item.comparisonPoint.opponent}` : "-"}</small>
                  </div>
                )) : plottedChartData.slice(-6).reverse().map((item) => <div key={`${item.match}-${item.date}`}><span>{item.date} · {item.opponent}</span><strong>{formatChartPointValue(item)}</strong><small>{item.score}</small></div>)}
              </div>
              <PlayerValuationPanel
                loading={valuationLoading}
                series={comparedPlayers.map((player, index) => ({
                  key: `valuation${index}`,
                  name: comparedPlayerNames[index],
                  color: comparisonChartColors[index],
                  valuations: index === 0 ? valuations : comparisonValuations[player.player_id] ?? [],
                }))}
              />
              <div className={`season-heatmap-layout${comparisonPlayer ? " comparison" : ""}${isMultiComparison ? " multi" : ""}`}>
                <SeasonHeatmapPanel
                  appearances={Number(selectedPlayer.appearances)}
                  heatmaps={seasonHeatmaps}
                  loading={seasonHeatmapLoading}
                  playerName={selectedPlayerName}
                  seasonName={season.season_name}
                />
                {comparisonPlayers.map((player) => (
                  <SeasonHeatmapPanel
                    appearances={Number(player.appearances)}
                    heatmaps={comparisonSeasonHeatmaps[player.player_id] ?? []}
                    key={player.player_id}
                    loading={comparisonSeasonHeatmapLoading}
                    playerName={localizedPlayerName(player, player.display_name, language)}
                    seasonName={season.season_name}
                  />
                ))}
              </div>
            </>
          ) : <EmptyState text={text.selectPlayer} />}
        </section>
      </div>
    </>
  );
}

function PlayerValuationPanel({
  series,
  loading,
}: {
  series: PlayerValuationSeries[];
  loading: boolean;
}) {
  const { language, text } = useLocale();
  const latestValuations = series.map((item) => item.valuations[item.valuations.length - 1] ?? null);
  const pointsByDate = new Map<string, ValuationChartPoint>();
  const addValue = (valuation: PlayerValuation, item: PlayerValuationSeries) => {
    const current = pointsByDate.get(valuation.valuation_date) ?? {
      date: valuation.valuation_date,
      timestamp: Date.parse(`${valuation.valuation_date}T00:00:00Z`),
    };
    current[`${item.key}Value`] = Number(valuation.value_amount);
    current[`${item.key}Valuation`] = valuation;
    pointsByDate.set(valuation.valuation_date, current);
  };
  series.forEach((item) => item.valuations.forEach((valuation) => addValue(valuation, item)));
  const chartPoints = [...pointsByDate.values()].sort((a, b) => a.timestamp - b.timestamp);
  const currency = latestValuations.find((valuation) => valuation)?.currency ?? "EUR";
  const latestValues = latestValuations.map((valuation) => valuation?.value_amount ?? null);
  const currentValueClasses = series.length > 2
    ? multiPlayerRankClasses(latestValues, "estimated_transfer_value")
    : latestValues.map((value, index) => series.length === 2
      ? playerComparisonClass(value, latestValues[index === 0 ? 1 : 0], "estimated_transfer_value")
      : "");
  const rangeLabel = (valuation: PlayerValuation) => {
    if (valuation.lower_bound === null || valuation.upper_bound === null) return "";
    return `${text.valuationRange}: ${formatValuation(valuation.lower_bound, valuation.currency, language)}–${formatValuation(valuation.upper_bound, valuation.currency, language)}`;
  };
  return (
    <section className="player-valuation">
      <div className="valuation-heading">
        <div><span>{text.estimatedTransferValue}</span><h3>{text.valuationHistory}</h3></div>
        <span>{text.valuationSource}</span>
      </div>
      {loading ? <InlineLoading /> : chartPoints.length ? (
        <>
          <div className={`valuation-current-band${series.length > 1 ? " comparison" : ""}${series.length > 2 ? " multi" : ""}`}>
            {series.map((item, index) => {
              const latest = latestValuations[index];
              return (
                <div className="valuation-current" key={item.key}>
                  <span className="valuation-series-name"><i style={{ backgroundColor: item.color }} />{item.name}</span>
                  <strong className={currentValueClasses[index]}>{latest ? formatValuation(latest.value_amount, latest.currency, language) : "-"}</strong>
                  <small>{latest ? `${text.valuationAsOf} ${formatValuationDate(latest.valuation_date, language)}${rangeLabel(latest) ? ` · ${rangeLabel(latest)}` : ""}` : text.noValuationData}</small>
                </div>
              );
            })}
          </div>
          <div className="valuation-chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartPoints} margin={{ top: 18, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="#293545" strokeDasharray="3 5" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  axisLine={false}
                  tick={{ fill: "#8B97A6", fontSize: 11 }}
                  tickFormatter={(value) => formatValuationDate(new Date(Number(value)).toISOString().slice(0, 10), language, true)}
                  tickLine={false}
                  minTickGap={30}
                />
                <YAxis
                  axisLine={false}
                  tick={{ fill: "#8B97A6", fontSize: 11 }}
                  tickFormatter={(value) => formatValuation(Number(value), currency, language)}
                  tickLine={false}
                  width={68}
                />
                <Tooltip
                  contentStyle={{ color: "#F4F7FA", background: "#182432", border: "1px solid #354456", borderRadius: 6, boxShadow: "0 14px 34px rgba(0, 0, 0, .3)" }}
                  labelStyle={{ color: "#F4F7FA", fontWeight: 700 }}
                  formatter={(value, _, item) => {
                    const point = item.payload as ValuationChartPoint;
                    const dataKey = String(item.dataKey);
                    const valuationSeries = series.find((candidate) => `${candidate.key}Value` === dataKey);
                    const valuation = valuationSeries ? point[`${valuationSeries.key}Valuation`] as PlayerValuation | null : null;
                    if (!valuation || !valuationSeries) return ["-", text.estimatedTransferValue];
                    const range = rangeLabel(valuation);
                    return [
                      `${formatValuation(Number(value), valuation.currency, language)}${range ? ` · ${range}` : ""}`,
                      valuationSeries.name,
                    ];
                  }}
                  labelFormatter={(value) => formatValuationDate(new Date(Number(value)).toISOString().slice(0, 10), language)}
                />
                {series.filter((item) => item.valuations.length).map((item, index) => (
                  <Area
                    activeDot={{ r: 6, fill: item.color, stroke: "#080D14", strokeWidth: 3 }}
                    connectNulls
                    dataKey={`${item.key}Value`}
                    dot={{ r: 3, fill: "#111923", stroke: item.color, strokeWidth: 2 }}
                    fill={series.length > 2 ? "transparent" : index === 0 ? "rgba(53, 201, 182, 0.08)" : "rgba(240, 179, 90, 0.06)"}
                    key={item.key}
                    stroke={item.color}
                    strokeWidth={3}
                    type="monotone"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : <EmptyState text={text.noValuationData} />}
    </section>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function SectionHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  const { language } = useLocale();
  return <div className="section-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div>{action && <button type="button" onClick={onAction}>{action}<ArrowUpRight className={language === "he" ? "rtl-arrow" : ""} size={15} /></button>}</div>;
}

function Stat({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={accent ? "stat accent" : "stat"}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function CompactMatch({ match, onClick, showCompetition = false }: { match: Match; onClick: () => void; showCompetition?: boolean }) {
  const { language } = useLocale();
  const OpenIcon = language === "he" ? ChevronLeft : ChevronRight;
  return (
    <button className="compact-match" type="button" onClick={onClick}>
      <time><span>{formatFixtureDate(match.scheduled_at, language)}</span>{showCompetition && <small>{localizedMatchCompetition(match, language)}</small>}</time>
      <span className="compact-club compact-club-home"><strong>{localizedMatchTeam(match, "home", language)}</strong><ClubBadge name={localizedMatchTeam(match, "home", language)} logoUrl={match.home_team_logo_url} size="tiny" /></span>
      <span className="compact-scoreline" aria-label={formatScore(match.home_score, match.away_score)}>
        <span className="compact-score">{displayMatchScore(match.home_score)}</span>
        <span className="compact-score-separator" aria-hidden="true">:</span>
        <span className="compact-score">{displayMatchScore(match.away_score)}</span>
      </span>
      <span className="compact-club compact-club-away"><ClubBadge name={localizedMatchTeam(match, "away", language)} logoUrl={match.away_team_logo_url} size="tiny" /><strong>{localizedMatchTeam(match, "away", language)}</strong></span>
      <OpenIcon size={16} />
    </button>
  );
}

function MatchScoreboard({ match }: { match: Match }) {
  const { language, text } = useLocale();
  return (
    <div className="match-scoreboard">
      <div className="match-meta"><span>{localizedStageName(match.stage_name, language)} · {text.round} {match.round_number}</span><strong>{formatLongDate(match.scheduled_at, language)}</strong></div>
      <div className="scoreboard-main">
        <div className="score-club home"><div><strong>{localizedMatchTeam(match, "home", language)}</strong><span>{text.home}</span></div><ClubBadge name={localizedMatchTeam(match, "home", language)} logoUrl={match.home_team_logo_url} size="large" /></div>
        <div className="big-score"><strong>{displayMatchScore(match.home_score)}</strong><span>:</span><strong>{displayMatchScore(match.away_score)}</strong><small>{localizedStatus(match.status, language, text.scheduled)}</small></div>
        <div className="score-club"><ClubBadge name={localizedMatchTeam(match, "away", language)} logoUrl={match.away_team_logo_url} size="large" /><div><strong>{localizedMatchTeam(match, "away", language)}</strong><span>{text.away}</span></div></div>
      </div>
    </div>
  );
}

function ComparisonBar({ label, home, away, valueType }: { label: string; home: number; away: number; valueType: string }) {
  const total = Math.max(home + away, 1);
  const homeWidth = `${Math.max((home / total) * 100, 4)}%`;
  const awayWidth = `${Math.max((away / total) * 100, 4)}%`;
  const isTie = formatMetric(home, valueType) === formatMetric(away, valueType);
  const homeTone = isTie ? "tie" : home > away ? "higher" : "lower";
  const awayTone = isTie ? "tie" : away > home ? "higher" : "lower";
  return (
    <div className="comparison-row">
      <div><strong>{formatMetric(home, valueType)}</strong><span>{label}</span><strong>{formatMetric(away, valueType)}</strong></div>
      <div className="comparison-track"><i className={`home ${homeTone}`} style={{ width: homeWidth }} /><i className={`away ${awayTone}`} style={{ width: awayWidth }} /></div>
    </div>
  );
}

function MatchShotMap({
  match,
  shots,
  sideFilter,
  setSideFilter,
  playerFilter,
  setPlayerFilter,
  loading,
}: {
  match: Match;
  shots: MatchShot[];
  sideFilter: ShotSideFilter;
  setSideFilter: (side: ShotSideFilter) => void;
  playerFilter: string;
  setPlayerFilter: (id: string) => void;
  loading: boolean;
}) {
  const { language, text } = useLocale();
  const sideShots = shots.filter((shot) => sideFilter === "all" || shot.side === sideFilter);
  const playerOptions = Array.from(new Map(
    sideShots
      .filter((shot) => shot.player_id)
      .map((shot) => [shot.player_id as string, localizedShotPlayer(shot, language)]),
  ).entries()).sort((left, right) => left[1].localeCompare(right[1], language));
  const filteredShots = sideShots.filter((shot) => playerFilter === "all" || shot.player_id === playerFilter);
  const outcomes = ["Goal", "Saved", "Blocked", "Missed", "Post"];

  useEffect(() => {
    if (playerFilter !== "all" && !playerOptions.some(([id]) => id === playerFilter)) setPlayerFilter("all");
  }, [playerFilter, playerOptions, setPlayerFilter]);

  return (
    <section className="shot-map-panel">
      <div className="shot-map-heading">
        <SectionHeading eyebrow={text.spatialAnalysis} title={text.shotMap} />
        <span>{filteredShots.length} {text.shots.toLowerCase()}</span>
      </div>
      <div className="shot-map-controls">
        <div className="segmented compact-segmented" aria-label={text.team}>
          <button className={sideFilter === "all" ? "active" : ""} type="button" onClick={() => setSideFilter("all")}>{text.allShots}</button>
          <button className={sideFilter === "home" ? "active" : ""} type="button" onClick={() => setSideFilter("home")}>{localizedMatchTeam(match, "home", language)}</button>
          <button className={sideFilter === "away" ? "active" : ""} type="button" onClick={() => setSideFilter("away")}>{localizedMatchTeam(match, "away", language)}</button>
        </div>
        <label className="shot-player-filter">
          <span>{text.player}</span>
          <select value={playerFilter} onChange={(event) => setPlayerFilter(event.target.value)}>
            <option value="all">{text.allPlayers}</option>
            {playerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>
      {loading ? <InlineLoading /> : shots.length ? (
        <div className="shot-map-content">
          <div className="shot-pitch" dir="ltr">
            <span className="pitch-center-line" />
            <span className="pitch-center-circle" />
            <span className="pitch-box pitch-box-left" />
            <span className="pitch-box pitch-box-right" />
            <span className="pitch-six pitch-six-left" />
            <span className="pitch-six pitch-six-right" />
            <span className="pitch-goal pitch-goal-left" />
            <span className="pitch-goal pitch-goal-right" />
            <span className="attack-direction" title={text.attackingDirection}><ArrowRight size={15} aria-hidden="true" /></span>
            {filteredShots.map((shot) => {
              const xg = Number(shot.xg ?? 0);
              const size = Math.min(22, 9 + Math.sqrt(Math.max(xg, 0)) * 16);
              const playerName = localizedShotPlayer(shot, language);
              const outcome = localizedShotOutcome(shot.outcome, text);
              const label = `${playerName} · ${shot.event_time ?? shot.minute ?? "-"} · ${outcome} · xG ${xg.toFixed(2)}`;
              return (
                <button
                  className={`shot-point ${shotOutcomeClass(shot.outcome)} ${shot.side ?? "unknown"}`}
                  key={shot.event_id}
                  type="button"
                  style={{
                    left: `${clampCoordinate(shot.x)}%`,
                    top: `${clampCoordinate(shot.y)}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                  }}
                  title={label}
                  aria-label={label}
                />
              );
            })}
          </div>
          <div className="shot-map-legend">
            {outcomes.map((outcome) => (
              <span key={outcome}><i className={shotOutcomeClass(outcome)} />{localizedShotOutcome(outcome, text)}</span>
            ))}
          </div>
        </div>
      ) : <EmptyState text={text.noShotMap} />}
    </section>
  );
}

function matchTableRankClasses(players: PlayerPivot[]) {
  function extremes(valueForPlayer: (player: PlayerPivot) => number | null | undefined, metricCode: string) {
    const ranked = players.map((player) => {
      const rawValue = valueForPlayer(player);
      const value = rawValue === null || rawValue === undefined ? null : Number(rawValue);
      return {
        playerId: player.player_id,
        value: value === null || !Number.isFinite(value) || (metricCode === "rating_365" && value < 0) ? null : value,
      };
    });
    const observed = ranked.flatMap((item) => item.value === null ? [] : [item.value]);
    const classes = new Map<string, string>();
    if (observed.length < 2) return classes;
    const best = Math.max(...observed);
    const worst = Math.min(...observed);
    if (Math.abs(best - worst) < 0.000001) return classes;
    const bestCount = ranked.filter((item) => item.value !== null && Math.abs(item.value - best) < 0.000001).length;
    const worstCount = ranked.filter((item) => item.value !== null && Math.abs(item.value - worst) < 0.000001).length;
    ranked.forEach((item) => {
      if (item.value === null) return;
      if (bestCount <= 3 && Math.abs(item.value - best) < 0.000001) classes.set(item.playerId, "match-stat-best");
      else if (worstCount <= 3 && Math.abs(item.value - worst) < 0.000001) classes.set(item.playerId, "match-stat-worst");
    });
    return classes;
  }

  return {
    rating: extremes((player) => player.values.rating_365, "rating_365"),
    goals: extremes((player) => player.values.goals, "goals"),
    assists: extremes((player) => player.values.assists, "assists"),
    passCompletion: extremes((player) => player.values.pass_completion_pct, "pass_completion_pct"),
    shots: extremes((player) => player.values.total_shots, "total_shots"),
  };
}

function shortPlayerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  const finalPair = parts.slice(-2).join(" ");
  return finalPair.length <= 15 ? finalPair : parts[parts.length - 1];
}

function spreadAveragePositions(items: Array<{ playerId: string; x: number; y: number }>) {
  const arranged = [...items]
    .sort((left, right) => left.playerId.localeCompare(right.playerId))
    .map((item) => ({ ...item, originalX: item.x, originalY: item.y }));
  const horizontalRadius = 10;
  const verticalRadius = 13.5;

  for (let iteration = 0; iteration < 90; iteration += 1) {
    for (let leftIndex = 0; leftIndex < arranged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arranged.length; rightIndex += 1) {
        const left = arranged[leftIndex];
        const right = arranged[rightIndex];
        let scaledX = (right.x - left.x) / horizontalRadius;
        let scaledY = (right.y - left.y) / verticalRadius;
        let distance = Math.sqrt(scaledX * scaledX + scaledY * scaledY);
        if (distance >= 1) continue;
        if (distance < 0.001) {
          const angle = ((leftIndex + 1) * 137.5 + rightIndex * 47) * Math.PI / 180;
          scaledX = Math.cos(angle) * 0.001;
          scaledY = Math.sin(angle) * 0.001;
          distance = 0.001;
        }
        const push = (1 - distance) * 0.29;
        const directionX = scaledX / distance;
        const directionY = scaledY / distance;
        left.x -= directionX * horizontalRadius * push;
        right.x += directionX * horizontalRadius * push;
        left.y -= directionY * verticalRadius * push;
        right.y += directionY * verticalRadius * push;
      }
    }
    arranged.forEach((item) => {
      item.x += (item.originalX - item.x) * 0.012;
      item.y += (item.originalY - item.y) * 0.012;
      item.x = Math.max(6, Math.min(94, item.x));
      item.y = Math.max(8, Math.min(90, item.y));
    });
  }

  return Object.fromEntries(arranged.map((item) => [item.playerId, { x: item.x, y: item.y }]));
}

function matchLineupStatusOrder(status: string | null) {
  if (/start/i.test(status ?? "")) return 0;
  if (/sub/i.test(status ?? "")) return 1;
  return 2;
}

function matchPositionOrder(player: PlayerPivot, seasonPlayer?: SeasonPlayer) {
  const roleOrder: Record<SeasonPlayer["role_group"], number> = {
    Goalkeepers: 0,
    Defenders: 1,
    Midfielders: 2,
    Attackers: 3,
    Other: 4,
  };
  if (seasonPlayer) return roleOrder[seasonPlayer.role_group];
  const position = `${player.formation_position ?? ""} ${player.position_name ?? ""}`.toLowerCase();
  if (/goalkeeper|keeper/.test(position)) return 0;
  if (/defender|centre back|center back|full back|wing back|left back|right back/.test(position)) return 1;
  if (/midfield/.test(position)) return 2;
  if (/attacker|forward|striker|winger/.test(position)) return 3;
  return 4;
}

function sortMatchLineupPlayers(players: PlayerPivot[], seasonPlayerById: Map<string, SeasonPlayer>) {
  return players
    .map((player, sourceIndex) => ({ player, sourceIndex }))
    .sort((left, right) => (
      matchLineupStatusOrder(left.player.lineup_status) - matchLineupStatusOrder(right.player.lineup_status)
      || matchPositionOrder(left.player, seasonPlayerById.get(left.player.player_id)) - matchPositionOrder(right.player, seasonPlayerById.get(right.player.player_id))
      || left.sourceIndex - right.sourceIndex
    ))
    .map(({ player }) => player);
}

function PlayerMatchTable({
  players,
  seasonPlayers,
  inspectPlayer,
}: {
  players: PlayerPivot[];
  seasonPlayers: SeasonPlayer[];
  inspectPlayer: (id: string) => void;
}) {
  const { language, text } = useLocale();
  const seasonPlayerById = new Map(seasonPlayers.map((player) => [player.player_id, player]));
  const rankClasses = matchTableRankClasses(players);
  const sortedPlayers = sortMatchLineupPlayers(players, seasonPlayerById);
  if (!players.length) return <EmptyState text={text.noSidePlayerStats} />;
  return (
    <div className="data-table-wrap">
      <table className="player-stat-table">
        <thead><tr><th>{text.player}</th><th>{text.minShort}</th><th>{text.rating}</th><th>{text.goalsShort}</th><th>{text.assistsShort}</th><th>{text.passPct}</th><th>{text.shots}</th></tr></thead>
        <tbody>{sortedPlayers.map((player, index) => {
          const displayName = localizedPlayerName(seasonPlayerById.get(player.player_id), player.display_name, language);
          const inspect = () => inspectPlayer(player.player_id);
          const startsSubstitutes = matchLineupStatusOrder(player.lineup_status) === 1
            && index > 0
            && matchLineupStatusOrder(sortedPlayers[index - 1].lineup_status) !== 1;
          return (
            <tr
              className={startsSubstitutes ? "substitute-start" : undefined}
              key={player.appearance_id}
              role="button"
              tabIndex={0}
              title={`${text.viewMatchAttributes}: ${displayName}`}
              aria-label={`${text.viewMatchAttributes}: ${displayName}`}
              onClick={inspect}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                inspect();
              }}
            >
              <td><span className="match-player-cell"><span>{player.shirt_number ?? "-"}</span><span><strong>{displayName}</strong><small>{localizedFormationPosition(player.formation_position ?? player.position_name, language) || player.lineup_status || text.player}</small></span></span></td>
              <td>{formatMetric(player.minutes_played)}</td>
              <td className={rankClasses.rating.get(player.player_id)}><strong>{formatMetric(player.values.rating_365)}</strong></td>
              <td className={rankClasses.goals.get(player.player_id)}>{formatMetric(player.values.goals)}</td>
              <td className={rankClasses.assists.get(player.player_id)}>{formatMetric(player.values.assists)}</td>
              <td className={rankClasses.passCompletion.get(player.player_id)}>{formatMetricWithRatio(player.values.pass_completion_pct, "percentage", player.values.passes_completed, player.values.passes_attempted)}</td>
              <td className={rankClasses.shots.get(player.player_id)}>{formatMetric(player.values.total_shots)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function MatchAveragePositionPitch({
  players,
  seasonPlayers,
  heatmaps,
  inspectPlayer,
}: {
  players: PlayerPivot[];
  seasonPlayers: SeasonPlayer[];
  heatmaps: MatchPlayerHeatmap[];
  inspectPlayer: (id: string) => void;
}) {
  const { language, text } = useLocale();
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading, setLoading] = useState(false);
  const lineupPlayers = useMemo(() => {
    const starters = players.filter((player) => /start/i.test(player.lineup_status ?? ""));
    return starters.length >= 7
      ? starters
      : [...players].sort((left, right) => Number(right.minutes_played ?? 0) - Number(left.minutes_played ?? 0)).slice(0, 11);
  }, [players]);
  const lineupPlayerIds = useMemo(() => new Set(lineupPlayers.map((player) => player.player_id)), [lineupPlayers]);
  const lineupHeatmaps = useMemo(
    () => heatmaps.filter((heatmap) => lineupPlayerIds.has(heatmap.player_id)),
    [heatmaps, lineupPlayerIds],
  );
  const seasonPlayerById = useMemo(
    () => new Map(seasonPlayers.map((player) => [player.player_id, player])),
    [seasonPlayers],
  );

  useEffect(() => {
    const controller = new AbortController();
    setPositions({});
    if (!lineupHeatmaps.length) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void calculateMatchAveragePositions(lineupHeatmaps, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPositions(Object.fromEntries(result.map((position) => [position.playerId, position])));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setPositions({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [lineupHeatmaps]);

  const positionedPlayers = lineupPlayers.filter((player) => positions[player.player_id]);
  const validRatings = positionedPlayers
    .map((player) => Number(player.values.rating_365))
    .filter((rating) => Number.isFinite(rating) && rating >= 0);
  const highestRating = validRatings.length ? Math.max(...validRatings) : null;
  const displayPositions = spreadAveragePositions(positionedPlayers.map((player) => ({
    playerId: player.player_id,
    ...positions[player.player_id],
  })));
  return (
    <section className="average-position-panel">
      <div className="average-position-heading"><strong>{text.averagePositions}</strong><span>{positionedPlayers.length || lineupPlayers.length}</span></div>
      <div className="shot-pitch average-position-pitch" dir="ltr">
        <span className="pitch-center-line" />
        <span className="pitch-center-circle" />
        <span className="pitch-box pitch-box-left" />
        <span className="pitch-box pitch-box-right" />
        <span className="pitch-six pitch-six-left" />
        <span className="pitch-six pitch-six-right" />
        <span className="pitch-goal pitch-goal-left" />
        <span className="pitch-goal pitch-goal-right" />
        {positionedPlayers.map((player) => {
          const position = displayPositions[player.player_id];
          const displayName = localizedPlayerName(seasonPlayerById.get(player.player_id), player.display_name, language);
          const numericRating = Number(player.values.rating_365);
          const hasRating = Number.isFinite(numericRating) && numericRating >= 0;
          const rating = hasRating ? formatMetric(numericRating) : "-";
          const ratingTone = !hasRating ? "rating-unrated" : numericRating >= 7 ? "rating-high" : numericRating < 5 ? "rating-low" : "rating-medium";
          const isTopRated = hasRating && highestRating !== null && Math.abs(numericRating - highestRating) < 0.000001;
          return (
            <button
              className={`average-position-player ${ratingTone}${isTopRated ? " top-rated" : ""}`}
              key={player.appearance_id}
              type="button"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              title={`${displayName} · ${text.rating}: ${rating}`}
              aria-label={`${text.viewMatchAttributes}: ${displayName}, ${text.rating} ${rating}`}
              onClick={() => inspectPlayer(player.player_id)}
            >
              <span className="average-position-marker">
                {isTopRated ? <Star className="average-position-star" size={13} aria-hidden="true" /> : null}
                <strong>{player.shirt_number ?? "-"}</strong><small>{rating}</small>
              </span>
              <span className="average-position-name" dir={language === "he" ? "rtl" : "ltr"}>{shortPlayerName(displayName)}</span>
            </button>
          );
        })}
        {loading ? <span className="average-position-loading"><Loader2 className="spin" size={19} aria-label={text.averagePositions} /></span> : null}
        {!loading && !positionedPlayers.length ? <span className="average-position-empty">{text.noAveragePositions}</span> : null}
      </div>
    </section>
  );
}

function PlayerMatchInspector({
  match,
  player,
  seasonPlayer,
  heatmap,
  metrics,
  onClose,
  openPlayer,
}: {
  match: Match;
  player: PlayerPivot;
  seasonPlayer?: SeasonPlayer;
  heatmap?: MatchPlayerHeatmap;
  metrics: Metric[];
  onClose: () => void;
  openPlayer: (id: string) => void;
}) {
  const { language, text } = useLocale();
  const [rows, setRows] = useState<MatchPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isGoalkeeper = seasonPlayer?.role_group === "Goalkeepers" || /goalkeeper/i.test(player.position_name ?? "");
  const attributes = useMemo(
    () => buildMatchPlayerAttributes(rows, metrics, language, isGoalkeeper),
    [isGoalkeeper, language, metrics, rows],
  );
  const categoryOrder = isGoalkeeper
    ? (["Goalkeeping", ...playerAttributeCategories.filter((category) => category !== "Goalkeeping")] as PlayerAttributeCategory[])
    : playerAttributeCategories.filter((category) => category !== "Goalkeeping");
  const attributeGroups = categoryOrder
    .map((category) => ({ category, attributes: attributes.filter((attribute) => attribute.category === category) }))
    .filter((group) => group.attributes.length > 0);
  const playerTeam = player.side === "away" ? localizedMatchTeam(match, "away", language) : localizedMatchTeam(match, "home", language);
  const opponent = player.side === "away" ? localizedMatchTeam(match, "home", language) : localizedMatchTeam(match, "away", language);
  const displayName = localizedPlayerName(seasonPlayer, player.display_name, language);

  useEffect(() => {
    let cancelled = false;
    async function loadAttributes() {
      setLoading(true);
      setLoadError(null);
      if (!hasSupabaseConfig || !supabase) {
        setRows([]);
        setLoading(false);
        return;
      }
      const result = await supabase
        .from("api_match_player_stats")
        .select("*")
        .eq("match_id", match.match_id)
        .eq("player_id", player.player_id)
        .limit(500);
      if (cancelled) return;
      setRows((result.data ?? []) as MatchPlayerStat[]);
      setLoadError(result.error?.message ?? null);
      setLoading(false);
    }
    void loadAttributes();
    return () => { cancelled = true; };
  }, [match.match_id, player.player_id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="match-player-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="match-player-dialog" role="dialog" aria-modal="true" aria-labelledby="match-player-dialog-title">
        <header className="match-player-dialog-header">
          <div>
            <span>{text.matchAttributes}</span>
            <h2 id="match-player-dialog-title">{displayName}</h2>
            <p>{playerTeam} · {text.opponent}: {opponent}</p>
          </div>
          <div className="match-player-dialog-actions">
            <button className="profile-command" type="button" onClick={() => { onClose(); openPlayer(player.player_id); }}>{text.fullPlayerProfile}<ArrowUpRight size={15} aria-hidden="true" /></button>
            <button className="icon-button compact" type="button" title={text.closeMatchAttributes} aria-label={text.closeMatchAttributes} onClick={onClose} autoFocus><X size={17} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="match-player-summary">
          <span><small>{text.position}</small><strong>{localizedFormationPosition(player.formation_position ?? player.position_name, language) || text.player}</strong></span>
          <span><small>{text.minutes}</small><strong>{formatMetric(player.minutes_played)}</strong></span>
          <span><small>{text.rating}</small><strong>{formatMetric(player.values.rating_365)}</strong></span>
          <span><small>{text.match}</small><strong>{formatScore(match.home_score, match.away_score)}</strong></span>
        </div>
        <div className="match-player-dialog-body">
          {loading ? <InlineLoading /> : loadError ? <EmptyState text={loadError} /> : attributeGroups.length ? attributeGroups.map((group) => (
            <section className="match-attribute-group" key={group.category}>
              <h3>{categoryName(group.category, language)}</h3>
              <div className="match-attribute-grid">
                {group.attributes.map((attribute) => <div key={attribute.code}><span>{attribute.name}</span><strong>{attribute.value}</strong></div>)}
              </div>
            </section>
          )) : <EmptyState text={text.noMatchAttributes} />}
          {heatmap?.heatmap_url ? (
            <section className="player-heatmap-panel">
              <h3>{text.playerHeatmap}</h3>
              <div><img src={heatmap.heatmap_url} alt={`${displayName} · ${text.playerHeatmap}`} /></div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ClubBadge({ name, logoUrl, size }: { name: string; logoUrl?: string | null; size: "tiny" | "small" | "large" }) {
  return (
    <span className={`club-badge ${size}`} aria-hidden="true">
      <span className="club-badge-fallback">{initials(cleanTeamName(name))}</span>
      {logoUrl ? <img src={logoUrl} alt="" onError={(event) => event.currentTarget.remove()} /> : null}
    </span>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-centerline" />
      <span className="brand-center-circle" />
      <span className="brand-step step-a" />
      <span className="brand-step step-b" />
      <span className="brand-step step-c" />
      <span className="brand-rise rise-a" />
      <span className="brand-rise rise-b" />
      <span className="brand-terminal" />
    </span>
  );
}

function LoadingState() {
  const { text } = useLocale();
  return <div className="loading-state"><Loader2 className="spin" size={28} /><strong>{text.buildingSeason}</strong><span>{text.loadingSeason}</span></div>;
}

function InlineLoading() {
  const { text } = useLocale();
  return <div className="inline-loading"><Loader2 className="spin" size={20} /><span>{text.loadingMatchData}</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><BarChart3 size={22} /><span>{text}</span></div>;
}

function pivotMatchPlayers(rows: MatchPlayerStat[]): PlayerPivot[] {
  const pivots = new Map<string, { base: MatchPlayerStat; values: Map<string, number[]> }>();
  rows.forEach((row) => {
    const current = pivots.get(row.appearance_id) ?? { base: row, values: new Map<string, number[]>() };
    if (row.value_numeric !== null && isUsableMetricValue(row.metric_code, Number(row.value_numeric))) {
      const metricValues = current.values.get(row.metric_code) ?? [];
      metricValues.push(Number(row.value_numeric));
      current.values.set(row.metric_code, metricValues);
    }
    pivots.set(row.appearance_id, current);
  });
  return [...pivots.values()].map(({ base, values }) => ({
    ...base,
    values: Object.fromEntries([...values.entries()].map(([code, numbers]) => [code, average(numbers)])),
  })).sort((a, b) => Number(b.minutes_played ?? 0) - Number(a.minutes_played ?? 0));
}

function buildMatchPlayerAttributes(
  rows: MatchPlayerStat[],
  metrics: Metric[],
  language: Language,
  isGoalkeeper: boolean,
): MatchPlayerAttribute[] {
  const grouped = new Map<string, { row: MatchPlayerStat; values: number[] }>();
  rows.forEach((row) => {
    if (row.value_numeric === null || !isUsableMetricValue(row.metric_code, Number(row.value_numeric))) return;
    const current = grouped.get(row.metric_code) ?? { row, values: [] };
    current.values.push(Number(row.value_numeric));
    grouped.set(row.metric_code, current);
  });
  const valuesByCode = new Map([...grouped].map(([code, item]) => [code, average(item.values)]));
  const metricByCode = new Map(metrics.map((metric) => [metric.code, metric]));

  return [...grouped].flatMap(([code, item]) => {
    const metric = metricByCode.get(code);
    if (!isGoalkeeper && isGoalkeepingMetricCode(code)) return [];
    const valueType = metric?.value_type ?? item.row.value_type;
    const numerator = metric?.numerator_metric_code ? valuesByCode.get(metric.numerator_metric_code) : undefined;
    const denominator = metric?.denominator_metric_code ? valuesByCode.get(metric.denominator_metric_code) : undefined;
    return [{
      code,
      name: metricName(code, friendlyMetric(metric?.name ?? item.row.metric_name), language),
      value: formatMetricWithRatio(valuesByCode.get(code), valueType, numerator, denominator),
      category: playerAttributeCategory(metric ?? { code }),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name, localeCode(language)));
}

function isUsableMetricValue(metricCode: string, value: number) {
  return Number.isFinite(value) && !(metricCode === "rating_365" && value < 0);
}

function buildTeamComparisons(rows: MatchTeamStat[], language: Language) {
  const grouped = new Map<string, { label: string; valueType: string; home: number[]; away: number[] }>();
  rows.filter((row) => comparisonMetrics.includes(row.metric_code) && row.value_numeric !== null).forEach((row) => {
    const current = grouped.get(row.metric_code) ?? { label: metricName(row.metric_code, friendlyMetric(row.metric_name), language), valueType: row.value_type, home: [], away: [] };
    current[row.side].push(Number(row.value_numeric));
    grouped.set(row.metric_code, current);
  });
  return comparisonMetrics.flatMap((code) => {
    const values = grouped.get(code);
    return values && values.home.length && values.away.length ? [{ code, label: values.label, valueType: values.valueType, home: average(values.home), away: average(values.away) }] : [];
  });
}

function aggregatePlayerHistory(rows: PlayerHistory[], metric?: PlayerChartMetric, includeYear = false, language: Language = "en"): PlayerChartPoint[] {
  const grouped = new Map<string, PlayerHistory[]>();
  rows.forEach((row) => grouped.set(row.match_id, [...(grouped.get(row.match_id) ?? []), row]));
  return [...grouped.values()]
    .filter((matchRows) => !metric?.minimumMatchMinutes
      || Number(matchRows[0]?.minutes_played ?? 0) >= metric.minimumMatchMinutes)
    .map((matchRows, index): PlayerChartPoint => {
    const row = matchRows[0];
    const metricValue = (code?: string | null) => {
      if (!code) return null;
      const values = matchRows
        .filter((item) => item.metric_code === code && item.value_numeric !== null && isUsableMetricValue(item.metric_code, Number(item.value_numeric)))
        .map((item) => Number(item.value_numeric))
        .filter(Number.isFinite);
      return values.length ? average(values) : null;
    };
    const isRatioMetric = metric?.value_type === "percentage"
      && Boolean(metric.numerator_metric_code)
      && Boolean(metric.denominator_metric_code);
    const observedNumerator = metricValue(metric?.numerator_metric_code);
    const observedDenominator = metricValue(metric?.denominator_metric_code);
    const numerator = isRatioMetric ? observedNumerator ?? 0 : observedNumerator;
    const denominator = isRatioMetric ? observedDenominator ?? 0 : observedDenominator;
    const observedValue = metricValue(metric?.code ?? row.metric_code);
    const value = isRatioMetric
      ? denominator !== null && denominator > 0 ? Number(numerator) * 100 / denominator : null
      : metric?.value_type === "count" ? observedValue ?? 0 : observedValue;
    return {
      match: index + 1,
      matchId: row.match_id,
      scheduledAt: row.scheduled_at,
      date: formatPlayerHistoryDate(row.scheduled_at, includeYear, language),
      value,
      opponent: cleanTeamName(row.opponent_team_name ?? textByLanguage[language].opponent),
      opponentTeamId: row.opponent_team_id,
      score: formatScore(row.home_score, row.away_score),
      minutes: row.minutes_played === null ? null : Number(row.minutes_played),
      numerator,
      denominator,
    };
  });
}

function summarizePlayerAttribute(historyRows: PlayerHistory[], metric: PlayerChartMetric): PlayerAttributeSummary {
  const points = aggregatePlayerHistory(historyRows, metric);
  const observedCodes = new Set([
    metric.code,
    metric.numerator_metric_code,
    metric.denominator_metric_code,
  ].filter((code): code is string => Boolean(code)));
  const eligibleHistoryRows = metric.minimumMatchMinutes
    ? historyRows.filter((row) => Number(row.minutes_played ?? 0) >= metric.minimumMatchMinutes!)
    : historyRows;
  const hasObservation = eligibleHistoryRows.some((row) => observedCodes.has(row.metric_code)
    && row.value_numeric !== null
    && isUsableMetricValue(row.metric_code, Number(row.value_numeric)));
  const values = points.map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value));
  const totalMinutes = points.reduce((total, point) => total + Number(point.minutes ?? 0), 0);
  const totalValue = values.reduce((total, value) => total + value, 0);
  const numerator = points.reduce((total, point) => total + Number(point.numerator ?? 0), 0);
  const denominator = points.reduce((total, point) => total + Number(point.denominator ?? 0), 0);
  const isPaired = metric.chartMode === "paired"
    && Boolean(metric.numerator_metric_code)
    && Boolean(metric.denominator_metric_code);

  let value = "-";
  let comparisonValue: number | null = null;
  if (hasObservation && metric.normalization === "per90" && totalMinutes > 0) {
    comparisonValue = isPaired ? numerator * 90 / totalMinutes : totalValue * 90 / totalMinutes;
    value = isPaired
      ? formatMetricRatio(numerator * 90 / totalMinutes, denominator * 90 / totalMinutes)
      : formatMetric(totalValue * 90 / totalMinutes);
  } else if (hasObservation && isPaired && points.length) {
    comparisonValue = numerator;
    value = formatMetricRatio(numerator, denominator);
  } else if (hasObservation && metric.value_type === "percentage" && values.length) {
    const weightedValue = denominator > 0 ? numerator * 100 / denominator : average(values);
    comparisonValue = weightedValue;
    value = formatMetric(weightedValue, "percentage");
  } else if (hasObservation && metric.value_type === "count" && points.length) {
    comparisonValue = totalValue;
    value = formatMetric(totalValue);
  } else if (hasObservation && values.length) {
    comparisonValue = average(values);
    value = formatMetric(comparisonValue, metric.value_type);
  }

  return {
    chartKey: metric.chartKey,
    name: metric.name,
    category: playerAttributeCategory(metric),
    value,
    comparisonValue,
  };
}

function playerComparisonClass(
  value: number | null,
  otherValue: number | null,
  metricCode: string,
) {
  if (value === null || otherValue === null) return "";
  if (Math.abs(value - otherValue) < 0.000001) return "tie";
  const lowerIsBetter = isLowerBetterMetric(metricCode);
  const isBetter = lowerIsBetter ? value < otherValue : value > otherValue;
  return isBetter ? "better" : "worse";
}

function multiPlayerRankClasses(values: (number | null)[], metricCode: string) {
  const lowerIsBetter = isLowerBetterMetric(metricCode);
  const distinctValues = [...new Set(values.filter((value): value is number => value !== null && Number.isFinite(value)))]
    .sort((a, b) => lowerIsBetter ? a - b : b - a);
  return values.map((value) => {
    if (value === null || !Number.isFinite(value)) return "";
    const rank = distinctValues.findIndex((candidate) => Math.abs(candidate - value) < 0.000001) + 1;
    if (rank === 1) return "rank-first";
    if (rank === 2) return "rank-second";
    return "rank-rest";
  });
}

function isLowerBetterMetric(metricCode: string) {
  return lowerIsBetterMetricCodes.has(leaderboardSourceMetricCode(metricCode).replace(/::paired$/, ""));
}

function playerAttributeCategory(metric: Pick<Metric, "code">): PlayerAttributeCategory {
  const code = metric.code.toLowerCase();
  if (isGoalkeepingMetricCode(code)) return "Goalkeeping";
  if (/(card|foul|penalty_committed)/.test(code)) return "Discipline";
  if (/(tackle|interception|clearance|block|error|possession_won|ball_recovery|dribbled_past)/.test(code)) return "Defending";
  if (/(pass|cross)/.test(code)) return "Passing";
  if (/(duel|dribble|touch|possession_lost|was_fouled)/.test(code)) return "Possession & duels";
  if (/(goal|assist|shot|chance|expected|xg|xa|offside|woodwork|penalty_(won|missed))/.test(code)) return "Attacking";
  return "General";
}

function isGoalkeepingMetricCode(metricCode: string) {
  return goalkeeperMetricCodes.has(metricCode.replace(/::(paired|per90)$/, ""));
}

function makeDemoHistory(playerId: string, metric?: Metric): PlayerHistory[] {
  const metricCode = metric?.code ?? "rating_365";
  return Array.from({ length: 16 }, (_, index) => {
    const denominator = 38 + index * 2;
    const percentage = 76 + Math.sin(index / 2) * 8 + index * .35;
    const numerator = Math.round(denominator * percentage / 100);
    const value = metricCode === "rating_365" ? 6.7 + Math.sin(index / 2) * .5 + index * .025
      : metric?.value_type === "percentage" ? numerator * 100 / denominator
        : 5 + Math.sin(index / 2) * 3 + index * .2;
    const base = {
      player_id: playerId,
      display_name: "Demo Player",
      season_id: "demo-season",
      competition_id: "demo-competition",
      stage_id: null,
      round_id: null,
      round_number: index + 1,
      appearance_id: `appearance-${index}`,
      team_id: "demo-team-0",
      team_name: demoClubNames[0],
      opponent_team_id: "demo-team-1",
      opponent_team_name: demoClubNames[(index + 1) % 4],
      match_id: `history-${index}`,
      scheduled_at: `2025-${String(8 + Math.floor(index / 4)).padStart(2, "0")}-${String(5 + (index % 4) * 6).padStart(2, "0")}T17:00:00Z`,
      home_score: index % 3,
      away_score: (index + 1) % 3,
      side: "home" as const,
      minutes_played: 90,
      source_id: "demo-source",
      source_code: "demo",
      source_name: "Demo",
    };
    const selected: PlayerHistory = {
      ...base,
      metric_id: metric?.metric_id ?? metricCode,
      metric_code: metricCode,
      metric_name: metric?.name ?? metricCode,
      value_type: metric?.value_type ?? "number",
      value_numeric: value,
      raw_value: metric?.value_type === "percentage" ? `${numerator}/${denominator}` : null,
    };
    if (!metric?.numerator_metric_code || !metric.denominator_metric_code) return [selected];
    return [
      selected,
      { ...selected, metric_id: metric.numerator_metric_code, metric_code: metric.numerator_metric_code, metric_name: metric.numerator_metric_code, value_type: "count", value_numeric: numerator },
      { ...selected, metric_id: metric.denominator_metric_code, metric_code: metric.denominator_metric_code, metric_name: metric.denominator_metric_code, value_type: "count", value_numeric: denominator },
    ];
  }).flat();
}

function readViewFromHash(): View {
  const value = window.location.hash.replace("#", "") as View;
  return navItems.some((item) => item.id === value) ? value : "overview";
}

function readLanguage(): Language {
  try {
    return window.localStorage.getItem("kadurdata-language") === "en" ? "en" : "he";
  } catch {
    return "he";
  }
}

function preferredMetric(metrics: Metric[]) {
  return metrics.find((metric) => metric.code === "rating_365")?.code
    ?? metrics.find((metric) => metric.code === "pass_completion_pct")?.code
    ?? metrics[0]?.code
    ?? "";
}

function percentageMetricGroupName(metric: Metric) {
  const baseCode = metric.denominator_metric_code?.replace(/_attempted$/, "");
  return baseCode ? humanizeMetricCode(baseCode) : metric.name.replace(/\s+(Pct|Percentage)$/i, "");
}

function ratioComponentLabel(code: string | null | undefined, language: Language) {
  const localized = ratioPartName(code, language);
  if (localized) return localized;
  if (!code) return "Value";
  if (code.endsWith("_completed")) return "Completed";
  if (code.endsWith("_attempted")) return "Attempted";
  if (code.endsWith("_won")) return "Won";
  if (code.startsWith("successful_")) return "Successful";
  return humanizeMetricCode(code);
}

function humanizeMetricCode(code: string) {
  return code.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function localizedShotPlayer(shot: MatchShot, language: Language) {
  return language === "he" ? shot.display_name_he || shot.display_name || textByLanguage.he.unknownPlayer : shot.display_name || textByLanguage.en.unknownPlayer;
}

function localizedShotOutcome(
  outcome: string | null,
  text: Pick<ReturnType<typeof useLocale>["text"], "shotGoal" | "shotSaved" | "shotBlocked" | "shotMissed" | "shotPost">,
) {
  if (outcome === "Goal") return text.shotGoal;
  if (outcome === "Saved") return text.shotSaved;
  if (outcome === "Blocked") return text.shotBlocked;
  if (outcome === "Missed") return text.shotMissed;
  if (outcome === "Post") return text.shotPost;
  return outcome ?? "-";
}

function shotOutcomeClass(outcome: string | null) {
  return `outcome-${(outcome ?? "unknown").toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

function clampCoordinate(value: number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(98.5, Math.max(1.5, numeric)) : 50;
}

function specificPositionDetail(position?: string | null): PlayerPositionDetail | null {
  const normalized = position?.trim().toLowerCase();
  if (!normalized) return null;
  const known = specificPositionDetails[normalized];
  if (known) return known;
  const label = position!.trim();
  const code = label.split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return { code: code || "Other", label };
}

function isManagementPlayer(player: SeasonPlayer) {
  const position = `${player.primary_position ?? ""} ${player.specific_position ?? ""}`.toLowerCase();
  return /\b(?:coach|manager|management|staff)\b/.test(position);
}

function playerPositionDetail(player: SeasonPlayer): PlayerPositionDetail {
  const specific = specificPositionDetail(player.specific_position);
  if (specific) return specific;
  if (player.role_group === "Goalkeepers") return { code: "GK", label: "Goalkeeper" };
  if (player.role_group === "Defenders") return { code: "DEF", label: "Defender" };
  if (player.role_group === "Midfielders") return { code: "MID", label: "Midfielder" };
  if (player.role_group === "Attackers") return { code: "FWD", label: "Forward" };
  return { code: "Other", label: player.primary_position || "Other" };
}

function playerPositionFilterDetail(player: SeasonPlayer): PlayerPositionDetail {
  return specificPositionDetail(player.specific_position) ?? { code: "Other", label: "Other" };
}

function demoSpecificPosition(role: string, index: number) {
  const positions: Record<string, string[]> = {
    Goalkeepers: ["Goalkeeper"],
    Defenders: ["Left Back", "Centre Back", "Right Back"],
    Midfielders: ["Defensive Midfield", "Central Midfield", "Attacking Midfield"],
    Attackers: ["Left Forward", "Centre Forward", "Right Forward"],
  };
  const options = positions[role] ?? [];
  return options.length ? options[index % options.length] : null;
}

function competitionLabel(name?: string) {
  return name?.toLowerCase().includes("israeli premier") ? "Ligat Ha'Al" : name ?? "Competition";
}

function hasOfficialLeagueTable(competition?: Competition) {
  return Boolean(competition && (competition.scope || "domestic") === "domestic" && competition.competition_type === "league");
}

const hebrewCompetitionNames: Record<string, string> = {
  "division 3": "ליגה א׳",
  "division 4": "ליגה ב׳",
  "fa cup": "גביע המדינה",
  "israeli premier league": "ליגת העל",
  "liga leumit": "הליגה הלאומית",
  "premier league": "ליגת העל",
  "super cup": "אלוף האלופים",
  "toto cup national league": "גביע הטוטו לאומית",
  "toto league cup": "גביע הטוטו",
  "youth cup": "גביע המדינה לנוער",
  "youth league": "ליגת העל לנוער",
  "euro": "אליפות אירופה",
  "euro u17": "אליפות אירופה עד גיל 17",
  "euro u17 qualification": "מוקדמות אליפות אירופה עד גיל 17",
  "euro u19": "אליפות אירופה עד גיל 19",
  "euro u19 qualification": "מוקדמות אליפות אירופה עד גיל 19",
  "euro u21": "אליפות אירופה עד גיל 21",
  "euro u21 qualification": "מוקדמות אליפות אירופה עד גיל 21",
  "european qualifiers": "מוקדמות אליפות אירופה",
  "fifa series": "סדרת פיפ״א",
  "fifa series (w)": "סדרת פיפ״א לנשים",
  "fifa world cup": "גביע העולם",
  "friendly international": "משחקי ידידות בינלאומיים",
  "friendly women": "משחקי ידידות בינלאומיים לנשים",
  "olympics football - men": "הטורניר האולימפי לגברים",
  "olympics football - women": "הטורניר האולימפי לנשים",
  "u17 friendly international": "משחקי ידידות עד גיל 17",
  "u17 world cup": "גביע העולם עד גיל 17",
  "u18 friendly international": "משחקי ידידות עד גיל 18",
  "u19 friendly international": "משחקי ידידות עד גיל 19",
  "u20 friendly international": "משחקי ידידות עד גיל 20",
  "u20 world cup": "גביע העולם עד גיל 20",
  "u21 friendly international": "משחקי ידידות עד גיל 21",
  "u23 friendly international": "משחקי ידידות עד גיל 23",
  "uefa champions league": "ליגת האלופות",
  "uefa champions league qualifiers": "מוקדמות ליגת האלופות",
  "uefa conference league": "הקונפרנס ליג",
  "uefa europa league": "הליגה האירופית",
  "uefa europa league qualifiers": "מוקדמות הליגה האירופית",
  "uefa nations league": "ליגת האומות",
  "uefa nations league women": "ליגת האומות לנשים",
  "uefa super cup": "הסופר קאפ האירופי",
  "uefa wc qualification": "מוקדמות גביע העולם באירופה",
  "uefa women wc qualifiers": "מוקדמות גביע העולם לנשים באירופה",
  "uefa women's champions league": "ליגת האלופות לנשים",
  "uefa women's euro": "אליפות אירופה לנשים",
  "uefa women's euro qualification": "מוקדמות אליפות אירופה לנשים",
  "uefa women's europa cup": "גביע אירופה לנשים",
  "uefa youth league": "ליגת האלופות לנוער",
  "women u17 world cup": "גביע העולם לנשים עד גיל 17",
  "women's premier league": "ליגת העל לנשים",
  "women's world cup": "גביע העולם לנשים",
  "world cup playoff tournament": "פלייאוף גביע העולם",
  "world cup women u20": "גביע העולם לנשים עד גיל 20",
};

const hebrewTeamNames: Record<string, string> = {
  "beitar jerusalem": "בית״ר ירושלים",
  "bnei sakhnin": "בני סכנין",
  "hapoel acre": "הפועל עכו",
  "hapoel ashkelon": "הפועל אשקלון",
  "hapoel be'er sheva": "הפועל באר שבע",
  "hapoel bnei lod": "הפועל בני לוד",
  "hapoel hadera": "הפועל חדרה",
  "hapoel haifa": "הפועל חיפה",
  "hapoel ironi kiryat shmona": "הפועל קריית שמונה",
  "hapoel ironi rishon lezion": "הפועל ראשון לציון",
  "hapoel jerusalem": "הפועל ירושלים",
  "hapoel kafr qasim": "מ.ס. כפר קאסם",
  "hapoel kfar saba": "הפועל כפר סבא",
  "hapoel nof hagalil": "הפועל נוף הגליל",
  "hapoel petah tikva": "הפועל פתח תקווה",
  "hapoel raanana": "הפועל רעננה",
  "hapoel ra'anana": "הפועל רעננה",
  "hapoel ra'anana afc": "הפועל רעננה",
  "hapoel ramat gan": "הפועל רמת גן",
  "hapoel ramat gan giv'atayim": "הפועל רמת גן",
  "hapoel tel aviv": "הפועל תל אביב",
  "ironi tiberias": "עירוני טבריה",
  "maccabi bnei raina": "מכבי בני ריינה",
  "maccabi haifa": "מכבי חיפה",
  "maccabi ahi nazareth": "מכבי אחי נצרת",
  "maccabi herzliya": "מכבי הרצליה",
  "maccabi netanya": "מכבי נתניה",
  "maccabi petah tikva": "מכבי פתח תקווה",
  "maccabi tel aviv": "מכבי תל אביב",
  "ms kfar kassem": "מ.ס. כפר קאסם",
  "sc ashdod": "מ.ס. אשדוד",
  "sektzia ness ziona": "סקציה נס ציונה",
  "bnei yehuda tel aviv": "בני יהודה תל אביב",
  "israel": "ישראל",
  "israel (w)": "נבחרת ישראל נשים",
  "israel national team": "ישראל",
  "israel national team (w)": "נבחרת ישראל נשים",
  "israel u17": "נבחרת ישראל עד גיל 17",
  "israel u17 national team": "נבחרת ישראל עד גיל 17",
  "israel u18": "נבחרת ישראל עד גיל 18",
  "israel u18 national team": "נבחרת ישראל עד גיל 18",
  "israel u19": "נבחרת ישראל עד גיל 19",
  "israel u19 national team": "נבחרת ישראל עד גיל 19",
  "israel u20": "נבחרת ישראל עד גיל 20",
  "israel u20 national team": "נבחרת ישראל עד גיל 20",
  "israel u21": "נבחרת ישראל עד גיל 21",
  "israel u21 national team": "נבחרת ישראל עד גיל 21",
  "israel u23": "הנבחרת האולימפית של ישראל",
  "israel u23 national team": "הנבחרת האולימפית של ישראל",
  "israel women": "נבחרת ישראל נשים",
  "israel women national team": "נבחרת ישראל נשים",
};

function hebrewCompetitionName(name: string) {
  const normalized = name.trim().toLowerCase();
  return hebrewCompetitionNames[normalized]
    ?? (normalized.includes("premier") ? "ליגת העל" : name);
}

function hebrewTeamName(name: string) {
  const cleaned = cleanTeamName(name);
  return hebrewTeamNames[cleaned.toLowerCase()] ?? cleaned;
}

function localizedCompetition(competition: Competition | undefined, language: Language) {
  if (!competition) return language === "he" ? "מפעל" : "Competition";
  if (language === "he") {
    return competition.name_he ?? hebrewCompetitionName(competition.name);
  }
  return competitionLabel(competition.name);
}

function localizedSeasonCompetition(season: Season, language: Language) {
  if (language === "he") {
    return season.competition_name_he ?? hebrewCompetitionName(season.competition_name);
  }
  return competitionLabel(season.competition_name);
}

function localizedMatchCompetition(match: Match, language: Language) {
  if (language === "he") {
    return match.competition_name_he ?? hebrewCompetitionName(match.competition_name);
  }
  return competitionLabel(match.competition_name);
}

function localizedClubName(club: Club, language: Language) {
  return language === "he" && club.team_name_he
    ? club.team_name_he
    : language === "he" ? hebrewTeamName(club.team_name) : cleanTeamName(club.team_name);
}

function localizedClubById(
  clubs: Club[],
  teamId: string | null,
  fallback: string | null | undefined,
  language: Language,
) {
  const club = clubs.find((item) => item.team_id === teamId);
  if (club) return localizedClubName(club, language);
  return fallback ? language === "he" ? hebrewTeamName(fallback) : cleanTeamName(fallback) : "";
}

function localizedMatchTeam(match: Match, side: "home" | "away", language: Language) {
  const englishName = side === "home" ? match.home_team_name : match.away_team_name;
  const hebrewName = side === "home" ? match.home_team_name_he : match.away_team_name_he;
  return language === "he" ? hebrewName ?? hebrewTeamName(englishName) : cleanTeamName(englishName);
}

function localizedPlayerName(player: SeasonPlayer | undefined, fallback: string, language: Language) {
  return language === "he" && player?.display_name_he ? player.display_name_he : fallback;
}

function localizedPlayerPosition(player: SeasonPlayer, language: Language): PlayerPositionDetail {
  const detail = playerPositionDetail(player);
  return { ...detail, label: positionName(detail.code, detail.label, language) };
}

function localizedFormationPosition(value: string | null | undefined, language: Language) {
  const detail = specificPositionDetail(value);
  return detail ? positionName(detail.code, detail.label, language) : value ?? "";
}

function localizedRoleName(role: RoleFilter, language: Language) {
  if (language === "en") return role === "All" ? "All positions" : role;
  return ({
    All: "כל העמדות",
    Goalkeepers: "שוערים",
    Defenders: "שחקני הגנה",
    Midfielders: "קשרים",
    Attackers: "שחקני התקפה",
    Other: "אחר",
  } as Record<RoleFilter, string>)[role];
}

function localizedResult(result: string, language: Language) {
  if (language === "en") return result;
  return ({ W: "נ", D: "ת", L: "ה", "-": "-" } as Record<string, string>)[result] ?? result;
}

function latestSeasonWithData(seasons: Season[]) {
  const orderedSeasons = [...seasons].sort((a, b) => dateValue(b.start_date) - dateValue(a.start_date));
  return orderedSeasons.find((season) => Number(season.completed_match_count) > 0)
    ?? orderedSeasons.find((season) => season.is_latest)
    ?? orderedSeasons[0];
}

function roleLabel(role: RoleFilter, language: Language) {
  if (role === "All") return language === "he" ? "הכול" : "All";
  if (role === "Other") return language === "he" ? "אחר" : "Other";
  return ({ Goalkeepers: "GK", Defenders: "DEF", Midfielders: "MID", Attackers: "FWD" } as Record<string, string>)[role];
}

function compareLeaderboardRows(a: PlayerLeaderboardRow, b: PlayerLeaderboardRow, metricCode: string) {
  const lowerIsBetter = isLowerBetterMetric(metricCode);
  const missingValue = lowerIsBetter ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const aNumericValue = Number(a.leaderboard_value);
  const bNumericValue = Number(b.leaderboard_value);
  const aValue = a.leaderboard_value === null || !Number.isFinite(aNumericValue) ? missingValue : aNumericValue;
  const bValue = b.leaderboard_value === null || !Number.isFinite(bNumericValue) ? missingValue : bNumericValue;
  const aSecondary = a.value_type === "percentage" ? Number(a.denominator_value ?? 0) : Number(a.sample_size);
  const bSecondary = b.value_type === "percentage" ? Number(b.denominator_value ?? 0) : Number(b.sample_size);
  return (lowerIsBetter ? aValue - bValue : bValue - aValue)
    || bSecondary - aSecondary
    || a.display_name.localeCompare(b.display_name);
}

function getLeaderboardQualification(metric?: LeaderboardMetricOption): LeaderboardQualification | null {
  if (metric?.code.endsWith("::per90")) {
    return { source: "minutes", unit: "minutes", defaultValue: 450, step: 90 };
  }
  if (metric?.value_type === "percentage") {
    return {
      source: "denominator",
      unit: percentageQualificationUnit(metric.denominator_metric_code),
      defaultValue: defaultPercentageQualification(metric.denominator_metric_code),
      step: 1,
    };
  }
  if (metric && ["rating", "average", "ratio"].includes(metric.value_type)) {
    return { source: "matches", unit: "matches", defaultValue: 5, step: 1 };
  }
  return null;
}

function defaultPercentageQualification(denominatorCode: string | null) {
  if (denominatorCode === "passes_attempted") return 100;
  if (denominatorCode === "long_passes_attempted") return 25;
  if (denominatorCode === "ground_duels_attempted" || denominatorCode === "aerial_duels_attempted") return 20;
  return 10;
}

function percentageQualificationUnit(denominatorCode: string | null) {
  return denominatorCode ? denominatorCode.replace(/_attempted$/, "").replace(/_/g, " ") : "attempts";
}

function filterLeaderboardRows(
  rows: PlayerLeaderboardRow[],
  players: SeasonPlayer[],
  qualification: LeaderboardQualification | null,
  minimum: number,
) {
  if (!qualification) return rows;

  const minutesByPlayer = new Map(players.map((player) => [player.player_id, Number(player.minutes)]));
  return rows.filter((row) => {
    const sample = qualification.source === "minutes"
      ? minutesByPlayer.get(row.player_id) ?? 0
      : qualification.source === "denominator"
        ? Number(row.denominator_value ?? 0)
        : Number(row.sample_size);
    return sample >= minimum;
  });
}

function leaderboardSampleLabel(
  row: PlayerLeaderboardRow,
  qualification: LeaderboardQualification | null,
  minutesByPlayer: Map<string, number>,
  language: Language,
) {
  if (row.value_type === "currency") {
    return row.valuation_date
      ? `${textByLanguage[language].valuationAsOf} ${formatValuationDate(row.valuation_date, language)}`
      : "";
  }
  const aggregation = language === "he"
    ? ({ total: "סך הכול", average: "ממוצע", weighted: "משוקלל", latest: "עדכני" } as Record<string, string>)[row.aggregation]
    : row.aggregation;
  return qualification?.source === "minutes"
    ? `${aggregation} · ${numberFormatter.format(minutesByPlayer.get(row.player_id) ?? 0)} ${textByLanguage[language].minutes}`
    : `${aggregation} · ${row.sample_size} ${language === "he" ? "משחקים" : "matches"}`;
}

function explorerRankingSampleLabel(
  row: PlayerLeaderboardRow,
  player: SeasonPlayer,
  qualification: LeaderboardQualification | null,
  language: Language,
) {
  if (row.value_type === "currency") {
    return row.valuation_date
      ? `${textByLanguage[language].valuationAsOf} ${formatValuationDate(row.valuation_date, language)}`
      : "";
  }
  if (qualification?.source === "minutes") return `${numberFormatter.format(Math.round(Number(player.minutes)))} ${language === "he" ? "דק׳" : "min"}`;
  if (qualification?.source === "denominator") {
    return `${numberFormatter.format(Math.round(Number(row.denominator_value ?? 0)))} ${qualificationUnit(qualification.unit, language)}`;
  }
  if (qualification?.source === "matches") return `${numberFormatter.format(row.sample_size)} ${language === "he" ? "משחקים" : "matches"}`;
  return row.aggregation === "total"
    ? textByLanguage[language].seasonTotal
    : `${numberFormatter.format(row.sample_size)} ${language === "he" ? "משחקים" : "matches"}`;
}

function leaderboardSourceMetricCode(metricCode: string) {
  return metricCode.replace(/::(?:per90|full90)$/, "");
}

function isValuationMetricCode(metricCode: string) {
  return leaderboardSourceMetricCode(metricCode) === "current_valuation";
}

function isRatingMetricCode(metricCode: string) {
  return leaderboardSourceMetricCode(metricCode) === "rating_365";
}

function isFull90RatingMetricCode(metricCode: string) {
  return metricCode === "rating_365::full90";
}

function ratingMinimumForMetric(metricCode: string, configuredMinimum: number) {
  if (isFull90RatingMetricCode(metricCode)) return 90;
  return isRatingMetricCode(metricCode) ? configuredMinimum : 0;
}

function hasConfigurableRatingMinimum(metricCode: string) {
  return isRatingMetricCode(metricCode) && !isFull90RatingMetricCode(metricCode);
}

function prepareLeaderboardRows(rows: PlayerLeaderboardRow[], players: SeasonPlayer[], metricCode: string) {
  const completeRows = isValuationMetricCode(metricCode)
    ? completeValuationLeaderboard(rows, players)
    : rows;
  const roleByPlayer = new Map(players.map((player) => [player.player_id, player.role_group]));
  const eligibleRows = isGoalkeepingMetricCode(metricCode)
    ? completeRows.filter((row) => roleByPlayer.get(row.player_id) === "Goalkeepers")
    : completeRows;
  if (!metricCode.endsWith("::per90")) return [...eligibleRows].sort((a, b) => compareLeaderboardRows(a, b, metricCode));

  const minutesByPlayer = new Map(players.map((player) => [player.player_id, Number(player.minutes)]));
  return eligibleRows.map((row): PlayerLeaderboardRow => {
    const minutes = minutesByPlayer.get(row.player_id) ?? 0;
    const total = row.total_value === null ? Number(row.leaderboard_value) : Number(row.total_value);
    const value = minutes > 0 && Number.isFinite(total) ? total * 90 / minutes : null;
    return {
      ...row,
      metric_code: metricCode,
      metric_name: `${row.metric_name} (90 min)`,
      value_type: "rate",
      aggregation: "weighted",
      leaderboard_value: value,
      average_value: value,
    };
  }).sort((a, b) => compareLeaderboardRows(a, b, metricCode));
}

function completeValuationLeaderboard(rows: PlayerLeaderboardRow[], players: SeasonPlayer[]) {
  const representedPlayerIds = new Set(rows.map((row) => row.player_id));
  return [
    ...rows,
    ...players.filter((player) => !representedPlayerIds.has(player.player_id)).map((player): PlayerLeaderboardRow => ({
      season_id: player.season_id,
      player_id: player.player_id,
      display_name: player.display_name,
      team_id: player.team_id,
      team_name: player.team_name,
      metric_id: "current_valuation",
      metric_code: "current_valuation",
      metric_name: "Estimated transfer value",
      value_type: "currency",
      aggregation: "latest",
      sample_size: 0,
      leaderboard_value: null,
      total_value: null,
      average_value: null,
      numerator_value: null,
      denominator_value: null,
      currency: null,
      valuation_date: null,
    })),
  ];
}

function makeSeasonSummaryLeaderboard(players: SeasonPlayer[], seasonId: string, metricCode: string) {
  const metric = seasonLeaderboardMetrics.find((item) => item.code === metricCode) ?? seasonLeaderboardMetrics[0];
  return players.map((player): PlayerLeaderboardRow => {
    const value = metric.code === "season_starts" ? Number(player.starts)
      : metric.code === "season_minutes" ? Number(player.minutes)
        : Number(player.appearances);
    return {
      season_id: seasonId,
      player_id: player.player_id,
      display_name: player.display_name,
      team_id: player.team_id,
      team_name: player.team_name,
      metric_id: metric.code,
      metric_code: metric.code,
      metric_name: metric.name,
      value_type: metric.value_type,
      aggregation: "total",
      sample_size: Number(player.appearances),
      leaderboard_value: value,
      total_value: value,
      average_value: null,
      numerator_value: null,
      denominator_value: null,
    };
  }).sort((a, b) => compareLeaderboardRows(a, b, metricCode));
}

function makeDemoLeaderboard(players: SeasonPlayer[], seasonId: string, metricCode: string) {
  const sourceMetricCode = leaderboardSourceMetricCode(metricCode);
  const metric = demoMetrics.find((item) => item.code === sourceMetricCode) ?? demoMetrics[0];
  const averages = [88.4, 84.9, 86.1, 82.7, 79.8];
  const rows = players.map((player, index): PlayerLeaderboardRow => {
    const value = metric.code === "goals" ? Number(player.goals)
      : metric.code === "assists" ? Number(player.assists)
        : metric.code === "rating_365" ? Number(player.average_rating)
          : metric.code === "pass_completion_pct" ? averages[index % averages.length]
            : Number(player.goals) * 3 + 18 - index;
    const denominator = metric.value_type === "percentage" ? 300 + index * 24 : null;
    const numerator = denominator === null ? null : Math.round(denominator * value / 100);
    const aggregation = metric.value_type === "percentage" ? "weighted" : ["rating", "average", "ratio"].includes(metric.value_type) ? "average" : "total";
    return {
      season_id: seasonId,
      player_id: player.player_id,
      display_name: player.display_name,
      team_id: player.team_id,
      team_name: player.team_name,
      metric_id: metric.metric_id,
      metric_code: metric.code,
      metric_name: metric.name,
      value_type: metric.value_type,
      aggregation,
      sample_size: Number(player.appearances),
      leaderboard_value: value,
      total_value: aggregation === "total" ? value : null,
      average_value: aggregation === "average" ? value : null,
      numerator_value: numerator,
      denominator_value: denominator,
    };
  });
  return prepareLeaderboardRows(rows, players, metricCode);
}

function cleanTeamName(name: string) {
  return name.replace(/\s+FC$/i, "").replace(/^Ihoud\s+/i, "");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function friendlyMetric(name: string) {
  return name.replace(/^Team\s+/i, "");
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function dateValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function formatNumber(value: number | string) {
  return numberFormatter.format(Math.round(Number(value)));
}

function formatValuation(value: number, currency: string, language: Language) {
  return new Intl.NumberFormat(localeCode(language), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatLeaderboardValue(row: PlayerLeaderboardRow, language: Language) {
  if (row.value_type === "currency" && row.leaderboard_value !== null) {
    return formatValuation(Number(row.leaderboard_value), row.currency ?? "EUR", language);
  }
  return formatMetricWithRatio(
    row.leaderboard_value,
    row.value_type,
    row.numerator_value,
    row.denominator_value,
  );
}

function formatValuationDate(value: string, language: Language, short = false) {
  return new Intl.DateTimeFormat(localeCode(language), {
    month: "short",
    year: short ? "2-digit" : "numeric",
    day: short ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatMetric(value: number | null | undefined, valueType?: string) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  const formatted = Number.isInteger(numeric) ? numberFormatter.format(numeric) : numeric.toFixed(numeric < 10 ? 2 : 1);
  return valueType === "percentage" ? `${formatted}%` : formatted;
}

function formatMetricRatio(numerator: number | null | undefined, denominator: number | null | undefined) {
  return `\u2066${formatMetric(numerator)} / ${formatMetric(denominator)}\u2069`;
}

function formatMetricWithRatio(
  value: number | null | undefined,
  valueType?: string,
  numerator?: number | null,
  denominator?: number | null,
) {
  const formatted = formatMetric(value, valueType);
  if (
    valueType !== "percentage"
    || numerator === null
    || numerator === undefined
    || denominator === null
    || denominator === undefined
    || !Number.isFinite(Number(numerator))
    || !Number.isFinite(Number(denominator))
  ) return formatted;
  return `${formatted} (${formatMetricRatio(Number(numerator), Number(denominator))})`;
}

function formatShortDate(value: string | null, language: Language = "en") {
  return value ? new Intl.DateTimeFormat(localeCode(language), { day: "2-digit", month: "short" }).format(new Date(value)) : "-";
}

function formatPlayerHistoryDate(value: string | null, includeYear: boolean, language: Language = "en") {
  return value
    ? new Intl.DateTimeFormat(localeCode(language), { day: "2-digit", month: "short", year: includeYear ? "2-digit" : undefined }).format(new Date(value))
    : "-";
}

function formatFixtureDate(value: string | null, language: Language = "en") {
  return value
    ? new Intl.DateTimeFormat(localeCode(language), { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value))
    : textByLanguage[language].dateTbd;
}

function formatLongDate(value: string | null, language: Language = "en") {
  return value
    ? new Intl.DateTimeFormat(localeCode(language), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : textByLanguage[language].dateTbd;
}

function formatDateRange(start?: string | null, end?: string | null, language: Language = "en") {
  if (!start) return textByLanguage[language].datesTbd;
  if (!end || formatShortDate(start, language) === formatShortDate(end, language)) return formatShortDate(start, language);
  return `${formatShortDate(start, language)} – ${formatShortDate(end, language)}`;
}

function formatScore(home: number | null, away: number | null) {
  const validHome = normalizedMatchScore(home);
  const validAway = normalizedMatchScore(away);
  return validHome === null || validAway === null ? "-" : `${validHome}:${validAway}`;
}

function isCompletedMatch(match: Match) {
  return normalizedMatchScore(match.home_score) !== null && normalizedMatchScore(match.away_score) !== null;
}

function aggregateClubRecord(club: Club, matches: Match[]): Club {
  const record = matches.filter(isCompletedMatch).reduce((totals, match) => {
    const isHome = match.home_team_id === club.team_id;
    const goalsFor = Number(isHome ? match.home_score : match.away_score);
    const goalsAgainst = Number(isHome ? match.away_score : match.home_score);
    totals.played += 1;
    totals.goalsFor += goalsFor;
    totals.goalsAgainst += goalsAgainst;
    if (goalsFor > goalsAgainst) totals.won += 1;
    else if (goalsFor < goalsAgainst) totals.lost += 1;
    else totals.drawn += 1;
    return totals;
  }, { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });

  return {
    ...club,
    played: record.played,
    won: record.won,
    drawn: record.drawn,
    lost: record.lost,
    goals_for: record.goalsFor,
    goals_against: record.goalsAgainst,
    goal_difference: record.goalsFor - record.goalsAgainst,
    points: 0,
  };
}

function normalizedMatchScore(score: number | null) {
  return score !== null && score >= 0 ? score : null;
}

function displayMatchScore(score: number | null) {
  return normalizedMatchScore(score) ?? "-";
}

function clubResult(match: Match, clubId: string) {
  if (!isCompletedMatch(match)) return "-";
  const isHome = match.home_team_id === clubId;
  const clubScore = isHome ? Number(match.home_score) : Number(match.away_score);
  const opponentScore = isHome ? Number(match.away_score) : Number(match.home_score);
  return clubScore > opponentScore ? "W" : clubScore < opponentScore ? "L" : "D";
}
