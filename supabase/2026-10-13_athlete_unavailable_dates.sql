-- Issue #445: структурная отметка «день недоступен» от атлета.
--
-- В #420 недельный агент должен был уметь переставлять тренировки под
-- ограничения атлета («в четверг уезжаю»), но канала для самого ограничения
-- не было. Здесь он появляется: атлет отмечает дату недоступной, и
-- детерминированный движок (server/coachProgramActions.ts, applyMoveWorkoutChange)
-- переносит ближайшую подходящую тренировку в пределах той же недели.
--
-- Свободный текст и LLM-парсинг фраз в исполнительный путь намеренно не
-- подключаются — только структурная отметка даты. Снять отметку в этом
-- изменении нельзя: передумал — отменяй перенос через
-- POST /coach/program-change/:actionId/revert.

create table if not exists public.athlete_unavailable_dates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists athlete_unavailable_dates_user_date_idx
  on public.athlete_unavailable_dates (user_id, date);

alter table public.athlete_unavailable_dates enable row level security;

-- MVP policy: как и остальная схема — anon-доступ по приватной ссылке.
drop policy if exists athlete_unavailable_dates_mvp_anon on public.athlete_unavailable_dates;
create policy athlete_unavailable_dates_mvp_anon on public.athlete_unavailable_dates for all using (true) with check (true);

comment on table public.athlete_unavailable_dates is
  'Issue #445: даты, отмеченные атлетом как недоступные. Читает гейт переноса тренировки (server/services/athleteAvailability.ts); снятия отметки в этой ревизии нет.';
