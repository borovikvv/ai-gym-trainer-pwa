import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildNextSetDecision } from './coachSetAdvisor.ts'
import { clampNextSetDecision } from './userTrainingPolicies.ts'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const RULES_DECISION = {
  action: 'continue',
  recommendedWeight: 60,
  recommendedReps: 8,
  recommendedRestSeconds: 120,
  reason: 'подход под контролем — повторяем рабочий вес и держим качество',
}

const EXERCISE = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  repMin: 6,
  repMax: 10,
  weightStep: 2.5,
  restSeconds: 120,
  targetWeight: 60,
}

const COMPLETED_SETS = [{ weight: 60, reps: 8, rpe: 7, completed: true }]

// Rich user-data mock served by the DB client through loadCoachMemoryForUser.
// Instead of mocking programService, we mock the whole liveCoachContext module
// data loader via a fake client is too heavy — so we mock the module.
vi.mock('./services/liveCoachContext.ts', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    loadLiveCoachUserData: vi.fn().mockResolvedValue({
      coachState: {
        userId: 'vyacheslav',
        generatedAt: '2026-07-10T10:00:00.000Z',
        readinessScore: 72,
        recoveryStatus: 'ok',
        weeklyLoadStatus: 'balanced',
        daysSinceLastWorkout: 2,
        warnings: [],
        mesocycle: {
          phase: 'accumulation',
          phaseDescription: '',
          weekInCycle: 2,
          cycleLength: 5,
          loadingWeeks: 4,
          deloadWeeks: 1,
          isDeload: false,
          deloadScheduled: false,
          triggerReason: null,
          completionRatio: 0.5,
          workoutsThisCycle: 5,
          plannedWorkoutsThisCycle: 10,
        },
        muscleGroups: {
          chest: { fatigue: 'medium', recentHardSets: 6, recentMaxEffortSets: 0, recentVolume: 3200, lastTrainedDaysAgo: 2 },
        },
      },
      coachMemory: {
        exerciseProfiles: {
          'bench-press': { status: 'progress_possible' },
        },
      },
      history: [
        {
          completedAt: '2026-07-08T10:00:00.000Z',
          exercises: [
            { exerciseId: 'bench-press', pain: false, sets: [{ weight: 57.5, reps: 8, rpe: 7, completed: true }, { weight: 57.5, reps: 8, rpe: 8, completed: true }] },
          ],
        },
      ],
      e1rmHistories: [
        { exerciseId: 'bench-press', currentBest: 72.5, trend: { direction: 'up', slopePerWeek: 0.8, dataPointCount: 6 } },
      ],
      policy: {
        userId: 'vyacheslav',
        maxIntensity: 'controlled_aggressive',
        allowFailureSets: true,
        progressionAggressiveness: 'controlled_aggressive',
        maxWeightJumpSteps: 2,
        safetyNotes: ['не ломать технику ради веса'],
        ageRecoveryProfile: { phase: 'mature_adult', baseRecoveryDays: 2.5, readinessPriorAdjustment: -8, sparseHistoryRecoveryBufferDays: 1 },
      },
      profile: { age: 43, goal: 'сила и мышечная масса', level: 'intermediate', workoutsPerWeek: 3 },
    }),
  }
})

function llmResponse(payload) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 800, completion_tokens: 90 } }),
  }
}

const fakeClient = { query: vi.fn() }

