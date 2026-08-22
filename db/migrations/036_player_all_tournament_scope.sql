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
    create or replace function public.api_player_history_for_player_all_tournaments(
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
      with requested as materialized (
        select public.api_player_identity_key(
          player.display_name,
          player.display_name_he,
          player.date_of_birth
        ) as identity_key
        from core.players player
        where player.id = p_player_id
      ), candidate_players as materialized (
        select player.id
        from core.players player
        cross join requested
        where player.id = p_player_id
           or public.api_player_identity_key(
                player.display_name,
                player.display_name_he,
                player.date_of_birth
              ) = requested.identity_key
      ), appearances as materialized (
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
        from candidate_players candidate
        join core.player_match_appearances appearance on appearance.player_id = candidate.id
        join core.matches season_match on season_match.id = appearance.match_id
        join core.seasons season on season.id = season_match.season_id
        left join core.rounds round_info on round_info.id = season_match.round_id
      ), player_stats as materialized (
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

revoke all on function public.api_player_history_for_player_all_tournaments(uuid) from public;
grant execute on function public.api_player_history_for_player_all_tournaments(uuid) to anon, authenticated;

create or replace function public.api_player_heatmaps_for_player_season(
  p_player_id uuid,
  p_season_name text
)
returns table (
  season_id uuid,
  scheduled_at timestamptz,
  match_id uuid,
  appearance_id uuid,
  player_id uuid,
  display_name text,
  display_name_he text,
  team_id uuid,
  team_name text,
  team_name_he text,
  minutes_played numeric,
  heatmap_url text,
  source_id uuid,
  source_code text,
  source_name text,
  observed_at timestamptz
)
language sql
stable
security definer
set search_path = public, core, obs, source
as $function$
  with requested as materialized (
    select public.api_player_identity_key(
      player.display_name,
      player.display_name_he,
      player.date_of_birth
    ) as identity_key
    from core.players player
    where player.id = p_player_id
  ), candidate_players as materialized (
    select player.id
    from core.players player
    cross join requested
    where player.id = p_player_id
       or public.api_player_identity_key(
            player.display_name,
            player.display_name_he,
            player.date_of_birth
          ) = requested.identity_key
  )
  select
    season_match.season_id,
    season_match.scheduled_at,
    appearance.match_id,
    appearance.id as appearance_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    appearance.team_id,
    team.name as team_name,
    team.name_he as team_name_he,
    appearance.minutes_played,
    observation.heatmap_url,
    source_catalog.id as source_id,
    source_catalog.code as source_code,
    source_catalog.name as source_name,
    observation.observed_at
  from candidate_players candidate
  join core.player_match_appearances appearance on appearance.player_id = candidate.id
  join core.matches season_match on season_match.id = appearance.match_id
  join core.seasons season on season.id = season_match.season_id
  join core.players player on player.id = appearance.player_id
  join core.teams team on team.id = appearance.team_id
  join obs.player_appearance_observations observation on observation.appearance_id = appearance.id
  join source.sources source_catalog on source_catalog.id = observation.source_id
  where season.name = p_season_name
    and nullif(trim(observation.heatmap_url), '') is not null
  order by season_match.scheduled_at, appearance.match_id, observation.observed_at desc;
$function$;

revoke all on function public.api_player_heatmaps_for_player_season(uuid, text) from public;
grant execute on function public.api_player_heatmaps_for_player_season(uuid, text) to anon, authenticated;

create or replace function public.api_player_context_for_season(
  p_player_id uuid,
  p_season_name text
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
  with requested as materialized (
    select
      player.id,
      public.api_player_identity_key(
        player.display_name,
        player.display_name_he,
        player.date_of_birth
      ) as identity_key
    from core.players player
    where player.id = p_player_id
  ), candidate_players as materialized (
    select
      player.id,
      player.display_name,
      player.display_name_he,
      player.primary_position,
      player.metadata,
      player.id = p_player_id as is_direct_identity
    from core.players player
    cross join requested
    where player.id = p_player_id
       or public.api_player_identity_key(
            player.display_name,
            player.display_name_he,
            player.date_of_birth
          ) = requested.identity_key
  ), appearance_rows as materialized (
    select
      candidate.id as player_id,
      candidate.is_direct_identity,
      season.id as season_id,
      season.competition_id,
      appearance.id as appearance_id,
      appearance.team_id,
      appearance.lineup_status,
      appearance.position_name,
      appearance.formation_position,
      appearance.minutes_played,
      season_match.scheduled_at
    from candidate_players candidate
    join core.player_match_appearances appearance on appearance.player_id = candidate.id
    join core.matches season_match on season_match.id = appearance.match_id
    join core.seasons season on season.id = season_match.season_id
    where season.name = p_season_name
  ), appearance_stats as materialized (
    select distinct on (stats.appearance_id)
      stats.appearance_id,
      stats.goals,
      stats.assists,
      stats.rating_365
    from obs.player_match_stats stats
    join appearance_rows appearance on appearance.appearance_id = stats.appearance_id
    order by stats.appearance_id, stats.metric_count desc, stats.observed_at desc
  ), appearance_contexts as (
    select
      appearance.player_id,
      appearance.is_direct_identity,
      appearance.season_id,
      appearance.competition_id,
      (array_agg(appearance.team_id order by appearance.scheduled_at desc nulls last, appearance.appearance_id desc)
        filter (where appearance.team_id is not null))[1] as team_id,
      (array_agg(appearance.position_name order by appearance.scheduled_at desc nulls last, appearance.appearance_id desc)
        filter (where nullif(trim(appearance.position_name), '') is not null))[1] as position_name,
      (array_agg(appearance.formation_position order by appearance.scheduled_at desc nulls last, appearance.appearance_id desc)
        filter (where nullif(trim(appearance.formation_position), '') is not null))[1] as formation_position,
      count(distinct appearance.appearance_id)::integer as appearances,
      count(distinct appearance.appearance_id) filter (
        where lower(coalesce(appearance.lineup_status, '')) like '%start%'
      )::integer as starts,
      coalesce(sum(appearance.minutes_played), 0)::numeric(10, 2) as minutes,
      coalesce(sum(stats.goals), 0)::numeric(10, 2) as goals,
      coalesce(sum(stats.assists), 0)::numeric(10, 2) as assists,
      avg(stats.rating_365) filter (
        where stats.rating_365 is not null and stats.rating_365 >= 0
      )::numeric(6, 2) as average_rating,
      3 as source_priority
    from appearance_rows appearance
    left join appearance_stats stats on stats.appearance_id = appearance.appearance_id
    group by appearance.player_id, appearance.is_direct_identity, appearance.season_id, appearance.competition_id
  ), stint_contexts as (
    select distinct on (candidate.id, season.id, stint.team_id)
      candidate.id as player_id,
      candidate.is_direct_identity,
      season.id as season_id,
      season.competition_id,
      stint.team_id,
      candidate.primary_position as position_name,
      candidate.metadata ->> 'formation_position' as formation_position,
      0::integer as appearances,
      0::integer as starts,
      0::numeric as minutes,
      0::numeric as goals,
      0::numeric as assists,
      null::numeric as average_rating,
      2 as source_priority
    from candidate_players candidate
    join core.player_team_stints stint on stint.player_id = candidate.id
    join core.seasons season on season.id = stint.season_id
    where season.name = p_season_name
    order by candidate.id, season.id, stint.team_id, stint.start_date desc nulls last, stint.id
  ), roster_contexts as (
    select distinct on (candidate.id, season.id, roster.team_id)
      candidate.id as player_id,
      candidate.is_direct_identity,
      season.id as season_id,
      season.competition_id,
      roster.team_id,
      coalesce(roster.role_name, candidate.primary_position) as position_name,
      coalesce(roster.specific_position, candidate.metadata ->> 'formation_position') as formation_position,
      0::integer as appearances,
      0::integer as starts,
      0::numeric as minutes,
      0::numeric as goals,
      0::numeric as assists,
      null::numeric as average_rating,
      1 as source_priority
    from candidate_players candidate
    join obs.team_roster_memberships roster
      on roster.player_id = candidate.id
     and roster.season_name = p_season_name
     and roster.is_active
    join core.team_seasons team_season on team_season.team_id = roster.team_id
    join core.seasons season
      on season.id = team_season.season_id
     and season.name = p_season_name
    order by candidate.id, season.id, roster.team_id, roster.observed_at desc, roster.id
  ), contexts as (
    select * from appearance_contexts
    union all
    select * from stint_contexts
    union all
    select * from roster_contexts
  ), selected_context as materialized (
    select context.*
    from contexts context
    join core.competitions competition on competition.id = context.competition_id
    order by
      case
        when competition.name = 'Israeli Premier League' then 0
        when coalesce(competition.metadata ->> 'participant_type', 'club') = 'club'
          and coalesce(competition.metadata ->> 'scope', 'domestic') in ('domestic', 'foreign_club')
          and competition.competition_type = 'league' then 1
        when coalesce(competition.metadata ->> 'participant_type', 'club') = 'club'
          and coalesce(competition.metadata ->> 'scope', 'domestic') = 'foreign_club' then 2
        when coalesce(competition.metadata ->> 'participant_type', 'club') = 'club'
          and coalesce(competition.metadata ->> 'scope', 'domestic') = 'european_club' then 3
        when coalesce(competition.metadata ->> 'participant_type', 'club') = 'club' then 4
        when coalesce(competition.metadata ->> 'scope', 'domestic') in ('national_team', 'national_youth') then 5
        else 6
      end,
      context.source_priority desc,
      context.minutes desc,
      context.appearances desc,
      context.is_direct_identity desc,
      context.season_id
    limit 1
  )
  select
    context.season_id,
    context.competition_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    coalesce(context.position_name, player.primary_position) as primary_position,
    coalesce(context.formation_position, player.metadata ->> 'formation_position') as specific_position,
    case
      when lower(coalesce(context.formation_position, context.position_name, player.primary_position, '')) like '%goal%' then 'Goalkeepers'
      when lower(coalesce(context.formation_position, context.position_name, player.primary_position, '')) like '%back%'
        or lower(coalesce(context.position_name, player.primary_position, '')) like '%defend%' then 'Defenders'
      when lower(coalesce(context.formation_position, context.position_name, player.primary_position, '')) like '%mid%' then 'Midfielders'
      when lower(coalesce(context.formation_position, context.position_name, player.primary_position, '')) like '%forward%'
        or lower(coalesce(context.formation_position, context.position_name, player.primary_position, '')) like '%striker%'
        or lower(coalesce(context.position_name, player.primary_position, '')) like '%attack%'
        or lower(coalesce(context.position_name, player.primary_position, '')) like '%wing%' then 'Attackers'
      else 'Other'
    end as role_group,
    context.team_id,
    team.name as team_name,
    context.appearances,
    context.starts,
    context.minutes,
    context.goals,
    context.assists,
    context.average_rating
  from selected_context context
  join core.players player on player.id = context.player_id
  left join core.teams team on team.id = context.team_id;
$function$;

revoke all on function public.api_player_context_for_season(uuid, text) from public;
grant execute on function public.api_player_context_for_season(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
