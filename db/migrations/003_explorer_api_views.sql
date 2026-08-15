create or replace view public.api_competitions as
with season_rank as (
  select
    s.*,
    row_number() over (
      partition by s.competition_id
      order by s.start_date desc nulls last, s.name desc
    ) as recency_rank
  from core.seasons s
)
select
  c.id as competition_id,
  c.name,
  c.name_he,
  c.competition_type,
  country.name as country_name,
  count(sr.id)::integer as season_count,
  (max(sr.id::text) filter (where sr.recency_rank = 1))::uuid as latest_season_id,
  max(sr.name) filter (where sr.recency_rank = 1) as latest_season_name
from core.competitions c
left join core.countries country on country.id = c.country_id
left join season_rank sr on sr.competition_id = c.id
group by c.id, country.name;

create or replace view public.api_seasons as
with match_totals as (
  select
    season_id,
    count(*)::integer as match_count,
    count(*) filter (where home_score is not null and away_score is not null)::integer
      as completed_match_count,
    coalesce(sum(home_score + away_score) filter (
      where home_score is not null and away_score is not null
    ), 0)::integer as goals_scored,
    min(scheduled_at) as first_match_at,
    max(scheduled_at) as latest_match_at
  from core.matches
  group by season_id
),
team_totals as (
  select m.season_id, count(distinct mt.team_id)::integer as team_count
  from core.matches m
  join core.match_teams mt on mt.match_id = m.id
  group by m.season_id
),
player_totals as (
  select m.season_id, count(distinct pma.player_id)::integer as player_count
  from core.matches m
  join core.player_match_appearances pma on pma.match_id = m.id
  group by m.season_id
),
season_base as (
  select
    s.id as season_id,
    s.competition_id,
    c.name as competition_name,
    c.name_he as competition_name_he,
    s.name as season_name,
    s.start_date,
    s.end_date,
    coalesce(matches.match_count, 0) as match_count,
    coalesce(matches.completed_match_count, 0) as completed_match_count,
    coalesce(teams.team_count, 0) as team_count,
    coalesce(players.player_count, 0) as player_count,
    coalesce(matches.goals_scored, 0) as goals_scored,
    matches.first_match_at,
    matches.latest_match_at
  from core.seasons s
  join core.competitions c on c.id = s.competition_id
  left join match_totals matches on matches.season_id = s.id
  left join team_totals teams on teams.season_id = s.id
  left join player_totals players on players.season_id = s.id
)
select
  season_base.*,
  row_number() over (
    partition by competition_id
    order by start_date desc nulls last, season_name desc
  ) = 1 as is_latest
from season_base;

create or replace view public.api_rounds as
select
  r.id as round_id,
  s.id as season_id,
  stage.id as stage_id,
  stage.name as stage_name,
  stage.stage_type,
  stage.stage_number,
  r.round_number,
  coalesce(r.name, 'Round') as round_name,
  count(m.id)::integer as match_count,
  count(m.id) filter (where m.home_score is not null and m.away_score is not null)::integer
    as completed_match_count,
  min(m.scheduled_at) as first_match_at,
  max(m.scheduled_at) as last_match_at
from core.rounds r
join core.season_stages stage on stage.id = r.stage_id
join core.seasons s on s.id = stage.season_id
left join core.matches m on m.round_id = r.id
group by r.id, s.id, stage.id;

create or replace view public.api_matches as
select
  m.id as match_id,
  m.season_id,
  s.name as season_name,
  s.competition_id,
  c.name as competition_name,
  c.name_he as competition_name_he,
  m.stage_id,
  stage.name as stage_name,
  stage.stage_number,
  m.round_id,
  r.round_number,
  r.name as round_name,
  m.scheduled_at,
  m.status,
  home.id as home_team_id,
  home.name as home_team_name,
  home.name_he as home_team_name_he,
  home.short_name as home_team_short_name,
  home.primary_color as home_team_color,
  away.id as away_team_id,
  away.name as away_team_name,
  away.name_he as away_team_name_he,
  away.short_name as away_team_short_name,
  away.primary_color as away_team_color,
  m.home_score,
  m.away_score
