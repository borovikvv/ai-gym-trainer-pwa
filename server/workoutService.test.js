import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeWorkoutHistoryEntry, saveWorkoutHistoryEntry } from './services/workoutService.js'
import { cascadeRegenerateFutureWorkouts } from './services/plannedWorkoutService.js'

// Mock the dependencies that saveWorkoutHistoryEntry calls — we only care
// about verifying the cache-invalidation DELETE is issued (#94).
vi.mock('./services/coachPlanningService.js', () => ({
  planAndApplyNextWorkout: vi.fn().mockResolvedValue(null),
}))
vi.mock('./services/plannedWorkoutService.js', () => ({
  regeneratePlannedWorkout: vi.fn().mockResolvedValue(undefined),
  cascadeRegenerateFutureWorkouts: vi.fn().mockResolvedValue(1),
}))
vi.mock('./coachDebrief.js', () => ({
  buildWorkoutDebrief: vi.fn().mockReturnValue({ qualityScore: 75, summary: '', wentWell: [], overload: [], progressed: [], nextFocus: '' }),
  saveWorkoutDebriefRecommendation: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./coachTrainingRecord.js', () => ({
  saveTrainingRecord: vi.fn().mockResolvedValue(undefined),
}))
// Issue #91: mock programService so saveWorkoutHistoryEntry can load
// coachState, userProfile, and exerciseLibrary for training record
// Issue #108: also mock loadRecentHistory for changes computation
vi.mock('./services/programService.js', () => ({
  loadCoachStateForUser: vi.fn().mockResolvedValue({
    readinessScore: 78,
    recoveryStatus: 'ready',
    weeklyLoadStatus: 'on_plan',
    mesocycle: { phase: 'accumulation', weekInCycle: 2, cycleLength: 4 },
  }),
  loadUserProfile: vi.fn().mockResolvedValue({
    age: 43,
    goal: 'сила',
    level: 'intermediate',
    workoutsPerWeek: 3,
  }),
  loadExerciseLibrary: vi.fn().mockResolvedValue([
    { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', repMin: 6, repMax: 8, targetWeight: 50 },
    { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', repMin: 8, repMax: 10, targetWeight: 40 },
  ]),
  loadRecentHistory: vi.fn().mockResolvedValue([]),
}))
// Issue #108: mock analyzeProgress so training record doesn't hang on LLM
vi.mock('./coachProgressAnalysis.js', () => ({
  analyzeProgress: vi.fn().mockResolvedValue({
    date: '2026-07-09T00:00:00Z',
    summary: 'Стабильный прогресс',
    plateaus: [], improvements: [], warnings: [], suggestions: [],
    exerciseFlags: [],
    globalFlags: { overtraining: false, recommendedDeload: false },
  }),
}))
// Issue #108: mock e1RM histories (used by analyzeProgress input)
vi.mock('../src/domain/estimatedOneRepMax.js', () => ({
  buildAllExerciseE1RMHistories: vi.fn().mockReturnValue([]),
  // Issue #171: опции e1RM выводятся из профиля (возраст → минимум повторов).
  e1rmOptionsForProfile: vi.fn().mockReturnValue({ bodyWeightKg: null, minReps: 1 }),
}))

afterEach(() => {
  // Note: vi.clearAllMocks() would reset factory mock implementations in
  // vitest 4.x. Instead we only clear specific mocks that need it in each
  // test (via vi.mocked(...).mockClear()).
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

  // Issue #161: user_rating is `integer check (1..5)` — an unusable value must
  // never reach the INSERT, or the whole workout save rolls back.
  it('drops userRating that would violate the 1..5 column constraint (#161)', () => {
    const base = {
      id: 'session-rating',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-29T10:00:00Z',
      totalVolume: 0,
      exercises: [],
    }

    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 1 }).userRating).toBe(1)
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 4 }).userRating).toBe(4)
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 5 }).userRating).toBe(5)
    // Out of range / not an integer / not a number → not rated, never invented
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 7 }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 0 }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: -3 }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 3.7 }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: 'abc' }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry({ ...base, userRating: null }).userRating).toBeNull()
    expect(sanitizeWorkoutHistoryEntry(base).userRating).toBeNull()
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

