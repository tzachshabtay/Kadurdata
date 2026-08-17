create table obs.player_match_stats (
  source_id uuid not null references source.sources(id),
  appearance_id uuid not null references core.player_match_appearances(id) on delete cascade,
  metric_count smallint not null default 0,
  observed_at timestamptz not null default now(),
  primary key (source_id, appearance_id)
);

create index player_match_stats_appearance_idx
  on obs.player_match_stats (appearance_id, source_id);

create table obs.team_match_stats (
  source_id uuid not null references source.sources(id),
  match_team_id uuid not null references core.match_teams(id) on delete cascade,
  metric_count smallint not null default 0,
  observed_at timestamptz not null default now(),
  primary key (source_id, match_team_id)
);

create index team_match_stats_match_team_idx
  on obs.team_match_stats (match_team_id, source_id);

do $migration$
declare
  metric record;
begin
  for metric in
    select distinct catalog.code
    from obs.stat_observations observation
    join obs.metrics catalog on catalog.id = observation.metric_id
    where observation.subject_type = 'player_match'
      and observation.value_numeric is not null
    order by catalog.code
  loop
    execute format(
      'alter table obs.player_match_stats add column if not exists %I numeric(18,6)',
      metric.code
    );
  end loop;

  for metric in
    select distinct catalog.code
    from obs.stat_observations observation
    join obs.metrics catalog on catalog.id = observation.metric_id
    where observation.subject_type = 'team_match'
      and observation.value_numeric is not null
    order by catalog.code
  loop
    execute format(
      'alter table obs.team_match_stats add column if not exists %I numeric(18,6)',
      metric.code
    );
  end loop;
end;
$migration$;

with packed as (
  select
    observation.source_id,
    observation.subject_id as appearance_id,
    count(observation.value_numeric)::smallint as metric_count,
    max(observation.observed_at) as observed_at,
    jsonb_object_agg(catalog.code, observation.value_numeric) as metrics
  from obs.stat_observations observation
  join obs.metrics catalog on catalog.id = observation.metric_id
  join core.player_match_appearances appearance on appearance.id = observation.subject_id
  where observation.subject_type = 'player_match'
    and observation.subject_id is not null
    and observation.value_numeric is not null
  group by observation.source_id, observation.subject_id
), records as (
  select jsonb_build_object(
    'source_id', packed.source_id,
    'appearance_id', packed.appearance_id,
    'metric_count', packed.metric_count,
    'observed_at', packed.observed_at
  ) || packed.metrics as data
  from packed
)
insert into obs.player_match_stats
select (jsonb_populate_record(null::obs.player_match_stats, records.data)).*
from records;

with packed as (
  select
    observation.source_id,
    observation.subject_id as match_team_id,
    count(observation.value_numeric)::smallint as metric_count,
    max(observation.observed_at) as observed_at,
    jsonb_object_agg(catalog.code, observation.value_numeric) as metrics
  from obs.stat_observations observation
  join obs.metrics catalog on catalog.id = observation.metric_id
  join core.match_teams match_team on match_team.id = observation.subject_id
  where observation.subject_type = 'team_match'
    and observation.subject_id is not null
    and observation.value_numeric is not null
  group by observation.source_id, observation.subject_id
), records as (
  select jsonb_build_object(
    'source_id', packed.source_id,
    'match_team_id', packed.match_team_id,
    'metric_count', packed.metric_count,
    'observed_at', packed.observed_at
  ) || packed.metrics as data
  from packed
)
insert into obs.team_match_stats
select (jsonb_populate_record(null::obs.team_match_stats, records.data)).*
from records;

create or replace function obs.refresh_stat_values_view()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, core, obs, source
as $function$
declare
  player_values text;
  team_values text;
  player_select text := '';
  team_select text := '';
  empty_select constant text := $empty$
    select
      null::uuid as id,
      null::uuid as source_id,
      null::uuid as metric_id,
      null::text as subject_type,
      null::uuid as subject_id,
      null::uuid as match_id,
      null::uuid as team_id,
      null::uuid as player_id,
      null::uuid as season_id,
      null::text as source_subject_id,
      null::text as source_metric_id,
      null::text as source_metric_name,
      null::numeric(18,6) as value_numeric,
      null::text as value_text,
      null::text as raw_value,
      null::timestamptz as observed_at,
      null::numeric(5,4) as confidence
    where false
  $empty$;