from core.matches m
join core.seasons s on s.id = m.season_id
join core.competitions c on c.id = s.competition_id
left join core.season_stages stage on stage.id = m.stage_id
left join core.rounds r on r.id = m.round_id
join core.teams home on home.id = m.home_team_id
join core.teams away on away.id = m.away_team_id;

create or replace view public.api_clubs as
with club_matches as (
  select
    m.season_id,
    mt.team_id,
    opponent.score as opponent_score,
    mt.score,
    m.scheduled_at,
    m.home_score is not null and m.away_score is not null as is_completed
  from core.match_teams mt
  join core.matches m on m.id = mt.match_id
  left join core.match_teams opponent
    on opponent.match_id = mt.match_id
   and opponent.team_id = mt.opponent_team_id
),
club_totals as (
  select
    season_id,
    team_id,
    count(*) filter (where is_completed)::integer as played,
    count(*) filter (where is_completed and score > opponent_score)::integer as won,
    count(*) filter (where is_completed and score = opponent_score)::integer as drawn,
    count(*) filter (where is_completed and score < opponent_score)::integer as lost,
    coalesce(sum(score) filter (where is_completed), 0)::integer as goals_for,
    coalesce(sum(opponent_score) filter (where is_completed), 0)::integer as goals_against,
    max(scheduled_at) filter (where is_completed) as last_played_at
  from club_matches
  group by season_id, team_id
)
select
  totals.season_id,
  s.competition_id,
  team.id as team_id,
  team.name as team_name,
  team.name_he as team_name_he,
  team.short_name,
  team.city,
  team.founded_year,
  team.primary_color,
  team.secondary_color,
  totals.played,
  totals.won,
  totals.drawn,
  totals.lost,
  totals.goals_for,
  totals.goals_against,
  totals.goals_for - totals.goals_against as goal_difference,
  totals.won * 3 + totals.drawn as points,
  totals.last_played_at
from club_totals totals
join core.seasons s on s.id = totals.season_id
join core.teams team on team.id = totals.team_id;

create or replace view public.api_season_players as
with latest_team as (
  select distinct on (m.season_id, pma.player_id)
    m.season_id,
    pma.player_id,
    pma.team_id,
    pma.position_name,
    m.scheduled_at
  from core.player_match_appearances pma
  join core.matches m on m.id = pma.match_id
  order by m.season_id, pma.player_id, m.scheduled_at desc nulls last
),
appearance_totals as (
  select
    m.season_id,
    pma.player_id,
    count(distinct pma.match_id)::integer as appearances,
    count(distinct pma.match_id) filter (where lower(coalesce(pma.lineup_status, '')) like '%start%')::integer
      as starts,
    coalesce(sum(pma.minutes_played), 0)::numeric(10,2) as minutes
  from core.player_match_appearances pma
  join core.matches m on m.id = pma.match_id
  group by m.season_id, pma.player_id
),
performance as (
  select
    so.season_id,
    so.player_id,
    coalesce(sum(so.value_numeric) filter (where metric.code = 'goals'), 0)::numeric(10,2) as goals,
    coalesce(sum(so.value_numeric) filter (where metric.code = 'assists'), 0)::numeric(10,2) as assists,
    avg(so.value_numeric) filter (where metric.code = 'rating_365')::numeric(6,2) as average_rating
  from obs.stat_observations so
  join obs.metrics metric on metric.id = so.metric_id
  where so.subject_type = 'player_match'
    and metric.code in ('goals', 'assists', 'rating_365')
  group by so.season_id, so.player_id
)
select
  totals.season_id,
  s.competition_id,
  player.id as player_id,
  player.display_name,
  player.display_name_he,
  coalesce(latest.position_name, player.primary_position) as primary_position,
  case
    when lower(coalesce(latest.position_name, player.primary_position, '')) like '%goal%' then 'Goalkeepers'
    when lower(coalesce(latest.position_name, player.primary_position, '')) like '%defend%'
      or lower(coalesce(latest.position_name, player.primary_position, '')) like '%back%' then 'Defenders'
    when lower(coalesce(latest.position_name, player.primary_position, '')) like '%mid%' then 'Midfielders'
    when lower(coalesce(latest.position_name, player.primary_position, '')) like '%attack%'
      or lower(coalesce(latest.position_name, player.primary_position, '')) like '%forward%'
      or lower(coalesce(latest.position_name, player.primary_position, '')) like '%wing%'
      or lower(coalesce(latest.position_name, player.primary_position, '')) like '%striker%' then 'Attackers'
    else 'Other'
  end as role_group,
  latest.team_id,
  team.name as team_name,
  totals.appearances,
  totals.starts,
  totals.minutes,
  coalesce(performance.goals, 0) as goals,
  coalesce(performance.assists, 0) as assists,
  performance.average_rating
