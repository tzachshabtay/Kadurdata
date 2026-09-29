-- Expose the match/season keys from the unpivoted stats branch itself. Using
-- a second matches join hid the API filter from that branch, so sorted batch
-- requests expanded stats for every match before discarding unrelated rows.
-- stat_values derives these keys from the same appearance/match-team foreign
-- keys, so this preserves the API columns, values and access permissions.
create or replace view public.api_match_player_stats as
select
  so.match_id,
  so.season_id,
  pma.id as appearance_id,
  p.id as player_id,
  p.display_name,
  pma.team_id,
  team.name as team_name,
  pma.opponent_team_id,
  opponent.name as opponent_team_name,
  pma.side,
  pma.shirt_number,
  pma.lineup_status,
  pma.position_name,
  pma.formation_position,
  pma.minutes_played,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  so.value_numeric,
  so.raw_value
from obs.stat_values so
join core.player_match_appearances pma on pma.id = so.subject_id
join core.players p on p.id = pma.player_id
join core.teams team on team.id = pma.team_id
left join core.teams opponent on opponent.id = pma.opponent_team_id
join source.sources source on source.id = so.source_id
join obs.metrics metric on metric.id = so.metric_id
where so.subject_type = 'player_match';

create or replace view public.api_match_team_stats as
select
  so.match_id,
  so.season_id,
  mt.id as match_team_id,
  mt.team_id,
  team.name as team_name,
  mt.opponent_team_id,
  opponent.name as opponent_team_name,
  mt.side,
  mt.score,
  metric.id as metric_id,
  metric.code as metric_code,
  metric.name as metric_name,
  metric.value_type,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  so.value_numeric,
  so.raw_value
from obs.stat_values so
join core.match_teams mt on mt.id = so.subject_id
join core.teams team on team.id = mt.team_id
left join core.teams opponent on opponent.id = mt.opponent_team_id
join source.sources source on source.id = so.source_id
join obs.metrics metric on metric.id = so.metric_id
where so.subject_type = 'team_match';

notify pgrst, 'reload schema';