describe('Issue #91: training record fills 12 previously-empty fields', () => {
  it('passes real coachState, profile, and exerciseLibrary data to saveTrainingRecord', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser, loadUserProfile, loadExerciseLibrary } = await import('./services/programService.js')

    vi.mocked(saveTrainingRecord).mockClear()

    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-91',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-07T18:09:41.164Z',
      totalVolume: 4080,
      qualityScore: 100,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 47.5,
          progressionType: 'increase',
          progressionReason: 'ok',
          sets: [{ weight: 47.5, reps: 8, rpe: 7, completed: true }],
        },
        {
          exerciseId: 'lat-pulldown',
          exerciseName: 'Тяга верхнего блока',
          pain: false,
          nextRecommendedWeight: 40,
          progressionType: 'hold',
          progressionReason: 'ok',
          sets: [{ weight: 40, reps: 10, rpe: 7, completed: true }],
        },
      ],
    })

    // Verify loadCoachStateForUser, loadUserProfile, loadExerciseLibrary were called
    expect(loadCoachStateForUser).toHaveBeenCalledWith(expect.anything(), 'vyacheslav')
    expect(loadUserProfile).toHaveBeenCalledWith(expect.anything(), 'vyacheslav')
    expect(loadExerciseLibrary).toHaveBeenCalled()

    // Verify saveTrainingRecord was called with real data (not null/''/0)
    expect(saveTrainingRecord).toHaveBeenCalledTimes(1)
    const call = vi.mocked(saveTrainingRecord).mock.calls[0]
    const [, entryArg, coachStateArg, decisionArg, profileArg] = call

    // coachState should NOT be null anymore
    expect(coachStateArg).not.toBeNull()
    expect(coachStateArg.readinessScore).toBe(78)
    expect(coachStateArg.recoveryStatus).toBe('ready')
    expect(coachStateArg.weeklyLoadStatus).toBe('on_plan')
    expect(coachStateArg.mesocycle).toEqual({ phase: 'accumulation', weekInCycle: 2, cycleLength: 4 })

    // profile should have real values (not null/undefined)
    expect(profileArg.age).toBe(43)
    expect(profileArg.goal).toBe('сила')
    expect(profileArg.level).toBe('intermediate')
    expect(profileArg.workoutsPerWeek).toBe(3)

    // decision.exercises should have muscleGroup/repMin/repMax from library
    expect(decisionArg.exercises[0]).toMatchObject({
      exerciseId: 'bench-press',
      muscleGroup: 'Грудь',  // was '' before #91
      repMin: 6,             // was 0 before #91
      repMax: 8,             // was 0 before #91
    })
    expect(decisionArg.exercises[1]).toMatchObject({
      exerciseId: 'lat-pulldown',
      muscleGroup: 'Спина',  // was '' before #91
      repMin: 8,             // was 0 before #91
      repMax: 10,            // was 0 before #91
    })

    // lowReadiness and loadPolicy should be computed from coachState
    expect(decisionArg.lowReadiness).toBe(false)  // readiness 78 >= 55
    expect(decisionArg.loadPolicy).toBe('on_plan')  // was 'unknown' before #91

    // entry.exercises should also have muscleGroup from library
    expect(entryArg.exercises[0].muscleGroup).toBe('Грудь')  // was '' before #91
    expect(entryArg.exercises[1].muscleGroup).toBe('Спина')  // was '' before #91
  })

  it('computes lowReadiness=true when readinessScore < 55', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser } = await import('./services/programService.js')

    vi.mocked(saveTrainingRecord).mockClear()

    // Override the mock to return low readiness for this test
    vi.mocked(loadCoachStateForUser).mockResolvedValue({
      readinessScore: 45,
      recoveryStatus: 'low',
      weeklyLoadStatus: 'overreached',
      mesocycle: { phase: 'deload', weekInCycle: 4, cycleLength: 4 },
    })

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-low',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-07T18:09:41.164Z',
      totalVolume: 1000,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 40,
        progressionType: 'hold',
        progressionReason: '',
        sets: [{ weight: 40, reps: 8, rpe: 7, completed: true }],
      }],
    })

    const call = vi.mocked(saveTrainingRecord).mock.calls[0]
    const decisionArg = call[3]
    expect(decisionArg.lowReadiness).toBe(true)
    expect(decisionArg.loadPolicy).toBe('overreached')
  })

  it('does not fail the workout save if programService load fails (non-fatal)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser } = await import('./services/programService.js')

    vi.mocked(saveTrainingRecord).mockClear()
    vi.mocked(loadCoachStateForUser).mockRejectedValue(new Error('DB connection lost'))

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    const result = await saveWorkoutHistoryEntry(client, {
      id: 'session-fail',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-07T18:09:41.164Z',
      totalVolume: 1000,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 40,
        progressionType: 'hold',
        progressionReason: '',
        sets: [{ weight: 40, reps: 8, rpe: 7, completed: true }],
      }],
    })

    // Workout should still save successfully — training record failure is non-fatal
    expect(result).toBeDefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('saveTrainingRecord (non-fatal)'),
      expect.any(String),
    )
    errorSpy.mockRestore()
  })
})

