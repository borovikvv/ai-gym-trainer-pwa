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

  it('happy path: LLM присылает только текст — числа и действие берутся из rulesDecision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      reason: 'Подход шёл уверенно — держим вес.',
      detail: 'RPE 7 при растущем e1RM: запас есть, но правила решили не повышать.',
    })))
    const { decision, prompt } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('llm')
    expect(decision.action).toBe(RULES_DECISION.action)
    expect(decision.recommendedWeight).toBe(RULES_DECISION.recommendedWeight)
    expect(decision.recommendedReps).toBe(RULES_DECISION.recommendedReps)
    expect(decision.recommendedRestSeconds).toBe(RULES_DECISION.recommendedRestSeconds)
    expect(decision.reason).toBe('Подход шёл уверенно — держим вес.')
    expect(decision.detail).toBe('RPE 7 при растущем e1RM: запас есть, но правила решили не повышать.')
    // Prompt contains the load-bearing context blocks
    expect(prompt).toContain('АТЛЕТ')
    expect(prompt).toContain('БАЗОВАЯ РЕКОМЕНДАЦИЯ ПО ПРАВИЛАМ')
    expect(prompt).toContain('e1RM 72.5')
  })

  it('враждебный ответ LLM: другой вес и действие игнорируются — числа и действие берутся из rulesDecision, текст — из LLM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 200, reps: 1, restSeconds: 5, targetRpe: 10 },
      strategyAction: { type: 'stop_exercise' },
      reason: 'Остановись и смени упражнение.',
      detail: 'Судя по RPE, пора закончить это движение.',
    })))
    const { decision } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: EXERCISE,
      completedSets: COMPLETED_SETS,
      remainingSets: 2,
      pain: false,
      rulesDecision: RULES_DECISION,
    })
    expect(decision.source).toBe('llm')
    expect(decision.action).toBe(RULES_DECISION.action)
    expect(decision.recommendedWeight).toBe(RULES_DECISION.recommendedWeight)
    expect(decision.recommendedReps).toBe(RULES_DECISION.recommendedReps)
    expect(decision.recommendedRestSeconds).toBe(RULES_DECISION.recommendedRestSeconds)
    expect(decision.reason).toBe('Остановись и смени упражнение.')
    expect(decision.detail).toBe('Судя по RPE, пора закончить это движение.')
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

  it('pain forces suggest_replacement regardless of LLM text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      reason: 'Продолжаем как шло.',
      detail: 'Боль — не повод геройствовать.',
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
    expect(decision.reason).toBe('Продолжаем как шло.')
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

describe('Issue #296: bodyweight exercises (турник/брусья) — вес всегда 0', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const BAR_DIPS = {
    id: 'bar-dips',
    name: 'Отжимания на брусьях',
    muscleGroup: 'Грудь',
    repMin: 7,
    repMax: 12,
    weightStep: 2.5,
    restSeconds: 90,
    targetWeight: 0,
    equipment: 'bodyweight',
  }

  it('промпт для bodyweight не показывает шаг веса и явно говорит про собственный вес', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(llmResponse({
      nextSet: { weight: 0, reps: 12, restSeconds: 90, targetRpe: 7 },
      strategyAction: { type: 'hold' },
      reason: 'ok',
    })))
    const { prompt } = await buildNextSetDecision({
      client: fakeClient,
      userId: 'vyacheslav',
      exercise: BAR_DIPS,
      completedSets: [{ weight: 0, reps: 12, rpe: 7, completed: true }],
      remainingSets: 1,
      pain: false,
      rulesDecision: { ...RULES_DECISION, recommendedWeight: 0, recommendedReps: 12, recommendedRestSeconds: 90 },
    })
    expect(prompt).toContain('СОБСТВЕННЫМ ВЕСОМ')
    expect(prompt).not.toContain('шаг веса')
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
    expect(clamped.wasClamped).toBe(true)
  })

  it('does not flag a clamp when the proposal is already within bounds', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 60, reps: 8, restSeconds: 90, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 60, reps: 8, rpe: 7 }, weightStep: 2.5, pain: false },
    )
    expect(clamped.wasClamped).toBe(false)
  })

  it('Issue #296: bodyweight — LLM предложил вес 60, кламп обнуляет', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 60, reps: 12, restSeconds: 90, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 0, reps: 12, rpe: 7 }, weightStep: 2.5, pain: false, bodyweight: true },
    )
    expect(clamped.nextSet.weight).toBe(0)
    expect(clamped.wasClamped).toBe(true)
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

// ---------------------------------------------------------------------------
// Issue #173: кламп решений для упражнений с помощью (гравитрон).
// Границы инвертируются: «вверх» (прогрессия) = снижение веса.
// ---------------------------------------------------------------------------

describe('Issue #173: clampNextSetDecision for assisted exercises', () => {
  it('прогрессия (меньше помощи) ограничена maxWeightJumpSteps вниз', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 10, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'oleg', lastSet: { weight: 30, reps: 8, rpe: 6 }, weightStep: 2.5, pain: false, weightDirection: 'assistance' },
    )
    // oleg: max 1 шаг прогрессии = 30 − 2.5 = 27.5 (LLM предложил 10)
    expect(clamped.nextSet.weight).toBe(27.5)
  })

  it('регрессия (больше помощи) ограничена 2 шагами вверх', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 60, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 30, reps: 8, rpe: 7 }, weightStep: 2.5, pain: false, weightDirection: 'assistance' },
    )
    // легче максимум на 2 шага: 30 + 5 = 35 (LLM предложил 60)
    expect(clamped.nextSet.weight).toBe(35)
  })

  // Issue #369: 0 кг помощи — самый тяжёлый вариант, а не «нет данных».
  // Раньше границы строились только при lastWeight > 0, и 60 кг от LLM проходили.
  it('Issue #369: подход без помощи (0 кг) — 60 кг от LLM ограничены двумя шагами помощи', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 60, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 0, reps: 8, rpe: 7 }, weightStep: 5, pain: false, weightDirection: 'assistance' },
    )
    // легче максимум на 2 шага: 0 + 10 = 10 (LLM предложил 60)
    expect(clamped.nextSet.weight).toBe(10)
    expect(clamped.wasClamped).toBe(true)
  })

  it('Issue #369: подход без помощи — предложение остаться без помощи не считается клампом', () => {
    const clamped = clampNextSetDecision(
      {
        nextSet: { weight: 0, reps: 8, restSeconds: 120, targetRpe: 7 },
        strategyAction: { type: 'hold' },
        reason: 'x',
      },
      { userId: 'vyacheslav', lastSet: { weight: 0, reps: 8, rpe: 7 }, weightStep: 5, pain: false, weightDirection: 'assistance' },
    )
    expect(clamped.nextSet.weight).toBe(0)
    expect(clamped.wasClamped).toBe(false)
  })
})

