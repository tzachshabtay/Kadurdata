create index if not exists stat_observations_observed_at_idx
  on obs.stat_observations (observed_at desc);

create or replace view public.api_overview as
select
  (select count(*) from core.matches)::integer as match_count,
  (select count(*) from core.players)::integer as player_count,
  (select count(*) from core.teams)::integer as team_count,
  greatest(
    (select reltuples::bigint from pg_class where oid = 'obs.stat_observations'::regclass),
    0
  )::integer as stat_observation_count,
  (select max(observed_at) from obs.stat_observations) as latest_observed_at;
