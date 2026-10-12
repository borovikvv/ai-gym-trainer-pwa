import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLiveStrategyDecision, clampLiveStrategyDecision, requestLlmLiveStrategy } from './coachBrain.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function llmOutcomes(logSpy) {
  return logSpy.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.startsWith('TRAINER_EVENT '))
    .map((line) => JSON.parse(line.slice('TRAINER_EVENT '.length)))
    .filter((body) => body.event === 'llm.outcome')
}

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
    expect(decision.clamped).toBe(false)
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
    expect(decision.clamped).toBe(true)
  })

  it('does not flag a clamp when the LLM proposal is already within policy bounds', () => {
    const decision = clampLiveStrategyDecision({
      source: 'llm',
      decisionType: 'live_strategy',
      summary: 'ok',
      actions: [{ type: 'hold_strategy', reason: 'ok' }],
      constraints: { maxRpe: 8, allowFailure: false, maxAdditionalExercises: 1 },
      warnings: [],
    }, { userId: 'oleg' })

    expect(decision.clamped).toBe(false)
  })

  it('builds an LLM live strategy and clamps it for Oleg', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
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
    // Issue #426: a clamp that overrode the LLM is a degraded outcome.
    expect(llmOutcomes(logSpy)).toEqual([
      expect.objectContaining({ caller: 'coachBrain', outcome: 'degraded', reason: 'rejected_by_clamp' }),
    ])
  })

  it('Issue #426: logs ok/null when the LLM strategy passes the clamp', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await buildLiveStrategyDecision({
      userId: 'oleg',
      exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
      completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
      coachState: { readinessScore: 70, recoveryStatus: 'ready' },
      session: {},
      requestLlm: async () => ({
        source: 'llm',
        summary: 'Держим стратегию.',
        actions: [{ type: 'hold_strategy', reason: 'Норма.' }],
        constraints: { maxRpe: 8, allowFailure: false, maxAdditionalExercises: 1 },
        warnings: [],
      }),
    })

    expect(llmOutcomes(logSpy)).toEqual([
      expect.objectContaining({ caller: 'coachBrain', outcome: 'ok', reason: null }),
    ])
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
