alter table obs.events
  add column event_time text,
  add column outcome text,
  add column body_part text,
  add column situation text,
  add column xgot numeric(18,6),
  add column goal_mouth_x numeric(8,4),
  add column goal_mouth_y numeric(8,4),
  add column goal_description text;

alter table obs.events
  add constraint events_source_event_key unique (source_id, source_event_id);

create index events_match_type_idx
  on obs.events (match_id, event_type);

create or replace view public.api_match_player_heatmaps as
select
  appearance.match_id,
  appearance.id as appearance_id,
  appearance.player_id,
  player.display_name,
  player.display_name_he,
  appearance.team_id,
  team.name as team_name,
  team.name_he as team_name_he,
  observation.heatmap_url,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  observation.observed_at
from core.player_match_appearances appearance
join core.players player on player.id = appearance.player_id
join core.teams team on team.id = appearance.team_id
join obs.player_appearance_observations observation
  on observation.appearance_id = appearance.id
join source.sources source on source.id = observation.source_id
where nullif(trim(observation.heatmap_url), '') is not null;

create or replace view public.api_match_shots as
select
  event.match_id,
  event.id as event_id,
  event.source_event_id,
  event.minute,
  event.event_time,
  event.team_id,
  team.name as team_name,
  team.name_he as team_name_he,
  case
    when event.team_id = match.home_team_id then 'home'
    when event.team_id = match.away_team_id then 'away'
    else null
  end as side,
  event.player_id,
  player.display_name,
  player.display_name_he,
  event.x,
  event.y,
  event.value as xg,
  event.xgot,
  event.outcome,
  event.body_part,
  event.situation,
  event.goal_mouth_x,
  event.goal_mouth_y,
  event.goal_description,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name
from obs.events event
join core.matches match on match.id = event.match_id
left join core.teams team on team.id = event.team_id
left join core.players player on player.id = event.player_id
join source.sources source on source.id = event.source_id
where event.event_type = 'shot';

grant select on
  public.api_match_player_heatmaps,
  public.api_match_shots
to anon, authenticated;

notify pgrst, 'reload schema';
