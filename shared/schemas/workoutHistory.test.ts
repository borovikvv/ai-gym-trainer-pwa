import { describe, expect, it } from 'vitest'
import { workoutHistoryEntrySchema } from './workoutHistory'

// Issue #464: POST /api/workout-history падал 400, если в хвосте тренировки
// оставался незаполненный подход (reps: 0, completed: false). Схема требовала
// reps > 0 у любого подхода и роняла всю запись до sanitizeWorkoutHistoryEntry,
// который такие подходы и так отбрасывает. Теперь reps > 0 обязателен только
// у выполненных подходов.

const done = { weight: 60, reps: 8, rpe: 7, completed: true }
const empty = { weight: 5, reps: 0, rpe: 7, completed: false }

const entry = (lastSets: unknown[]) => ({
  id: 'planned-vyacheslav-2026-10-13-1791480105860',
  userId: 'vyacheslav',
  workoutDayId: 'planned-vyacheslav-2026-10-13',
  exercises: [
    ...Array.from({ length: 4 }, () => ({ sets: [done, done] })),
    { exerciseId: 'pallof-press', sets: lastSets },
  ],
})

describe('workoutHistoryEntrySchema — незаполненный подход (#464)', () => {
  it('пропускает незавершённый подход с reps: 0 рядом с выполненным', () => {
    expect(workoutHistoryEntrySchema.safeParse(entry([done, empty])).success).toBe(true)
  })

  it('отклоняет выполненный подход с reps: 0 — регрессия испорченного подхода', () => {
    expect(workoutHistoryEntrySchema.safeParse(entry([{ ...done, reps: 0 }])).success).toBe(false)
    expect(workoutHistoryEntrySchema.safeParse(entry([{ weight: 60, reps: 0, rpe: 7 }])).success).toBe(false)
  })

  it('принимает каноническую запись без пустых подходов', () => {
    expect(workoutHistoryEntrySchema.safeParse(entry([done, done])).success).toBe(true)
  })
})
