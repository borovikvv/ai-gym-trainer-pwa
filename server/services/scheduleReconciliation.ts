// Фаза 2Б.2 (план развития): сверка расписания с реальностью.
//
// Вызывается лениво при открытии приложения (GET /planned-workouts,
// GET /program-data). Запланированные тренировки с прошедшей датой без
// выполнения помечаются 'missed', и все будущие тренировки каскадно
// пересобираются под фактический перерыв: генератор считает coachState на
// дату тренировки, так что 5-дневный разрыв даст другую тренировку, чем
// 2-дневный (мышцы успели восстановиться).
//
// Пропущенная тренировка НЕ переносится автоматически — тренер перестраивает
// будущее, а не догоняет прошлое.
import type { DbClient } from '../dbClient.js'
import { cascadeRegenerateFutureWorkouts } from './plannedWorkoutService.js'
import { invalidateLiveCoachCache } from './liveCoachContext.js'
import { logActivity } from '../activityLog.js'

export interface ReconcileResult {
  missedDates: string[]
  regenerated: number
}

export async function reconcileSchedule(client: DbClient, userId: string): Promise<ReconcileResult> {
  const missed = await client.query(
    `update public.planned_workouts
     set status = 'missed',
         updated_at = now()
     where user_id = $1
       and status in ('planned', 'generated', 'moved')
       and scheduled_date < current_date
     returning scheduled_date`,
    [userId],
  )
  const missedDates = (missed.rows as Array<{ scheduled_date: unknown }>).map((row) =>
    String((row.scheduled_date as Date)?.toISOString?.()?.slice(0, 10) ?? row.scheduled_date).slice(0, 10),
  )
  if (missedDates.length === 0) return { missedDates, regenerated: 0 }

  // Пропуск меняет фактический разрыв → будущий план строился на устаревших
  // допущениях. Пересобираем каскадом и сбрасываем кэш live-советника.
  invalidateLiveCoachCache(userId)
  const regenerated = await cascadeRegenerateFutureWorkouts(client, { userId })
  logActivity('schedule.reconciled', { userId, missedDates, regenerated })
  return { missedDates, regenerated }
}
