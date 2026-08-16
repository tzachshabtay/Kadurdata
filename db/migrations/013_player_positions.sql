drop function if exists public.api_season_players_for_season(uuid);

create function public.api_season_players_for_season(
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
      pma.player_id,
      pma.team_id,
      pma.match_id,
      pma.lineup_status,
      pma.position_name,
      pma.formation_position,
      pma.minutes_played,
      season_match.scheduled_at,
      pma.id as appearance_id
    from core.matches season_match
    join core.player_match_appearances pma on pma.match_id = season_match.id
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
      observation.player_id,
      coalesce(sum(observation.value_numeric) filter (where metric.code = 'goals'), 0)::numeric(10,2) as goals,
      coalesce(sum(observation.value_numeric) filter (where metric.code = 'assists'), 0)::numeric(10,2) as assists,
      avg(observation.value_numeric) filter (where metric.code = 'rating_365')::numeric(6,2) as average_rating
    from obs.stat_observations observation
    join obs.metrics metric on metric.id = observation.metric_id
    where observation.subject_type = 'player_match'
      and observation.season_id = p_season_id
      and observation.player_id is not null
      and observation.value_numeric is not null
      and metric.code in ('goals', 'assists', 'rating_365')
    group by observation.player_id
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
