create or replace view public.api_seasons as
with match_totals as (
  select
    season_id,
    count(*)::integer as match_count,
    count(*) filter (
      where lower(coalesce(status, '')) in ('ended', 'after et', 'after penalties', 'awarded')
        and home_score >= 0
        and away_score >= 0
    )::integer as completed_match_count,
    coalesce(sum(home_score + away_score) filter (
      where lower(coalesce(status, '')) in ('ended', 'after et', 'after penalties', 'awarded')
        and home_score >= 0
        and away_score >= 0
    ), 0)::integer as goals_scored,
    min(scheduled_at) as first_match_at,
    max(scheduled_at) as latest_match_at
  from core.matches
  group by season_id
),
team_totals as (
  select m.season_id, count(distinct mt.team_id)::integer as team_count
  from core.matches m
  join core.match_teams mt on mt.match_id = m.id
  group by m.season_id
),
player_totals as (
  select m.season_id, count(distinct pma.player_id)::integer as player_count
  from core.matches m
  join core.player_match_appearances pma on pma.match_id = m.id
  group by m.season_id
),
season_base as (
  select
    s.id as season_id,
    s.competition_id,
    c.name as competition_name,
    c.name_he as competition_name_he,
    s.name as season_name,
    s.start_date,
    s.end_date,
    coalesce(matches.match_count, 0) as match_count,
    coalesce(matches.completed_match_count, 0) as completed_match_count,
    coalesce(teams.team_count, 0) as team_count,
    coalesce(players.player_count, 0) as player_count,
    coalesce(matches.goals_scored, 0) as goals_scored,
    matches.first_match_at,
    matches.latest_match_at
  from core.seasons s
  join core.competitions c on c.id = s.competition_id
  left join match_totals matches on matches.season_id = s.id
  left join team_totals teams on teams.season_id = s.id
  left join player_totals players on players.season_id = s.id
)
select
  season_base.*,
  row_number() over (
    partition by competition_id
    order by start_date desc nulls last, season_name desc
  ) = 1 as is_latest
from season_base;

create or replace view public.api_rounds as
select
  r.id as round_id,
  s.id as season_id,
  stage.id as stage_id,
  stage.name as stage_name,
  stage.stage_type,
  stage.stage_number,
  r.round_number,
  coalesce(r.name, 'Round') as round_name,
  count(m.id)::integer as match_count,
  count(m.id) filter (
    where lower(coalesce(m.status, '')) in ('ended', 'after et', 'after penalties', 'awarded')
      and m.home_score >= 0
      and m.away_score >= 0
  )::integer as completed_match_count,
  min(m.scheduled_at) as first_match_at,
  max(m.scheduled_at) as last_match_at
from core.rounds r
join core.season_stages stage on stage.id = r.stage_id
join core.seasons s on s.id = stage.season_id
left join core.matches m on m.round_id = r.id
group by r.id, s.id, stage.id;

create or replace view public.api_clubs as
with club_matches as (
  select
    m.season_id,
    mt.team_id,
    opponent.score as opponent_score,
    mt.score,
    m.scheduled_at,
    lower(coalesce(m.status, '')) in ('ended', 'after et', 'after penalties', 'awarded')
      and m.home_score >= 0
      and m.away_score >= 0 as is_completed
  from core.match_teams mt
  join core.matches m on m.id = mt.match_id
  left join core.match_teams opponent
    on opponent.match_id = mt.match_id
   and opponent.team_id = mt.opponent_team_id
),
club_totals as (
  select
    season_id,
    team_id,
    count(*) filter (where is_completed)::integer as played,
    count(*) filter (where is_completed and score > opponent_score)::integer as won,
    count(*) filter (where is_completed and score = opponent_score)::integer as drawn,
    count(*) filter (where is_completed and score < opponent_score)::integer as lost,
    coalesce(sum(score) filter (where is_completed), 0)::integer as goals_for,
    coalesce(sum(opponent_score) filter (where is_completed), 0)::integer as goals_against,
    max(scheduled_at) filter (where is_completed) as last_played_at
  from club_matches
  group by season_id, team_id
)
select
  totals.season_id,
  s.competition_id,
  team.id as team_id,
  team.name as team_name,
  team.name_he as team_name_he,
  team.short_name,
  team.city,
  team.founded_year,
  team.primary_color,
  team.secondary_color,
  totals.played,
  totals.won,
  totals.drawn,
  totals.lost,
  totals.goals_for,
  totals.goals_against,
  totals.goals_for - totals.goals_against as goal_difference,
  totals.won * 3 + totals.drawn as points,
  totals.last_played_at
from club_totals totals
join core.seasons s on s.id = totals.season_id
join core.teams team on team.id = totals.team_id;

grant select on public.api_seasons, public.api_rounds, public.api_clubs to anon, authenticated;