describe('Issue #108: training record captures analysis → decision → outcome loop', () => {
  // Issue #108: these tests need fresh mock defaults because the #91 tests
  // above may have overridden loadCoachStateForUser with reject/resolvedValue.
  // We import the mocked modules and reset their implementations in each test.
  const defaultCoachState = {
    readinessScore: 78,
    recoveryStatus: 'ready',
    weeklyLoadStatus: 'on_plan',
    mesocycle: { phase: 'accumulation', weekInCycle: 2, cycleLength: 4 },
  }

  it('passes analysisResult and decision.source to saveTrainingRecord', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser, loadRecentHistory } = await import('./services/programService.js')
    vi.mocked(saveTrainingRecord).mockClear()
    vi.mocked(loadCoachStateForUser).mockResolvedValue(defaultCoachState)
    vi.mocked(loadRecentHistory).mockResolvedValue([])

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-108',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-09T18:00:00Z',
      totalVolume: 3000,
      qualityScore: 85,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 52.5,
        progressionType: 'increase',
        progressionReason: '',
        sets: [{ weight: 50, reps: 8, rpe: 7, completed: true }],
      }],
    })

    expect(saveTrainingRecord).toHaveBeenCalledTimes(1)
    const call = vi.mocked(saveTrainingRecord).mock.calls[0]
    const decisionArg = call[3]
    const analysisArg = call[5]

    // Issue #108: decision.source should be set (from coachPlan, default 'rules')
    expect(decisionArg.source).toBeDefined()

    // Issue #108: decision.changes should be an array (even if empty)
    expect(Array.isArray(decisionArg.changes)).toBe(true)

    // Issue #108: analysisResult should not be null (mocked analyzeProgress returned a result)
    expect(analysisArg).not.toBeNull()
    expect(analysisArg.summary).toBe('Стабильный прогресс')
    expect(analysisArg.exerciseFlags).toEqual([])
    expect(analysisArg.globalFlags.overtraining).toBe(false)
  })

  it('computes changes by comparing with previous workout', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser, loadRecentHistory } = await import('./services/programService.js')
    vi.mocked(saveTrainingRecord).mockClear()
    vi.mocked(loadCoachStateForUser).mockResolvedValue(defaultCoachState)

    // Mock previous workout with bench-press at 50kg, 3 sets
    vi.mocked(loadRecentHistory).mockResolvedValue([{
      id: 'prev-session',
      userId: 'vyacheslav',
      workoutDayId: 'day-1',
      workoutDayName: 'День A',
      completedAt: '2026-07-02T18:00:00Z',
      totalVolume: 1200,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 50,
        progressionType: 'hold',
        progressionReason: '',
        sets: [
          { weight: 50, reps: 8, rpe: 7, completed: true },
          { weight: 50, reps: 8, rpe: 7, completed: true },
          { weight: 50, reps: 8, rpe: 8, completed: true },
        ],
      }],
    }])

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    // Current workout: bench-press at 52.5kg (weight increase)
    await saveWorkoutHistoryEntry(client, {
      id: 'session-108b',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-09T18:00:00Z',
      totalVolume: 1260,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 52.5,
        progressionType: 'increase',
        progressionReason: '',
        sets: [{ weight: 52.5, reps: 8, rpe: 7, completed: true }],
      }],
    })

    const call = vi.mocked(saveTrainingRecord).mock.calls[0]
    const decisionArg = call[3]

    // Changes should include weight_increase for bench-press
    expect(decisionArg.changes.length).toBeGreaterThan(0)
    const benchChange = decisionArg.changes.find((c) => c.exerciseId === 'bench-press')
    expect(benchChange).toBeDefined()
    expect(benchChange.type).toBe('weight_increase')
    expect(benchChange.details).toContain('50')
    expect(benchChange.details).toContain('52.5')
  })

  it('records swap when exercise is new (not in previous workout)', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadCoachStateForUser, loadRecentHistory } = await import('./services/programService.js')
    vi.mocked(saveTrainingRecord).mockClear()
    vi.mocked(loadCoachStateForUser).mockResolvedValue(defaultCoachState)

    // Previous workout has bench-press only
    vi.mocked(loadRecentHistory).mockResolvedValue([{
      id: 'prev-session',
      userId: 'vyacheslav',
      workoutDayId: 'day-1',
      workoutDayName: 'День A',
      completedAt: '2026-07-02T18:00:00Z',
      totalVolume: 1200,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 50,
        progressionType: 'hold',
        progressionReason: '',
        sets: [{ weight: 50, reps: 8, rpe: 7, completed: true }],
      }],
    }])

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    // Current workout has lat-pulldown (new exercise, not in previous)
    await saveWorkoutHistoryEntry(client, {
      id: 'session-108c',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День B',
      completedAt: '2026-07-09T18:00:00Z',
      totalVolume: 400,
      exercises: [{
        exerciseId: 'lat-pulldown',
        exerciseName: 'Тяга верхнего блока',
        pain: false,
        nextRecommendedWeight: 40,
        progressionType: 'hold',
        progressionReason: '',
        sets: [{ weight: 40, reps: 10, rpe: 7, completed: true }],
      }],
    })

    const call = vi.mocked(saveTrainingRecord).mock.calls[0]
    const decisionArg = call[3]

    // lat-pulldown is new → should be a swap
    const latChange = decisionArg.changes.find((c) => c.exerciseId === 'lat-pulldown')
    expect(latChange).toBeDefined()
    expect(latChange.type).toBe('swap')
  })
})

