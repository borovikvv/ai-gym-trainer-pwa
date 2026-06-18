import { describe, expect, it, vi } from 'vitest'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from './coachDecisionLog.js'

describe('coach decision log', () => {
  it('builds a compact structured decision entry without raw secrets', () => {
    const entry = buildCoachDecisionLogEntry({
      userId: 'oleg',
      sessionId: 'session-1',
      decisionType: 'live_strategy',
      source: 'llm',
      inputs: {
        coachState: { readinessScore: 62, recoveryStatus: 'partial' },
        apiKey: 'secret',
      },
      decision: {
        summary: 'Убрать отказные подходы.',
        actions: [{ type: 'reduce_remaining_volume', reason: 'RPE высокий.' }],
      },
    })

    expect(entry.userId).toBe('oleg')
    expect(entry.decisionType).toBe('live_strategy')
    expect(entry.source).toBe('llm')
    expect(JSON.stringify(entry)).not.toContain('secret')
    expect(entry.inputSummary.readinessScore).toBe(62)
    expect(entry.decisionSummary).toBe('Убрать отказные подходы.')
  })

  it('stores a decision in recommendations as coach_decision_log', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await storeCoachDecisionLog(client, {
      userId: 'vyacheslav',
      sessionId: 'session-2',
      decisionType: 'post_workout_plan',
      source: 'rules',
      decisionSummary: 'Следующую тренировку сделать умеренной.',
      payload: { ok: true },
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into public.recommendations'),
      expect.arrayContaining(['vyacheslav', 'session-2', 'coach_decision_log']),
    )
  })
})
