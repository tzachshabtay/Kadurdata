delete from obs.stat_observations observation
using obs.metrics metric
where observation.metric_id = metric.id
  and metric.code = 'rating_365'
  and observation.value_numeric < 0;

update obs.player_appearance_observations
set rating = null
where rating < 0;

notify pgrst, 'reload schema';