// Issue #163: анкета боли собирается на экране зала в ExerciseLog, уезжает
// в API через createWorkoutHistoryEntry и должна лечь в workout_sessions.pain_log.
// Тест идёт по всему этому пути целиком: раньше маппер терял три поля из
// четырёх, и на сервер приезжал только булев `pain` — при зелёных юнит-тестах
// компонента.
describe('Issue #163: детали боли из анкеты доезжают до pain_log', () => {
  it('переносит локацию, интенсивность и красные флаги из лога упражнения в insert', async () => {
    const { createWorkoutHistoryEntry } = await import('../src/domain/workoutHistory.js')

    const entry = createWorkoutHistoryEntry({
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-29T10:00:00Z',
      exercises: [{
        id: 'bench-press',
        name: 'Жим лёжа',
        prescription: '3x8',
        targetWeight: 50,
        repMin: 6,
        repMax: 8,
        weightStep: 2.5,
      }],
      logs: {
        'bench-press': {
          exerciseId: 'bench-press',
          pain: true,
          painLocation: 'shoulder',
          painIntensity: 7,
          redFlags: ['numbness'],
          sets: [{ weight: 50, reps: 8, rpe: 8, completed: true }],
        },
      },
    })

    // Анкета не должна теряться уже на клиенте — иначе серверу нечего писать.
    expect(entry.exercises[0]).toMatchObject({
      painLocation: 'shoulder',
      painIntensity: 7,
      redFlags: ['numbness'],
    })

    const queries = []
    const client = {
      query: vi.fn().mockImplementation(async (text, params) => {
        queries.push({ text, params })
        return { rows: [], rowCount: 0 }
      }),
    }

    await saveWorkoutHistoryEntry(client, entry)

    const insert = queries.find((q) => q.text.includes('insert into public.workout_sessions'))
    const painLogParamIndex = insert.text
      .slice(insert.text.indexOf('('), insert.text.indexOf(')'))
      .split(',')
      .findIndex((column) => column.trim() === 'pain_log')

    expect(insert.params[painLogParamIndex]).toEqual({
      'bench-press': { pain: true, painLocation: 'shoulder', painIntensity: 7, redFlags: ['numbness'] },
    })
  })

  it('оставляет pain_log пустым, когда анкету пропустили', async () => {
    const { createWorkoutHistoryEntry } = await import('../src/domain/workoutHistory.js')

    const entry = createWorkoutHistoryEntry({
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-29T11:00:00Z',
      exercises: [{
        id: 'bench-press',
        name: 'Жим лёжа',
        prescription: '3x8',
        targetWeight: 50,
        repMin: 6,
        repMax: 8,
        weightStep: 2.5,
      }],
      logs: {
        'bench-press': {
          exerciseId: 'bench-press',
          pain: false,
          sets: [{ weight: 50, reps: 8, rpe: 8, completed: true }],
        },
      },
    })

    const queries = []
    const client = {
      query: vi.fn().mockImplementation(async (text, params) => {
        queries.push({ text, params })
        return { rows: [], rowCount: 0 }
      }),
    }

    await saveWorkoutHistoryEntry(client, entry)

    const insert = queries.find((q) => q.text.includes('insert into public.workout_sessions'))
    const painLogParamIndex = insert.text
      .slice(insert.text.indexOf('('), insert.text.indexOf(')'))
      .split(',')
      .findIndex((column) => column.trim() === 'pain_log')

    expect(insert.params[painLogParamIndex]).toBeNull()
  })

  it('отбрасывает зоны и флаги, которых нет в общем словаре', async () => {
    const queries = []
    const client = {
      query: vi.fn().mockImplementation(async (text, params) => {
        queries.push({ text, params })
        return { rows: [], rowCount: 0 }
      }),
    }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-163-junk',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-29T12:00:00Z',
      totalVolume: 400,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: true,
        painLocation: '<script>alert(1)</script>',
        painIntensity: 99,
        redFlags: ['numbness', 'выдуманный флаг'],
        nextRecommendedWeight: 50,
        progressionType: 'pain',
        progressionReason: '',
        sets: [{ weight: 50, reps: 8, rpe: 8, completed: true }],
      }],
    })

    const insert = queries.find((q) => q.text.includes('insert into public.workout_sessions'))
    const painLogParamIndex = insert.text
      .slice(insert.text.indexOf('('), insert.text.indexOf(')'))
      .split(',')
      .findIndex((column) => column.trim() === 'pain_log')

    // Признак боли остаётся — это ответ пользователя. Мусор в деталях не сохраняем.
    expect(insert.params[painLogParamIndex]).toEqual({
      'bench-press': { pain: true, redFlags: ['numbness'] },
    })
  })
})

