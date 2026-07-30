-- Этап 1 (#176): ряд измерений веса тела.
--
-- До этого вес хранился ОДНИМ значением профиля (user_profiles.weight_kg),
-- заданным в анкете: динамики не было совсем. Из-за этого недоступен один из
-- шести диагнозов стагнации (#175) — «прогресса нет, вес идёт вниз, цель
-- масса» — энергетический дефицит, а не тренировочная проблема. Без тренда
-- веса он неотличим от недостаточного стимула, и тренер добавлял бы объём
-- там, где причина вообще не в тренировках.
--
-- Назначение узкое: вес ОБЪЯСНЯЕТ, но ничего не ограничивает. Ни целевого
-- веса, ни калорий, ни ограничения объёма по динамике веса здесь нет и не
-- планируется.
--
-- user_profiles.weight_kg остаётся, но становится последним известным
-- значением (его обновляет server/bodyWeightLog.ts), а не самостоятельной
-- истиной. Значение из анкеты трактуется как первый замер.
--
-- Один замер в день: вес меряется в одинаковых условиях, второе измерение за
-- те же сутки — уточнение, а не новая точка ряда, поэтому unique + upsert.

create table if not exists public.body_weight_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  measured_on date not null,
  -- Границы — защита от опечатки в поле ввода, а не медицинское суждение.
  weight_kg numeric not null check (weight_kg >= 20 and weight_kg <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);

create index if not exists body_weight_log_user_date_idx
  on public.body_weight_log (user_id, measured_on desc);

alter table public.body_weight_log enable row level security;

-- MVP policy: как и остальная схема — anon-доступ по приватной ссылке.
drop policy if exists body_weight_log_mvp_anon on public.body_weight_log;
create policy body_weight_log_mvp_anon on public.body_weight_log for all using (true) with check (true);

comment on table public.body_weight_log is
  'Ряд измерений веса тела. Тренд по скользящему среднему считает shared/bodyWeight.ts.';
