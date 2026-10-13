-- Issue #420: структурные изменения плана, применённые недельным агентом.
--
-- До этого недельный обзор (server/coachProgramReview.ts) предлагал изменения
-- (adjust_volume и др.), но никто их не применял — текст уходил на фронт для
-- чтения. #420 вводит применение, и каждое действие обязано быть
-- залогировано с причиной: что изменено, по какой границе объёма подрезано,
-- когда применено и когда отменено.
--
-- Рамки безопасности (#171/#136) — детерминированный гейт до применения:
-- getVolumeLandmarks учитывает возрастную фазу (подростку объём урезается
-- сильнее). Личная модель (#418) в гейте не участвует.
--
-- status:
--   applied   — применено без подрезки;
--   clamped   — применение урезано до границы объёма (MEV/MRV);
--   unmatched — упражнение не найдено, план не менялся (строки с этим
--               статусом движок не пишет, значение — для полноты контракта);
--   reverted  — действие отменено, упражнению вернули прежнее значение.
-- before/after — снимок числа подходов ({ "setsCount": N }).

create table if not exists public.program_change_actions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  program_exercise_id text not null,
  change_type text not null,
  status text not null check (status in ('applied', 'clamped', 'unmatched', 'reverted')),
  before jsonb,
  after jsonb,
  rationale text,
  safety_note text,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists program_change_actions_user_created_idx
  on public.program_change_actions (user_id, created_at desc);

alter table public.program_change_actions enable row level security;

-- MVP policy: как и остальная схема — anon-доступ по приватной ссылке.
drop policy if exists program_change_actions_mvp_anon on public.program_change_actions;
create policy program_change_actions_mvp_anon on public.program_change_actions for all using (true) with check (true);

comment on table public.program_change_actions is
  'Issue #420: изменения плана, применённые недельным агентом (adjust_volume), со статусом, before/after и причиной. Двигатель — server/coachProgramActions.ts; отмена возвращает прежнее число подходов.';