describe('Issue #165: таймстемп подхода доезжает до insert', () => {
  function fakeClient() {
    const queries = []
    return {
      queries,
      query: vi.fn().mockImplementation(async (text, params) => {
        queries.push({ text, params })
        return { rows: [], rowCount: 0 }
      }),
    }
  }

  // Индекс параметра по имени колонки в списке insert into ... (a, b, c).
  function setsInsertParam(queries, column) {
    const insert = queries.find((q) => q.text.includes('insert into public.workout_sets'))
    const columns = insert.text
      .slice(insert.text.indexOf('('), insert.text.indexOf(')'))
      .replace(/[()]/g, '')
      .split(',')
      .map((name) => name.trim())
    // Колонка skipped вписана в values литералом false, поэтому позиция
    // параметра — не позиция колонки: считаем плейсхолдеры $N по values.
    const values = insert.text.slice(insert.text.lastIndexOf('values'))
    const placeholders = values.slice(values.indexOf('(') + 1, values.indexOf(')')).split(',').map((v) => v.trim())
    const columnIndex = columns.indexOf(column)
    const placeholder = placeholders[columnIndex]
    return insert.params[Number(placeholder.replace('$', '')) - 1]
  }

  function entryWithPerformedAt(performedAt) {
    return {
      id: 'session-165',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-29T12:00:00Z',
      totalVolume: 400,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 50,
        progressionType: 'hold',
        progressionReason: '',
        sets: [{ weight: 50, reps: 8, rpe: 8, completed: true, performedAt }],
      }],
    }
  }

  it('пишет клиентский таймстемп в колонку performed_at', async () => {
    const client = fakeClient()

    await saveWorkoutHistoryEntry(client, entryWithPerformedAt('2026-07-29T11:58:20.000Z'))

    expect(setsInsertParam(client.queries, 'performed_at')).toBe('2026-07-29T11:58:20.000Z')
  })

  it('кладёт null вместо кривого таймстемпа — иначе timestamptz уронит весь insert', async () => {
    const client = fakeClient()

    await saveWorkoutHistoryEntry(client, entryWithPerformedAt('вчера вечером'))

    expect(setsInsertParam(client.queries, 'performed_at')).toBeNull()
  })

  it('терпит подходы без таймстемпа — старые черновики и офлайн-очередь', async () => {
    const client = fakeClient()

    await saveWorkoutHistoryEntry(client, entryWithPerformedAt(undefined))

    expect(setsInsertParam(client.queries, 'performed_at')).toBeNull()
  })
})

