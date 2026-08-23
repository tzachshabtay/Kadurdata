create or replace function public.api_player_valuation_leaderboard(
  p_season_id uuid
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
  denominator_value numeric,
  currency text,
  valuation_date date
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  with candidates as materialized (
    select
      player.season_id,
      player.player_id,
      player.display_name,
      player.team_id,
      player.team_name,
      0 as preference
    from public.api_season_players_for_season(p_season_id) player
    union all
    select
      roster.season_id,
      roster.player_id,
      roster.display_name,
      roster.team_id,
      roster.team_name,
      1 as preference
    from public.api_team_rosters_for_season(p_season_id) roster
    where not roster.is_management
  ), eligible_players as (
    select distinct on (candidate.player_id)
      candidate.season_id,
      candidate.player_id,
      candidate.display_name,
      candidate.team_id,
      candidate.team_name
    from candidates candidate
    order by candidate.player_id, candidate.preference
  )
  select
    player.season_id,
    player.player_id,
    player.display_name,
    player.team_id,
    player.team_name,
    null::uuid as metric_id,
    'current_valuation'::text as metric_code,
    'Estimated transfer value'::text as metric_name,
    'currency'::text as value_type,
    'latest'::text as aggregation,
    case when latest.value_amount is null then 0 else 1 end::integer as sample_size,
    latest.value_amount::numeric as leaderboard_value,
    latest.value_amount::numeric as total_value,
    latest.value_amount::numeric as average_value,
    null::numeric as numerator_value,
    null::numeric as denominator_value,
    latest.currency,
    latest.valuation_date
  from eligible_players player
  left join lateral (
    select
      series.currency,
      series.valuation_dates[point.position] as valuation_date,
      series.value_amounts[point.position] as value_amount
    from obs.player_valuation_series series
    cross join lateral (
      select array_upper(series.valuation_dates, 1) as position
    ) point
    where series.player_id = player.player_id
    order by
      series.valuation_dates[point.position] desc,
      series.observed_at desc,
      series.source_player_id
    limit 1
  ) latest on true
  order by latest.value_amount desc nulls last, player.display_name;
$function$;

revoke all on function public.api_player_valuation_leaderboard(uuid) from public;
grant execute on function public.api_player_valuation_leaderboard(uuid) to anon, authenticated;

create or replace function public.api_legionnaire_valuation_leaderboard(
  p_season_name text
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
  denominator_value numeric,
  currency text,
  valuation_date date
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  select
    player.season_id,
    player.player_id,
    player.display_name,
    player.team_id,
    player.team_name,
    null::uuid as metric_id,
    'current_valuation'::text as metric_code,
    'Estimated transfer value'::text as metric_name,
    'currency'::text as value_type,
    'latest'::text as aggregation,
    case when latest.value_amount is null then 0 else 1 end::integer as sample_size,
    latest.value_amount::numeric as leaderboard_value,
    latest.value_amount::numeric as total_value,
    latest.value_amount::numeric as average_value,
    null::numeric as numerator_value,
    null::numeric as denominator_value,
    latest.currency,
    latest.valuation_date
  from public.api_legionnaires(p_season_name) player
  left join lateral (
    select
      series.currency,
      series.valuation_dates[point.position] as valuation_date,
      series.value_amounts[point.position] as value_amount
    from obs.player_valuation_series series
    cross join lateral (
      select array_upper(series.valuation_dates, 1) as position
    ) point
    where series.player_id = player.player_id
    order by
      series.valuation_dates[point.position] desc,
      series.observed_at desc,
      series.source_player_id
    limit 1
  ) latest on true
  order by latest.value_amount desc nulls last, player.display_name;
$function$;

revoke all on function public.api_legionnaire_valuation_leaderboard(text) from public;
grant execute on function public.api_legionnaire_valuation_leaderboard(text) to anon, authenticated;

notify pgrst, 'reload schema';
