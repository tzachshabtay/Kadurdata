create index if not exists player_match_appearances_player_match_idx
  on core.player_match_appearances (player_id, match_id);

create or replace function public.api_season_players_for_season(
  p_season_id uuid
)
returns table (
  season_id uuid,
  competition_id uuid,
  player_id uuid,
  display_name text,
  display_name_he text,
  primary_position text,
  specific_position text,
  role_group text,
  team_id uuid,
  team_name text,
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
set search_path = public, core, obs
as $function$
  with season_appearances as materialized (
    select
      appearance.player_id,
      appearance.team_id,
      appearance.match_id,
      appearance.lineup_status,
      appearance.position_name,
      appearance.formation_position,
      appearance.minutes_played,
      season_match.scheduled_at,
      appearance.id as appearance_id
    from core.matches season_match
    join core.player_match_appearances appearance on appearance.match_id = season_match.id
    where season_match.season_id = p_season_id
  ),
  appearance_totals as (
    select
      appearance.player_id,
      count(distinct appearance.match_id)::integer as appearances,
      count(distinct appearance.match_id) filter (
        where lower(coalesce(appearance.lineup_status, '')) like '%start%'
      )::integer as starts,
      coalesce(sum(appearance.minutes_played), 0)::numeric(10,2) as minutes
    from season_appearances appearance
    group by appearance.player_id
  ),
  latest_team as (
    select distinct on (appearance.player_id)
      appearance.player_id,
      appearance.team_id,
      appearance.position_name
    from season_appearances appearance
    order by
      appearance.player_id,
      appearance.scheduled_at desc nulls last,
      appearance.appearance_id
  ),
  position_frequency as (
    select
      appearance.player_id,
      appearance.formation_position,
      row_number() over (
        partition by appearance.player_id
        order by
          count(*) desc,
          max(appearance.scheduled_at) desc nulls last,
          appearance.formation_position
      ) as preference
    from season_appearances appearance
    where nullif(trim(appearance.formation_position), '') is not null
      and lower(appearance.formation_position) not in ('coach', 'management')
    group by appearance.player_id, appearance.formation_position
  ),
  performance as (
    select
      appearance.player_id,
      coalesce(sum(stats.goals), 0)::numeric(10,2) as goals,
      coalesce(sum(stats.assists), 0)::numeric(10,2) as assists,
      avg(stats.rating_365) filter (
        where stats.rating_365 is not null and stats.rating_365 >= 0
      )::numeric(6,2) as average_rating
    from season_appearances appearance
    join obs.player_match_stats stats on stats.appearance_id = appearance.appearance_id
    group by appearance.player_id
  )
  select
    p_season_id as season_id,
    season.competition_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    coalesce(latest.position_name, player.primary_position) as primary_position,
    detailed.formation_position as specific_position,
    case
      when lower(coalesce(detailed.formation_position, latest.position_name, player.primary_position, '')) like '%goal%' then 'Goalkeepers'
      when lower(coalesce(detailed.formation_position, latest.position_name, player.primary_position, '')) like '%back%' then 'Defenders'
      when lower(coalesce(detailed.formation_position, latest.position_name, player.primary_position, '')) like '%midfield%' then 'Midfielders'
      when lower(coalesce(detailed.formation_position, latest.position_name, player.primary_position, '')) like '%forward%'
        or lower(coalesce(detailed.formation_position, latest.position_name, player.primary_position, '')) like '%striker%' then 'Attackers'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%defend%' then 'Defenders'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%mid%' then 'Midfielders'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%attack%'
        or lower(coalesce(latest.position_name, player.primary_position, '')) like '%wing%' then 'Attackers'
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
  join core.seasons season on season.id = p_season_id
  join core.players player on player.id = totals.player_id
  left join latest_team latest on latest.player_id = totals.player_id
  left join position_frequency detailed
    on detailed.player_id = totals.player_id
   and detailed.preference = 1
  left join core.teams team on team.id = latest.team_id
  left join performance on performance.player_id = totals.player_id
  order by totals.minutes desc, player.display_name;
$function$;

revoke all on function public.api_season_players_for_season(uuid) from public;
grant execute on function public.api_season_players_for_season(uuid) to anon, authenticated;

do $migration$
declare
  player_values text;
  function_definition text;
begin
  select string_agg(
    format('(%L::text, stats.%I)', column_name, column_name),
    ', ' order by ordinal_position
  )
  into player_values
  from information_schema.columns
  where table_schema = 'obs'
    and table_name = 'player_match_stats'
    and column_name not in ('source_id', 'appearance_id', 'metric_count', 'observed_at');

  if player_values is null then
    raise exception 'obs.player_match_stats has no metric columns';
  end if;

  function_definition := format($ddl$
    create or replace function public.api_player_history_for_player(
      p_competition_id uuid,
      p_player_id uuid
    )
    returns table (
      player_id uuid,
      display_name text,
      season_id uuid,
      competition_id uuid,
      stage_id uuid,
      round_id uuid,
      round_number integer,
      appearance_id uuid,
      team_id uuid,
      team_name text,
      opponent_team_id uuid,
      opponent_team_name text,
      match_id uuid,
      scheduled_at timestamptz,
      home_score integer,
      away_score integer,
      side text,
      minutes_played numeric,
      metric_id uuid,
      metric_code text,
      metric_name text,
      value_type text,
      source_id uuid,
      source_code text,
      source_name text,
      value_numeric numeric,
      raw_value text
    )
    language sql
    stable
    security definer
    set search_path = public, core, obs, source
    as $body$
      with appearances as materialized (
        select
          appearance.id as appearance_id,
          appearance.player_id,
          appearance.team_id,
          appearance.opponent_team_id,
          appearance.side,
          appearance.minutes_played,
          season_match.id as match_id,
          season_match.season_id,
          season.competition_id,
          season_match.stage_id,
          season_match.round_id,
          round_info.round_number,
          season_match.scheduled_at,
          season_match.home_score,
          season_match.away_score
        from core.player_match_appearances appearance
        join core.matches season_match on season_match.id = appearance.match_id
        join core.seasons season on season.id = season_match.season_id
        left join core.rounds round_info on round_info.id = season_match.round_id
        where appearance.player_id = p_player_id
          and season.competition_id = p_competition_id
      ),
      player_stats as materialized (
        select stats.*
        from obs.player_match_stats stats
        join appearances appearance on appearance.appearance_id = stats.appearance_id
      )
      select
        player.id as player_id,
        player.display_name,
        appearance.season_id,
        appearance.competition_id,
        appearance.stage_id,
        appearance.round_id,
        appearance.round_number,
        appearance.appearance_id,
        appearance.team_id,
        team.name as team_name,
        appearance.opponent_team_id,
        opponent.name as opponent_team_name,
        appearance.match_id,
        appearance.scheduled_at,
        appearance.home_score,
        appearance.away_score,
        appearance.side,
        appearance.minutes_played,
        metric.id as metric_id,
        metric.code as metric_code,
        metric.name as metric_name,
        metric.value_type,
        source_catalog.id as source_id,
        source_catalog.code as source_code,
        source_catalog.name as source_name,
        value.value_numeric,
        null::text as raw_value
      from appearances appearance
      join core.players player on player.id = appearance.player_id
      join core.teams team on team.id = appearance.team_id
      left join core.teams opponent on opponent.id = appearance.opponent_team_id
      join player_stats stats on stats.appearance_id = appearance.appearance_id
      join source.sources source_catalog on source_catalog.id = stats.source_id
      cross join lateral (values %s) value(metric_code, value_numeric)
      join obs.metrics metric on metric.code = value.metric_code
      where value.value_numeric is not null
      order by appearance.scheduled_at, appearance.match_id, metric.code, source_catalog.code;
    $body$;
  $ddl$, player_values);

  execute function_definition;
end;
$migration$;

revoke all on function public.api_player_history_for_player(uuid, uuid) from public;
grant execute on function public.api_player_history_for_player(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
