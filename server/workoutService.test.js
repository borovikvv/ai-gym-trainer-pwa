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
