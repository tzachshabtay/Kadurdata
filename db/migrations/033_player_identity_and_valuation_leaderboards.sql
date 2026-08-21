create function public.api_player_identity_key(
  p_display_name text,
  p_display_name_he text,
  p_date_of_birth date
)
returns text
language sql
immutable
set search_path = public
as $function$
  with normalized as (
    select
      btrim(regexp_replace(lower(coalesce(p_display_name, '')), '[^a-z0-9]+', ' ', 'g')) as english_name,
      btrim(regexp_replace(
        regexp_replace(coalesce(p_display_name_he, ''), '[^א-ת''׳״ -]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )) as hebrew_name
  ), canonical as (
    select
      case english_name
        when 'awaka eshata' then 'awka ashta'
        when 'gabi kanichowsky' then 'gabi kanikovski'
        when 'hasan hilu' then 'hassan hilo'
        when 'idan toklomati' then 'idan toklomaty'
        when 'itay zafrani' then 'itai zafrani'
        when 'mahmud jaber' then 'mahmoud jaber'
        when 'roy nawi' then 'roy navi'
        when 'tay abed' then 'tai abed'
        else english_name
      end as english_name,
      hebrew_name,
      english_name in (
        'awaka eshata', 'awka ashta',
        'gabi kanichowsky', 'gabi kanikovski',
        'hasan hilu', 'hassan hilo',
        'idan toklomati', 'idan toklomaty',
        'itay zafrani', 'itai zafrani',
        'mahmud jaber', 'mahmoud jaber',
        'roy nawi', 'roy navi',
        'tay abed', 'tai abed'
      ) as is_alias_family
    from normalized
  )
  select case
    when is_alias_family
      then 'alias:' || english_name
    when p_date_of_birth is not null and nullif(hebrew_name, '') is not null
      then 'he:' || hebrew_name || ':' || p_date_of_birth::text
    when p_date_of_birth is not null
      then 'en:' || english_name || ':' || p_date_of_birth::text
    else 'en:' || english_name
  end
  from canonical;
$function$;

revoke all on function public.api_player_identity_key(text, text, date) from public;

alter function public.api_legionnaires(text)
  rename to api_legionnaires_with_duplicate_identities;

revoke all on function public.api_legionnaires_with_duplicate_identities(text)
  from public, anon, authenticated;

create function public.api_legionnaires(
  p_season_name text
)
returns table (
  season_id uuid,
  competition_id uuid,
  competition_name text,
  competition_name_he text,
  player_id uuid,
  display_name text,
  display_name_he text,
  primary_position text,
  specific_position text,
  role_group text,
  team_id uuid,
  team_name text,
  team_logo_url text,
  appearances integer,
  starts integer,
  minutes numeric,
  goals numeric,
  assists numeric,
  average_rating numeric
)
language sql
stable
security definer
set search_path = public, core, obs, source
as $function$
  with raw as materialized (
    select * from public.api_legionnaires_with_duplicate_identities(p_season_name)
  ), identified as (
    select
      raw.*,
      public.api_player_identity_key(
        raw.display_name,
        raw.display_name_he,
        player.date_of_birth
      ) as identity_key,
      exists (
        select 1
        from source.source_entity_ids mapping
        join source.sources source_catalog on source_catalog.id = mapping.source_id
        where source_catalog.code = '365scores'
          and mapping.entity_type = 'player'
          and mapping.canonical_id = raw.player_id
      ) as has_365scores_identity,
      exists (
        select 1
        from obs.player_valuation_series valuation
        where valuation.player_id = raw.player_id
      ) as has_valuation
    from raw
    join core.players player on player.id = raw.player_id
  ), ranked as (
    select
      identified.*,
      row_number() over (
        partition by identified.identity_key
        order by
          identified.has_365scores_identity desc,
          (identified.appearances > 0) desc,
          identified.minutes desc nulls last,
          identified.has_valuation desc,
          identified.player_id
      ) as identity_rank
    from identified
  )
  select
    ranked.season_id,
    ranked.competition_id,
    ranked.competition_name,
    ranked.competition_name_he,
    ranked.player_id,
    ranked.display_name,
    ranked.display_name_he,
    ranked.primary_position,
    ranked.specific_position,
    ranked.role_group,
    ranked.team_id,
    ranked.team_name,
    ranked.team_logo_url,
    ranked.appearances,
    ranked.starts,
    ranked.minutes,
    ranked.goals,
    ranked.assists,
    ranked.average_rating
  from ranked
  where ranked.identity_rank = 1
  order by ranked.minutes desc nulls last, ranked.display_name;
$function$;

revoke all on function public.api_legionnaires(text) from public;
grant execute on function public.api_legionnaires(text) to anon, authenticated;

create function public.api_player_valuation_leaderboard(
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
    1::integer as sample_size,
    latest.value_amount::numeric as leaderboard_value,
    latest.value_amount::numeric as total_value,
    latest.value_amount::numeric as average_value,
    null::numeric as numerator_value,
    null::numeric as denominator_value,
    latest.currency,
    latest.valuation_date
  from eligible_players player
  cross join lateral (
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
  ) latest
  order by latest.value_amount desc, player.display_name;
$function$;

revoke all on function public.api_player_valuation_leaderboard(uuid) from public;
grant execute on function public.api_player_valuation_leaderboard(uuid) to anon, authenticated;

create function public.api_legionnaire_valuation_leaderboard(
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
    1::integer as sample_size,
    latest.value_amount::numeric as leaderboard_value,
    latest.value_amount::numeric as total_value,
    latest.value_amount::numeric as average_value,
    null::numeric as numerator_value,
    null::numeric as denominator_value,
    latest.currency,
    latest.valuation_date
  from public.api_legionnaires(p_season_name) player
  cross join lateral (
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
  ) latest
  order by latest.value_amount desc, player.display_name;
$function$;

revoke all on function public.api_legionnaire_valuation_leaderboard(text) from public;
grant execute on function public.api_legionnaire_valuation_leaderboard(text) to anon, authenticated;

notify pgrst, 'reload schema';
