create or replace view public.api_competitions as
with season_rank as (
  select
    s.*,
    row_number() over (
      partition by s.competition_id
      order by s.start_date desc nulls last, s.name desc
    ) as recency_rank
  from core.seasons s
)
select
  c.id as competition_id,
  c.name,
  c.name_he,
  c.competition_type,
  country.name as country_name,
  count(sr.id)::integer as season_count,
  (max(sr.id::text) filter (where sr.recency_rank = 1))::uuid as latest_season_id,
  max(sr.name) filter (where sr.recency_rank = 1) as latest_season_name,
  coalesce(c.metadata ->> 'scope', 'domestic') as scope,
  c.gender,
  coalesce(c.metadata ->> 'age_group', 'senior') as age_group,
  coalesce(c.metadata ->> 'participant_type', 'club') as participant_type
from core.competitions c
left join core.countries country on country.id = c.country_id
left join season_rank sr on sr.competition_id = c.id
group by c.id, country.name;

grant select on public.api_competitions to anon, authenticated;
