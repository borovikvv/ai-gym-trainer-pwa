// Issue #420: контекст недельного агента — личная модель (#418) и ответы
// атлета после тренировок (#419). Оба блока — только текст для промпта
// обзора: в гейт применения изменений они не входят.

import type { WorkoutHistoryEntry } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import { estimateRepsLostPerWeightStep } from '../src/domain/repsLostPerWeightStep.js'

interface ProgramDayLike {
  exercises?: Array<{ id?: string; name?: string }>
}

interface StoredPostWorkoutSignal {
  trigger?: { exerciseName?: string; deviation?: number }
  signalType?: string
  painLocation?: string | null
  confidence?: number | null
}

const SIGNAL_TEXT: Record<string, string> = {
  easy: 'было легко',
  tired: 'устал',
  pain: 'боль',
  no_time: 'не хватило времени',
  other: 'другая причина',
}

/**
 * Личная потеря повторов на кг для упражнений программы. Откат к общей норме
 * не показываем: это не знание об атлете.
 */
export function buildPersonalModelNote(history: WorkoutHistoryEntry[], programDays: ProgramDayLike[]): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const day of programDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      const exerciseId = String(exercise.id ?? '')
      if (!exerciseId || seen.has(exerciseId)) continue
      seen.add(exerciseId)
      const estimate = estimateRepsLostPerWeightStep(history, { exerciseId, setIndex: 1 })
      if (estimate.basis !== 'personal' || estimate.repsLostPerKg === null) continue
      lines.push(`- ${exercise.name}: −${estimate.repsLostPerKg.toFixed(2)} повт. на +1 кг (первый рабочий подход, ${estimate.observations} сессий)`)
    }
  }
  return lines.length > 0 ? `Личная модель атлета (сколько повторов он теряет при росте веса):\n${lines.join('\n')}` : ''
}

/** Разобранные ответы атлета за 7 дней. «Не разобрано» не показываем. */
export async function loadAthleteSignalsNote(client: DbClient, userId: string, now: Date): Promise<string> {
  const since = new Date(now.getTime() - 7 * 86_400_000)
  const result = await client.query(
    `select completed_at, post_workout_signal from public.workout_sessions
     where user_id = $1 and completed_at >= $2 and post_workout_signal is not null
     order by completed_at desc`,
    [userId, since.toISOString()],
  )
  const lines: string[] = []
  for (const row of result.rows) {
    const signal = row.post_workout_signal as StoredPostWorkoutSignal | null
    const text = SIGNAL_TEXT[String(signal?.signalType ?? '')]
    if (!signal || !text) continue
    const completedAt = row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)
    const deviation = Number(signal.trigger?.deviation)
    const deviationText = Number.isFinite(deviation) ? ` (${deviation > 0 ? '+' : ''}${deviation} кг к плану)` : ''
    const pain = signal.signalType === 'pain' && signal.painLocation ? `, ${signal.painLocation}` : ''
    lines.push(`- ${completedAt.slice(0, 10)}, ${signal.trigger?.exerciseName ?? 'упражнение'}${deviationText}: ${text}${pain}`)
  }
  return lines.length > 0 ? `Ответы атлета после тренировок за 7 дней:\n${lines.join('\n')}` : ''
}
