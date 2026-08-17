alter function public.api_legionnaires(text)
  rename to api_legionnaires_with_squad_rows;

revoke all on function public.api_legionnaires_with_squad_rows(text)
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
  with base as materialized (
    select *
    from public.api_legionnaires_with_squad_rows(p_season_name)
  ),
  selected_seasons as materialized (
    select season.id
    from core.seasons season
    where season.name = p_season_name
      and exists (
        select 1
        from core.player_team_stints discovered
        where discovered.season_id = season.id
          and discovered.metadata ->> 'discovery' = '365scores_legionnaires'
      )
  ),
  played as (
    select
      appearance.player_id,
      count(distinct appearance.match_id) filter (
        where coalesce(appearance.minutes_played, 0) > 0
      )::integer as appearances,
      count(distinct appearance.match_id) filter (
        where coalesce(appearance.minutes_played, 0) > 0
          and lower(coalesce(appearance.lineup_status, '')) like '%start%'
      )::integer as starts
    from core.player_match_appearances appearance
    join core.matches season_match on season_match.id = appearance.match_id
    where season_match.season_id in (select id from selected_seasons)
    group by appearance.player_id
  )
  select
    base.season_id,
    base.competition_id,
    base.competition_name,
    base.competition_name_he,
    base.player_id,
    base.display_name,
    base.display_name_he,
    base.primary_position,
    base.specific_position,
    base.role_group,
    base.team_id,
    base.team_name,
    base.team_logo_url,
    coalesce(played.appearances, 0) as appearances,
    coalesce(played.starts, 0) as starts,
    base.minutes,
    base.goals,
    base.assists,
    base.average_rating
  from base
  left join played on played.player_id = base.player_id
  order by base.minutes desc nulls last, base.display_name;
$function$;

revoke all on function public.api_legionnaires(text) from public;
grant execute on function public.api_legionnaires(text) to anon, authenticated;

notify pgrst, 'reload schema';