describe('buildNextSetDecision', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns rules decision when no API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')
    const { decision, prompt } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('rules')
    expect(decision.recommendedWeight).toBe(60)
    expect(prompt).toBeNull()
  })

  it('happy path: LLM refines the next set within clamp bounds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 62.5, reps: 8, restSeconds: 150, targetRpe: 8 },
      strategyAction: { type: 'hold', exerciseId: null },
      reason: 'Подход шёл уверенно — добавляем один шаг.',
      detail: 'RPE 7 при растущем e1RM: есть запас на +2.5 кг без риска для техники.',
    })))
    const { decision, prompt, clamped } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('llm')
    expect(decision.recommendedWeight).toBe(62.5)
    expect(decision.recommendedReps).toBe(8)
    expect(decision.recommendedRestSeconds).toBe(150)
    expect(decision.targetRpe).toBe(8)
    expect(decision.reason).toContain('уверенно')
    expect(decision.detail).toContain('запас')
    expect(decision.remainingSetUpdates).toHaveLength(2)
    expect(clamped).not.toBeNull()
    // Prompt contains the load-bearing context blocks
    expect(prompt).toContain('АТЛЕТ')
    expect(prompt).toContain('БАЗОВАЯ РЕКОМЕНДАЦИЯ ПО ПРАВИЛАМ')
    expect(prompt).toContain('e1RM 72.5')
  })

  it('falls back to rules on LLM timeout/error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('rules')
    expect(decision.recommendedWeight).toBe(60)
  })

  it('falls back to rules on malformed LLM JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'не json' } }] }),
    }))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('rules')
  })

  it('adversarial LLM: wild weight jump is clamped to policy bounds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 200, reps: 50, restSeconds: 1, targetRpe: 10 },
      strategyAction: { type: 'hold' },
      reason: 'Давай рекорд!',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 1,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('llm')
    // vyacheslav: max 2 steps up from last set 60 → 65
    expect(decision.recommendedWeight).toBe(65)
    expect(decision.recommendedReps).toBe(20)
    expect(decision.recommendedRestSeconds).toBe(30)
    expect(decision.targetRpe).toBeLessThanOrEqual(9)
  })

  it('adversarial LLM: unknown strategy action degrades to hold', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 60, reps: 8, restSeconds: 120, targetRpe: 7 },
      strategyAction: { type: 'do_a_backflip' },
      reason: 'ok',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 1,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(['continue', 'hold_load']).toContain(decision.action)
    expect(decision.recommendedWeight).toBe(60)
  })

  it('pain forces suggest_replacement regardless of LLM answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 62.5, reps: 8, restSeconds: 120, targetRpe: 8 },
      strategyAction: { type: 'hold' },
      reason: 'Продолжаем как шло.',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: true,
      rulesDecision: { ...RULES_DECISION, action: 'suggest_replacement', recommendedWeight: 0, recommendedReps: 0 },
    })
    expect(decision.action).toBe('suggest_replacement')
    expect(decision.recommendedWeight).toBe(0)
  })

  it('strategy action reuses rules suggested exercise when LLM gives no valid id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: null,
      strategyAction: { type: 'replace_next_exercise', exerciseId: 'nonexistent-id' },
      reason: 'Следующее упражнение грузит ту же группу.',
    })))
    const rulesSuggested = { id: 'incline-press', name: 'Жим на наклонной', muscleGroup: 'Грудь' }
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 0,
      pain: false,
      session: { exerciseLibrary: [{ id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина' }] },
      rulesDecision: { ...RULES_DECISION, suggestedExercise: rulesSuggested, suggestedExercises: [rulesSuggested] },
    })
    expect(decision.action).toBe('replace_next_exercise')
    expect(decision.suggestedExercise).toEqual(rulesSuggested)
  })

  it('prompt stays within the token budget (~2.5k tokens ≈ 9000 chars)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 60, reps: 8, restSeconds: 120, targetRpe: 7 },
      strategyAction: { type: 'hold' },
      reason: 'ok',
    })))
    const manyExercises = Array.from({ length: 8 }, (_, i) => ({ id: `ex-${i}`, name: `Упражнение ${i}`, muscleGroup: 'Спина' }))
    const { prompt } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: [...COMPLETED_SETS, { weight: 60, reps: 8, rpe: 8, completed: true }],
      remainingSets: 2,
      pain: false,
      sessionSoFar: manyExercises.map((ex) => ({ exerciseId: ex.id, exerciseName: ex.name, sets: [{ weight: 40, reps: 10, rpe: 7, completed: true }] })),
      session: { workoutExercises: manyExercises, nextExercise: manyExercises[0], availableMinutes: 60 },
      rulesDecision: RULES_DECISION,
    })
    expect(prompt).not.toBeNull()
    expect(prompt.length).toBeLessThan(9000)
  })
})

