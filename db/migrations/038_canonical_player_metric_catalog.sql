do $migration$
declare
  mapping record;
begin
  for mapping in
    select *
    from (
      values
        ('big_chance_created_team_title', 'big_chances_created', 'Big Chances Created'),
        ('big_chance_missed_title', 'big_chances_missed', 'Big Chances Missed'),
        ('blocked_shots', 'shots_blocked', 'Shots Blocked'),
        ('chances_created', 'key_passes', 'Key Passes'),
        ('dribbled_past', 'was_dribbled_past', 'Was Dribbled Past'),
        ('duel_lost', 'duels_lost', 'Duels Lost'),
        ('expected_goals_on_target_variant', 'expected_goals_on_target', 'Expected Goals On Target'),
        ('fouls', 'fouls_made', 'Fouls Made'),
        ('headed_clearance', 'headed_clearances', 'Headed Clearances'),
        ('matchstats_headers_tackles', 'tackles_won', 'Tackles Won'),
        ('penalties_won', 'penalty_won', 'Penalty Won'),
        ('recoveries', 'ball_recovery', 'Ball Recovery'),
        ('shot_blocks', 'blocks', 'Blocks'),
        ('shots_woodwork', 'hit_woodwork', 'Hit Woodwork'),
        ('shotsofftarget', 'shots_off_target', 'Shots Off Target'),
        ('shotsontarget', 'shots_on_target', 'Shots On Target'),
        ('touches_opp_box', 'touches_in_opposition_box', 'Touches In Opposition Box')
    ) as aliases(source_code, canonical_code, canonical_name)
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'obs'
        and table_name = 'player_match_stats'
        and column_name = mapping.source_code
    ) then
      insert into obs.metrics (code, name, subject_type, value_type)
      values (mapping.canonical_code, mapping.canonical_name, 'player_match', 'count')
      on conflict (code) do nothing;

      execute format(
        'alter table obs.player_match_stats add column if not exists %I numeric(18,6)',
        mapping.canonical_code
      );
      execute format(
        'update obs.player_match_stats
         set metric_count = (metric_count - case when %1$I is not null and %2$I is not null then 1 else 0 end)::smallint,
             %2$I = coalesce(%2$I, %1$I),
             %1$I = null
         where %1$I is not null',
        mapping.source_code,
        mapping.canonical_code
      );
    end if;
  end loop;
end;
$migration$;

update obs.metrics
set metadata = metadata || jsonb_build_object('public', false)
where subject_type = 'player_match'
  and code in (
    'big_chance_created_team_title',
    'big_chance_missed_title',
    'blocked_shots',
    'chances_created',
    'dribbled_past',
    'duel_lost',
    'expected_goals_on_target_variant',
    'fouls',
    'headed_clearance',
    'matchstats_headers_tackles',
    'penalties_won',
    'recoveries',
    'shot_accuracy',
    'shot_accuracy_attempted',
    'shot_accuracy_pct',
    'shot_blocks',
    'shots_woodwork',
    'shotsofftarget',
    'shotsontarget',
    'touches_opp_box',
    'xg_and_xa'
  );

select obs.refresh_stat_values_view();

create or replace view public.api_metrics as
select
  id as metric_id,
  code,
  name,
  subject_type,
  value_type,
  metadata ->> 'numerator_metric_code' as numerator_metric_code,
  metadata ->> 'denominator_metric_code' as denominator_metric_code
from obs.metrics
where subject_type in ('player_match', 'team_match')
  and coalesce((metadata ->> 'public')::boolean, true);

grant select on public.api_metrics to anon, authenticated;

notify pgrst, 'reload schema';
