create or replace function public.api_player_loans_for_season(
  p_season_id uuid
)
returns table (
  loan_id uuid,
  season_id uuid,
  player_id uuid,
  display_name text,
  display_name_he text,
  primary_position text,
  specific_position text,
  role_group text,
  parent_team_id uuid,
  parent_team_name text,
  parent_team_name_he text,
  destination_team_id uuid,
  destination_team_name text,
  destination_team_name_he text,
  started_on date,
  ended_on date
)
language sql
stable
security definer
set search_path = public, core, obs, source
as $function$
  with selected_season as materialized (
    select
      season.id,
      coalesce(
        season.start_date,
        min(match.scheduled_at::date),
        make_date(substring(season.name from '([0-9]{4})')::integer, 7, 1)
      ) as starts_on,
      coalesce(
        season.end_date,
        max(match.scheduled_at::date),
        make_date(substring(season.name from '([0-9]{4})')::integer + 1, 6, 30)
      ) as ends_on
    from core.seasons season
    left join core.matches match on match.season_id = season.id
    where season.id = p_season_id
    group by season.id, season.name, season.start_date, season.end_date
  ), ranked_loans as (
    select
      loan.*,
      row_number() over (
        partition by
          loan.player_id,
          coalesce(loan.parent_team_id::text, lower(loan.parent_team_name))
        order by
          source.priority,
          coalesce(loan.ended_on, 'infinity'::date) desc,
          loan.started_on desc,
          loan.observed_at desc
      ) as source_rank
    from obs.player_loans loan
    join selected_season selected
      on loan.started_on <= selected.ends_on
     and coalesce(loan.ended_on, selected.ends_on) >= selected.starts_on
    join source.sources source on source.id = loan.source_id
  )
  select
    loan.id as loan_id,
    selected.id as season_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    player.primary_position,
    coalesce(loan.metadata ->> 'formation_position', player.metadata ->> 'formation_position') as specific_position,
    case
      when lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%goal%'
        or lower(coalesce(loan.metadata ->> 'formation_position', '')) = 'gk' then 'Goalkeepers'
      when lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%defend%'
        or lower(coalesce(loan.metadata ->> 'formation_position', '')) ~ '^(cb|lb|rb|lwb|rwb)$' then 'Defenders'
      when lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%mid%'
        or lower(coalesce(loan.metadata ->> 'formation_position', '')) ~ '^(dm|cm|am|cdm|cam|lm|rm)$' then 'Midfielders'
      when lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%attack%'
        or lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%forward%'
        or lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%wing%'
        or lower(coalesce(player.primary_position, loan.metadata ->> 'formation_position', '')) like '%striker%'
        or lower(coalesce(loan.metadata ->> 'formation_position', '')) ~ '^(st|cf|lw|rw)$' then 'Attackers'
      else 'Other'
    end as role_group,
    loan.parent_team_id,
    coalesce(parent_team.name, loan.parent_team_name) as parent_team_name,
    parent_team.name_he as parent_team_name_he,
    loan.destination_team_id,
    coalesce(destination_team.name, loan.destination_team_name) as destination_team_name,
    destination_team.name_he as destination_team_name_he,
    loan.started_on,
    loan.ended_on
  from selected_season selected
  join ranked_loans loan on loan.source_rank = 1
  join core.players player on player.id = loan.player_id
  left join core.teams parent_team on parent_team.id = loan.parent_team_id
  left join core.teams destination_team on destination_team.id = loan.destination_team_id
  order by player.display_name, loan.started_on desc;
$function$;

revoke all on function public.api_player_loans_for_season(uuid) from public;
grant execute on function public.api_player_loans_for_season(uuid) to anon, authenticated;