from appearance_totals totals
join core.seasons s on s.id = totals.season_id
join core.players player on player.id = totals.player_id
left join latest_team latest
  on latest.season_id = totals.season_id
 and latest.player_id = totals.player_id
left join core.teams team on team.id = latest.team_id
left join performance
  on performance.season_id = totals.season_id
 and performance.player_id = totals.player_id;

create or replace view public.api_player_history as
select
  p.id as player_id,
  p.display_name,
  m.season_id,
  s.competition_id,
  m.stage_id,
  m.round_id,
  r.round_number,
  pma.id as appearance_id,
  pma.team_id,
  team.name as team_name,
  pma.opponent_team_id,
  opponent.name as opponent_team_name,
  m.id as match_id,
  m.scheduled_at,
  m.home_score,
  m.away_score,
  pma.side,
  pma.minutes_played,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  so.value_numeric,
  so.raw_value
from obs.stat_observations so
join source.sources source on source.id = so.source_id
join obs.metrics metric on metric.id = so.metric_id
join core.player_match_appearances pma on pma.id = so.subject_id
join core.players p on p.id = pma.player_id
join core.teams team on team.id = pma.team_id
left join core.teams opponent on opponent.id = pma.opponent_team_id
join core.matches m on m.id = pma.match_id
join core.seasons s on s.id = m.season_id
left join core.rounds r on r.id = m.round_id
where so.subject_type = 'player_match';

create or replace view public.api_match_player_stats as
select
  m.id as match_id,
  m.season_id,
  pma.id as appearance_id,
  p.id as player_id,
  p.display_name,
  pma.team_id,
  team.name as team_name,
  pma.opponent_team_id,
  opponent.name as opponent_team_name,
  pma.side,
  pma.shirt_number,
  pma.lineup_status,
  pma.position_name,
  pma.formation_position,
  pma.minutes_played,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  so.value_numeric,
  so.raw_value
from core.player_match_appearances pma
join core.matches m on m.id = pma.match_id
join core.players p on p.id = pma.player_id
join core.teams team on team.id = pma.team_id
left join core.teams opponent on opponent.id = pma.opponent_team_id
join obs.stat_observations so
  on so.subject_type = 'player_match'
 and so.subject_id = pma.id
join source.sources source on source.id = so.source_id
join obs.metrics metric on metric.id = so.metric_id;

create or replace view public.api_match_team_stats as
select
  m.id as match_id,
  m.season_id,
  mt.id as match_team_id,
  mt.team_id,
  team.name as team_name,
  mt.opponent_team_id,
  opponent.name as opponent_team_name,
  mt.side,
  mt.score,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  so.value_numeric,
  so.raw_value
from core.match_teams mt
join core.matches m on m.id = mt.match_id
join core.teams team on team.id = mt.team_id
left join core.teams opponent on opponent.id = mt.opponent_team_id
join obs.stat_observations so
  on so.subject_type = 'team_match'
 and so.subject_id = mt.id
join source.sources source on source.id = so.source_id
join obs.metrics metric on metric.id = so.metric_id;

grant select on
  public.api_competitions,
  public.api_seasons,
  public.api_rounds,
  public.api_matches,
  public.api_clubs,
  public.api_season_players,
  public.api_player_history,
  public.api_match_player_stats,
  public.api_match_team_stats
to anon, authenticated;
