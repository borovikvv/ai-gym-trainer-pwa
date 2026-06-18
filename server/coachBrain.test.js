import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLiveStrategyDecision, clampLiveStrategyDecision, requestLlmLiveStrategy } from './coachBrain.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('coach brain', () => {
  it('falls back to rules when no LLM client is available', async () => {
    const decision = await buildLiveStrategyDecision({
      userId: 'oleg',
      exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
      completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
      coachState: { readinessScore: 58, recoveryStatus: 'partial' },
      session: { remainingExercises: [] },
    })

    expect(decision.source).toBe('rules')
    expect(decision.decisionType).toBe('live_strategy')
    expect(decision.actions[0].type).toBe('reduce_remaining_volume')
  })

  it('removes unsafe or unknown LLM actions', () => {
    const decision = clampLiveStrategyDecision({
      source: 'llm',
      decisionType: 'live_strategy',
      summary: 'Bad plan',
      actions: [
        { type: 'increase_weight_aggressively', reason: 'unknown' },
        { type: 'finish_workout_early', reason: 'RPE too high' },
      ],
      constraints: { maxRpe: 11, allowFailure: true, maxAdditionalExercises: 5 },
      warnings: [],
    }, { userId: 'oleg' })

    expect(decision.actions).toEqual([{ type: 'finish_workout_early', reason: 'RPE too high' }])
    expect(decision.constraints.maxRpe).toBe(8)
    expect(decision.constraints.allowFailure).toBe(false)
    expect(decision.constraints.maxAdditionalExercises).toBe(1)
  })

  it('builds an LLM live strategy and clamps it for Oleg', async () => {
    const decision = await buildLiveStrategyDecision({
      userId: 'oleg',
      exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
      completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
      coachState: { readinessScore: 70, recoveryStatus: 'ready' },
      session: {},
      requestLlm: async () => ({
        source: 'llm',
        summary: 'Добавить отказную добивку.',
        actions: [{ type: 'add_accessory', exerciseId: 'push-up', reason: 'Легко.' }],
        constraints: { maxRpe: 10, allowFailure: true, maxAdditionalExercises: 2 },
        warnings: [],
      }),
    })

    expect(decision.source).toBe('llm')
    expect(decision.constraints.allowFailure).toBe(false)
    expect(decision.constraints.maxRpe).toBe(8)
    expect(decision.constraints.maxAdditionalExercises).toBe(1)
  })

  it('requests a JSON live strategy from an OpenAI-compatible LLM', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')
    vi.stubEnv('OPENAI_MODEL', 'test-model')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Снизить объём.',
                actions: [{ type: 'reduce_remaining_volume', reason: 'RPE высокий.' }],
                constraints: { maxRpe: 8, allowFailure: false, maxAdditionalExercises: 0 },
                warnings: [],
              }),
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const decision = await requestLlmLiveStrategy({
      userId: 'oleg',
      exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
      completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
      coachState: { readinessScore: 60, recoveryStatus: 'partial' },
      session: { availableMinutes: 45 },
      rulesDecision: { summary: 'Правила предлагают снизить объём.' },
    })

    expect(decision).toMatchObject({
      source: 'llm',
      summary: 'Снизить объём.',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
