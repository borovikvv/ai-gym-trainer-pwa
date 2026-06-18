-- AI Gym Trainer PWA v0.1 schema
-- Run in Supabase SQL Editor or through Supabase MCP/CLI.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id text primary key,
  name text not null,
  initials text not null,
  goal text not null default '',
  streak text not null default '0 недель',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  user_id text primary key references public.app_users(id) on delete cascade,
  age integer,
  sex text,
  height_cm numeric,
  weight_kg numeric,
  goal text not null default '',
  level text not null default 'beginner',
  workouts_per_week integer not null default 3,
  target_workout_minutes integer not null default 60,
  injuries text[] not null default '{}',
  limitations text[] not null default '{}',
  banned_exercises text[] not null default '{}',
  preferred_exercises text[] not null default '{}',
  equipment text[] not null default '{}',
  training_days text[] not null default '{}',
  preferences jsonb not null default '{}'::jsonb,
  notes text not null default '',
  questionnaire_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_library (
  id text primary key,
  name text not null,
  muscle_group text not null,
  instruction text not null default '',
  common_mistakes text[] not null default '{}',
  alternatives jsonb not null default '[]'::jsonb,
  media jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.programs (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  source text not null default 'template',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_days (
  id text primary key,
  program_id text not null references public.programs(id) on delete cascade,
  day_key text not null,
  name text not null,
  label text not null,
  description text not null default '',
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_id, day_key),
  unique(program_id, sort_order)
);

create table if not exists public.program_exercises (
  id text primary key,
  program_day_id text not null references public.program_days(id) on delete cascade,
  exercise_id text not null references public.exercise_library(id),
  sort_order integer not null,
  sets_count integer not null check (sets_count > 0),
  rep_min integer not null check (rep_min >= 0),
  rep_max integer not null check (rep_max >= rep_min),
  target_weight numeric not null default 0,
  weight_step numeric not null default 2.5,
  rest_seconds integer not null default 90,
  previous_text text not null default '',
  today_goal text not null default '',
  coach_focus text not null default '',
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_day_id, sort_order)
);

create table if not exists public.planned_workouts (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  scheduled_date date not null,
  status text not null default 'planned' check (status in ('planned', 'generated', 'completed', 'skipped', 'moved', 'cancelled')),
  source text not null default 'user' check (source in ('user', 'coach', 'auto')),
  workout_day_id text references public.program_days(id) on delete set null,
  workout_day_name text not null default '',
  goal text not null default '',
  coach_reason text not null default '',
  readiness_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planned_workouts_user_date_idx on public.planned_workouts(user_id, scheduled_date);

create table if not exists public.planned_workout_exercises (
  id text primary key,
  planned_workout_id text not null references public.planned_workouts(id) on delete cascade,
  exercise_id text not null references public.exercise_library(id),
  sort_order integer not null,
  sets_count integer not null check (sets_count > 0),
  rep_min integer not null check (rep_min >= 0),
  rep_max integer not null check (rep_max >= rep_min),
  target_weight numeric not null default 0,
  weight_step numeric not null default 2.5,
  rest_seconds integer not null default 90,
  intensity_target text not null default 'normal',
  coach_focus text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(planned_workout_id, sort_order)
);

create index if not exists planned_workout_exercises_workout_idx on public.planned_workout_exercises(planned_workout_id);

create table if not exists public.workout_sessions (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  workout_day_id text not null,
  workout_day_name text not null,
  completed_at timestamptz not null,
  total_volume numeric not null default 0,
  readiness_check_in jsonb,
  source text not null default 'pwa',
  created_at timestamptz not null default now()
);

alter table public.workout_sessions add column if not exists readiness_check_in jsonb;
alter table public.workout_sessions add column if not exists quality_score integer check (quality_score >= 0 and quality_score <= 100);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.workout_sessions(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  exercise_id text not null,
  exercise_name text not null default '',
  set_index integer not null check (set_index > 0),
  weight numeric not null default 0,
  reps integer not null default 0,
  rpe integer not null default 7 check (rpe between 1 and 10),
  completed boolean not null default false,
  pain boolean not null default false,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  unique(session_id, exercise_id, set_index)
);

create table if not exists public.progression_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.workout_sessions(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  exercise_id text not null,
  exercise_name text not null default '',
  recommended_weight numeric not null default 0,
  progression_type text not null check (progression_type in ('increase', 'hold', 'deload', 'pain', 'skip')),
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.workout_drafts (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  workout_day_id text not null,
  active_exercise_index integer not null default 0,
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  session_id text references public.workout_sessions(id) on delete cascade,
  recommendation_type text not null default 'coach_note',
  title text not null default '',
  body text not null,
  source text not null default 'rules',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();

drop trigger if exists exercise_library_updated_at on public.exercise_library;
create trigger exercise_library_updated_at before update on public.exercise_library for each row execute function public.set_updated_at();

drop trigger if exists programs_updated_at on public.programs;
create trigger programs_updated_at before update on public.programs for each row execute function public.set_updated_at();

drop trigger if exists program_days_updated_at on public.program_days;
create trigger program_days_updated_at before update on public.program_days for each row execute function public.set_updated_at();

drop trigger if exists program_exercises_updated_at on public.program_exercises;
create trigger program_exercises_updated_at before update on public.program_exercises for each row execute function public.set_updated_at();

drop trigger if exists planned_workouts_updated_at on public.planned_workouts;
create trigger planned_workouts_updated_at before update on public.planned_workouts for each row execute function public.set_updated_at();

drop trigger if exists planned_workout_exercises_updated_at on public.planned_workout_exercises;
create trigger planned_workout_exercises_updated_at before update on public.planned_workout_exercises for each row execute function public.set_updated_at();

drop trigger if exists workout_drafts_updated_at on public.workout_drafts;
create trigger workout_drafts_updated_at before update on public.workout_drafts for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.exercise_library enable row level security;
alter table public.programs enable row level security;
alter table public.program_days enable row level security;
alter table public.program_exercises enable row level security;
alter table public.planned_workouts enable row level security;
alter table public.planned_workout_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.progression_events enable row level security;
alter table public.workout_drafts enable row level security;
alter table public.recommendations enable row level security;

-- MVP policy: the frontend uses the anon key without Supabase Auth yet.
-- This is acceptable only for a private test link. Before public use, replace with auth.uid()-scoped policies.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_users', 'user_profiles', 'exercise_library', 'programs', 'program_days',
    'program_exercises', 'planned_workouts', 'planned_workout_exercises', 'workout_sessions', 'workout_sets', 'progression_events', 'workout_drafts', 'recommendations'
  ] loop
    execute format('drop policy if exists "mvp_anon_select_%1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "mvp_anon_insert_%1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "mvp_anon_update_%1$s" on public.%1$I', table_name);
    execute format('create policy "mvp_anon_select_%1$s" on public.%1$I for select to anon using (true)', table_name);
    execute format('create policy "mvp_anon_insert_%1$s" on public.%1$I for insert to anon with check (true)', table_name);
    execute format('create policy "mvp_anon_update_%1$s" on public.%1$I for update to anon using (true) with check (true)', table_name);
  end loop;
end $$;
