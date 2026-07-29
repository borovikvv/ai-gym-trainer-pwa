-- Exercise Library Weight Direction
-- Issue #173: for assisted machines (gravitron) the "weight" is the
-- counterweight — MORE weight = EASIER. The direction must be a catalog
-- property, not a name string check scattered across the codebase.
--
-- New column:
--   weight_direction   text — 'load' (default) | 'assistance'

alter table public.exercise_library
  add column if not exists weight_direction text;

alter table public.exercise_library
  drop constraint if exists exercise_library_weight_direction_check;
alter table public.exercise_library
  add constraint exercise_library_weight_direction_check
  check (weight_direction is null or weight_direction in ('load', 'assistance'));

-- Backfill: assisted machines (gravitron / assisted) get 'assistance',
-- everything else 'load'. Matches the legacy isAssistedExercise name check.
update public.exercise_library
set weight_direction = 'assistance'
where weight_direction is null
  and (lower(name) like '%гравитрон%' or lower(name) like '%assisted%');

update public.exercise_library
set weight_direction = 'load'
where weight_direction is null;

alter table public.exercise_library
  alter column weight_direction set default 'load';

comment on column public.exercise_library.weight_direction is
  'load: more weight = harder (default). assistance: weight is counterweight, more weight = easier (gravitron). Issue #173.';
