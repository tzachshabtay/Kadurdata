update obs.stat_observations observation
set value_numeric = btrim(
  substring(observation.raw_value from '^\s*[-+]?[0-9]+[.]?[0-9]*')
)::numeric
where observation.subject_type = 'team_match'
  and observation.raw_value ~ '^\s*[-+]?[0-9]';

update obs.metrics metric
set value_type = case
  when exists (
    select 1
    from obs.stat_observations observation
    where observation.metric_id = metric.id
      and observation.subject_type = 'team_match'
      and observation.raw_value ~ '^\s*[-+]?[0-9]+([.][0-9]+)?%\s*$'
  ) then 'percentage'
  else 'count'
end
where metric.subject_type = 'team_match';

notify pgrst, 'reload schema';
