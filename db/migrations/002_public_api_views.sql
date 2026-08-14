create or replace view public.api_overview as
select
  (select count(*) from core.matches)::integer as match_count,
  (select count(*) from core.players)::integer as player_count,
  (select count(*) from core.teams)::integer as team_count,
  (select count(*) from obs.stat_observations)::integer as stat_observation_count,
  (select max(observed_at) from obs.stat_observations) as latest_observed_at;

create or replace view public.api_players as
with latest_appearance as (
  select distinct on (pma.player_id)
    pma.player_id,
    pma.team_id,
    pma.position_name,
    pma.minutes_played,
    m.scheduled_at
  from core.player_match_appearances pma
  join core.matches m on m.id = pma.match_id
  order by pma.player_id, m.scheduled_at desc nulls last
),
player_totals as (
  select
    pma.player_id,
    count(distinct pma.match_id)::integer as appearances,
    coalesce(sum(pma.minutes_played), 0)::numeric(10,2) as minutes
  from core.player_match_appearances pma
  group by pma.player_id
)
select
  p.id as player_id,
  p.display_name,
  p.primary_position,
  t.id as current_team_id,
  t.name as current_team_name,
  coalesce(pt.appearances, 0) as appearances,
  coalesce(pt.minutes, 0) as minutes
from core.players p
left join latest_appearance la on la.player_id = p.id
left join core.teams t on t.id = la.team_id
left join player_totals pt on pt.player_id = p.id;

create or replace view public.api_metrics as
select
  id as metric_id,
  code,
  name,
  subject_type,
  value_type
from obs.metrics
where subject_type in ('player_match', 'team_match');

create or replace view public.api_player_match_stats as
select
  p.id as player_id,
  p.display_name,
  t.id as team_id,
  t.name as team_name,
  opponent.id as opponent_team_id,
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
  so.value_numeric,
  so.raw_value
from obs.stat_observations so
join obs.metrics metric on metric.id = so.metric_id
join core.player_match_appearances pma on pma.id = so.subject_id
join core.players p on p.id = pma.player_id
join core.teams t on t.id = pma.team_id
left join core.teams opponent on opponent.id = pma.opponent_team_id
join core.matches m on m.id = pma.match_id
where so.subject_type = 'player_match';

create or replace view public.api_team_match_stats as
select
  t.id as team_id,
  t.name as team_name,
  opponent.id as opponent_team_id,
  opponent.name as opponent_team_name,
  m.id as match_id,
  m.scheduled_at,
  mt.side,
  mt.score,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  so.value_numeric,
  so.raw_value
from obs.stat_observations so
join obs.metrics metric on metric.id = so.metric_id
join core.match_teams mt on mt.id = so.subject_id
join core.teams t on t.id = mt.team_id
left join core.teams opponent on opponent.id = mt.opponent_team_id
join core.matches m on m.id = mt.match_id
where so.subject_type = 'team_match';

grant usage on schema public to anon, authenticated;
grant select on
  public.api_overview,
  public.api_players,
  public.api_metrics,
  public.api_player_match_stats,
  public.api_team_match_stats
to anon, authenticated;
