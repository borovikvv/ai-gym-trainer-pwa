create table if not exists public.planned_workouts (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  scheduled_date date not null,
  status text not null default 'planned' check (status in ('planned', 'generated', 'completed', 'skipped', 'moved', 'cancelled')),
  source text not null default 'user' check (source in ('user', 'coach', 'auto')),
  workout_day_id text,
  workout_day_name text not null default '',
  goal text not null default '',
  coach_reason text not null default '',
  readiness_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, scheduled_date, status)
);

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
  intensity_target text not null default '',
  coach_focus text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(planned_workout_id, sort_order)
);

create index if not exists planned_workouts_user_date_idx on public.planned_workouts(user_id, scheduled_date);
create index if not exists planned_workout_exercises_workout_idx on public.planned_workout_exercises(planned_workout_id, sort_order);

drop trigger if exists planned_workouts_updated_at on public.planned_workouts;
create trigger planned_workouts_updated_at before update on public.planned_workouts for each row execute function public.set_updated_at();

drop trigger if exists planned_workout_exercises_updated_at on public.planned_workout_exercises;
create trigger planned_workout_exercises_updated_at before update on public.planned_workout_exercises for each row execute function public.set_updated_at();

alter table public.planned_workouts enable row level security;
alter table public.planned_workout_exercises enable row level security;

drop policy if exists "mvp_anon_select_planned_workouts" on public.planned_workouts;
drop policy if exists "mvp_anon_insert_planned_workouts" on public.planned_workouts;
drop policy if exists "mvp_anon_update_planned_workouts" on public.planned_workouts;
create policy "mvp_anon_select_planned_workouts" on public.planned_workouts for select to anon using (true);
create policy "mvp_anon_insert_planned_workouts" on public.planned_workouts for insert to anon with check (true);
create policy "mvp_anon_update_planned_workouts" on public.planned_workouts for update to anon using (true) with check (true);

drop policy if exists "mvp_anon_select_planned_workout_exercises" on public.planned_workout_exercises;
drop policy if exists "mvp_anon_insert_planned_workout_exercises" on public.planned_workout_exercises;
drop policy if exists "mvp_anon_update_planned_workout_exercises" on public.planned_workout_exercises;
create policy "mvp_anon_select_planned_workout_exercises" on public.planned_workout_exercises for select to anon using (true);
create policy "mvp_anon_insert_planned_workout_exercises" on public.planned_workout_exercises for insert to anon with check (true);
create policy "mvp_anon_update_planned_workout_exercises" on public.planned_workout_exercises for update to anon using (true) with check (true);
