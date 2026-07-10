-- Фаза 2Б (план развития): статус 'missed' для запланированных тренировок.
--
-- Тренировка с прошедшей датой, которую пользователь не выполнил, помечается
-- missed сверкой расписания (server/services/scheduleReconciliation.ts) при
-- открытии приложения. Это триггер каскадной перегенерации будущих
-- тренировок под фактический перерыв.

alter table public.planned_workouts drop constraint if exists planned_workouts_status_check;
alter table public.planned_workouts add constraint planned_workouts_status_check
  check (status in ('planned', 'generated', 'completed', 'skipped', 'moved', 'cancelled', 'missed'));
