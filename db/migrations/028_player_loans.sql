create table if not exists obs.player_loans (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  player_id uuid not null references core.players(id),
  parent_team_id uuid references core.teams(id),
  destination_team_id uuid references core.teams(id),
  source_player_id text not null,
  source_parent_team_id text not null,
  source_destination_team_id text not null,
  parent_team_name text not null,
  destination_team_name text not null,
  started_on date not null,
  ended_on date,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (
    source_id,
    source_player_id,
    source_parent_team_id,
    source_destination_team_id,
    started_on
  )
);

create index if not exists player_loans_player_idx
  on obs.player_loans (player_id, started_on desc);

create index if not exists player_loans_parent_team_idx
  on obs.player_loans (parent_team_id, started_on desc);

create index if not exists player_loans_destination_team_idx
  on obs.player_loans (destination_team_id, started_on desc);

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
set search_path = public, core, obs
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
  )
  select distinct on (
    loan.player_id,
    loan.source_parent_team_id,
    loan.source_destination_team_id,
    loan.started_on
  )
    loan.id as loan_id,
    selected.id as season_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    player.primary_position,
    player.metadata ->> 'formation_position' as specific_position,
    case
      when lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%goal%'
        or lower(coalesce(player.metadata ->> 'formation_position', '')) = 'gk' then 'Goalkeepers'
      when lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%defend%'
        or lower(coalesce(player.metadata ->> 'formation_position', '')) ~ '^(cb|lb|rb|lwb|rwb)$' then 'Defenders'
      when lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%mid%'
        or lower(coalesce(player.metadata ->> 'formation_position', '')) ~ '^(dm|cm|am|cdm|cam|lm|rm)$' then 'Midfielders'
      when lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%attack%'
        or lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%forward%'
        or lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%wing%'
        or lower(coalesce(player.primary_position, player.metadata ->> 'formation_position', '')) like '%striker%'
        or lower(coalesce(player.metadata ->> 'formation_position', '')) ~ '^(st|cf|lw|rw)$' then 'Attackers'
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
  join obs.player_loans loan
    on coalesce(loan.started_on, selected.starts_on) <= selected.ends_on
   and coalesce(loan.ended_on, selected.ends_on) >= selected.starts_on
  join core.players player on player.id = loan.player_id
  left join core.teams parent_team on parent_team.id = loan.parent_team_id
  left join core.teams destination_team on destination_team.id = loan.destination_team_id
  order by
    loan.player_id,
    loan.source_parent_team_id,
    loan.source_destination_team_id,
    loan.started_on,
    loan.observed_at desc;
$function$;

revoke all on function public.api_player_loans_for_season(uuid) from public;
grant execute on function public.api_player_loans_for_season(uuid) to anon, authenticated;
