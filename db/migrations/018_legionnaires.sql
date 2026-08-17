with israel as (
  select id
  from core.countries
  where iso2 = 'IL'
  limit 1
)
update core.players player
set country_id = israel.id
from israel
where player.country_id is null
  and coalesce(
    player.metadata ->> 'source_country_id',
    player.metadata ->> '365_country_id'
  ) = '6';

create index if not exists player_team_stints_current_discovery_idx
  on core.player_team_stints ((metadata ->> 'discovery'), (metadata ->> 'is_current'));

create or replace function public.api_legionnaires(
  p_season_name text
)
returns table (
  season_id uuid,
  competition_id uuid,
  competition_name text,
  competition_name_he text,
  player_id uuid,
  display_name text,
  display_name_he text,
  primary_position text,
  specific_position text,
  role_group text,
  team_id uuid,
  team_name text,
  team_logo_url text,
  appearances integer,
  starts integer,
  minutes numeric,
  goals numeric,
  assists numeric,
  average_rating numeric
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  with selected_seasons as materialized (
    select
      season.id,
      season.competition_id,
      competition.name as competition_name,
      competition.name_he as competition_name_he
    from core.seasons season
    join core.competitions competition on competition.id = season.competition_id
    where season.name = p_season_name
      and competition.metadata ->> 'scope' = 'foreign_club'
  ),
  season_appearances as materialized (
    select
      appearance.player_id,
      appearance.team_id,
      appearance.match_id,
      appearance.lineup_status,
      appearance.position_name,
      appearance.formation_position,
      appearance.minutes_played,
      season_match.scheduled_at,
      appearance.id as appearance_id,
      selected.id as season_id,
      selected.competition_id,
      selected.competition_name,
      selected.competition_name_he
    from selected_seasons selected
    join core.matches season_match on season_match.season_id = selected.id
    join core.player_match_appearances appearance on appearance.match_id = season_match.id
  ),
  affiliation_candidates as (
    select
      stint.player_id,
      stint.team_id,
      selected.id as season_id,
      selected.competition_id,
      selected.competition_name,
      selected.competition_name_he,
      case when stint.metadata ->> 'is_current' = 'true' then 0 else 1 end as preference,
      season.end_date::timestamptz as observed_at
    from core.player_team_stints stint
    join selected_seasons selected on selected.id = stint.season_id
    join core.seasons season on season.id = stint.season_id
    where stint.metadata ->> 'discovery' = '365scores_legionnaires'

    union all

    select
      appearance.player_id,
      appearance.team_id,
      appearance.season_id,
      appearance.competition_id,
      appearance.competition_name,
      appearance.competition_name_he,
      2 as preference,
      appearance.scheduled_at as observed_at
    from season_appearances appearance
  ),
  affiliation as (
    select distinct on (candidate.player_id)
      candidate.player_id,
      candidate.team_id,
      candidate.season_id,
      candidate.competition_id,
      candidate.competition_name,
      candidate.competition_name_he
    from affiliation_candidates candidate
    order by
      candidate.player_id,
      candidate.preference,
      candidate.observed_at desc nulls last,
      candidate.team_id
  ),
  appearance_totals as (
    select
      appearance.player_id,
      count(distinct appearance.match_id)::integer as appearances,
      count(distinct appearance.match_id) filter (
        where lower(coalesce(appearance.lineup_status, '')) like '%start%'
      )::integer as starts,
      coalesce(sum(appearance.minutes_played), 0)::numeric(10,2) as minutes
    from season_appearances appearance
    group by appearance.player_id
  ),
  latest_position as (
    select distinct on (appearance.player_id)
      appearance.player_id,
      appearance.position_name
    from season_appearances appearance
    order by
      appearance.player_id,
      appearance.scheduled_at desc nulls last,
      appearance.appearance_id
  ),
  position_frequency as (
    select
      appearance.player_id,
      appearance.formation_position,
      row_number() over (
        partition by appearance.player_id
        order by
          count(*) desc,
          max(appearance.scheduled_at) desc nulls last,
          appearance.formation_position
      ) as preference
    from season_appearances appearance
    where nullif(trim(appearance.formation_position), '') is not null
      and lower(appearance.formation_position) not in ('coach', 'management')
    group by appearance.player_id, appearance.formation_position
  ),
  performance as (
    select
      observation.player_id,
      coalesce(sum(observation.value_numeric) filter (where metric.code = 'goals'), 0)::numeric(10,2) as goals,
      coalesce(sum(observation.value_numeric) filter (where metric.code = 'assists'), 0)::numeric(10,2) as assists,
      avg(observation.value_numeric) filter (where metric.code = 'rating_365')::numeric(6,2) as average_rating
    from obs.stat_observations observation
    join obs.metrics metric on metric.id = observation.metric_id
    where observation.subject_type = 'player_match'
      and observation.season_id in (select id from selected_seasons)
      and observation.player_id is not null
      and observation.value_numeric is not null
      and metric.code in ('goals', 'assists', 'rating_365')
    group by observation.player_id
  )
  select
    affiliation.season_id,
    affiliation.competition_id,
    affiliation.competition_name,
    affiliation.competition_name_he,
    player.id as player_id,
    player.display_name,
    player.display_name_he,
    coalesce(latest.position_name, player.primary_position) as primary_position,
    coalesce(detailed.formation_position, player.metadata ->> 'formation_position') as specific_position,
    case
      when lower(coalesce(detailed.formation_position, player.metadata ->> 'formation_position', latest.position_name, player.primary_position, '')) like '%goal%' then 'Goalkeepers'
      when lower(coalesce(detailed.formation_position, player.metadata ->> 'formation_position', latest.position_name, player.primary_position, '')) like '%back%' then 'Defenders'
      when lower(coalesce(detailed.formation_position, player.metadata ->> 'formation_position', latest.position_name, player.primary_position, '')) like '%midfield%' then 'Midfielders'
      when lower(coalesce(detailed.formation_position, player.metadata ->> 'formation_position', latest.position_name, player.primary_position, '')) like '%forward%'
        or lower(coalesce(detailed.formation_position, player.metadata ->> 'formation_position', latest.position_name, player.primary_position, '')) like '%striker%' then 'Attackers'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%defend%' then 'Defenders'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%mid%' then 'Midfielders'
      when lower(coalesce(latest.position_name, player.primary_position, '')) like '%attack%'
        or lower(coalesce(latest.position_name, player.primary_position, '')) like '%wing%' then 'Attackers'
      else 'Other'
    end as role_group,
    affiliation.team_id,
    team.name as team_name,
    team.logo_url as team_logo_url,
    coalesce(totals.appearances, 0) as appearances,
    coalesce(totals.starts, 0) as starts,
    coalesce(totals.minutes, 0) as minutes,
    coalesce(performance.goals, 0) as goals,
    coalesce(performance.assists, 0) as assists,
    performance.average_rating
  from affiliation
  join core.players player on player.id = affiliation.player_id
  left join core.countries country on country.id = player.country_id
  left join core.teams team on team.id = affiliation.team_id
  left join appearance_totals totals on totals.player_id = affiliation.player_id
  left join latest_position latest on latest.player_id = affiliation.player_id
  left join position_frequency detailed
    on detailed.player_id = affiliation.player_id
   and detailed.preference = 1
  left join performance on performance.player_id = affiliation.player_id
  where country.iso2 = 'IL'
    or coalesce(player.metadata ->> 'source_country_id', player.metadata ->> '365_country_id') = '6'
  order by totals.minutes desc nulls last, player.display_name;
$function$;

revoke all on function public.api_legionnaires(text) from public;
grant execute on function public.api_legionnaires(text) to anon, authenticated;

create or replace function public.api_legionnaire_leaderboard(
  p_season_name text,
  p_metric_code text,
  p_min_minutes numeric
)
returns table (
  season_id uuid,
  player_id uuid,
  display_name text,
  team_id uuid,
  team_name text,
  metric_id uuid,
  metric_code text,
  metric_name text,
  value_type text,
  aggregation text,
  sample_size integer,
  leaderboard_value numeric,
  total_value numeric,
  average_value numeric,
  numerator_value numeric,
  denominator_value numeric
)
language sql
stable
security definer
set search_path = public, core, obs
as $function$
  with selected_seasons as materialized (
    select season.id
    from core.seasons season
    join core.competitions competition on competition.id = season.competition_id
    where season.name = p_season_name
      and competition.metadata ->> 'scope' = 'foreign_club'
  ),
  selected_metric as (
    select
      metric.id,
      metric.code,
      metric.name,
      metric.value_type,
      metric.metadata ->> 'numerator_metric_code' as numerator_code,
      metric.metadata ->> 'denominator_metric_code' as denominator_code
    from obs.metrics metric
    where metric.code = p_metric_code
      and metric.subject_type = 'player_match'
  ),
  legionnaires as materialized (
    select * from public.api_legionnaires(p_season_name)
  ),
  source_resolved as (
    select
      observation.player_id,
      observation.subject_id,
      avg(observation.value_numeric) as match_value
    from obs.stat_observations observation
    join selected_metric metric on metric.id = observation.metric_id
    join core.player_match_appearances appearance on appearance.id = observation.subject_id
    where observation.subject_type = 'player_match'
      and observation.season_id in (select id from selected_seasons)
      and observation.player_id is not null
      and observation.subject_id is not null
      and observation.value_numeric is not null
      and (
        metric.value_type <> 'rating'
        or coalesce(appearance.minutes_played, 0) >= greatest(coalesce(p_min_minutes, 0), 0)
      )
    group by observation.player_id, observation.subject_id
  ),
  player_totals as (
    select
      resolved.player_id,
      count(*)::integer as sample_size,
      sum(resolved.match_value) as total_value,
      avg(resolved.match_value) as average_value
    from source_resolved resolved
    group by resolved.player_id
  ),
  component_source_resolved as (
    select
      observation.player_id,
      observation.subject_id,
      component_metric.code as component_code,
      avg(observation.value_numeric) as match_value
    from obs.stat_observations observation
    join obs.metrics component_metric on component_metric.id = observation.metric_id
    cross join selected_metric metric
    where observation.subject_type = 'player_match'
      and observation.season_id in (select id from selected_seasons)
      and observation.player_id is not null
      and observation.subject_id is not null
      and observation.value_numeric is not null
      and component_metric.code in (metric.numerator_code, metric.denominator_code)
    group by observation.player_id, observation.subject_id, component_metric.code
  ),
  component_totals as (
    select
      component.player_id,
      sum(component.match_value) filter (
        where component.component_code = metric.numerator_code
      ) as numerator_value,
      sum(component.match_value) filter (
        where component.component_code = metric.denominator_code
      ) as denominator_value
    from component_source_resolved component
    cross join selected_metric metric
    group by component.player_id
  )
  select
    legionnaire.season_id,
    legionnaire.player_id,
    legionnaire.display_name,
    legionnaire.team_id,
    legionnaire.team_name,
    metric.id as metric_id,
    metric.code as metric_code,
    metric.name as metric_name,
    metric.value_type,
    case
      when metric.value_type = 'percentage' then 'weighted'
      when metric.value_type in ('rating', 'average', 'ratio') then 'average'
      else 'total'
    end as aggregation,
    coalesce(totals.sample_size, 0) as sample_size,
    case
      when metric.value_type = 'percentage' and components.denominator_value > 0
        then components.numerator_value * 100 / components.denominator_value
      when metric.value_type in ('percentage', 'rating', 'average', 'ratio')
        then totals.average_value
      else coalesce(totals.total_value, 0)
    end as leaderboard_value,
    totals.total_value,
    totals.average_value,
    components.numerator_value,
    components.denominator_value
  from legionnaires legionnaire
  cross join selected_metric metric
  left join player_totals totals on totals.player_id = legionnaire.player_id
  left join component_totals components on components.player_id = legionnaire.player_id
  order by leaderboard_value desc nulls last, legionnaire.display_name;
$function$;

revoke all on function public.api_legionnaire_leaderboard(text, text, numeric) from public;
grant execute on function public.api_legionnaire_leaderboard(text, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
