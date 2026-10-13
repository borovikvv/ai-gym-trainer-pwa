// Issue #347 (push-напоминания, шаг 1): чистое решение «напоминать или нет».
//
// Функция ничего не отправляет и не читает из БД — она только принимает
// запланированную тренировку и «сегодня», возвращая решение для будущего
// слоя доставки пушей (следующие issue: подписки, VAPID, cron, настройки).
//
// Статусы взяты из check-constraint public.planned_workouts
// (supabase/schema.sql:117 + supabase/2026-07-10_missed_status.sql:10).
export type PlannedWorkoutStatus =
  | 'planned'
  | 'generated'
  | 'completed'
  | 'skipped'
  | 'moved'
  | 'cancelled'
  | 'missed'

export type ReminderDecision = 'train-today' | 'missed-reschedule' | 'none'

const ACTIVE_STATUSES: PlannedWorkoutStatus[] = ['planned', 'generated', 'moved']

// Даты приводим к календарному дню YYYY-MM-DD, как в
// server/services/scheduleReconciliation.ts:38-40.
function toCalendarDay(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

export function computeWorkoutReminder(
  plannedWorkout: { status: PlannedWorkoutStatus; scheduledDate: string },
  today: Date,
): ReminderDecision {
  // Уже сделано — не напоминаем.
  if (plannedWorkout.status === 'completed') return 'none'

  // Пропуск уже вычислен сверкой расписания — мягко предлагаем перенос.
  if (plannedWorkout.status === 'missed') return 'missed-reschedule'

  // Активная тренировка на сегодня — напоминаем.
  if (ACTIVE_STATUSES.includes(plannedWorkout.status) && toCalendarDay(plannedWorkout.scheduledDate) === toCalendarDay(today)) {
    return 'train-today'
  }

  // Будущая дата, skipped/cancelled или прошедшая дата без missed — молчим.
  return 'none'
}
