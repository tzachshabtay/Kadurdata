create index if not exists stat_observations_player_season_metric_idx
  on obs.stat_observations (player_id, season_id, metric_id)
  include (value_numeric)
  where subject_type = 'player_match';

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
left join lateral (
  select
    coalesce(sum(so.value_numeric) filter (where metric.code = 'goals'), 0)::numeric(10,2) as goals,
    coalesce(sum(so.value_numeric) filter (where metric.code = 'assists'), 0)::numeric(10,2) as assists,
    (avg(so.value_numeric) filter (where metric.code = 'rating_365'))::numeric(6,2) as average_rating
  from obs.stat_observations so
  join obs.metrics metric on metric.id = so.metric_id
  where so.subject_type = 'player_match'
    and so.player_id = totals.player_id
    and so.season_id = totals.season_id
    and metric.code in ('goals', 'assists', 'rating_365')
) performance on true;
