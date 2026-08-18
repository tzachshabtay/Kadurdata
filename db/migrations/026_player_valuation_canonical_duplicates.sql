alter table obs.player_valuations
  drop constraint player_valuations_pkey;

alter table obs.player_valuations
  add primary key (source_id, player_id, source_player_id, valuation_date);

notify pgrst, 'reload schema';
