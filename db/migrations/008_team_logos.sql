alter table core.teams
  add column if not exists logo_url text,
  add column if not exists logo_source_id uuid references source.sources(id) on delete set null;

create or replace view public.api_team_assets as
select
  team.id as team_id,
  team.logo_url,
  team.logo_source_id,
  team.primary_color,
  team.secondary_color
from core.teams team;

grant select on public.api_team_assets to anon, authenticated;
