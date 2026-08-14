import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Database,
  Loader2,
  RefreshCcw,
  Search,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { Metric, Overview, Player, PlayerMatchStat } from "./lib/types";

const formatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact" });

const demoOverview: Overview = {
  match_count: 240,
  player_count: 682,
  team_count: 14,
  stat_observation_count: 596524,
  latest_observed_at: new Date().toISOString(),
};

const demoPlayers: Player[] = [
  {
    player_id: "demo-1",
    display_name: "Demo Midfielder",
    primary_position: "CM",
    current_team_id: "team-1",
    current_team_name: "Maccabi Tel Aviv",
    appearances: 29,
    minutes: 2411,
  },
  {
    player_id: "demo-2",
    display_name: "Demo Forward",
    primary_position: "ST",
    current_team_id: "team-2",
    current_team_name: "Maccabi Haifa",
    appearances: 27,
    minutes: 2184,
  },
  {
    player_id: "demo-3",
    display_name: "Demo Fullback",
    primary_position: "RB",
    current_team_id: "team-3",
    current_team_name: "Hapoel Be'er Sheva",
    appearances: 25,
    minutes: 2019,
  },
];

const demoMetrics: Metric[] = [
  {
    metric_id: "metric-1",
    code: "accurate_passes_percentage",
    name: "Accurate passes %",
    subject_type: "player_match",
    value_type: "percentage",
  },
  {
    metric_id: "metric-2",
    code: "key_passes",
    name: "Key passes",
    subject_type: "player_match",
    value_type: "number",
  },
];

const demoStats: PlayerMatchStat[] = Array.from({ length: 12 }, (_, index) => ({
  player_id: "demo-1",
  display_name: "Demo Midfielder",
  team_id: "team-1",
  team_name: "Maccabi Tel Aviv",
  opponent_team_id: "opponent",
  opponent_team_name: index % 2 ? "Maccabi Haifa" : "Hapoel Be'er Sheva",
  match_id: `demo-match-${index}`,
  scheduled_at: new Date(2026, 0, 5 + index * 7).toISOString(),
  home_score: index % 4,
  away_score: (index + 1) % 3,
  side: index % 2 ? "away" : "home",
  minutes_played: index % 5 === 0 ? 72 : 90,
  metric_id: "metric-1",
  metric_code: "accurate_passes_percentage",
  metric_name: "Accurate passes %",
  value_type: "percentage",
  value_numeric: 71 + Math.round(Math.sin(index / 2) * 8 + index * 1.4),
  raw_value: null,
}));

type LoadState = "loading" | "ready" | "demo" | "error";

