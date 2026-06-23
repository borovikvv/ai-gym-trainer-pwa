-- Exercise Library Metadata Expansion
-- Phase 3 issue #12: add columns for coach decision-making and audit.
--
-- New columns:
--   target_muscles     text[]   — detailed muscles (e.g. ['верх груди', 'передняя дельта'])
--   movement_pattern   text     — 'push' | 'pull' | 'squat' | 'hinge' | 'rotation' | 'carry' | 'isolation'
--   equipment          text     — 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell' | 'band'
--   exercise_type      text     — 'compound' | 'isolation'
--   difficulty_level   text     — 'beginner' | 'intermediate' | 'advanced'
--
-- All columns are nullable for backward compatibility — existing rows
-- keep working without metadata until the data migration fills them in.

alter table public.exercise_library
  add column if not exists target_muscles text[] default '{}',
  add column if not exists movement_pattern text,
  add column if not exists equipment text,
  add column if not exists exercise_type text,
  add column if not exists difficulty_level text;

-- Add check constraints for enum-like columns.
alter table public.exercise_library
  drop constraint if exists exercise_library_movement_pattern_check;
alter table public.exercise_library
  add constraint exercise_library_movement_pattern_check
  check (movement_pattern is null or movement_pattern in (
    'push', 'pull', 'squat', 'hinge', 'rotation', 'carry', 'isolation'
  ));

alter table public.exercise_library
  drop constraint if exists exercise_library_equipment_check;
alter table public.exercise_library
  add constraint exercise_library_equipment_check
  check (equipment is null or equipment in (
    'barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band'
  ));

alter table public.exercise_library
  drop constraint if exists exercise_library_exercise_type_check;
alter table public.exercise_library
  add constraint exercise_library_exercise_type_check
  check (exercise_type is null or exercise_type in ('compound', 'isolation'));

alter table public.exercise_library
  drop constraint if exists exercise_library_difficulty_level_check;
alter table public.exercise_library
  add constraint exercise_library_difficulty_level_check
  check (difficulty_level is null or difficulty_level in ('beginner', 'intermediate', 'advanced'));

comment on column public.exercise_library.target_muscles is
  'Detailed muscle targets, e.g. {верх груди, передняя дельта}. Empty array = use muscle_group only.';
comment on column public.exercise_library.movement_pattern is
  'Movement pattern: push, pull, squat, hinge, rotation, carry, isolation.';
comment on column public.exercise_library.equipment is
  'Primary equipment: barbell, dumbbell, cable, machine, bodyweight, kettlebell, band.';
comment on column public.exercise_library.exercise_type is
  'compound (multi-joint) or isolation (single-joint).';
comment on column public.exercise_library.difficulty_level is
  'beginner, intermediate, or advanced.';
