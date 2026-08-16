import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListFilter,
  Loader2,
  RefreshCcw,
  Search,
  Shield,
  Users,
} from "lucide-react";
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
import type {
  Club,
  Competition,
  Match,
  MatchPlayerStat,
  MatchTeamStat,
  Metric,
  PlayerLeaderboardRow,
  PlayerHistory,
  Round,
  Season,
  SeasonPlayer,
  TeamAsset,
} from "./lib/types";

type View = "overview" | "matches" | "clubs" | "players";
type RoleFilter = "All" | SeasonPlayer["role_group"];
type PlayerHistoryRange = "latest" | "all";
type PlayerPivot = MatchPlayerStat & { values: Record<string, number> };
type LeaderboardMetricOption = Pick<Metric, "code" | "name" | "value_type" | "denominator_metric_code"> & { kind: "season" | "match" };
type LeaderboardQualification = {
  source: "minutes" | "denominator" | "matches";
  unit: string;
  defaultValue: number;
  step: number;
};
type PlayerChartMetric = Metric & {
  chartKey: string;
  chartMode: "single" | "paired";
  normalization: "raw" | "per90";
};
type PlayerChartPoint = {
  match: number;
  date: string;
  value: number | null;
  opponent: string;
  score: string;
  minutes: number | null;
  numerator: number | null;
  denominator: number | null;
};
type PlayerAttributeSummary = {
  chartKey: string;
  name: string;
  category: PlayerAttributeCategory;
  value: string;
};
type PlayerAttributeCategory = (typeof playerAttributeCategories)[number];
type PlayerPositionDetail = { code: string; label: string };

const numberFormatter = new Intl.NumberFormat("en-US");
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
const specificPositionDetails: Record<string, PlayerPositionDetail> = {
  "goalkeeper": { code: "GK", label: "Goalkeeper" },
  "left back": { code: "LB", label: "Left Back" },
  "left wing back": { code: "LWB", label: "Left Wing Back" },
  "centre back": { code: "CB", label: "Centre Back" },
  "center back": { code: "CB", label: "Centre Back" },
  "right back": { code: "RB", label: "Right Back" },
  "right wing back": { code: "RWB", label: "Right Wing Back" },
  "left midfield": { code: "LM", label: "Left Midfield" },
  "defensive midfield": { code: "DM", label: "Defensive Midfield" },
  "central midfield": { code: "CM", label: "Central Midfield" },
  "attacking midfield": { code: "AM", label: "Attacking Midfield" },
  "right midfield": { code: "RM", label: "Right Midfield" },
  "left forward": { code: "LW", label: "Left Forward" },
  "left wing": { code: "LW", label: "Left Wing" },
  "secondary striker": { code: "SS", label: "Secondary Striker" },
  "centre forward": { code: "CF", label: "Centre Forward" },
  "center forward": { code: "CF", label: "Centre Forward" },
  "right forward": { code: "RW", label: "Right Forward" },
  "right wing": { code: "RW", label: "Right Wing" },
};
const positionCodeOrder = ["GK", "LB", "LWB", "CB", "RB", "RWB", "LM", "DM", "CM", "AM", "RM", "LW", "SS", "CF", "RW", "Other"];
const seasonLeaderboardMetrics: LeaderboardMetricOption[] = [
  { code: "season_appearances", name: "Appearances", value_type: "count", denominator_metric_code: null, kind: "season" },
  { code: "season_starts", name: "Starts", value_type: "count", denominator_metric_code: null, kind: "season" },
  { code: "season_minutes", name: "Minutes played", value_type: "count", denominator_metric_code: null, kind: "season" },
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
  { metric_id: "rating", code: "rating_365", name: "Rating", subject_type: "player_match", value_type: "rating", numerator_metric_code: null, denominator_metric_code: null },
  { metric_id: "passes", code: "pass_completion_pct", name: "Pass completion", subject_type: "player_match", value_type: "percentage", numerator_metric_code: "passes_completed", denominator_metric_code: "passes_attempted" },
  { metric_id: "goals", code: "goals", name: "Goals", subject_type: "player_match", value_type: "count", numerator_metric_code: null, denominator_metric_code: null },
  { metric_id: "shots", code: "total_shots", name: "Total shots", subject_type: "player_match", value_type: "count", numerator_metric_code: null, denominator_metric_code: null },
];

