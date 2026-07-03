import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeWorkoutHistoryEntry, saveWorkoutHistoryEntry } from './services/workoutService.js'

// Mock the dependencies that saveWorkoutHistoryEntry calls — we only care
// about verifying the cache-invalidation DELETE is issued (#94).
vi.mock('./services/coachPlanningService.js', () => ({
  planAndApplyNextWorkout: vi.fn().mockResolvedValue(null),
}))
vi.mock('./services/plannedWorkoutService.js', () => ({
  regeneratePlannedWorkout: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./coachDebrief.js', () => ({
  buildWorkoutDebrief: vi.fn().mockReturnValue({ qualityScore: 75, summary: '', wentWell: [], overload: [], progressed: [], nextFocus: '' }),
  saveWorkoutDebriefRecommendation: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./coachTrainingRecord.js', () => ({
  saveTrainingRecord: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('rounds fractional RPE to integer (#93) — schema column is integer, fractional would fail INSERT', () => {
    const sanitized = sanitizeWorkoutHistoryEntry({
      id: 'session-rpe',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-03T10:00:00Z',
      totalVolume: 0,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 42.5,
          progressionType: 'increase',
          progressionReason: 'ok',
          sets: [
            { weight: 40, reps: 8, rpe: 7.5, completed: true },
            { weight: 40, reps: 8, rpe: 8.4, completed: true },
            { weight: 40, reps: 8, rpe: 9.5, completed: true },
          ],
        },
      ],
    })

    expect(sanitized.exercises[0].sets.map((s) => s.rpe)).toEqual([8, 8, 10])
  })

  it('keeps integer RPE unchanged (#93)', () => {
    const sanitized = sanitizeWorkoutHistoryEntry({
      id: 'session-rpe-int',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-03T10:00:00Z',
      totalVolume: 0,
      exercises: [
        {
          exerciseId: 'squat',
          exerciseName: 'Присед',
          pain: false,
          nextRecommendedWeight: 60,
          progressionType: 'hold',
          progressionReason: 'ok',
          sets: [
            { weight: 50, reps: 12, rpe: 7, completed: true },
            { weight: 50, reps: 12, rpe: 8, completed: true },
          ],
        },
      ],
    })

    expect(sanitized.exercises[0].sets.map((s) => s.rpe)).toEqual([7, 8])
  })
})

describe('saveWorkoutHistoryEntry — issue #94 cache invalidation', () => {
  it('deletes cached progress_analysis and program_review after saving a workout', async () => {
    const queries = []
    const client = {
      query: vi.fn().mockImplementation(async (text, params) => {
        queries.push({ text, params })
        // The regeneratePlannedWorkout path looks up next planned workout;
        // return empty rows so it skips regen.
        return { rows: [], rowCount: 0 }
      }),
    }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-cache-1',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-03T10:00:00Z',
      totalVolume: 1000,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 42.5,
          progressionType: 'increase',
          progressionReason: 'ok',
          sets: [{ weight: 40, reps: 8, rpe: 7, completed: true }],
        },
      ],
    })

    // Find the cache-invalidation DELETE query
    const cacheDelete = queries.find(
      (q) => q.text.includes('delete from public.recommendations')
        && q.text.includes('progress_analysis')
        && q.text.includes('program_review'),
    )

    expect(cacheDelete).toBeDefined()
    expect(cacheDelete.params).toEqual(['vyacheslav'])
  })

  it('does not fail the workout save if cache invalidation DELETE throws (non-fatal)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = {
      query: vi.fn().mockImplementation(async (text) => {
        // Cache-invalidation DELETE fails
        if (text.includes('delete from public.recommendations') && text.includes('progress_analysis')) {
          throw new Error('connection lost')
        }
        return { rows: [], rowCount: 0 }
      }),
    }

    // Should not throw — cache invalidation is non-fatal
    const result = await saveWorkoutHistoryEntry(client, {
      id: 'session-cache-2',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-03T10:00:00Z',
      totalVolume: 1000,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 42.5,
          progressionType: 'increase',
          progressionReason: 'ok',
          sets: [{ weight: 40, reps: 8, rpe: 7, completed: true }],
        },
      ],
    })

    expect(result).toBeDefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('cache invalidation after save (non-fatal)'),
      expect.any(String),
    )
    errorSpy.mockRestore()
  })
})
