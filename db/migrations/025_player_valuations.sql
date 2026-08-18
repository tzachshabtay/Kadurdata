create table obs.player_valuations (
  source_id uuid not null references source.sources(id),
  player_id uuid not null references core.players(id) on delete cascade,
  source_player_id text not null,
  valuation_date date not null,
  value_amount bigint not null check (value_amount >= 0),
  currency text not null check (char_length(currency) = 3),
  lower_bound bigint check (lower_bound is null or lower_bound >= 0),
  upper_bound bigint check (upper_bound is null or upper_bound >= 0),
  provider text,
  source_team_id text,
  source_team_name text,
  source_url text,
  observed_at timestamptz not null default now(),
  primary key (source_id, source_player_id, valuation_date)
);

create index player_valuations_player_date_idx
  on obs.player_valuations (player_id, valuation_date desc);

create or replace view public.api_player_valuations as
select
  valuation.player_id,
  player.display_name,
  player.display_name_he,
  valuation.valuation_date,
  valuation.value_amount,
  valuation.currency,
  valuation.lower_bound,
  valuation.upper_bound,
  valuation.provider,
  valuation.source_player_id,
  valuation.source_team_id,
  valuation.source_team_name,
  valuation.source_url,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  valuation.observed_at
from obs.player_valuations valuation
join core.players player on player.id = valuation.player_id
join source.sources source on source.id = valuation.source_id;

grant select on public.api_player_valuations to anon, authenticated;

notify pgrst, 'reload schema';
