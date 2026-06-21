create extension if not exists pgcrypto;

create schema if not exists source;
create schema if not exists core;
create schema if not exists obs;
create schema if not exists analytics;

create table source.sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null,
  base_url text,
  is_active boolean not null default true,
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table source.source_entity_ids (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  entity_type text not null,
  source_entity_id text not null,
  canonical_table text,
  canonical_id uuid,
  source_name text,
  source_slug text,
  confidence numeric(5,4) not null default 1.0,
  mapping_status text not null default 'auto',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (source_id, entity_type, source_entity_id)
);

create index source_entity_ids_entity_idx
  on source.source_entity_ids (entity_type, canonical_id);

create index source_entity_ids_mapping_status_idx
  on source.source_entity_ids (mapping_status);

create table core.countries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  iso2 text,
  iso3 text
);

create table core.competitions (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references core.countries(id),
  name text not null,
  name_he text,
  competition_type text not null,
  gender text not null default 'men',
  metadata jsonb not null default '{}'::jsonb
);

create table core.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references core.competitions(id),
  name text not null,
  start_date date,
  end_date date,
  metadata jsonb not null default '{}'::jsonb,
  unique (competition_id, name)
);

create table core.season_stages (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references core.seasons(id),
  name text not null,
  stage_type text,
  stage_number integer,
  metadata jsonb not null default '{}'::jsonb,
  unique (season_id, stage_number)
);

create table core.rounds (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references core.season_stages(id),
  round_number integer,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  unique (stage_id, round_number)
);

create table core.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_he text,
  short_name text,
  city text,
  founded_year integer,
  primary_color text,
  secondary_color text,
  metadata jsonb not null default '{}'::jsonb
);

create table core.team_seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references core.teams(id),
  season_id uuid not null references core.seasons(id),
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  unique (team_id, season_id)
);

create table core.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  display_name_he text,
  date_of_birth date,
  country_id uuid references core.countries(id),
  primary_position text,
  preferred_foot text,
  metadata jsonb not null default '{}'::jsonb
);

create table core.player_team_stints (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references core.players(id),
  team_id uuid not null references core.teams(id),
  season_id uuid references core.seasons(id),
  start_date date,
  end_date date,
  shirt_number integer,
  metadata jsonb not null default '{}'::jsonb
);

create table core.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country_id uuid references core.countries(id),
  capacity integer,
  metadata jsonb not null default '{}'::jsonb
);

create table core.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references core.seasons(id),
  stage_id uuid references core.season_stages(id),
  round_id uuid references core.rounds(id),
  venue_id uuid references core.venues(id),
  scheduled_at timestamptz,
  status text,
  home_team_id uuid references core.teams(id),
  away_team_id uuid references core.teams(id),
  home_score integer,
  away_score integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matches_season_scheduled_at_idx
  on core.matches (season_id, scheduled_at);

create index matches_home_scheduled_at_idx
  on core.matches (home_team_id, scheduled_at);

create index matches_away_scheduled_at_idx
  on core.matches (away_team_id, scheduled_at);

create table core.match_teams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references core.matches(id),
  team_id uuid not null references core.teams(id),
  opponent_team_id uuid references core.teams(id),
  side text not null,
  score integer,
  is_winner boolean,
  red_cards integer,
  formation text,
  coach_name text,
  metadata jsonb not null default '{}'::jsonb,
  unique (match_id, team_id),
  unique (match_id, side)
);

create table core.player_match_appearances (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references core.matches(id),
  player_id uuid not null references core.players(id),
  team_id uuid not null references core.teams(id),
  opponent_team_id uuid references core.teams(id),
  side text,
  shirt_number integer,
  lineup_status text,
  position_name text,
  formation_position text,
  minutes_played numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  unique (match_id, player_id, team_id)
);

create table obs.metrics (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  subject_type text not null,
  value_type text not null,
  unit text,
  higher_is_better boolean,
  description text,
  metadata jsonb not null default '{}'::jsonb
);

create table obs.source_metric_mappings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  source_metric_id text,
  source_metric_name text not null,
  canonical_metric_id uuid references obs.metrics(id),
  parser text,
  mapping_status text not null default 'auto',
  metadata jsonb not null default '{}'::jsonb
);

create unique index source_metric_mappings_unique_idx
  on obs.source_metric_mappings (
    source_id,
    source_metric_name,
    coalesce(source_metric_id, '')
  );

create table obs.match_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  match_id uuid references core.matches(id),
  source_match_id text not null,
  observed_at timestamptz not null default now(),
  scheduled_at timestamptz,
  status text,
  home_source_team_id text,
  away_source_team_id text,
  home_score integer,
  away_score integer,
  venue_name text,
  round_name text,
  unique (source_id, source_match_id)
);

create table obs.player_appearance_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  appearance_id uuid references core.player_match_appearances(id),
  match_id uuid references core.matches(id),
  player_id uuid references core.players(id),
  team_id uuid references core.teams(id),
  source_match_id text not null,
  source_player_id text not null,
  source_team_id text,
  observed_at timestamptz not null default now(),
  lineup_status text,
  position_name text,
  formation_name text,
  shirt_number integer,
  rating numeric(6,3),
  heatmap_url text,
  unique (source_id, source_match_id, source_player_id)
);

create index player_appearance_observations_source_idx
  on obs.player_appearance_observations (source_id, source_match_id, source_player_id);

create table obs.stat_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  metric_id uuid not null references obs.metrics(id),
  subject_type text not null,
  subject_id uuid,
  match_id uuid references core.matches(id),
  team_id uuid references core.teams(id),
  player_id uuid references core.players(id),
  season_id uuid references core.seasons(id),
  source_subject_id text,
  source_metric_id text,
  source_metric_name text,
  value_numeric numeric(18,6),
  value_text text,
  raw_value text,
  observed_at timestamptz not null default now(),
  confidence numeric(5,4) not null default 1.0,
  unique (source_id, subject_type, subject_id, metric_id)
);

create index stat_observations_subject_metric_idx
  on obs.stat_observations (subject_type, subject_id, metric_id);

create index stat_observations_match_metric_idx
  on obs.stat_observations (match_id, metric_id);

create index stat_observations_player_metric_match_idx
  on obs.stat_observations (player_id, metric_id, match_id);

create index stat_observations_team_metric_match_idx
  on obs.stat_observations (team_id, metric_id, match_id);

create index stat_observations_source_subject_metric_idx
  on obs.stat_observations (source_id, source_subject_id, source_metric_name);

create table obs.events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  match_id uuid references core.matches(id),
  source_event_id text,
  event_type text not null,
  minute integer,
  second integer,
  period text,
  team_id uuid references core.teams(id),
  player_id uuid references core.players(id),
  related_player_id uuid references core.players(id),
  x numeric(8,4),
  y numeric(8,4),
  value numeric(18,6)
);

create table obs.heatmaps (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  appearance_id uuid references core.player_match_appearances(id),
  match_id uuid references core.matches(id),
  player_id uuid references core.players(id),
  url text,
  data jsonb,
  image_path text,
  observed_at timestamptz not null default now()
);