function isSchemaCacheMiss(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202" || error?.message?.toLowerCase().includes("schema cache") === true;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function App() {
  const [view, setView] = useState<View>(readViewFromHash);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<SeasonPlayer[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [playerHistory, setPlayerHistory] = useState<PlayerHistory[]>([]);
  const [matchPlayerStats, setMatchPlayerStats] = useState<MatchPlayerStat[]>([]);
  const [matchTeamStats, setMatchTeamStats] = useState<MatchTeamStat[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [squadLeaderboardRows, setSquadLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [explorerLeaderboardRows, setExplorerLeaderboardRows] = useState<PlayerLeaderboardRow[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [clubId, setClubId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [metricCode, setMetricCode] = useState("");
  const [playerHistoryRange, setPlayerHistoryRange] = useState<PlayerHistoryRange>("latest");
  const [leaderMetricCode, setLeaderMetricCode] = useState("goals");
  const [squadMetricCode, setSquadMetricCode] = useState("season_minutes");
  const [explorerMetricCode, setExplorerMetricCode] = useState("season_minutes");
  const [leaderMinimums, setLeaderMinimums] = useState<Record<string, number>>({});
  const [squadMinimums, setSquadMinimums] = useState<Record<string, number>>({});
  const [explorerMinimums, setExplorerMinimums] = useState<Record<string, number>>({});
  const [matchSide, setMatchSide] = useState<"home" | "away">("home");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("All");
  const [positionFilter, setPositionFilter] = useState("All");
  const [clubFilter, setClubFilter] = useState("all");
  const [playerQuery, setPlayerQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [squadLeaderboardLoading, setSquadLeaderboardLoading] = useState(false);
  const [squadLeaderboardError, setSquadLeaderboardError] = useState<string | null>(null);
  const [explorerLeaderboardLoading, setExplorerLeaderboardLoading] = useState(false);
  const [explorerLeaderboardError, setExplorerLeaderboardError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadReferenceData() {
    setLoading(true);
    setError(null);

    if (!hasSupabaseConfig || !supabase) {
      setCompetitions([demoCompetition]);
      setSeasons([demoSeason]);
      setMetrics(demoMetrics);
      setCompetitionId(demoCompetition.competition_id);
      setSeasonId(demoSeason.season_id);
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
    const defaultSeason = nextSeasons.find((item) => item.competition_id === defaultCompetition?.competition_id && item.is_latest)
      ?? nextSeasons.find((item) => item.competition_id === defaultCompetition?.competition_id);

    setCompetitions(nextCompetitions);
    setSeasons(nextSeasons);
    setMetrics(nextMetrics);
    setCompetitionId((current) => current || defaultCompetition?.competition_id || "");
    setSeasonId((current) => current || defaultSeason?.season_id || "");
    setMetricCode((current) => current || preferredMetric(nextMetrics));
    setLeaderMetricCode((current) => nextMetrics.some((metric) => metric.code === leaderboardSourceMetricCode(current)) ? current : preferredMetric(nextMetrics));
    setLoading(false);
  }

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(readViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const availableSeasons = useMemo(
    () => seasons.filter((season) => season.competition_id === competitionId),
    [competitionId, seasons],
  );

  useEffect(() => {
    if (!competitionId || availableSeasons.some((season) => season.season_id === seasonId)) return;
    const nextSeason = availableSeasons.find((season) => season.is_latest) ?? availableSeasons[0];
    setSeasonId(nextSeason?.season_id ?? "");
  }, [availableSeasons, competitionId, seasonId]);

  useEffect(() => {
    async function loadSeasonData() {
      if (!seasonId) return;
      setSeasonLoading(true);
      setError(null);

      const client = supabase;
      if (!hasSupabaseConfig || !client) {
        setRounds(demoRounds);
        setMatches(demoMatches);
        setClubs(demoClubs);
        setPlayers(demoPlayers);
        setRoundId(demoRounds[demoRounds.length - 1]?.round_id ?? "");
        setClubId(demoClubs[0]?.team_id ?? "");
        setPlayerId(demoPlayers[0]?.player_id ?? "");
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

      const [roundResult, matchResult, clubResult, playerResult, teamAssetResult] = await Promise.all([
        liveClient.from("api_rounds").select("*").eq("season_id", seasonId).order("stage_number").order("round_number"),
        liveClient.from("api_matches").select("*").eq("season_id", seasonId).order("scheduled_at"),
        liveClient.from("api_clubs").select("*").eq("season_id", seasonId).order("points", { ascending: false }),
        loadSeasonPlayers(),
        liveClient.from("api_team_assets").select("*"),
      ]);
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
      const latestPlayedRound = [...nextRounds].reverse().find((round) => round.completed_match_count > 0) ?? nextRounds[nextRounds.length - 1];

      setRounds(nextRounds);
      setMatches(nextMatches);
      setClubs(nextClubs);
      setPlayers(nextPlayers);
      setRoundId((current) => nextRounds.some((round) => round.round_id === current) ? current : latestPlayedRound?.round_id ?? "");
      setClubId((current) => nextClubs.some((club) => club.team_id === current) ? current : nextClubs[0]?.team_id ?? "");
      setPlayerId((current) => nextPlayers.some((player) => player.player_id === current) ? current : nextPlayers[0]?.player_id ?? "");
      setSeasonLoading(false);
    }

    void loadSeasonData();
  }, [refreshToken, seasonId]);

  const roundMatches = useMemo(
    () => matches.filter((match) => match.round_id === roundId),
    [matches, roundId],
  );

  useEffect(() => {
    setMatchId((current) => roundMatches.some((match) => match.match_id === current) ? current : roundMatches[0]?.match_id ?? "");
  }, [roundMatches]);

  useEffect(() => {
    async function loadMatchDetail() {
      if (!matchId) {
        setMatchPlayerStats([]);
        setMatchTeamStats([]);
        return;
      }
      if (!hasSupabaseConfig || !supabase) return;
      setDetailLoading(true);
      const [playersResult, teamsResult] = await Promise.all([
        supabase
          .from("api_match_player_stats")
          .select("*")
          .eq("match_id", matchId)
          .in("metric_code", matchPlayerMetrics)
          .limit(1000),
        supabase.from("api_match_team_stats").select("*").eq("match_id", matchId).limit(500),
      ]);
      const firstError = playersResult.error ?? teamsResult.error;
      if (firstError) setError(firstError.message);
      setMatchPlayerStats((playersResult.data ?? []) as MatchPlayerStat[]);
      setMatchTeamStats((teamsResult.data ?? []) as MatchTeamStat[]);
      setDetailLoading(false);
    }

    void loadMatchDetail();
  }, [matchId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayerDetail() {
      if (!competitionId || !playerId) {
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
      const historyRows: PlayerHistory[] = [];
      const pageSize = 1000;
      let page = 0;

      while (true) {
        const result = await client
          .from("api_player_history")
          .select("*")
          .eq("competition_id", competitionId)
          .eq("player_id", playerId)
          .order("scheduled_at")
          .order("match_id")
          .order("metric_code")
          .order("source_id")
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (cancelled) return;
        if (result.error) {
          setError(result.error.message);
          setPlayerHistory([]);
          setDetailLoading(false);
          return;
        }
        const pageRows = (result.data ?? []) as PlayerHistory[];
        historyRows.push(...pageRows);
        if (pageRows.length < pageSize) break;
        page += 1;
      }

      setPlayerHistory(historyRows);
      setDetailLoading(false);
    }

    void loadPlayerDetail();
    return () => { cancelled = true; };
  }, [competitionId, playerId]);

  useEffect(() => {
    setPlayerHistoryRange("latest");
  }, [competitionId, playerId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeaderboard() {
      if (!seasonId || !leaderMetricCode) {
        setLeaderboardRows([]);
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

      const result = await supabase.rpc("api_player_leaderboard", {
        p_season_id: seasonId,
        p_metric_code: leaderboardSourceMetricCode(leaderMetricCode),
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
  }, [leaderMetricCode, players, seasonId]);

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

      const result = await supabase.rpc("api_player_leaderboard", {
        p_season_id: seasonId,
        p_metric_code: leaderboardSourceMetricCode(squadMetricCode),
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
  }, [players, seasonId, squadMetricCode, view]);

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

      const result = await supabase.rpc("api_player_leaderboard", {
        p_season_id: seasonId,
        p_metric_code: leaderboardSourceMetricCode(explorerMetricCode),
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
  }, [explorerMetricCode, players, seasonId, view]);

  const currentSeason = seasons.find((season) => season.season_id === seasonId) ?? demoSeason;
  const currentRound = rounds.find((round) => round.round_id === roundId);
  const selectedMatch = matches.find((match) => match.match_id === matchId);
  const selectedClub = clubs.find((club) => club.team_id === clubId);
  const selectedPlayer = players.find((player) => player.player_id === playerId);
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
        if (metric.value_type !== "percentage") {
          const rawMetric: PlayerChartMetric = {
            ...metric,
            chartKey: metric.code,
            chartMode: "single",
            normalization: "raw",
          };
          return metric.value_type === "count" && metric.code !== "minutes"
            ? [
                rawMetric,
                { ...rawMetric, name: `${metric.name} (90 mins)`, chartKey: `${metric.code}::per90`, normalization: "per90" },
              ]
            : [rawMetric];
        }
        const groupName = percentageMetricGroupName(metric);
        return [
          { ...metric, name: groupName, chartKey: `${metric.code}::paired`, chartMode: "paired", normalization: "raw" },
          { ...metric, name: `${groupName} (%)`, chartKey: metric.code, chartMode: "single", normalization: "raw" },
          { ...metric, name: `${groupName} (90 mins)`, chartKey: `${metric.code}::per90`, chartMode: "paired", normalization: "per90" },
        ];
      });
  }, [playerMetrics]);
  const playerViewMetrics = useMemo(
    () => selectedPlayer?.role_group === "Goalkeepers"
      ? playerChartMetrics
      : playerChartMetrics.filter((metric) => !isGoalkeepingMetricCode(metric.code)),
    [playerChartMetrics, selectedPlayer?.role_group],
  );
  useEffect(() => {
    if (playerViewMetrics.some((metric) => metric.chartKey === metricCode)) return;
    const preferred = playerViewMetrics.find((metric) => metric.code === preferredMetric(playerMetrics));
    setMetricCode(preferred?.chartKey ?? playerViewMetrics[0]?.chartKey ?? "");
  }, [metricCode, playerMetrics, playerViewMetrics]);
  const leaderboardMetrics = useMemo<LeaderboardMetricOption[]>(
    () => [
      ...seasonLeaderboardMetrics,
      ...playerMetrics.flatMap((metric): LeaderboardMetricOption[] => {
        const rawMetric: LeaderboardMetricOption = {
          code: metric.code,
          name: metric.name,
          value_type: metric.value_type,
          denominator_metric_code: metric.denominator_metric_code,
          kind: "match",
        };
        return metric.value_type === "count" && metric.code !== "minutes"
          ? [rawMetric, { ...rawMetric, code: `${metric.code}::per90`, name: `${metric.name} (90 min)`, value_type: "rate" }]
          : [rawMetric];
      }),
    ],
    [playerMetrics],
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
    if (explorerLeaderboardMetrics.some((metric) => metric.code === explorerMetricCode)) return;
    setExplorerMetricCode("season_minutes");
  }, [explorerLeaderboardMetrics, explorerMetricCode]);
  const leaderQualification = getLeaderboardQualification(leaderboardMetrics.find((metric) => metric.code === leaderMetricCode));
  const squadQualification = getLeaderboardQualification(leaderboardMetrics.find((metric) => metric.code === squadMetricCode));
  const explorerQualification = getLeaderboardQualification(explorerLeaderboardMetrics.find((metric) => metric.code === explorerMetricCode));
  const leaderMinimum = leaderQualification ? leaderMinimums[leaderMetricCode] ?? leaderQualification.defaultValue : 0;
  const squadMinimum = squadQualification ? squadMinimums[squadMetricCode] ?? squadQualification.defaultValue : 0;
  const explorerMinimum = explorerQualification ? explorerMinimums[explorerMetricCode] ?? explorerQualification.defaultValue : 0;
  const qualifiedLeaderboardRows = filterLeaderboardRows(leaderboardRows, players, leaderQualification, leaderMinimum);

  const standings = useMemo(
    () => [...clubs].sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference),
    [clubs],
  );
  useEffect(() => {
    setPositionFilter("All");
  }, [roleFilter]);
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
      const matchesRole = roleFilter === "All" || player.role_group === roleFilter;
      const matchesPosition = positionFilter === "All" || playerPositionFilterDetail(player).code === positionFilter;
      const matchesClub = clubFilter === "all" || player.team_id === clubFilter;
      const matchesQuery = !query || [player.display_name, player.team_name, player.primary_position, detailedPosition.code, detailedPosition.label]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
      return matchesRole && matchesPosition && matchesClub && matchesQuery;
    });
  }, [clubFilter, playerQuery, players, positionFilter, roleFilter]);
  const filteredPlayerIds = new Set(filteredPlayers.map((player) => player.player_id));
  const filteredExplorerRows = explorerLeaderboardRows.filter((row) => filteredPlayerIds.has(row.player_id));
  const qualifiedExplorerRows = filterLeaderboardRows(filteredExplorerRows, players, explorerQualification, explorerMinimum);
  const filteredPlayersById = new Map(filteredPlayers.map((player) => [player.player_id, player]));
  const rankedExplorerPlayers = qualifiedExplorerRows.flatMap((row) => {
    const player = filteredPlayersById.get(row.player_id);
    return player ? [player] : [];
  });
  useEffect(() => {
    if (view !== "players" || explorerLeaderboardLoading || !rankedExplorerPlayers.length || rankedExplorerPlayers.some((player) => player.player_id === playerId)) return;
    setPlayerId(rankedExplorerPlayers[0].player_id);
  }, [explorerLeaderboardLoading, playerId, rankedExplorerPlayers, view]);
  const clubMatches = useMemo(
    () => [...matches]
      .filter((match) => match.home_team_id === clubId || match.away_team_id === clubId)
      .sort((a, b) => dateValue(b.scheduled_at) - dateValue(a.scheduled_at)),
    [clubId, matches],
  );
  const clubSquad = useMemo(
    () => players.filter((player) => player.team_id === clubId),
    [clubId, players],
  );
  const clubSquadLeaderboardRows = useMemo(() => {
    const squadPlayerIds = new Set(clubSquad.map((player) => player.player_id));
    return squadLeaderboardRows.filter((player) => squadPlayerIds.has(player.player_id));
  }, [clubSquad, squadLeaderboardRows]);
  const clubSquadLeaders = filterLeaderboardRows(clubSquadLeaderboardRows, players, squadQualification, squadMinimum);
  const selectedPlayerMetric = playerViewMetrics.find((metric) => metric.chartKey === metricCode);
  const latestPlayerHistorySeasonId = useMemo(() => {
    const latestMatchBySeason = new Map<string, number>();
    playerHistory.forEach((row) => latestMatchBySeason.set(
      row.season_id,
      Math.max(latestMatchBySeason.get(row.season_id) ?? 0, dateValue(row.scheduled_at)),
    ));
    return [...latestMatchBySeason].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [playerHistory]);
  const latestPlayerHistorySeason = seasons.find((season) => season.season_id === latestPlayerHistorySeasonId);
  const visiblePlayerHistory = useMemo(
    () => playerHistoryRange === "all"
      ? playerHistory
      : playerHistory.filter((row) => row.season_id === latestPlayerHistorySeasonId),
    [latestPlayerHistorySeasonId, playerHistory, playerHistoryRange],
  );
  const playerHistorySeasonCount = useMemo(
    () => new Set(playerHistory.map((row) => row.season_id)).size,
    [playerHistory],
  );
  useEffect(() => {
    if (playerHistoryRange === "all" && playerHistorySeasonCount <= 1) setPlayerHistoryRange("latest");
  }, [playerHistoryRange, playerHistorySeasonCount]);
  const playerChartData = useMemo(
    () => selectedPlayerMetric
      ? aggregatePlayerHistory(visiblePlayerHistory, selectedPlayerMetric, playerHistoryRange === "all")
      : [],
    [playerHistoryRange, selectedPlayerMetric, visiblePlayerHistory],
  );
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
  const teamComparisons = useMemo(() => buildTeamComparisons(matchTeamStats), [matchTeamStats]);

  function navigate(nextView: View) {
    setView(nextView);
    window.history.pushState(null, "", `#${nextView}`);
  }

  function openMatch(match: Match) {
    if (match.round_id) setRoundId(match.round_id);
    setMatchId(match.match_id);
    setMatchSide("home");
    navigate("matches");
  }

  function openPlayer(nextPlayerId: string) {
    setPlayerId(nextPlayerId);
    navigate("players");
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-main">
          <button className="brand" type="button" onClick={() => navigate("overview")}>
            <BrandMark />
            <span><strong>KADUR<span className="brand-data">DATA</span></strong><small>Israeli football intelligence</small></span>
          </button>

          <nav className="primary-nav" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button className={view === item.id ? "active" : ""} key={item.id} type="button" onClick={() => navigate(item.id)}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <button className="icon-button" type="button" onClick={() => { void loadReferenceData(); setRefreshToken((value) => value + 1); }} title="Refresh data" aria-label="Refresh data">
            <RefreshCcw size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="context-bar">
          <div className="context-copy">
            <span>Viewing</span>
            <strong>{competitionLabel(competitions.find((item) => item.competition_id === competitionId)?.name)}</strong>
          </div>
          <label className="context-select">
            <span>Competition</span>
            <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)}>
              {competitions.map((competition) => (
                <option key={competition.competition_id} value={competition.competition_id}>{competitionLabel(competition.name)}</option>
              ))}
            </select>
          </label>
          <label className="context-select">
            <span>Season</span>
            <select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>
              {availableSeasons.map((season) => (
                <option key={season.season_id} value={season.season_id}>{season.season_name}{season.is_latest ? " · Latest" : ""}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="page-shell">
        {error && <div className="error-banner"><strong>Some data could not be loaded.</strong><span>{error}</span></div>}
        {!hasSupabaseConfig && <div className="demo-banner">Previewing the interface with sample data.</div>}

        {loading || seasonLoading ? (
          <LoadingState />
        ) : view === "overview" ? (
          <OverviewView
            season={currentSeason}
            seasonPlayers={players}
            round={currentRound}
            roundMatches={roundMatches}
            standings={standings}
            leaders={qualifiedLeaderboardRows}
            metrics={leaderboardMetrics}
            metricCode={leaderMetricCode}
            setMetricCode={setLeaderMetricCode}
            qualification={leaderQualification}
            minimum={leaderMinimum}
            setMinimum={(value) => setLeaderMinimums((current) => ({ ...current, [leaderMetricCode]: value }))}
            loading={leaderboardLoading}
            error={leaderboardError}
            openMatch={openMatch}
            openClub={(id) => { setClubId(id); navigate("clubs"); }}
            openPlayer={openPlayer}
            showMatches={() => navigate("matches")}
          />
        ) : view === "matches" ? (
          <MatchesView
            rounds={rounds}
            round={currentRound}
            roundId={roundId}
            setRoundId={setRoundId}
            matches={roundMatches}
            selectedMatch={selectedMatch}
            selectMatch={(id) => { setMatchId(id); setMatchSide("home"); }}
            matchSide={matchSide}
            setMatchSide={setMatchSide}
            players={visibleMatchPlayers}
            comparisons={teamComparisons}
            detailLoading={detailLoading}
            openPlayer={openPlayer}
          />
        ) : view === "clubs" ? (
          <ClubsView
            clubs={standings}
            selectedClub={selectedClub}
            setClubId={setClubId}
            matches={clubMatches}
            squad={clubSquad}
            squadLeaders={clubSquadLeaders}
            metrics={leaderboardMetrics}
            metricCode={squadMetricCode}
            setMetricCode={setSquadMetricCode}
            qualification={squadQualification}
            minimum={squadMinimum}
            setMinimum={(value) => setSquadMinimums((current) => ({ ...current, [squadMetricCode]: value }))}
            leaderboardLoading={squadLeaderboardLoading}
            leaderboardError={squadLeaderboardError}
            openMatch={openMatch}
            openPlayer={openPlayer}
          />
        ) : (
          <PlayersView
            players={rankedExplorerPlayers}
            rankingRows={qualifiedExplorerRows}
            rankingMetrics={explorerLeaderboardMetrics}
            rankingMetricCode={explorerMetricCode}
            setRankingMetricCode={setExplorerMetricCode}
            rankingQualification={explorerQualification}
            rankingMinimum={explorerMinimum}
            setRankingMinimum={(value) => setExplorerMinimums((current) => ({ ...current, [explorerMetricCode]: value }))}
            rankingLoading={explorerLeaderboardLoading}
            rankingError={explorerLeaderboardError}
            allPlayersCount={players.length}
            selectedPlayer={selectedPlayer}
            selectPlayer={setPlayerId}
            roles={roleFilters}
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            positions={positionOptions}
            positionFilter={positionFilter}
            setPositionFilter={setPositionFilter}
            clubs={clubs}
            clubFilter={clubFilter}
            setClubFilter={setClubFilter}
            query={playerQuery}
            setQuery={setPlayerQuery}
            metrics={playerViewMetrics}
            metricCode={metricCode}
            setMetricCode={setMetricCode}
            historyRange={playerHistoryRange}
            setHistoryRange={setPlayerHistoryRange}
            latestHistorySeasonLabel={latestPlayerHistorySeason?.season_name ?? "Latest season"}
            historySeasonCount={playerHistorySeasonCount}
            historyRows={visiblePlayerHistory}
            chartData={playerChartData}
            average={playerAverage}
            averageNumerator={playerRatioDenominator > 0 ? playerRatioNumerator : null}
            averageDenominator={playerRatioDenominator > 0 ? playerRatioDenominator : null}
            detailLoading={detailLoading}
          />
        )}
      </main>
    </div>
  );
}

function OverviewView({
  season,
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
  loading,
  error,
  openMatch,
  openClub,
  openPlayer,
  showMatches,
}: {
  season: Season;
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
  loading: boolean;
  error: string | null;
  openMatch: (match: Match) => void;
  openClub: (id: string) => void;
  openPlayer: (id: string) => void;
  showMatches: () => void;
}) {
  const selectedMetric = metrics.find((metric) => metric.code === metricCode);
  const seasonMetrics = metrics.filter((metric) => metric.kind === "season");
  const matchMetrics = metrics.filter((metric) => metric.kind === "match");
  const minutesByPlayer = new Map(seasonPlayers.map((player) => [player.player_id, Number(player.minutes)]));
  return (
    <>
      <PageHeading eyebrow={`${competitionLabel(season.competition_name)} · ${season.season_name}`} title="Season overview" description="The current shape of the league, from the latest results to the players setting the pace." />
      <section className="stat-band" aria-label="Season summary">
        <Stat label="Matches played" value={`${numberFormatter.format(season.completed_match_count)} / ${numberFormatter.format(season.match_count)}`} note={`${Math.round((season.completed_match_count / Math.max(season.match_count, 1)) * 100)}% complete`} />
        <Stat label="Clubs" value={numberFormatter.format(season.team_count)} note="League participants" />
        <Stat label="Players used" value={numberFormatter.format(season.player_count)} note="Across all matchdays" />
        <Stat label="Goals" value={numberFormatter.format(season.goals_scored)} note={`${(season.goals_scored / Math.max(season.completed_match_count, 1)).toFixed(2)} per match`} accent />
      </section>

      <div className="overview-grid">
        <section className="surface round-surface">
          <SectionHeading eyebrow={round?.stage_name ?? "Latest matchday"} title={`Round ${round?.round_number ?? "-"}`} action="All matches" onAction={showMatches} />
          <div className="score-list">
            {roundMatches.slice(0, 7).map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} />)}
          </div>
        </section>

        <section className="surface standings-surface">
          <SectionHeading eyebrow="League table" title="The leading pack" action="All clubs" onAction={() => openClub(standings[0]?.team_id ?? "")} />
          <div className="mini-table" aria-label="League standings">
            <div className="mini-table-head"><span>#</span><span>Club</span><span>GD</span><span>Pts</span></div>
            <div className="mini-table-body">
              {standings.map((club, index) => (
                <button className="mini-table-row" key={club.team_id} type="button" onClick={() => openClub(club.team_id)}>
                  <span className="rank">{index + 1}</span>
                  <span className="club-cell"><ClubBadge name={club.team_name} logoUrl={club.logo_url} size="small" /><strong>{cleanTeamName(club.team_name)}</strong></span>
                  <span>{signed(club.goal_difference)}</span>
                  <strong>{club.points}</strong>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="surface leaders-surface">
          <div className="leaderboard-heading">
            <div><span>Player leaderboard</span><h2>{selectedMetric?.name ?? "Performance"}</h2></div>
            <label className="leader-metric-select">
              <span>Sort by</span>
              <select value={metricCode} onChange={(event) => setMetricCode(event.target.value)}>
                <optgroup label="Season summary">{seasonMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                <optgroup label="Match metrics">{matchMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
              </select>
            </label>
          </div>
          {qualification && <LeaderboardQualificationFilter qualification={qualification} minimum={minimum} setMinimum={setMinimum} qualifiedCount={leaders.length} loading={loading} />}
          <div className="leader-list">
            {loading ? <InlineLoading /> : error ? <EmptyState text="Leaderboard data could not be loaded." /> : leaders.length ? leaders.map((player, index) => (
              <button key={player.player_id} type="button" onClick={() => openPlayer(player.player_id)}>
                <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="leader-copy"><strong>{player.display_name}</strong><small>{cleanTeamName(player.team_name ?? "")}</small></span>
                <span className="leader-value"><strong>{formatMetricWithRatio(player.leaderboard_value, player.value_type, player.numerator_value, player.denominator_value)}</strong><small>{leaderboardSampleLabel(player, qualification, minutesByPlayer)}</small></span>
              </button>
            )) : <EmptyState text={qualification ? "No players meet the current minimum sample." : "No leaderboard data is available for this metric."} />}
          </div>
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
  players,
  comparisons,
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
  players: PlayerPivot[];
  comparisons: Array<{ code: string; label: string; home: number; away: number }>;
  detailLoading: boolean;
  openPlayer: (id: string) => void;
}) {
  const roundIndex = rounds.findIndex((item) => item.round_id === roundId);
  return (
    <>
      <PageHeading eyebrow={round?.stage_name ?? "Season schedule"} title="Fixtures & results" description="Move through the season by round, then open any match for team and player-level detail." />
      <div className="round-toolbar">
        <button className="icon-button compact" type="button" disabled={roundIndex <= 0} onClick={() => setRoundId(rounds[roundIndex - 1]?.round_id)} aria-label="Previous round"><ChevronLeft size={18} /></button>
        <label>
          <span>Matchday</span>
          <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
            {rounds.map((item) => <option key={item.round_id} value={item.round_id}>{item.stage_name} · Round {item.round_number}</option>)}
          </select>
        </label>
        <button className="icon-button compact" type="button" disabled={roundIndex < 0 || roundIndex >= rounds.length - 1} onClick={() => setRoundId(rounds[roundIndex + 1]?.round_id)} aria-label="Next round"><ChevronRight size={18} /></button>
        <span className="round-date">{formatDateRange(round?.first_match_at, round?.last_match_at)}</span>
      </div>

      <div className="match-workspace">
        <aside className="surface fixture-rail">
          <div className="rail-heading"><strong>{matches.length} matches</strong><span>{round?.completed_match_count ?? 0} completed</span></div>
          <div className="fixture-list">
            {matches.map((match) => (
              <button className={selectedMatch?.match_id === match.match_id ? "active" : ""} key={match.match_id} type="button" onClick={() => selectMatch(match.match_id)}>
                <time>{formatFixtureDate(match.scheduled_at)}</time>
                <span className="fixture-clubs"><span>{cleanTeamName(match.home_team_name)}</span><span>{cleanTeamName(match.away_team_name)}</span></span>
                <strong className="fixture-score"><span>{match.home_score ?? "-"}</span><span>{match.away_score ?? "-"}</span></strong>
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
                  <SectionHeading eyebrow="Team comparison" title="Match profile" />
                  {detailLoading ? <InlineLoading /> : comparisons.length ? comparisons.map((item) => <ComparisonBar key={item.code} {...item} />) : <EmptyState text="Team comparison data is not available for this match." />}
                </div>
                <div className="lineup-panel">
                  <div className="lineup-heading">
                    <div><span>Player statistics</span><strong>{matchSide === "home" ? cleanTeamName(selectedMatch.home_team_name) : cleanTeamName(selectedMatch.away_team_name)}</strong></div>
                    <div className="segmented compact-segmented">
                      <button className={matchSide === "home" ? "active" : ""} type="button" onClick={() => setMatchSide("home")}>Home</button>
                      <button className={matchSide === "away" ? "active" : ""} type="button" onClick={() => setMatchSide("away")}>Away</button>
                    </div>
                  </div>
                  {detailLoading ? <InlineLoading /> : <PlayerMatchTable players={players} openPlayer={openPlayer} />}
                </div>
              </div>
            </>
          ) : <EmptyState text="Select a match to inspect its statistics." />}
        </section>
      </div>
    </>
  );
}

function ClubsView({
  clubs,
  selectedClub,
  setClubId,
  matches,
  squad,
  squadLeaders,
  metrics,
  metricCode,
  setMetricCode,
  qualification,
  minimum,
  setMinimum,
  leaderboardLoading,
  leaderboardError,
  openMatch,
  openPlayer,
}: {
  clubs: Club[];
  selectedClub?: Club;
  setClubId: (id: string) => void;
  matches: Match[];
  squad: SeasonPlayer[];
  squadLeaders: PlayerLeaderboardRow[];
  metrics: LeaderboardMetricOption[];
  metricCode: string;
  setMetricCode: (code: string) => void;
  qualification: LeaderboardQualification | null;
  minimum: number;
  setMinimum: (value: number) => void;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  openMatch: (match: Match) => void;
  openPlayer: (id: string) => void;
}) {
  const recent = matches.filter(isCompletedMatch).slice(0, 5);
  const squadByPlayerId = new Map(squad.map((player) => [player.player_id, player]));
  const seasonMetrics = metrics.filter((metric) => metric.kind === "season");
  const matchMetrics = metrics.filter((metric) => metric.kind === "match");
  return (
    <>
      <PageHeading eyebrow="Season directory" title="Clubs" description="Compare league position, form, results, and the players carrying each team through the season." />
      <div className="club-workspace">
        <aside className="surface club-directory">
          <div className="club-table-head"><span>#</span><span>Club</span><span>P</span><span>Pts</span></div>
          {clubs.map((club, index) => (
            <button className={club.team_id === selectedClub?.team_id ? "active" : ""} key={club.team_id} type="button" onClick={() => setClubId(club.team_id)}>
              <span>{index + 1}</span>
              <span className="club-cell"><ClubBadge name={club.team_name} logoUrl={club.logo_url} size="small" /><strong>{cleanTeamName(club.team_name)}</strong></span>
              <span>{club.played}</span><strong>{club.points}</strong>
            </button>
          ))}
        </aside>

        <section className="club-detail">
          {selectedClub ? (
            <>
              <div className="club-identity">
                <ClubBadge name={selectedClub.team_name} logoUrl={selectedClub.logo_url} size="large" />
                <div><span>League position {clubs.findIndex((club) => club.team_id === selectedClub.team_id) + 1}</span><h2>{cleanTeamName(selectedClub.team_name)}</h2><p>{selectedClub.city ?? "Israel"} · {selectedClub.played} matches played</p></div>
                <div className="form-strip" aria-label="Recent form">
                  {recent.map((match) => <span className={clubResult(match, selectedClub.team_id).toLowerCase()} key={match.match_id}>{clubResult(match, selectedClub.team_id)}</span>)}
                </div>
              </div>
              <section className="stat-band club-stats">
                <Stat label="Record" value={`${selectedClub.won}-${selectedClub.drawn}-${selectedClub.lost}`} note="W-D-L" />
                <Stat label="Goals" value={`${selectedClub.goals_for}:${selectedClub.goals_against}`} note="For : against" />
                <Stat label="Goal difference" value={signed(selectedClub.goal_difference)} note="Season total" />
                <Stat label="Points" value={String(selectedClub.points)} note={`${(selectedClub.points / Math.max(selectedClub.played, 1)).toFixed(2)} per match`} accent />
              </section>
              <div className="club-detail-grid">
                <section className="surface club-results">
                  <SectionHeading eyebrow="Season schedule" title="Recent matches" />
                  {matches.slice(0, 8).map((match) => <CompactMatch key={match.match_id} match={match} onClick={() => openMatch(match)} />)}
                </section>
                <section className="surface squad-panel">
                  <div className="squad-leaderboard-heading">
                    <div><span>{squad.length} players</span><h2>Season squad</h2></div>
                    <label className="leader-metric-select squad-metric-select">
                      <span>Rank by</span>
                      <select value={metricCode} onChange={(event) => setMetricCode(event.target.value)}>
                        <optgroup label="Season summary">{seasonMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                        <optgroup label="Match metrics">{matchMetrics.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}</optgroup>
                      </select>
                    </label>
                  </div>
                  {qualification && <LeaderboardQualificationFilter qualification={qualification} minimum={minimum} setMinimum={setMinimum} qualifiedCount={squadLeaders.length} loading={leaderboardLoading} />}
                  <div className="squad-list">
                    {leaderboardLoading ? <InlineLoading /> : leaderboardError ? <EmptyState text="Squad leaderboard data could not be loaded." /> : squadLeaders.length ? squadLeaders.map((leader, index) => {
                      const player = squadByPlayerId.get(leader.player_id);
                      return (
                        <button key={leader.player_id} type="button" onClick={() => openPlayer(leader.player_id)}>
                          <span className="squad-rank">{String(index + 1).padStart(2, "0")}</span>
                          <span className="avatar">{initials(leader.display_name)}</span>
                          <span><strong>{leader.display_name}</strong><small>{player ? `${playerPositionDetail(player).code} · ${playerPositionDetail(player).label}` : "Player"}</small></span>
                          <em>{formatMetricWithRatio(leader.leaderboard_value, leader.value_type, leader.numerator_value, leader.denominator_value)}</em>
                        </button>
                      );
                    }) : <EmptyState text={qualification ? "No squad players meet the current minimum sample." : "No squad data is available for this metric."} />}
                  </div>
                </section>
              </div>
            </>
          ) : <EmptyState text="Select a club to open its season workspace." />}
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
}: {
  qualification: LeaderboardQualification;
  minimum: number;
  setMinimum: (value: number) => void;
  qualifiedCount: number;
  loading: boolean;
}) {
  return (
    <label className="qualification-filter">
      <span className="qualification-copy">
        <strong>Minimum sample</strong>
        <small>{loading ? "Updating ranking" : `${qualifiedCount} ${qualifiedCount === 1 ? "player qualifies" : "players qualify"}`}</small>
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
          aria-label={`Minimum ${qualification.unit}`}
        />
        <small>{qualification.unit}</small>
      </span>
    </label>
  );
}

function PlayersView({
  players,
  rankingRows,
  rankingMetrics,
  rankingMetricCode,
  setRankingMetricCode,
  rankingQualification,
  rankingMinimum,
  setRankingMinimum,
  rankingLoading,
  rankingError,
  allPlayersCount,
  selectedPlayer,
  selectPlayer,
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
  metrics,
  metricCode,
  setMetricCode,
  historyRange,
  setHistoryRange,
  latestHistorySeasonLabel,
  historySeasonCount,
  historyRows,
  chartData,
  average,
  averageNumerator,
  averageDenominator,
  detailLoading,
}: {
  players: SeasonPlayer[];
  rankingRows: PlayerLeaderboardRow[];
  rankingMetrics: LeaderboardMetricOption[];
  rankingMetricCode: string;
  setRankingMetricCode: (code: string) => void;
  rankingQualification: LeaderboardQualification | null;
  rankingMinimum: number;
  setRankingMinimum: (value: number) => void;
  rankingLoading: boolean;
  rankingError: string | null;
  allPlayersCount: number;
  selectedPlayer?: SeasonPlayer;
  selectPlayer: (id: string) => void;
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
  metrics: PlayerChartMetric[];
  metricCode: string;
  setMetricCode: (code: string) => void;
  historyRange: PlayerHistoryRange;
  setHistoryRange: (range: PlayerHistoryRange) => void;
  latestHistorySeasonLabel: string;
  historySeasonCount: number;
  historyRows: PlayerHistory[];
  chartData: PlayerChartPoint[];
  average: number | null;
  averageNumerator: number | null;
  averageDenominator: number | null;
  detailLoading: boolean;
}) {
  const [attributeQuery, setAttributeQuery] = useState("");
  const metric = metrics.find((item) => item.chartKey === metricCode);
  const rankingByPlayerId = new Map(rankingRows.map((row) => [row.player_id, row]));
  const seasonRankingMetrics = rankingMetrics.filter((item) => item.kind === "season");
  const matchRankingMetrics = rankingMetrics.filter((item) => item.kind === "match");
  const selectedPosition = selectedPlayer ? playerPositionDetail(selectedPlayer) : null;
  const attributeGroups = useMemo(() => {
    const normalizedQuery = attributeQuery.trim().toLowerCase();
    const categoryOrder = selectedPlayer?.role_group === "Goalkeepers"
      ? (["Goalkeeping", ...playerAttributeCategories.filter((category) => category !== "Goalkeeping")] as PlayerAttributeCategory[])
      : playerAttributeCategories.filter((category) => category !== "Goalkeeping");
    const attributes = metrics
      .map((item) => summarizePlayerAttribute(historyRows, item))
      .filter((attribute) => !normalizedQuery
        || attribute.name.toLowerCase().includes(normalizedQuery)
        || attribute.category.toLowerCase().includes(normalizedQuery));
    return categoryOrder
      .map((category) => ({ category, attributes: attributes.filter((attribute) => attribute.category === category) }))
      .filter((group) => group.attributes.length > 0);
  }, [attributeQuery, historyRows, metrics, selectedPlayer?.role_group]);
  const isPairedMetric = metric?.chartMode === "paired"
    && Boolean(metric.numerator_metric_code)
    && Boolean(metric.denominator_metric_code);
  const isPer90Metric = metric?.normalization === "per90";
  const numeratorLabel = ratioComponentLabel(metric?.numerator_metric_code);
  const denominatorLabel = ratioComponentLabel(metric?.denominator_metric_code);
  const plottedChartData = isPer90Metric ? chartData.flatMap((point) => {
    if (point.minutes === null || point.minutes <= 0) return [];
    const factor = 90 / point.minutes;
    return [{
      ...point,
      value: point.value === null ? null : isPairedMetric ? point.value : point.value * factor,
      numerator: point.numerator === null ? null : point.numerator * factor,
      denominator: point.denominator === null ? null : point.denominator * factor,
    }];
  }) : chartData;
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
      ? per90Numerator === null || per90Denominator === null ? "-" : `${formatMetric(per90Numerator)} / ${formatMetric(per90Denominator)}`
      : formatMetric(per90Value)
    : average === null ? "-" : formatMetricWithRatio(average, metric?.value_type, averageNumerator, averageDenominator);
  const summaryNote = isPer90Metric
    ? isPairedMetric ? `${numeratorLabel} / ${denominatorLabel} per 90` : "Minutes-weighted rate per 90"
    : historyRange === "all"
      ? `${chartData.length} matches · ${historySeasonCount} ${historySeasonCount === 1 ? "season" : "seasons"}`
      : `${chartData.length} matches sampled`;
  return (
    <>
      <PageHeading eyebrow={`${numberFormatter.format(allPlayersCount)} players`} title="Player explorer" description="Filter the league by role or club, then track an individual metric from match to match." />
      <div className="player-filters">
        <div className="role-filter-stack">
          <div className="segmented role-segments">
            {roles.map((role) => <button aria-label={role} className={roleFilter === role ? "active" : ""} key={role} title={role} type="button" onClick={() => setRoleFilter(role)}>{roleLabel(role)}</button>)}
          </div>
          {positions.length > 0 && (
            <div className="position-filter">
              <span>Position</span>
              <div className="segmented compact-segmented position-segments" aria-label={`${roleFilter} positions`}>
                <button className={positionFilter === "All" ? "active" : ""} type="button" onClick={() => setPositionFilter("All")}>All</button>
                {positions.map((position) => (
                  <button className={positionFilter === position.code ? "active" : ""} key={position.code} title={position.label} type="button" onClick={() => setPositionFilter(position.code)}>{position.code}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <label className="filter-select"><ListFilter size={16} /><select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}><option value="all">All clubs</option>{clubs.map((club) => <option key={club.team_id} value={club.team_id}>{cleanTeamName(club.team_name)}</option>)}</select></label>
        <label className="search-field"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players" /></label>
      </div>

      <div className="player-workspace">
        <aside className="surface player-directory">
          <div className="rail-heading player-ranking-heading">
            <strong>{numberFormatter.format(players.length)} results</strong>
            <label className="player-ranking-select">
              <span>Rank by</span>
              <select aria-label="Rank players by" value={rankingMetricCode} onChange={(event) => setRankingMetricCode(event.target.value)}>
                <optgroup label="Season summary">{seasonRankingMetrics.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup>
                <optgroup label="Match metrics">{matchRankingMetrics.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup>
              </select>
            </label>
          </div>
          {rankingQualification && (
            <div className="directory-qualification">
              <LeaderboardQualificationFilter qualification={rankingQualification} minimum={rankingMinimum} setMinimum={setRankingMinimum} qualifiedCount={players.length} loading={rankingLoading} />
            </div>
          )}
          <div className="player-list">
            {rankingLoading ? <InlineLoading /> : rankingError ? <EmptyState text="Player ranking data could not be loaded." /> : players.length ? players.map((player) => {
              const ranking = rankingByPlayerId.get(player.player_id);
              return (
                <button className={player.player_id === selectedPlayer?.player_id ? "active" : ""} key={player.player_id} type="button" onClick={() => selectPlayer(player.player_id)}>
                  <span className="avatar">{initials(player.display_name)}</span>
                  <span className="player-copy"><strong>{player.display_name}</strong><small>{cleanTeamName(player.team_name ?? "Free agent")} · {playerPositionDetail(player).code}</small></span>
                  <span className="player-numbers">
                    <strong>{ranking ? formatMetricWithRatio(ranking.leaderboard_value, ranking.value_type, ranking.numerator_value, ranking.denominator_value) : "-"}</strong>
                    <small>{ranking ? explorerRankingSampleLabel(ranking, player, rankingQualification) : ""}</small>
                  </span>
                </button>
              );
            }) : <EmptyState text={rankingQualification ? "No players meet the current minimum sample." : "No players are available for this metric."} />}
          </div>
        </aside>

        <section className="surface player-detail">
          {selectedPlayer ? (
            <>
              <div className="player-profile-head">
                <span className="avatar large">{initials(selectedPlayer.display_name)}</span>
                <div>
                  <span className="player-position-line"><b title={selectedPosition?.label}>{selectedPosition?.code}</b><span>{selectedPosition?.label} · {cleanTeamName(selectedPlayer.team_name ?? "")}</span></span>
                  <h2>{selectedPlayer.display_name}</h2>
                </div>
              </div>
              <section className="stat-band player-stats">
                <Stat label="Appearances" value={formatNumber(selectedPlayer.appearances)} note={`${formatNumber(selectedPlayer.starts)} starts`} />
                <Stat label="Minutes" value={numberFormatter.format(Math.round(Number(selectedPlayer.minutes)))} note="Season total" />
                <Stat label="Goals + assists" value={formatNumber(Number(selectedPlayer.goals) + Number(selectedPlayer.assists))} note={`${formatNumber(selectedPlayer.goals)} goals · ${formatNumber(selectedPlayer.assists)} assists`} />
                <Stat label={metric?.name ?? "Average"} value={summaryValue} note={summaryNote} accent />
              </section>
              <section className="player-attributes">
                <div className="attribute-heading">
                  <div><span>Player attributes</span><h3>{metrics.length} chartable metrics</h3></div>
                  <label className="attribute-search"><Search size={15} /><input aria-label="Search player attributes" type="search" value={attributeQuery} onChange={(event) => setAttributeQuery(event.target.value)} placeholder="Find an attribute" /></label>
                </div>
                <div className="attribute-scroll">
                  {attributeGroups.map((group) => (
                    <section className="attribute-group" key={group.category}>
                      <h4>{group.category}</h4>
                      <div className="attribute-grid">
                        {group.attributes.map((attribute) => (
                          <button
                            className={attribute.chartKey === metricCode ? "active" : ""}
                            key={attribute.chartKey}
                            title={`Show ${attribute.name} match by match`}
                            type="button"
                            onClick={() => setMetricCode(attribute.chartKey)}
                          >
                            <span>{attribute.name}</span>
                            <strong>{attribute.value}</strong>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                  {!attributeGroups.length && <EmptyState text="No attributes match this search." />}
                </div>
              </section>
              <div className="trend-heading">
                <div><span>Match-by-match</span><h3>{metric?.name ?? "Performance trend"}</h3></div>
                <div className="trend-actions">
                  <div className="segmented compact-segmented history-range" aria-label="Match history range">
                    <button className={historyRange === "latest" ? "active" : ""} title="Latest season with data" type="button" onClick={() => setHistoryRange("latest")}>{latestHistorySeasonLabel}</button>
                    <button
                      className={historyRange === "all" ? "active" : ""}
                      disabled={historySeasonCount <= 1}
                      title={historySeasonCount <= 1 ? "Only one season has player match data" : `Show all ${historySeasonCount} seasons`}
                      type="button"
                      onClick={() => setHistoryRange("all")}
                    >
                      All seasons ({historySeasonCount})
                    </button>
                  </div>
                  <div className="trend-keys">
                    {isPairedMetric ? (
                      <>
                        <span className="trend-key completed"><i /> {numeratorLabel}</span>
                        <span className="trend-key attempted"><i /> {denominatorLabel}</span>
                      </>
                    ) : <span className="trend-key completed"><i /> Trend</span>}
                  </div>
                </div>
              </div>
              <div className="chart-frame">
                {detailLoading ? <InlineLoading /> : plottedChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={plottedChartData} margin={{ top: 18, right: 12, bottom: 4, left: -12 }}>
                      <CartesianGrid vertical={false} stroke="#293545" strokeDasharray="3 5" />
                      <XAxis dataKey="date" axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} minTickGap={28} />
                      <YAxis axisLine={false} tick={{ fill: "#8B97A6", fontSize: 11 }} tickLine={false} width={54} />
                      <Tooltip contentStyle={{ color: "#F4F7FA", background: "#182432", border: "1px solid #354456", borderRadius: 6, boxShadow: "0 14px 34px rgba(0, 0, 0, .3)" }} labelStyle={{ color: "#F4F7FA", fontWeight: 700 }} formatter={(value, name, item) => {
                        const point = item.payload as PlayerChartPoint;
                        return isPairedMetric
                          ? [formatMetric(Number(value)), String(name)]
                          : [formatMetricWithRatio(Number(value), metric?.value_type, point.numerator, point.denominator), metric?.name ?? "Value"];
                      }} labelFormatter={(_, payload) => {
                        const point = payload?.[0]?.payload as PlayerChartPoint | undefined;
                        if (!point) return "Match";
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
                ) : <EmptyState text="No match data is available for this player and metric." />}
              </div>
              <div className="history-strip">
                {plottedChartData.slice(-6).reverse().map((item) => <div key={`${item.match}-${item.date}`}><span>{item.date} · {item.opponent}</span><strong>{isPer90Metric && isPairedMetric ? `${formatMetric(item.numerator)} / ${formatMetric(item.denominator)}` : formatMetricWithRatio(item.value, metric?.value_type, item.numerator, item.denominator)}</strong><small>{item.score}</small></div>)}
              </div>
            </>
          ) : <EmptyState text="Select a player to explore their season." />}
        </section>
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function SectionHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="section-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div>{action && <button type="button" onClick={onAction}>{action}<ArrowUpRight size={15} /></button>}</div>;
}

function Stat({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={accent ? "stat accent" : "stat"}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function CompactMatch({ match, onClick }: { match: Match; onClick: () => void }) {
  return (
    <button className="compact-match" type="button" onClick={onClick}>
      <time>{formatFixtureDate(match.scheduled_at)}</time>
      <span className="compact-club"><ClubBadge name={match.home_team_name} logoUrl={match.home_team_logo_url} size="tiny" /><strong>{cleanTeamName(match.home_team_name)}</strong></span>
      <span className="compact-score">{match.home_score ?? "-"}</span>
      <span className="compact-club"><ClubBadge name={match.away_team_name} logoUrl={match.away_team_logo_url} size="tiny" /><strong>{cleanTeamName(match.away_team_name)}</strong></span>
      <span className="compact-score">{match.away_score ?? "-"}</span>
      <ChevronRight size={16} />
    </button>
  );
}

function MatchScoreboard({ match }: { match: Match }) {
  return (
    <div className="match-scoreboard">
      <div className="match-meta"><span>{match.stage_name} · Round {match.round_number}</span><strong>{formatLongDate(match.scheduled_at)}</strong></div>
      <div className="scoreboard-main">
        <div className="score-club home"><div><strong>{cleanTeamName(match.home_team_name)}</strong><span>Home</span></div><ClubBadge name={match.home_team_name} logoUrl={match.home_team_logo_url} size="large" /></div>
        <div className="big-score"><strong>{match.home_score ?? "-"}</strong><span>:</span><strong>{match.away_score ?? "-"}</strong><small>{match.status ?? "Scheduled"}</small></div>
        <div className="score-club"><ClubBadge name={match.away_team_name} logoUrl={match.away_team_logo_url} size="large" /><div><strong>{cleanTeamName(match.away_team_name)}</strong><span>Away</span></div></div>
      </div>
    </div>
  );
}

function ComparisonBar({ label, home, away }: { label: string; home: number; away: number }) {
  const total = Math.max(home + away, 1);
  const homeWidth = `${Math.max((home / total) * 100, 4)}%`;
  const awayWidth = `${Math.max((away / total) * 100, 4)}%`;
  return (
    <div className="comparison-row">
      <div><strong>{formatMetric(home)}</strong><span>{label}</span><strong>{formatMetric(away)}</strong></div>
      <div className="comparison-track"><i className="home" style={{ width: homeWidth }} /><i className="away" style={{ width: awayWidth }} /></div>
    </div>
  );
}

function PlayerMatchTable({ players, openPlayer }: { players: PlayerPivot[]; openPlayer: (id: string) => void }) {
  if (!players.length) return <EmptyState text="Player statistics are not available for this side." />;
  return (
    <div className="data-table-wrap">
      <table className="player-stat-table">
        <thead><tr><th>Player</th><th>Min</th><th>Rating</th><th>G</th><th>A</th><th>Pass %</th><th>Shots</th></tr></thead>
        <tbody>{players.map((player) => (
          <tr key={player.appearance_id}>
            <td><button type="button" onClick={() => openPlayer(player.player_id)}><span>{player.shirt_number ?? "-"}</span><span><strong>{player.display_name}</strong><small>{player.position_name ?? player.lineup_status ?? "Player"}</small></span></button></td>
            <td>{formatMetric(player.minutes_played)}</td><td><strong>{formatMetric(player.values.rating_365)}</strong></td><td>{formatMetric(player.values.goals)}</td><td>{formatMetric(player.values.assists)}</td><td>{formatMetricWithRatio(player.values.pass_completion_pct, "percentage", player.values.passes_completed, player.values.passes_attempted)}</td><td>{formatMetric(player.values.total_shots)}</td>
          </tr>
        ))}</tbody>
      </table>
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
  return <div className="loading-state"><Loader2 className="spin" size={28} /><strong>Building the season view</strong><span>Loading matches, clubs, and player data.</span></div>;
}

function InlineLoading() {
  return <div className="inline-loading"><Loader2 className="spin" size={20} /><span>Loading match data</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><BarChart3 size={22} /><span>{text}</span></div>;
}

function pivotMatchPlayers(rows: MatchPlayerStat[]): PlayerPivot[] {
  const pivots = new Map<string, { base: MatchPlayerStat; values: Map<string, number[]> }>();
  rows.forEach((row) => {
    const current = pivots.get(row.appearance_id) ?? { base: row, values: new Map<string, number[]>() };
    if (row.value_numeric !== null) {
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

function buildTeamComparisons(rows: MatchTeamStat[]) {
  const grouped = new Map<string, { label: string; home: number[]; away: number[] }>();
  rows.filter((row) => comparisonMetrics.includes(row.metric_code) && row.value_numeric !== null).forEach((row) => {
    const current = grouped.get(row.metric_code) ?? { label: friendlyMetric(row.metric_name), home: [], away: [] };
    current[row.side].push(Number(row.value_numeric));
    grouped.set(row.metric_code, current);
  });
  return comparisonMetrics.flatMap((code) => {
    const values = grouped.get(code);
    return values && values.home.length && values.away.length ? [{ code, label: values.label, home: average(values.home), away: average(values.away) }] : [];
  });
}

function aggregatePlayerHistory(rows: PlayerHistory[], metric?: Metric, includeYear = false): PlayerChartPoint[] {
  const grouped = new Map<string, PlayerHistory[]>();
  rows.forEach((row) => grouped.set(row.match_id, [...(grouped.get(row.match_id) ?? []), row]));
  return [...grouped.values()].map((matchRows, index): PlayerChartPoint => {
    const row = matchRows[0];
    const metricValue = (code?: string | null) => {
      if (!code) return null;
      const values = matchRows
        .filter((item) => item.metric_code === code && item.value_numeric !== null)
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
      date: formatPlayerHistoryDate(row.scheduled_at, includeYear),
      value,
      opponent: cleanTeamName(row.opponent_team_name ?? "Opponent"),
      score: formatScore(row.home_score, row.away_score),
      minutes: row.minutes_played === null ? null : Number(row.minutes_played),
      numerator,
      denominator,
    };
  });
}

function summarizePlayerAttribute(historyRows: PlayerHistory[], metric: PlayerChartMetric): PlayerAttributeSummary {
  const points = aggregatePlayerHistory(historyRows, metric);
  const values = points.map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value));
  const totalMinutes = points.reduce((total, point) => total + Number(point.minutes ?? 0), 0);
  const totalValue = values.reduce((total, value) => total + value, 0);
  const numerator = points.reduce((total, point) => total + Number(point.numerator ?? 0), 0);
  const denominator = points.reduce((total, point) => total + Number(point.denominator ?? 0), 0);
  const isPaired = metric.chartMode === "paired"
    && Boolean(metric.numerator_metric_code)
    && Boolean(metric.denominator_metric_code);

  let value = "-";
  if (metric.normalization === "per90" && totalMinutes > 0) {
    value = isPaired
      ? `${formatMetric(numerator * 90 / totalMinutes)} / ${formatMetric(denominator * 90 / totalMinutes)}`
      : formatMetric(totalValue * 90 / totalMinutes);
  } else if (isPaired && points.length) {
    value = `${formatMetric(numerator)} / ${formatMetric(denominator)}`;
  } else if (metric.value_type === "percentage" && values.length) {
    const weightedValue = denominator > 0 ? numerator * 100 / denominator : average(values);
    value = formatMetric(weightedValue, "percentage");
  } else if (metric.value_type === "count" && points.length) {
    value = formatMetric(totalValue);
  } else if (values.length) {
    value = formatMetric(average(values), metric.value_type);
  }

  return {
    chartKey: metric.chartKey,
    name: metric.name,
    category: playerAttributeCategory(metric),
    value,
  };
}

function playerAttributeCategory(metric: PlayerChartMetric): PlayerAttributeCategory {
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

function ratioComponentLabel(code?: string | null) {
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

function specificPositionDetail(position?: string | null): PlayerPositionDetail | null {
  const normalized = position?.trim().toLowerCase();
  if (!normalized) return null;
  const known = specificPositionDetails[normalized];
  if (known) return known;
  const label = position!.trim();
  const code = label.split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return { code: code || "Other", label };
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

function roleLabel(role: RoleFilter) {
  return ({ All: "All", Goalkeepers: "GK", Defenders: "DEF", Midfielders: "MID", Attackers: "FWD", Other: "Other" } as Record<RoleFilter, string>)[role];
}

function compareLeaderboardRows(a: PlayerLeaderboardRow, b: PlayerLeaderboardRow) {
  const aValue = a.leaderboard_value === null ? Number.NEGATIVE_INFINITY : Number(a.leaderboard_value);
  const bValue = b.leaderboard_value === null ? Number.NEGATIVE_INFINITY : Number(b.leaderboard_value);
  const aSecondary = a.value_type === "percentage" ? Number(a.denominator_value ?? 0) : Number(a.sample_size);
  const bSecondary = b.value_type === "percentage" ? Number(b.denominator_value ?? 0) : Number(b.sample_size);
  return bValue - aValue || bSecondary - aSecondary || a.display_name.localeCompare(b.display_name);
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
) {
  return qualification?.source === "minutes"
    ? `${row.aggregation} · ${numberFormatter.format(minutesByPlayer.get(row.player_id) ?? 0)} minutes`
    : `${row.aggregation} · ${row.sample_size} matches`;
}

function explorerRankingSampleLabel(
  row: PlayerLeaderboardRow,
  player: SeasonPlayer,
  qualification: LeaderboardQualification | null,
) {
  if (qualification?.source === "minutes") return `${numberFormatter.format(Math.round(Number(player.minutes)))} min`;
  if (qualification?.source === "denominator") {
    return `${numberFormatter.format(Math.round(Number(row.denominator_value ?? 0)))} ${qualification.unit}`;
  }
  if (qualification?.source === "matches") return `${numberFormatter.format(row.sample_size)} matches`;
  return row.aggregation === "total" ? "Season total" : `${numberFormatter.format(row.sample_size)} matches`;
}

function leaderboardSourceMetricCode(metricCode: string) {
  return metricCode.replace(/::per90$/, "");
}

function prepareLeaderboardRows(rows: PlayerLeaderboardRow[], players: SeasonPlayer[], metricCode: string) {
  const roleByPlayer = new Map(players.map((player) => [player.player_id, player.role_group]));
  const eligibleRows = isGoalkeepingMetricCode(metricCode)
    ? rows.filter((row) => roleByPlayer.get(row.player_id) === "Goalkeepers")
    : rows;
  if (!metricCode.endsWith("::per90")) return [...eligibleRows].sort(compareLeaderboardRows);

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
  }).sort(compareLeaderboardRows);
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
  }).sort(compareLeaderboardRows);
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

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatMetric(value: number | null | undefined, valueType?: string) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  const formatted = Number.isInteger(numeric) ? numberFormatter.format(numeric) : numeric.toFixed(numeric < 10 ? 2 : 1);
  return valueType === "percentage" ? `${formatted}%` : formatted;
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
  return `${formatted} (${formatMetric(Number(numerator))}/${formatMetric(Number(denominator))})`;
}

function formatShortDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(value)) : "-";
}

function formatPlayerHistoryDate(value: string | null, includeYear: boolean) {
  return value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: includeYear ? "2-digit" : undefined }).format(new Date(value))
    : "-";
}

function formatFixtureDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value)) : "TBD";
}

function formatLongDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Date to be confirmed";
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start) return "Dates to be confirmed";
  if (!end || formatShortDate(start) === formatShortDate(end)) return formatShortDate(start);
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

function formatScore(home: number | null, away: number | null) {
  return home === null || away === null ? "-" : `${home}:${away}`;
}

function isCompletedMatch(match: Match) {
  return match.home_score !== null && match.away_score !== null;
}

function clubResult(match: Match, clubId: string) {
  if (!isCompletedMatch(match)) return "-";
  const isHome = match.home_team_id === clubId;
  const clubScore = isHome ? Number(match.home_score) : Number(match.away_score);
  const opponentScore = isHome ? Number(match.away_score) : Number(match.home_score);
  return clubScore > opponentScore ? "W" : clubScore < opponentScore ? "L" : "D";
}
