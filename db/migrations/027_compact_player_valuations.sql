create table obs.player_valuation_series (
  source_id uuid not null references source.sources(id),
  player_id uuid not null references core.players(id) on delete cascade,
  source_player_id text not null,
  currency text not null check (char_length(currency) = 3),
  provider text,
  source_url text,
  valuation_dates date[] not null,
  value_amounts integer[] not null,
  lower_bounds integer[] not null,
  upper_bounds integer[] not null,
  observed_at timestamptz not null default now(),
  primary key (source_id, player_id, source_player_id),
  check (cardinality(valuation_dates) > 0),
  check (cardinality(value_amounts) = cardinality(valuation_dates)),
  check (cardinality(lower_bounds) = cardinality(valuation_dates)),
  check (cardinality(upper_bounds) = cardinality(valuation_dates))
);

create index player_valuation_series_player_idx
  on obs.player_valuation_series (player_id);

insert into obs.player_valuation_series (
  source_id,
  player_id,
  source_player_id,
  currency,
  provider,
  source_url,
  valuation_dates,
  value_amounts,
  lower_bounds,
  upper_bounds,
  observed_at
)
select
  valuation.source_id,
  valuation.player_id,
  valuation.source_player_id,
  (array_agg(valuation.currency order by valuation.valuation_date desc))[1],
  max(valuation.provider),
  max(valuation.source_url),
  array_agg(valuation.valuation_date order by valuation.valuation_date),
  array_agg(valuation.value_amount::integer order by valuation.valuation_date),
  array_agg(valuation.lower_bound::integer order by valuation.valuation_date),
  array_agg(valuation.upper_bound::integer order by valuation.valuation_date),
  max(valuation.observed_at)
from obs.player_valuations valuation
group by valuation.source_id, valuation.player_id, valuation.source_player_id;

drop view public.api_player_valuations;
drop table obs.player_valuations;

create view public.api_player_valuations as
select
  series.player_id,
  player.display_name,
  player.display_name_he,
  series.valuation_dates[point.ordinal] as valuation_date,
  series.value_amounts[point.ordinal] as value_amount,
  series.currency,
  series.lower_bounds[point.ordinal] as lower_bound,
  series.upper_bounds[point.ordinal] as upper_bound,
  series.provider,
  series.source_player_id,
  null::text as source_team_id,
  null::text as source_team_name,
  series.source_url,
  source.id as source_id,
  source.code as source_code,
  source.name as source_name,
  series.observed_at
from obs.player_valuation_series series
cross join lateral generate_subscripts(series.valuation_dates, 1) point(ordinal)
join core.players player on player.id = series.player_id
join source.sources source on source.id = series.source_id;

grant select on public.api_player_valuations to anon, authenticated;

notify pgrst, 'reload schema';
