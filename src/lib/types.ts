export type Overview = {
  match_count: number;
  player_count: number;
  team_count: number;
  stat_observation_count: number;
  latest_observed_at: string | null;
};

export type Player = {
  player_id: string;
  display_name: string;
  primary_position: string | null;
  current_team_id: string | null;
  current_team_name: string | null;
  appearances: number;
  minutes: number;
};

export type Metric = {
  metric_id: string;
  code: string;
  name: string;
  subject_type: "player_match" | "team_match";
  value_type: string;
};

export type PlayerMatchStat = {
  player_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  opponent_team_id: string | null;
  opponent_team_name: string | null;
  match_id: string;
  scheduled_at: string | null;
  home_score: number | null;
  away_score: number | null;
  side: string | null;
  minutes_played: number | null;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  value_type: string;
  value_numeric: number | null;
  raw_value: string | null;
};

