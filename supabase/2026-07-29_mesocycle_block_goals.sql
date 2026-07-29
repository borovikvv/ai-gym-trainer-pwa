-- Этап 1 (#174): измеримая цель тренировочного блока (мезоцикла).
--
-- Мезоцикл сам по себе бессостоятельный — фаза считается из истории. Но у
-- блока должен быть замысел: показатель, целевое значение, срок, ожидаемый
-- темп прироста и критерии провала. Иначе блок не может закончиться ни
-- успехом, ни провалом — только по календарю.
--
-- Одна строка на блок: block_started_on — понедельник первой недели цикла
-- (MesocycleState.cycleStartedOn). Новый блок → новая строка, предыдущая
-- закрывается оценкой (status + outcome_note).
--
-- expected_rate_per_week берётся из уровня и возраста (server/mesocycleBlockGoal.ts),
-- а НЕ из наблюдаемого наклона тренда: после перерыва наклон отражает возврат
-- к прежним рабочим весам, а не адаптацию. Возвратный сегмент отмечается
-- отдельно — regain_to_value.

create table if not exists public.mesocycle_block_goals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  -- Идентичность блока: дата понедельника первой недели мезоцикла.
  block_started_on date not null,
  -- Целевое упражнение. Без FK на exercise_library: id канонизируется из
  -- истории (getCanonicalExerciseId) и может не совпадать со справочником.
  exercise_id text not null,
  exercise_name text not null,
  title text not null,
  -- Показатель на старте блока и цель (e1RM, кг).
  baseline_value numeric not null,
  target_value numeric not null,
  -- Ожидаемый темп адаптации, кг/нед. Против него сверяется факт.
  expected_rate_per_week numeric not null,
  -- Если на старте блока показатель ниже прежнего максимума — прирост до
  -- этого значения считается возвратом, а не адаптацией.
  regain_to_value numeric,
  horizon_weeks integer not null,
  -- Критерии провала блока (сигнал к досрочному выходу).
  failure_drop_value numeric,
  failure_pain_sessions integer,
  status text not null default 'active' check (status in ('active', 'achieved', 'missed')),
  -- Последняя сверка факта с ожиданием (русский текст + машинный вердикт).
  progress_note text,
  progress_verdict text,
  -- Оценка по завершении блока.
  outcome_note text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, block_started_on)
);

create index if not exists mesocycle_block_goals_user_status_idx
  on public.mesocycle_block_goals (user_id, status);

drop trigger if exists mesocycle_block_goals_updated_at on public.mesocycle_block_goals;
create trigger mesocycle_block_goals_updated_at before update on public.mesocycle_block_goals for each row execute function public.set_updated_at();

alter table public.mesocycle_block_goals enable row level security;

-- MVP policy: как и остальная схема — anon-доступ по приватной ссылке.
drop policy if exists mesocycle_block_goals_mvp_anon on public.mesocycle_block_goals;
create policy mesocycle_block_goals_mvp_anon on public.mesocycle_block_goals for all using (true) with check (true);

comment on table public.mesocycle_block_goals is
  'Измеримая цель тренировочного блока: показатель, срок, ожидаемый темп, критерии провала, оценка по завершении. Управляется server/mesocycleBlockGoal.ts.';