export function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [stats, setStats] = useState<PlayerMatchStat[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [selectedMetricCode, setSelectedMetricCode] = useState<string>("");
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function loadReferenceData() {
    setError(null);

    if (!hasSupabaseConfig || !supabase) {
      setOverview(demoOverview);
      setPlayers(demoPlayers);
      setMetrics(demoMetrics);
      setSelectedPlayerId(demoPlayers[0].player_id);
      setSelectedMetricCode(demoMetrics[0].code);
      setLoadState("demo");
      return;
    }

    setLoadState("loading");

    const [overviewResult, playersResult, metricsResult] = await Promise.all([
      supabase.from("api_overview").select("*").single(),
      supabase
        .from("api_players")
        .select("*")
        .order("minutes", { ascending: false })
        .limit(500),
      supabase
        .from("api_metrics")
        .select("*")
        .eq("subject_type", "player_match")
        .order("name", { ascending: true }),
    ]);

    const firstError = overviewResult.error ?? playersResult.error ?? metricsResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoadState("error");
      return;
    }

    const nextPlayers = (playersResult.data ?? []) as Player[];
    const nextMetrics = (metricsResult.data ?? []) as Metric[];

    setOverview(overviewResult.data as Overview);
    setPlayers(nextPlayers);
    setMetrics(nextMetrics);
    setSelectedPlayerId((current) => current || nextPlayers[0]?.player_id || "");
    setSelectedMetricCode((current) => current || nextMetrics[0]?.code || "");
    setLoadState("ready");
  }

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    async function loadStats() {
      if (!selectedPlayerId || !selectedMetricCode) {
        setStats([]);
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        setStats(demoStats);
        return;
      }

      const result = await supabase
        .from("api_player_match_stats")
        .select("*")
        .eq("player_id", selectedPlayerId)
        .eq("metric_code", selectedMetricCode)
        .order("scheduled_at", { ascending: true })
        .limit(120);

      if (result.error) {
        setError(result.error.message);
        setLoadState("error");
        return;
      }

      setStats((result.data ?? []) as PlayerMatchStat[]);
    }

    void loadStats();
  }, [selectedMetricCode, selectedPlayerId]);

  const selectedPlayer = players.find((player) => player.player_id === selectedPlayerId);
  const selectedMetric = metrics.find((metric) => metric.code === selectedMetricCode);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return players;

    return players.filter((player) =>
      [player.display_name, player.current_team_name, player.primary_position]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery)),
    );
  }, [players, query]);

  const chartData = useMemo(
    () =>
      stats
        .filter((row) => row.value_numeric !== null)
        .map((row, index) => ({
          match: index + 1,
          date: row.scheduled_at ? formatShortDate(row.scheduled_at) : `Match ${index + 1}`,
          value: Number(row.value_numeric),
          opponent: row.opponent_team_name ?? "Unknown",
        })),
    [stats],
  );

  const recentStats = [...stats].reverse().slice(0, 8);
  const averageValue =
    chartData.length > 0
      ? chartData.reduce((sum, point) => sum + point.value, 0) / chartData.length
      : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <Database size={22} aria-hidden="true" />
            <span>Kadurdata</span>
          </div>
          <h1>Israeli soccer stats workbench</h1>
        </div>
        <button className="icon-button" type="button" onClick={loadReferenceData} title="Refresh data">
          <RefreshCcw size={18} aria-hidden="true" />
        </button>
      </header>

      {loadState === "demo" && (
        <section className="notice">
          <Settings size={18} aria-hidden="true" />
          <span>
            Supabase anon key is not configured locally, so this preview is using demo data.
            GitHub Pages will use the `SUPABASE_ANON_KEY` repo variable or secret.
          </span>
        </section>
      )}

      {loadState === "error" && (
        <section className="notice notice-error">
          <Activity size={18} aria-hidden="true" />
          <span>{error ?? "Could not load Supabase data."}</span>
        </section>
      )}

      <section className="stat-grid">
        <StatCard icon={<BarChart3 size={19} />} label="Matches" value={overview?.match_count} />
        <StatCard icon={<Users size={19} />} label="Players" value={overview?.player_count} />
        <StatCard icon={<Activity size={19} />} label="Teams" value={overview?.team_count} />
        <StatCard
          icon={<TrendingUp size={19} />}
          label="Observations"
          value={overview?.stat_observation_count}
          compact
        />
      </section>

      <section className="workspace-grid">
        <aside className="panel player-panel">
          <div className="panel-heading">
            <h2>Players</h2>
            <span>{formatter.format(filteredPlayers.length)}</span>
          </div>
          <label className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, team, position"
            />
          </label>
          <div className="player-list">
            {filteredPlayers.map((player) => (
              <button
                className={player.player_id === selectedPlayerId ? "player-row active" : "player-row"}
                key={player.player_id}
                type="button"
                onClick={() => setSelectedPlayerId(player.player_id)}
              >
                <span>
                  <strong>{player.display_name}</strong>
                  <small>{player.current_team_name ?? "No team"} · {player.primary_position ?? "Unknown"}</small>
                </span>
                <em>{formatter.format(Math.round(Number(player.minutes)))}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel analysis-panel">
          <div className="analysis-header">
            <div>
              <p>Selected player</p>
              <h2>{selectedPlayer?.display_name ?? "No player selected"}</h2>
            </div>
            <select
              value={selectedMetricCode}
              onChange={(event) => setSelectedMetricCode(event.target.value)}
              aria-label="Metric"
            >
              {metrics.map((metric) => (
                <option key={metric.metric_id} value={metric.code}>
                  {metric.name}
                </option>
              ))}
            </select>
          </div>

          <div className="chart-summary">
            <div>
              <span>Metric</span>
              <strong>{selectedMetric?.name ?? "Choose a metric"}</strong>
            </div>
            <div>
              <span>Sample</span>
              <strong>{formatter.format(chartData.length)} matches</strong>
            </div>
            <div>
              <span>Average</span>
              <strong>{averageValue === null ? "No data" : formatMetricValue(averageValue)}</strong>
            </div>
          </div>

          <div className="chart-frame">
            {loadState === "loading" ? (
              <div className="empty-state">
                <Loader2 className="spin" size={24} aria-hidden="true" />
                <span>Loading match stats</span>
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 20, right: 24, bottom: 10, left: 0 }}>
                  <CartesianGrid stroke="#dde4ea" strokeDasharray="4 4" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={26} />
                  <YAxis tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #d6dee6",
                      borderRadius: 8,
                      boxShadow: "0 16px 40px rgba(15, 23, 42, 0.12)",
                    }}
                    formatter={(value) => [formatMetricValue(Number(value)), selectedMetric?.name ?? "Value"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.opponent ?? "Match"}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0f766e"
                    strokeWidth={3}
                    dot={{ r: 3, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">No observations found for this player and metric.</div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Minutes</th>
                  <th>Score</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {recentStats.map((row) => (
                  <tr key={`${row.match_id}-${row.metric_code}`}>
                    <td>{row.scheduled_at ? formatShortDate(row.scheduled_at) : "-"}</td>
                    <td>{row.opponent_team_name ?? "-"}</td>
                    <td>{row.minutes_played ?? "-"}</td>
                    <td>{formatScore(row)}</td>
                    <td>{formatMetricValue(row.value_numeric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({
  compact = false,
  icon,
  label,
  value,
}: {
  compact?: boolean;
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
}) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value === undefined ? "-" : compact ? compactFormatter.format(value) : formatter.format(value)}</strong>
      </div>
    </article>
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatMetricValue(value: number | null) {
  if (value === null || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? formatter.format(value) : value.toFixed(1);
}

function formatScore(row: PlayerMatchStat) {
  if (row.home_score === null || row.away_score === null) return "-";
  return `${row.home_score}-${row.away_score}`;
}

