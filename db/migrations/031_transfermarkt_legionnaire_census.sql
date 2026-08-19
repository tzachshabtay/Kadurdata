alter function public.api_legionnaires(text)
  rename to api_legionnaires_with_365_census;

revoke all on function public.api_legionnaires_with_365_census(text)
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
set search_path = public, core
as $function$
  with scores365 as materialized (
    select * from public.api_legionnaires_with_365_census(p_season_name)
  ),
  transfermarkt_candidates as (
    select
      season.id as season_id,
      competition.id as competition_id,
      competition.name as competition_name,
      competition.name_he as competition_name_he,
      player.id as player_id,
      player.display_name,
      player.display_name_he,
      player.primary_position,
      coalesce(
        stint.metadata ->> 'formation_position',
        player.metadata ->> 'formation_position'
      ) as specific_position,
      team.id as team_id,
      team.name as team_name,
      team.logo_url as team_logo_url,
      row_number() over (
        partition by player.id
        order by season.start_date desc nulls last, stint.id
      ) as preference
    from core.player_team_stints stint
    join core.players player on player.id = stint.player_id
    join core.teams team on team.id = stint.team_id
    join core.seasons season on season.id = stint.season_id
    join core.competitions competition on competition.id = season.competition_id
    left join core.countries country on country.id = player.country_id
    where season.name = p_season_name
      and stint.metadata ->> 'transfermarkt_legionnaire_census' = 'true'
      and stint.metadata ->> 'transfermarkt_is_current' = 'true'
      and (
        country.iso2 = 'IL'
        or coalesce(player.metadata ->> 'source_country_id', player.metadata ->> '365_country_id') = '6'
      )
      and not exists (
        select 1 from scores365 existing where existing.player_id = player.id
      )
  ),
  transfermarkt as (
    select
      candidate.season_id,
      candidate.competition_id,
      candidate.competition_name,
      candidate.competition_name_he,
      candidate.player_id,
      candidate.display_name,
      candidate.display_name_he,
      candidate.primary_position,
      candidate.specific_position,
      case
        when lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%goal%' then 'Goalkeepers'
        when lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%back%'
          or lower(coalesce(candidate.primary_position, '')) like '%defend%' then 'Defenders'
        when lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%mid%' then 'Midfielders'
        when lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%wing%'
          or lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%forward%'
          or lower(coalesce(candidate.specific_position, candidate.primary_position, '')) like '%striker%'
          or lower(coalesce(candidate.primary_position, '')) like '%attack%' then 'Attackers'
        else 'Other'
      end as role_group,
      candidate.team_id,
      candidate.team_name,
      candidate.team_logo_url,
      0::integer as appearances,
      0::integer as starts,
      0::numeric as minutes,
      0::numeric as goals,
      0::numeric as assists,
      null::numeric as average_rating
    from transfermarkt_candidates candidate
    where candidate.preference = 1
  )
  select * from scores365
  union all
  select * from transfermarkt
  order by minutes desc nulls last, display_name;
$function$;

revoke all on function public.api_legionnaires(text) from public;
grant execute on function public.api_legionnaires(text) to anon, authenticated;

notify pgrst, 'reload schema';
