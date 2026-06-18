import { describe, expect, it, vi } from 'vitest'
import { sanitizeWorkoutHistoryEntry } from './services/workoutService.js'

describe('workout service guardrails', () => {
  it('drops invalid completed sets and recalculates workout volume before persistence', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sanitized = sanitizeWorkoutHistoryEntry({
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'Персональная',
      completedAt: '2026-06-07T15:16:57.645Z',
      totalVolume: 9999,
      exercises: [
        {
          exerciseId: 'dead-bug-extra-1780844563272',
          exerciseName: 'Dead bug',
          pain: false,
          nextRecommendedWeight: 0,
          progressionType: 'hold',
          progressionReason: 'bad zero row',
          sets: [{ weight: 0, reps: 0, rpe: 7, completed: true }],
        },
        {
          exerciseId: 'plank-extra-1780844823365',
          exerciseName: 'Планка',
          pain: false,
          nextRecommendedWeight: 0,
          progressionType: 'hold',
          progressionReason: 'valid timed work',
          sets: [
            { weight: 0, reps: 60, rpe: 7, completed: true },
            { weight: 0, reps: 0, rpe: 7, completed: false },
          ],
        },
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 42.5,
          progressionType: 'increase',
          progressionReason: 'valid strength work',
          sets: [
            { weight: 40, reps: 8, rpe: 7, completed: true },
            { weight: -40, reps: 8, rpe: 7, completed: true },
            { weight: 40, reps: 2000, rpe: 7, completed: true },
          ],
        },
      ],
    })

    expect(sanitized.totalVolume).toBe(320)
    expect(sanitized.exercises.map((exercise) => exercise.exerciseId)).toEqual(['plank-extra-1780844823365', 'bench-press'])
    expect(sanitized.exercises[0].sets).toEqual([{ weight: 0, reps: 60, rpe: 7, completed: true }])
    expect(sanitized.exercises[1].sets).toEqual([{ weight: 40, reps: 8, rpe: 7, completed: true }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WORKOUT_GUARDRAIL'), expect.objectContaining({
      sessionId: 'session-1',
      droppedExercises: 1,
      droppedSets: 4,
    }))
    warn.mockRestore()
  })
})
