-- Долгосрочная память тренера и цели (Фаза 2 плана развития).
--
-- coach_memory_facts — персистентные факты о пользователе, которые тренер
-- помнит бессрочно: травмы, реакция на нагрузку, предпочтения, ограничения,
-- вехи. Пишутся пост-тренировочной LLM-рефлексией (source='llm') и самим
-- пользователем через UI (source='user'). Факты живут, пока пользователь их
-- не заархивирует; факты-травмы LLM архивировать не может (защита в
-- server/coachLongTermMemory.ts).
--
-- coach_goals — явные многонедельные цели («жим лёжа 80 кг × 1 к 1 сентября»),
-- к которым тренер ведёт через макроцикл. Прогресс переоценивается недельным
-- обзором программы по трендам e1RM.
--
-- Отдельные таблицы (не blob в recommendations), потому что факты и цели
-- должны редактироваться пользователем поштучно.

create table if not exists public.coach_memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  kind text not null check (kind in ('injury', 'load_response', 'preference', 'constraint', 'milestone')),
  content text not null check (length(content) between 3 and 500),
  status text not null default 'active' check (status in ('active', 'archived')),
  source text not null default 'llm' check (source in ('llm', 'user', 'rules')),
  -- Уверенность LLM в факте (0..1). Факты-травмы с confidence < 1 показываются
  -- пользователю на подтверждение («тренер заметил — верно?»).
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_memory_facts_user_status_idx
  on public.coach_memory_facts (user_id, status);

create table if not exists public.coach_goals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null check (length(title) between 3 and 200),
  exercise_id text references public.exercise_library(id),
  metric text not null check (metric in ('e1rm', 'working_weight', 'reps_at_weight', 'bodyweight', 'habit')),
  target_value numeric,
  target_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'paused', 'dropped')),
  -- Последняя оценка прогресса недельным обзором (русский текст, например
  -- «e1RM 74 кг из 80, идём с опережением графика на неделю»).
  progress_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_goals_user_status_idx
  on public.coach_goals (user_id, status);

drop trigger if exists coach_memory_facts_updated_at on public.coach_memory_facts;
create trigger coach_memory_facts_updated_at before update on public.coach_memory_facts for each row execute function public.set_updated_at();

drop trigger if exists coach_goals_updated_at on public.coach_goals;
create trigger coach_goals_updated_at before update on public.coach_goals for each row execute function public.set_updated_at();

alter table public.coach_memory_facts enable row level security;
alter table public.coach_goals enable row level security;

-- MVP policy: same as the rest of the schema — anon access for a private
-- test link. Replace with auth.uid()-scoped policies before public use.
drop policy if exists coach_memory_facts_mvp_anon on public.coach_memory_facts;
create policy coach_memory_facts_mvp_anon on public.coach_memory_facts for all using (true) with check (true);

drop policy if exists coach_goals_mvp_anon on public.coach_goals;
create policy coach_goals_mvp_anon on public.coach_goals for all using (true) with check (true);

comment on table public.coach_memory_facts is
  'Долгосрочная память тренера: травмы, реакция на нагрузку, предпочтения. Управляется server/coachLongTermMemory.ts.';
comment on table public.coach_goals is
  'Многонедельные цели пользователя, к которым тренер ведёт через макроцикл.';
