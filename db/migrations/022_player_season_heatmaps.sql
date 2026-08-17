create or replace view public.api_player_season_heatmaps as
select
  season_match.season_id,
  season_match.scheduled_at,
  appearance.match_id,
  appearance.id as appearance_id,
  appearance.player_id,
  player.display_name,
  player.display_name_he,
  appearance.team_id,
  team.name as team_name,
  team.name_he as team_name_he,
  appearance.minutes_played,
  observation.heatmap_url,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  observation.observed_at
from core.player_match_appearances appearance
join core.matches season_match on season_match.id = appearance.match_id
join core.players player on player.id = appearance.player_id
join core.teams team on team.id = appearance.team_id
join obs.player_appearance_observations observation
  on observation.appearance_id = appearance.id
join source.sources source on source.id = observation.source_id
where nullif(trim(observation.heatmap_url), '') is not null;

grant select on public.api_player_season_heatmaps to anon, authenticated;

notify pgrst, 'reload schema';