begin
  select string_agg(
    format('(%L::text, stats.%I)', column_name, column_name),
    ', ' order by ordinal_position
  )
  into player_values
  from information_schema.columns
  where table_schema = 'obs'
    and table_name = 'player_match_stats'
    and column_name not in ('source_id', 'appearance_id', 'metric_count', 'observed_at');

  select string_agg(
    format('(%L::text, stats.%I)', column_name, column_name),
    ', ' order by ordinal_position
  )
  into team_values
  from information_schema.columns
  where table_schema = 'obs'
    and table_name = 'team_match_stats'
    and column_name not in ('source_id', 'match_team_id', 'metric_count', 'observed_at');

  if player_values is not null then
    player_select := format($player$
      union all
      select
        md5(stats.source_id::text || ':' || stats.appearance_id::text || ':' || metric.id::text)::uuid as id,
        stats.source_id,
        metric.id as metric_id,
        'player_match'::text as subject_type,
        stats.appearance_id as subject_id,
        appearance.match_id,
        appearance.team_id,
        appearance.player_id,
        season_match.season_id,
        null::text as source_subject_id,
        null::text as source_metric_id,
        metric.code as source_metric_name,
        value.value_numeric,
        null::text as value_text,
        null::text as raw_value,
        stats.observed_at,
        1::numeric(5,4) as confidence
      from obs.player_match_stats stats
      join core.player_match_appearances appearance on appearance.id = stats.appearance_id
      join core.matches season_match on season_match.id = appearance.match_id
      cross join lateral (values %s) value(metric_code, value_numeric)
      join obs.metrics metric on metric.code = value.metric_code
      where value.value_numeric is not null
    $player$, player_values);
  end if;

  if team_values is not null then
    team_select := format($team$
      union all
      select
        md5(stats.source_id::text || ':' || stats.match_team_id::text || ':' || metric.id::text)::uuid as id,
        stats.source_id,
        metric.id as metric_id,
        'team_match'::text as subject_type,
        stats.match_team_id as subject_id,
        match_team.match_id,
        match_team.team_id,
        null::uuid as player_id,
        season_match.season_id,
        null::text as source_subject_id,
        null::text as source_metric_id,
        metric.code as source_metric_name,
        value.value_numeric,
        null::text as value_text,
        null::text as raw_value,
        stats.observed_at,
        1::numeric(5,4) as confidence
      from obs.team_match_stats stats
      join core.match_teams match_team on match_team.id = stats.match_team_id
      join core.matches season_match on season_match.id = match_team.match_id
      cross join lateral (values %s) value(metric_code, value_numeric)
      join obs.metrics metric on metric.code = value.metric_code
      where value.value_numeric is not null
    $team$, team_values);
  end if;

  execute 'create or replace view obs.stat_values as '
    || empty_select
    || player_select
    || team_select;
end;
$function$;

revoke all on function obs.refresh_stat_values_view() from public;
select obs.refresh_stat_values_view();

do $migration$
declare
  dependent record;
  definition text;
begin
  for dependent in
    select namespace.nspname as schema_name, relation.relname as object_name, relation.oid
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.relkind = 'v'
      and namespace.nspname = 'public'
      and pg_get_viewdef(relation.oid, true) like '%obs.stat_observations%'
  loop
    definition := replace(
      pg_get_viewdef(dependent.oid, true),
      'stat_observations',
      'stat_values'
    );
    execute format(
      'create or replace view %I.%I as %s',
      dependent.schema_name,
      dependent.object_name,
      definition
    );
  end loop;

  for dependent in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and pg_get_functiondef(procedure.oid) like '%obs.stat_observations%'
  loop
    definition := replace(
      pg_get_functiondef(dependent.oid),
      'stat_observations',
      'stat_values'
    );
    execute definition;
  end loop;
end;
$migration$;

do $verification$
declare
  legacy_numeric_count bigint;
  wide_numeric_count bigint;
begin
  select count(*)
  into legacy_numeric_count
  from obs.stat_observations
  where value_numeric is not null;

  select
    coalesce((select sum(metric_count) from obs.player_match_stats), 0)
    + coalesce((select sum(metric_count) from obs.team_match_stats), 0)
  into wide_numeric_count;

  if legacy_numeric_count <> wide_numeric_count then
    raise exception
      'wide-stat verification failed: legacy numeric rows %, wide numeric values %',
      legacy_numeric_count,
      wide_numeric_count;
  end if;

  if (select count(*) from obs.stat_values) <> legacy_numeric_count then
    raise exception 'stat compatibility view did not preserve every numeric value';
  end if;
end;
$verification$;

drop table obs.stat_observations;

create view obs.stat_observations as
select * from obs.stat_values;

create or replace view public.api_overview as
select
  (select count(*) from core.matches)::integer as match_count,
  (select count(*) from core.players)::integer as player_count,
  (select count(*) from core.teams)::integer as team_count,
  (
    coalesce((select sum(metric_count) from obs.player_match_stats), 0)
    + coalesce((select sum(metric_count) from obs.team_match_stats), 0)
  )::integer as stat_observation_count,
  greatest(
    (select max(observed_at) from obs.player_match_stats),
    (select max(observed_at) from obs.team_match_stats)
  ) as latest_observed_at;

notify pgrst, 'reload schema';