describe('timed exercises (планка): секунды ≠ килограммы', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const PLANK = {
    id: 'plank',
    name: 'Планка',
    muscleGroup: 'Кор',
    repMin: 40,
    repMax: 60,
    weightStep: 0,
    restSeconds: 60,
    targetWeight: 0,
  }

  it('LLM предложил «вес 60» для планки — кламп обнуляет вес и ограничивает секунды', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      // Классическая путаница: LLM принял 60 секунд за 60 кг
      nextSet: { weight: 60, reps: 16, restSeconds: 60, targetRpe: 7 },
      strategyAction: { type: 'hold' },
      reason: 'Продолжаем в том же темпе.',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: PLANK,
      completedSets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
      remainingSets: 1,
      pain: false,
      rulesDecision: { ...RULES_DECISION, recommendedWeight: 0, recommendedReps: 60, recommendedRestSeconds: 60 },
    })
    expect(decision.source).toBe('llm')
    expect(decision.recommendedWeight).toBe(0)
    // 16 «повторов» — минимум 10 сек соблюдён, но вес обнулён
    expect(decision.recommendedReps).toBeGreaterThanOrEqual(10)
    expect(decision.recommendedReps).toBeLessThanOrEqual(300)
  })

  it('секунды не могут прыгнуть больше чем на +30 от прошлого удержания', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 0, reps: 240, restSeconds: 60, targetRpe: 7 },
      strategyAction: { type: 'hold' },
      reason: 'Держи дольше!',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'oleg',
      exercise: PLANK,
      completedSets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
      remainingSets: 1,
      pain: false,
      rulesDecision: { ...RULES_DECISION, recommendedWeight: 0, recommendedReps: 60, recommendedRestSeconds: 60 },
    })
    expect(decision.recommendedWeight).toBe(0)
    expect(decision.recommendedReps).toBe(90)
  })

  it('промпт для планки описывает секунды, а не «0×60»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 0, reps: 60, restSeconds: 60, targetRpe: 7 },
      strategyAction: { type: 'hold' },
      reason: 'ok',
    })))
    const { prompt } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: PLANK,
      completedSets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
      remainingSets: 1,
      pain: false,
      rulesDecision: { ...RULES_DECISION, recommendedWeight: 0, recommendedReps: 60, recommendedRestSeconds: 60 },
    })
    expect(prompt).toContain('УПРАЖНЕНИЕ НА ВРЕМЯ')
    expect(prompt).toContain('60 сек@7')
    expect(prompt).not.toContain('0×60')
  })
})

describe('clampNextSetDecision (direct)', () => {
  it('oleg (no-failure): targetRpe capped at 8, no weight increase after RPE≥8', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 45, reps: 8, restSeconds: 120, targetRpe: 10 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'oleg', lastSet: { weight: 40, reps: 8, rpe: 8 }, weightStep: 2.5, pain: false },
    )
    expect(clamped.nextSet.targetRpe).toBe(8)
    // RPE 8 for no-failure user → no increase allowed at all
    expect(clamped.nextSet.weight).toBe(40)
  })

  it('oleg: max 1 step up when fresh', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 50, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'oleg', lastSet: { weight: 40, reps: 8, rpe: 6 }, weightStep: 2.5, pain: false },
    )
    expect(clamped.nextSet.weight).toBe(42.5)
  })

  it('weight cannot drop more than 2 steps below last set', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 10, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 60, reps: 8, rpe: 7 }, weightStep: 2.5, pain: false },
    )
    expect(clamped.nextSet.weight).toBe(55)
  })

  it('pain forces suggest_replacement and clears the next set', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 60, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 60, reps: 8, rpe: 7 }, weightStep: 2.5, pain: true },
    )
    expect(clamped.strategyAction.type).toBe('suggest_replacement')
    expect(clamped.nextSet).toBeNull()
  })
})
