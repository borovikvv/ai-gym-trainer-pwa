-- Issue #194: три колонки были добавлены только в schema.sql, дельта-миграции
-- не было — на проде их нет, из-за чего с 2026-07-28 не сохранилась ни одна
-- тренировка (INSERT в workout_sessions падает, транзакция откатывается целиком).
--
-- Колонки: user_rating (#161), pain_log (#163), performed_at (#165).
-- performed_at ломает не только запись, но и чтение истории — она в SELECT
-- в workoutService.ts:116.
--
-- Определения дословно повторяют schema.sql, чтобы прогон обоих файлов в любом
-- порядке давал одно и то же.

alter table public.workout_sessions add column if not exists user_rating integer check (user_rating >= 1 and user_rating <= 5);
alter table public.workout_sessions add column if not exists pain_log jsonb;
alter table public.workout_sets add column if not exists performed_at timestamptz;
