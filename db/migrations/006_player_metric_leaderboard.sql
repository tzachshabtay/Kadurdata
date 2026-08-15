create index if not exists stat_observations_season_metric_player_idx
  on obs.stat_observations (season_id, metric_id, player_id, subject_id)
  include (value_numeric)
  where subject_type = 'player_match' and value_numeric is not null;

create index if not exists player_match_appearances_player_match_idx
  on core.player_match_appearances (player_id, match_id, team_id);

create or replace function public.api_player_leaderboard(
  p_season_id uuid,
  p_metric_code text
)
returns table (
  season_id uuid,
  player_id uuid,
  display_name text,
  team_id uuid,
  team_name text,
  metric_id uuid,
  metric_code text,
  metric_name text,
  value_type text,
  aggregation text,
  sample_size integer,
  leaderboard_value numeric,
  total_value numeric,
  average_value numeric
)
language sql
stable
security invoker
set search_path = public, core, obs
as $function$
  with selected_metric as (
    select m.id, m.code, m.name, m.value_type
    from obs.metrics m
    where m.code = p_metric_code
      and m.subject_type = 'player_match'
  ),
  season_players as (
    select distinct pma.player_id
    from core.player_match_appearances pma
    join core.matches season_match on season_match.id = pma.match_id
    where season_match.season_id = p_season_id
  ),
  latest_team as (
    select distinct on (pma.player_id)
      pma.player_id,
      pma.team_id
    from core.player_match_appearances pma
    join core.matches season_match on season_match.id = pma.match_id
    where season_match.season_id = p_season_id
    order by pma.player_id, season_match.scheduled_at desc nulls last, pma.id
  ),
  source_resolved as (
    select
      so.player_id,
      so.subject_id,
      avg(so.value_numeric) as match_value
    from obs.stat_observations so
    join selected_metric metric on metric.id = so.metric_id
    where so.subject_type = 'player_match'
      and so.season_id = p_season_id
      and so.player_id is not null
      and so.subject_id is not null
      and so.value_numeric is not null
    group by so.player_id, so.subject_id
  ),
  player_totals as (
    select
      resolved.player_id,
      count(*)::integer as sample_size,
      sum(resolved.match_value) as total_value,
      avg(resolved.match_value) as average_value
    from source_resolved resolved
    group by resolved.player_id
  )
  select
    p_season_id as season_id,
    player.id as player_id,
    player.display_name,
    latest.team_id,
    team.name as team_name,
    metric.id as metric_id,
    metric.code as metric_code,
    metric.name as metric_name,
    metric.value_type,
    case
      when metric.value_type in ('percentage', 'rating', 'average', 'ratio') then 'average'
      else 'total'
    end as aggregation,
    coalesce(totals.sample_size, 0) as sample_size,
    case
      when metric.value_type in ('percentage', 'rating', 'average', 'ratio') then totals.average_value
      else coalesce(totals.total_value, 0)
    end as leaderboard_value,
    totals.total_value,
    totals.average_value
  from season_players season_player
  join core.players player on player.id = season_player.player_id
  cross join selected_metric metric
  left join latest_team latest on latest.player_id = player.id
  left join core.teams team on team.id = latest.team_id
  left join player_totals totals on totals.player_id = player.id
  order by leaderboard_value desc nulls last, player.display_name;
$function$;

grant execute on function public.api_player_leaderboard(uuid, text) to anon, authenticated;
