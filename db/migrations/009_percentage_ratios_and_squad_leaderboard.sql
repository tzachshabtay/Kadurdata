update obs.metrics metric
set metadata = metric.metadata || jsonb_build_object(
  'numerator_metric_code', ratio.numerator_code,
  'denominator_metric_code', ratio.denominator_code
)
from (
  values
    ('aerial_duel_win_pct', 'aerial_duels_won', 'aerial_duels_attempted'),
    ('cross_completion_pct', 'crosses_completed', 'crosses_attempted'),
    ('dribble_success_pct', 'successful_dribbles', 'dribbles_attempted'),
    ('ground_duel_win_pct', 'ground_duels_won', 'ground_duels_attempted'),
    ('long_pass_completion_pct', 'long_passes_completed', 'long_passes_attempted'),
    ('pass_completion_pct', 'passes_completed', 'passes_attempted'),
    ('tackle_success_pct', 'tackles_won', 'tackles_attempted')
) as ratio(metric_code, numerator_code, denominator_code)
where metric.code = ratio.metric_code;

create or replace view public.api_metrics as
select
  id as metric_id,
  code,
  name,
  subject_type,
  value_type,
  metadata ->> 'numerator_metric_code' as numerator_metric_code,
  metadata ->> 'denominator_metric_code' as denominator_metric_code
from obs.metrics
where subject_type in ('player_match', 'team_match');

grant select on public.api_metrics to anon, authenticated;

drop function if exists public.api_player_leaderboard(uuid, text);

create function public.api_player_leaderboard(
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
  average_value numeric,
  numerator_value numeric,
  denominator_value numeric
)
language sql
stable
security invoker
set search_path = public, core, obs
as $function$
  with selected_metric as (
    select
      m.id,
      m.code,
      m.name,
      m.value_type,
      m.metadata ->> 'numerator_metric_code' as numerator_code,
      m.metadata ->> 'denominator_metric_code' as denominator_code
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
  ),
  component_source_resolved as (
    select
      so.player_id,
      so.subject_id,
      component_metric.code as component_code,
      avg(so.value_numeric) as match_value
    from obs.stat_observations so
    join obs.metrics component_metric on component_metric.id = so.metric_id
    cross join selected_metric metric
    where so.subject_type = 'player_match'
      and so.season_id = p_season_id
      and so.player_id is not null
      and so.subject_id is not null
      and so.value_numeric is not null
      and component_metric.code in (metric.numerator_code, metric.denominator_code)
    group by so.player_id, so.subject_id, component_metric.code
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

grant execute on function public.api_player_leaderboard(uuid, text) to anon, authenticated;
