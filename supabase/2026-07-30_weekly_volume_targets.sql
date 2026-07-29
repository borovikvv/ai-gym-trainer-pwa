-- Этап 1 (#166): недельный объём по группам — явная цель, факт, сверка.
--
-- До этого решения «сколько объёма на группу за неделю» не существовало:
-- число подходов приходило из библиотеки упражнения с поправкой на стиль, а
-- недельный объём складывался сам собой (ноги получали ~2-3 рабочих подхода в
-- неделю при цели «масса»).
--
-- Одна строка = намерение тренера на одну группу на одну календарную неделю:
-- сколько рабочих подходов дать, почему именно столько (обоснование и дата
-- решения), и чем неделя закончилась (факт, вердикт сверки).
--
-- Цель недели — способ достичь цели блока (#174), поэтому block_goal_id.
--
-- Оговорка (см. комментарий владельца в #166): сейчас все залогированные
-- подходы рабочие. Когда тренер начнёт назначать разминку (#172), учёт факта
-- должен сразу исключать разминочные подходы — считает
-- server/weeklyVolumeTargets.ts через countCompletedSets.

create table if not exists public.weekly_volume_targets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  -- Понедельник календарной недели.
  week_start date not null,
  muscle_key text not null check (muscle_key in ('back', 'chest', 'legs', 'shoulders', 'arms', 'core')),
  -- Намерение: столько рабочих подходов тренер планирует дать группе за неделю.
  target_sets integer not null check (target_sets >= 0 and target_sets <= 40),
  -- Обоснование решения (какие сигналы его вызвали) и то, что было неделей раньше.
  reason text not null,
  previous_target_sets integer,
  action text not null default 'hold' check (action in ('add', 'hold', 'cut')),
  -- Недельная цель ставится как способ достичь цели блока.
  block_goal_id uuid references public.mesocycle_block_goals(id) on delete set null,
  -- Сверка в конце недели.
  actual_sets integer,
  verdict text check (verdict in ('undershoot', 'hit', 'overshoot')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start, muscle_key)
);

create index if not exists weekly_volume_targets_user_week_idx
  on public.weekly_volume_targets (user_id, week_start desc);

drop trigger if exists weekly_volume_targets_updated_at on public.weekly_volume_targets;
create trigger weekly_volume_targets_updated_at before update on public.weekly_volume_targets for each row execute function public.set_updated_at();

alter table public.weekly_volume_targets enable row level security;

-- MVP policy: как и остальная схема — anon-доступ по приватной ссылке.
drop policy if exists weekly_volume_targets_mvp_anon on public.weekly_volume_targets;
create policy weekly_volume_targets_mvp_anon on public.weekly_volume_targets for all using (true) with check (true);

comment on table public.weekly_volume_targets is
  'Недельная цель по объёму на группу мышц с обоснованием и сверкой факта. Управляется server/weeklyVolumeTargets.ts.';
