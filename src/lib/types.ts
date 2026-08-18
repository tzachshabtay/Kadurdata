export type Overview = {
  match_count: number;
  player_count: number;
  team_count: number;
  stat_observation_count: number;
  latest_observed_at: string | null;
};

export type Competition = {
  competition_id: string;
  name: string;
  name_he: string | null;
  competition_type: string;
  country_name: string | null;
  season_count: number;
  latest_season_id: string | null;
  latest_season_name: string | null;
  scope: "domestic" | "european_club" | "national_team" | "national_youth" | "foreign_club";
  gender: string;
  age_group: string;
  participant_type: string;
};

export type Season = {
  season_id: string;
  competition_id: string;
  competition_name: string;
  competition_name_he: string | null;
  season_name: string;
  start_date: string | null;
  end_date: string | null;
  match_count: number;
  completed_match_count: number;
  team_count: number;
  player_count: number;
  goals_scored: number;
  first_match_at: string | null;
  latest_match_at: string | null;
  is_latest: boolean;
};

export type Round = {
  round_id: string;
  season_id: string;
  stage_id: string;
  stage_name: string;
  stage_type: string | null;
  stage_number: number | null;
  round_number: number | null;
  round_name: string;
  match_count: number;
  completed_match_count: number;
  first_match_at: string | null;
  last_match_at: string | null;
};

export type Match = {
  match_id: string;
  season_id: string;
  season_name: string;
  competition_id: string;
  competition_name: string;
  competition_name_he: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_number: number | null;
  round_id: string | null;
  round_number: number | null;
  round_name: string | null;
  scheduled_at: string | null;
  status: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_name_he: string | null;
  home_team_short_name: string | null;
  home_team_color: string | null;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_name_he: string | null;
  away_team_short_name: string | null;
  away_team_color: string | null;
  away_team_logo_url: string | null;
  home_score: number | null;
  away_score: number | null;
};

export type Club = {
  season_id: string;
  competition_id: string;
  team_id: string;
  team_name: string;
  team_name_he: string | null;
  short_name: string | null;
  city: string | null;
  founded_year: number | null;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  last_played_at: string | null;
};

export type TeamAsset = {
  team_id: string;
  logo_url: string | null;
  logo_source_id: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

export type SeasonPlayer = {
  season_id: string;
  competition_id: string;
  player_id: string;
  display_name: string;
  display_name_he: string | null;
  primary_position: string | null;
  specific_position: string | null;
  role_group: "Goalkeepers" | "Defenders" | "Midfielders" | "Attackers" | "Other";
  team_id: string | null;
  team_name: string | null;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  average_rating: number | null;
};

export type Legionnaire = SeasonPlayer & {
  competition_name: string;
  competition_name_he: string | null;
  team_logo_url: string | null;
};

export type PlayerLeaderboardRow = {
  season_id: string;
  player_id: string;
  display_name: string;
  team_id: string | null;
  team_name: string | null;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  value_type: string;
  aggregation: "total" | "average" | "weighted";
  sample_size: number;
  leaderboard_value: number | null;
  total_value: number | null;
  average_value: number | null;
  numerator_value: number | null;
  denominator_value: number | null;
};

export type Metric = {
  metric_id: string;
  code: string;
  name: string;
  subject_type: "player_match" | "team_match";
  value_type: string;
  numerator_metric_code: string | null;
  denominator_metric_code: string | null;
};

export type PlayerHistory = {
  player_id: string;
  display_name: string;
  season_id: string;
  competition_id: string;
  stage_id: string | null;
  round_id: string | null;
  round_number: number | null;
  appearance_id: string;
  team_id: string;
  team_name: string;
  opponent_team_id: string | null;
  opponent_team_name: string | null;
  match_id: string;
  scheduled_at: string | null;
  home_score: number | null;
  away_score: number | null;
  side: "home" | "away" | null;
  minutes_played: number | null;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  value_type: string;
  source_id: string;
  source_code: string;
  source_name: string;
  value_numeric: number | null;
  raw_value: string | null;
};

export type PlayerValuation = {
  player_id: string;
  display_name: string;
  display_name_he: string | null;
  valuation_date: string;
  value_amount: number;
  currency: string;
  lower_bound: number | null;
  upper_bound: number | null;
  provider: string | null;
  source_player_id: string;
  source_team_id: string | null;
  source_team_name: string | null;
  source_url: string | null;
  source_id: string;
  source_code: string;
  source_name: string;
  observed_at: string;
};

export type MatchPlayerStat = {
  match_id: string;
  season_id: string;
  appearance_id: string;
  player_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  opponent_team_id: string | null;
  opponent_team_name: string | null;
  side: "home" | "away" | null;
  shirt_number: number | null;
  lineup_status: string | null;
  position_name: string | null;
  formation_position: string | null;
  minutes_played: number | null;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  value_type: string;
  source_id: string;
  source_code: string;
  source_name: string;
  value_numeric: number | null;
  raw_value: string | null;
};

export type MatchTeamStat = {
  match_id: string;
  season_id: string;
  match_team_id: string;
  team_id: string;
  team_name: string;
  opponent_team_id: string | null;
  opponent_team_name: string | null;
  side: "home" | "away";
  score: number | null;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  value_type: string;
  source_id: string;
  source_code: string;
  source_name: string;
  value_numeric: number | null;
  raw_value: string | null;
};

export type MatchPlayerHeatmap = {
  match_id: string;
  appearance_id: string;
  player_id: string;
  display_name: string;
  display_name_he: string | null;
  team_id: string;
  team_name: string;
  team_name_he: string | null;
  heatmap_url: string;
  source_id: string;
  source_code: string;
  source_name: string;
  observed_at: string;
};

export type PlayerSeasonHeatmap = MatchPlayerHeatmap & {
  season_id: string;
  scheduled_at: string | null;
  minutes_played: number | null;
};

export type MatchShot = {
  match_id: string;
  event_id: string;
  source_event_id: string | null;
  minute: number | null;
  event_time: string | null;
  team_id: string | null;
  team_name: string | null;
  team_name_he: string | null;
  side: "home" | "away" | null;
  player_id: string | null;
  display_name: string | null;
  display_name_he: string | null;
  x: number | null;
  y: number | null;
  xg: number | null;
  xgot: number | null;
  outcome: string | null;
  body_part: string | null;
  situation: string | null;
  goal_mouth_x: number | null;
  goal_mouth_y: number | null;
  goal_description: string | null;
  source_id: string;
  source_code: string;
  source_name: string;
};