// Issue #167: отклонение повторов от ожидания попадает в обучающую запись
describe('Issue #167: training record captures rep deviation', () => {
  it('передаёт агрегат отклонения повторов в saveTrainingRecord', async () => {
    const { saveTrainingRecord } = await import('./coachTrainingRecord.js')
    const { loadRecentHistory } = await import('./services/programService.js')

    vi.mocked(saveTrainingRecord).mockClear()
    // Две сессии на 60 кг по 8 повторов в первом подходе → ожидание 8.
    vi.mocked(loadRecentHistory).mockResolvedValue([
      {
        completedAt: '2026-07-01T18:00:00.000Z',
        exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', sets: [{ weight: 60, reps: 8, rpe: 7, completed: true }] }],
      },
      {
        completedAt: '2026-07-08T18:00:00.000Z',
        exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', sets: [{ weight: 60, reps: 8, rpe: 7, completed: true }] }],
      },
    ])

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
    await saveWorkoutHistoryEntry(client, {
      id: 'session-167',
      userId: 'vyacheslav',
      workoutDayId: 'planned-day',
      workoutDayName: 'День A',
      completedAt: '2026-07-15T18:00:00.000Z',
      totalVolume: 3600,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 62.5,
        progressionType: 'increase',
        progressionReason: 'ok',
        sets: [{ weight: 60, reps: 6, rpe: 8, completed: true }],
      }],
    })

    vi.mocked(loadRecentHistory).mockResolvedValue([])

    const [, entryArg] = vi.mocked(saveTrainingRecord).mock.calls[0]
    expect(entryArg.repDeviation.avgDeviation).toBe(-2)
    expect(entryArg.repDeviation.setsWithExpectation).toBe(1)
    expect(entryArg.repDeviation.exercises[0].exerciseId).toBe('bench-press')
  })
})

// Issue #169: сохранение тренировки перестраивает только ближайшую
// запланированную. Раньше пересобирались все на две недели вперёд: между
// двумя тренировками менялись веса, состав и группы во всех будущих сессиях
// сразу, и отклик нельзя было привязать к одной переменной.
describe('saveWorkoutHistoryEntry — сужение каскада до ближайшей (#169)', () => {
  it('перестраивает ровно одну ближайшую запланированную тренировку', async () => {
    const cascade = vi.mocked(cascadeRegenerateFutureWorkouts)
    cascade.mockClear()
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    await saveWorkoutHistoryEntry(client, {
      id: 'session-cascade-1',
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

    expect(cascade).toHaveBeenCalledTimes(1)
    expect(cascade).toHaveBeenCalledWith(client, { userId: 'vyacheslav', limit: 1 })
  })
})
