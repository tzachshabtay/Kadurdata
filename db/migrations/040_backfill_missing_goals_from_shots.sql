insert into obs.metrics (code, name, subject_type, value_type)
values ('goals', 'Goals', 'player_match', 'count')
on conflict (code) do nothing;

alter table obs.player_match_stats
  add column if not exists goals numeric(18,6);

with event_goals as (
  select
    event.source_id,
    event.match_id,
    event.player_id,
    count(*)::numeric(18,6) as goals
  from obs.events event
  where event.event_type = 'shot'
    and lower(trim(event.outcome)) = 'goal'
    and event.match_id is not null
    and event.player_id is not null
  group by event.source_id, event.match_id, event.player_id
), missing_goals as (
  select
    stats.source_id,
    stats.appearance_id,
    event_goals.goals
  from event_goals
  join core.player_match_appearances appearance
    on appearance.match_id = event_goals.match_id
   and appearance.player_id = event_goals.player_id
  join obs.player_match_stats stats
    on stats.source_id = event_goals.source_id
   and stats.appearance_id = appearance.id
  where stats.goals is null
)
update obs.player_match_stats stats
set goals = missing_goals.goals,
    metric_count = (stats.metric_count + 1)::smallint,
    observed_at = greatest(stats.observed_at, now())
from missing_goals
where stats.source_id = missing_goals.source_id
  and stats.appearance_id = missing_goals.appearance_id;

select obs.refresh_stat_values_view();

notify pgrst, 'reload schema';
