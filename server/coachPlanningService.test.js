import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./services/programService.js', () => ({
  loadExerciseLibrary: vi.fn(),
  loadRecentHistory: vi.fn(),
  loadUserProfile: vi.fn(),
  loadUserWorkoutDays: vi.fn(),
}))

const {
  loadExerciseLibrary,
  loadRecentHistory,
  loadUserProfile,
  loadUserWorkoutDays,
} = await import('./services/programService.js')
const { planAndApplyNextWorkout } = await import('./services/coachPlanningService.js')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('coach planning service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    loadUserProfile.mockResolvedValue({
      userId: 'vyacheslav',
      workoutsPerWeek: 2,
      trainingDays: ['Понедельник', 'Четверг'],
    })
    loadUserWorkoutDays.mockResolvedValue([
      {
        id: 'day-a',
        name: 'День A',
        label: 'A',
        sortOrder: 1,
        exercises: [
          { programExerciseId: 'pe-bench', exerciseId: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150 },
        ],
      },
      {
        id: 'day-b',
        name: 'День B',
        label: 'B',
        sortOrder: 2,
        exercises: [
          { programExerciseId: 'pe-row', exerciseId: 'row', name: 'Тяга', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 120 },
        ],
      },
    ])
    loadRecentHistory.mockResolvedValue([])
    loadExerciseLibrary.mockResolvedValue([
      { id: 'row', name: 'Тяга', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 120 },
    ])
  })

  it('stores a coach decision log when applying a post-workout plan', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
    await planAndApplyNextWorkout(client, {
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      completedAt: '2026-06-08T12:00:00.000Z',
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          nextRecommendedWeight: 50,
          sets: [{ weight: 50, reps: 6, rpe: 8, completed: true }],
        },
      ],
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into public.recommendations'),
      expect.arrayContaining(['vyacheslav', 'session-1', 'coach_decision_log']),
    )
  })

  it('Issue #95: falls back to rules when LLM call exceeds timeout (5s)', async () => {
    // Enable LLM path
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')

    // Mock fetch that never resolves within test timeframe — AbortController
    // will abort it after LLM_TIMEOUT_MS (5s). Use fake timers to avoid
    // actually waiting 5s.
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url, opts) => {
      // Return a promise that never resolves on its own; the abort signal
      // will reject it.
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
    const planPromise = planAndApplyNextWorkout(client, {
      id: 'session-timeout',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      completedAt: '2026-06-08T12:00:00.000Z',
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          nextRecommendedWeight: 50,
          sets: [{ weight: 50, reps: 6, rpe: 8, completed: true }],
        },
      ],
    })

    // Fast-forward past the 5s timeout
    await vi.advanceTimersByTimeAsync(5100)
    const result = await planPromise

    // LLM was called but timed out — we should get a rules-based plan back
    expect(fetchMock).toHaveBeenCalled()
    expect(result).not.toBeNull()
    // The plan came from rules, not LLM
    expect(result.source).toBe('rules')
    // Warning was logged about the fallback
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('LLM coach plan failed'),
      expect.any(String),
    )

    vi.useRealTimers()
    warn.mockRestore()
  })
})
