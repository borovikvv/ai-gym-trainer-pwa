-- Issue #349: новый статус прогрессии 'calibration' — стартовый вес подобран
-- калибровочным рампом (подходы с нарастающим весом до RPE 7–8), а не обычной
-- прогрессией. Миграция расширяет CHECK на progression_events.
--
-- База не переписывается задним числом (schema.sql не трогаем) — паттерн тот
-- же, что у статуса 'missed' (2026-07-10_missed_status.sql).

alter table public.progression_events drop constraint if exists progression_events_progression_type_check;
alter table public.progression_events add constraint progression_events_progression_type_check
  check (progression_type in ('increase', 'hold', 'deload', 'pain', 'skip', 'calibration'));
