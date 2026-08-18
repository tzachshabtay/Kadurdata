create table if not exists obs.team_roster_memberships (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source.sources(id),
  team_id uuid not null references core.teams(id),
  player_id uuid not null references core.players(id),
  source_team_id text not null,
  source_player_id text not null,
  season_name text not null,
  roster_group text not null,
  role_name text,
  specific_position text,
  shirt_number integer,
  is_active boolean not null default true,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (source_id, source_team_id, source_player_id, season_name)
);

create index if not exists team_roster_memberships_season_team_idx
  on obs.team_roster_memberships (season_name, team_id)
  where is_active;

create index if not exists team_roster_memberships_player_idx
  on obs.team_roster_memberships (player_id, season_name desc);

create or replace function public.api_team_rosters_for_season(
  p_season_id uuid
)
returns table (
  roster_id uuid,
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
  appearances bigint,
  starts bigint,
  minutes bigint,
  goals numeric,
  assists numeric,
  average_rating numeric,
  roster_group text,
  role_name text,
  shirt_number integer,
  is_management boolean
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  select distinct on (roster.team_id, roster.player_id)
    roster.id as roster_id,
    season.id as season_id,
    season.competition_id,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    player.primary_position,
    coalesce(roster.specific_position, player.metadata ->> 'formation_position') as specific_position,
    case
      when roster.roster_group = 'keepers' then 'Goalkeepers'
      when roster.roster_group = 'defenders' then 'Defenders'
      when roster.roster_group = 'midfielders' then 'Midfielders'
      when roster.roster_group = 'attackers' then 'Attackers'
      else 'Other'
    end as role_group,
    team.id as team_id,
    team.name as team_name,
    0::bigint as appearances,
    0::bigint as starts,
    0::bigint as minutes,
    0::numeric as goals,
    0::numeric as assists,
    null::numeric as average_rating,
    roster.roster_group,
    roster.role_name,
    roster.shirt_number,
    roster.roster_group in ('coach', 'management', 'staff') as is_management
  from core.seasons season
  join obs.team_roster_memberships roster
    on roster.season_name = season.name
   and roster.is_active
  join core.players player on player.id = roster.player_id
  join core.teams team on team.id = roster.team_id
  where season.id = p_season_id
  order by roster.team_id, roster.player_id, roster.observed_at desc;
$function$;

revoke all on function public.api_team_rosters_for_season(uuid) from public;
grant execute on function public.api_team_rosters_for_season(uuid) to anon, authenticated;

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
          coalesce(loan.parent_team_id::text, lower(loan.parent_team_name)),
          coalesce(loan.destination_team_id::text, lower(loan.destination_team_name)),
          loan.started_on
        order by source.priority, loan.observed_at desc
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
