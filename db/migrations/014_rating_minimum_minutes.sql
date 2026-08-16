update obs.metrics
set name = 'Rating (365Score)'
where code = 'rating_365';

drop function if exists public.api_player_leaderboard(uuid, text, numeric);

create function public.api_player_leaderboard(
  p_season_id uuid,
  p_metric_code text,
  p_min_minutes numeric
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
  average_value numeric,
  numerator_value numeric,
  denominator_value numeric
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  with selected_metric as (
    select
      metric.id,
      metric.code,
      metric.name,
      metric.value_type,
      metric.metadata ->> 'numerator_metric_code' as numerator_code,
      metric.metadata ->> 'denominator_metric_code' as denominator_code
    from obs.metrics metric
    where metric.code = p_metric_code
      and metric.subject_type = 'player_match'
  ),
  season_players as (
    select distinct appearance.player_id
    from core.player_match_appearances appearance
    join core.matches season_match on season_match.id = appearance.match_id
    where season_match.season_id = p_season_id
  ),
  latest_team as (
    select distinct on (appearance.player_id)
      appearance.player_id,
      appearance.team_id
    from core.player_match_appearances appearance
    join core.matches season_match on season_match.id = appearance.match_id
    where season_match.season_id = p_season_id
    order by appearance.player_id, season_match.scheduled_at desc nulls last, appearance.id
  ),
  source_resolved as (
    select
      observation.player_id,
      observation.subject_id,
      avg(observation.value_numeric) as match_value
    from obs.stat_observations observation
    join selected_metric metric on metric.id = observation.metric_id
    join core.player_match_appearances appearance on appearance.id = observation.subject_id
    where observation.subject_type = 'player_match'
      and observation.season_id = p_season_id
      and observation.player_id is not null
      and observation.subject_id is not null
      and observation.value_numeric is not null
      and (
        metric.value_type <> 'rating'
        or coalesce(appearance.minutes_played, 0) >= greatest(coalesce(p_min_minutes, 0), 0)
      )
    group by observation.player_id, observation.subject_id
  ),
  player_totals as (
    select
      resolved.player_id,
      count(*)::integer as sample_size,
      sum(resolved.match_value) as total_value,
      avg(resolved.match_value) as average_value
    from source_resolved resolved
    group by resolved.player_id
  ),
  component_source_resolved as (
    select
      observation.player_id,
      observation.subject_id,
      component_metric.code as component_code,
      avg(observation.value_numeric) as match_value
    from obs.stat_observations observation
    join obs.metrics component_metric on component_metric.id = observation.metric_id
    cross join selected_metric metric
    where observation.subject_type = 'player_match'
      and observation.season_id = p_season_id
      and observation.player_id is not null
      and observation.subject_id is not null
      and observation.value_numeric is not null
      and component_metric.code in (metric.numerator_code, metric.denominator_code)
    group by observation.player_id, observation.subject_id, component_metric.code
  ),
  component_totals as (
    select
      component.player_id,
      sum(component.match_value) filter (
        where component.component_code = metric.numerator_code
      ) as numerator_value,
      sum(component.match_value) filter (
        where component.component_code = metric.denominator_code
      ) as denominator_value
    from component_source_resolved component
    cross join selected_metric metric
    group by component.player_id
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
      when metric.value_type = 'percentage' then 'weighted'
      when metric.value_type in ('rating', 'average', 'ratio') then 'average'
      else 'total'
    end as aggregation,
    coalesce(totals.sample_size, 0) as sample_size,
    case
      when metric.value_type = 'percentage' and components.denominator_value > 0
        then components.numerator_value * 100 / components.denominator_value
      when metric.value_type in ('percentage', 'rating', 'average', 'ratio')
        then totals.average_value
      else coalesce(totals.total_value, 0)
    end as leaderboard_value,
    totals.total_value,
    totals.average_value,
    components.numerator_value,
    components.denominator_value
  from season_players season_player
  join core.players player on player.id = season_player.player_id
  cross join selected_metric metric
  left join latest_team latest on latest.player_id = player.id
  left join core.teams team on team.id = latest.team_id
  left join player_totals totals on totals.player_id = player.id
  left join component_totals components on components.player_id = player.id
  order by leaderboard_value desc nulls last, player.display_name;
$function$;

revoke all on function public.api_player_leaderboard(uuid, text, numeric) from public;
grant execute on function public.api_player_leaderboard(uuid, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
