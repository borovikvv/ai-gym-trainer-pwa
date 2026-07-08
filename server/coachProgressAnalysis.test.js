import { afterEach, describe, expect, it, vi } from 'vitest'
// types are imported for JSDoc only; we can't use `import type` in .js test files
// so we just import the runtime function
import { analyzeProgress } from './coachProgressAnalysis.js'

/**
 * @typedef {import('./coachProgressAnalysis.js').ExerciseAnalysisFlag} ExerciseAnalysisFlag
 * @typedef {import('./coachProgressAnalysis.js').GlobalAnalysisFlags} GlobalAnalysisFlags
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const now = new Date('2026-07-09T12:00:00Z')

const loadingCoachState = {
  userId: 'vyacheslav',
  generatedAt: '2026-07-09T08:00:00Z',
  readinessScore: 75,
  recoveryStatus: 'ready',
  weeklyLoadStatus: 'on_plan',
  mesocycle: {
    phase: 'loading',
    phaseDescription: 'нагрузка',
    weekInCycle: 2,
    cycleLength: 4,
    loadingWeeks: 3,
    deloadWeeks: 1,
    isDeload: false,
    deloadScheduled: false,
    triggerReason: null,
    completionRatio: 0.5,
    workoutsThisCycle: 4,
    plannedWorkoutsThisCycle: 9,
  },
}

function makeE1RM(overrides) {
  return {
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    muscleGroup: 'Грудь',
    currentBest: 60,
    trendDirection: 'flat',
    slopePerWeek: 0,
    dataPointCount: 4,
    ...overrides,
  }
}

describe('Issue #105: structured exerciseFlags in rule-based analysis', () => {
  it('emits plateau flag with swap_exercise recommendation for flat e1RM', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'flat', dataPointCount: 4 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags).toHaveLength(1)
    expect(result.exerciseFlags[0]).toMatchObject({
      exerciseId: 'bench-press',
      status: 'plateau',
      recommendation: 'swap_exercise',
    })
    expect(result.exerciseFlags[0].reason).toContain('плато')
  })

  it('emits trending_up flag with increase_weight for growing e1RM', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'up', slopePerWeek: 1.2, currentBest: 80 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags[0]).toMatchObject({
      status: 'trending_up',
      recommendation: 'increase_weight',
    })
  })

  it('emits trending_down flag with decrease_weight for falling e1RM (non-deload)', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'down', slopePerWeek: -1.5 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags[0]).toMatchObject({
      status: 'trending_down',
      recommendation: 'decrease_weight',
    })
    expect(result.globalFlags.overtraining).toBe(true)
  })

  it('emits monitor (not decrease) for falling e1RM during deload', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const deloadState = {
      ...loadingCoachState,
      mesocycle: { ...loadingCoachState.mesocycle, phase: 'deload', isDeload: true },
    }

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'down', slopePerWeek: -1.5 })],
      coachState: deloadState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags[0]).toMatchObject({
      status: 'trending_down',
      recommendation: 'monitor',
    })
    expect(result.globalFlags.overtraining).toBe(false)
  })

  it('emits insufficient_data flag for exercises with <3 data points', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ dataPointCount: 2 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags[0]).toMatchObject({
      status: 'insufficient_data',
      recommendation: 'monitor',
    })
  })

  it('emits stable flag with hold_weight for exercises not matching other criteria', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'up', slopePerWeek: 0.2 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags[0]).toMatchObject({
      status: 'stable',
      recommendation: 'hold_weight',
    })
  })
})

describe('Issue #105: globalFlags in rule-based analysis', () => {
  it('sets overtraining=true and recommendedDeload=true for high RPE + falling e1RM', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const history = [{
      id: 's1',
      userId: 'vyacheslav',
      workoutDayId: 'day-1',
      workoutDayName: 'День A',
      completedAt: '2026-07-08T18:00:00Z',
      totalVolume: 5000,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 55,
        progressionType: 'hold',
        progressionReason: '',
        sets: [
          { weight: 55, reps: 8, rpe: 9, completed: true },
          { weight: 55, reps: 8, rpe: 9, completed: true },
          { weight: 55, reps: 8, rpe: 10, completed: true },
        ],
      }],
    }]

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history,
      e1rmHistories: [makeE1RM({ trendDirection: 'down', slopePerWeek: -1.0 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.globalFlags.overtraining).toBe(true)
    expect(result.globalFlags.recommendedDeload).toBe(true)
    expect(result.globalFlags.overtrainingReason).toBeTruthy()
  })

  it('sets overtraining=false when no issues detected', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [makeE1RM({ trendDirection: 'up', slopePerWeek: 1.0, currentBest: 80 })],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.globalFlags.overtraining).toBe(false)
    expect(result.globalFlags.recommendedDeload).toBe(false)
  })

  it('detects muscle imbalance from volume distribution', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const history = [
      {
        id: 's1',
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        workoutDayName: 'День A',
        completedAt: '2026-07-08T18:00:00Z',
        totalVolume: 10000,
        exercises: [{
          exerciseId: 'squat',
          exerciseName: 'Присед',
          muscleGroup: 'Ноги',
          pain: false,
          nextRecommendedWeight: 80,
          progressionType: 'hold',
          progressionReason: '',
          sets: [{ weight: 100, reps: 10, rpe: 7, completed: true }],
        }],
      },
      {
        id: 's2',
        userId: 'vyacheslav',
        workoutDayId: 'day-2',
        workoutDayName: 'День B',
        completedAt: '2026-07-06T18:00:00Z',
        totalVolume: 200,
        exercises: [{
          exerciseId: 'curl',
          exerciseName: 'Сгибания',
          muscleGroup: 'Руки',
          pain: false,
          nextRecommendedWeight: 10,
          progressionType: 'hold',
          progressionReason: '',
          sets: [{ weight: 10, reps: 10, rpe: 7, completed: true }],
        }],
      },
    ]

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history,
      e1rmHistories: [],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.globalFlags.muscleImbalance).toBeDefined()
    expect(result.globalFlags.muscleImbalance.length).toBeGreaterThanOrEqual(2)
    const overworked = result.globalFlags.muscleImbalance.find((m) => m.status === 'overworked')
    expect(overworked.muscleGroup).toBe('Ноги')
  })
})

describe('Issue #105: LLM response includes structured fields with fallback', () => {
  it('fills exerciseFlags and globalFlags if LLM omits them', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')

    // LLM returns only text fields, no exerciseFlags/globalFlags
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'Прогресс стабильный',
              plateaus: [],
              improvements: [],
              warnings: [],
              suggestions: [],
            }),
          },
        }],
      }),
    }))

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    // Should have empty arrays/objects, not undefined
    expect(result.exerciseFlags).toEqual([])
    expect(result.globalFlags).toEqual({ overtraining: false, recommendedDeload: false })
  })

  it('preserves exerciseFlags and globalFlags from LLM response', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')

    const llmFlags = [{
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      status: 'plateau',
      recommendation: 'swap_exercise',
      reason: 'LLM detected plateau',
    }]
    const llmGlobal = {
      overtraining: false,
      recommendedDeload: true,
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'Нужна разгрузка',
              plateaus: [],
              improvements: [],
              warnings: [],
              suggestions: [],
              exerciseFlags: llmFlags,
              globalFlags: llmGlobal,
            }),
          },
        }],
      }),
    }))

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: [],
      e1rmHistories: [],
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    expect(result.exerciseFlags).toEqual(llmFlags)
    expect(result.globalFlags).toEqual(llmGlobal)
  })
})
