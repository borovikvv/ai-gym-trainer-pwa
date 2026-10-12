import { describe, expect, it } from 'vitest'
import {
  analyzeSignal,
  clampedKey,
  degeneracyReasons,
  DEGENERATE_MIN_SAMPLE,
  isDegenerate,
  isUndersampled,
  LLM_FALLBACK_SHARE_ALARM_THRESHOLD,
  LLM_OUTCOME_MIN_SAMPLE,
  llmOutcomeAlarms,
  loadSignalValues,
  normalizeE1rmTrendValue,
  parseLlmOutcomeLine,
  readAvgRepDeviation,
  readClamped,
  tallyLlmOutcomes,
  tallyWeightAdherence,
  totalObservations,
  unobservedBranches,
  VOLUME_ACTIONS,
  weightBucket,
} from './coach-self-audit.ts'

/** Выборка длины n из повторяющихся значений — чтобы пройти порог DEGENERATE_MIN_SAMPLE. */
function repeat(values, times) {
  return Array.from({ length: times }, (_, index) => values[index % values.length])
}

describe('analyzeSignal', () => {
  it('считает заполненность, distinct, min/max, моду и её долю', () => {
    const stats = analyzeSignal([7, 7, 7, 8, null, null])
    expect(stats).toMatchObject({
      total: 6,
      filled: 4,
      distinct: 2,
      min: 7,
      max: 8,
      mode: 7,
    })
    expect(stats.fillRate).toBeCloseTo(4 / 6)
    expect(stats.modeShare).toBeCloseTo(0.75)
  })

  it('категориальный сигнал (строки) даёт моду и distinct, но не min/max', () => {
    const stats = analyzeSignal(['light', 'light', 'medium', null])
    expect(stats).toMatchObject({ distinct: 2, mode: 'light', min: null, max: null })
    expect(stats.modeShare).toBeCloseTo(2 / 3)
  })

  it('пустая выборка не падает', () => {
    const stats = analyzeSignal([])
    expect(stats).toMatchObject({ total: 0, filled: 0, distinct: 0, min: null, max: null, mode: null, modeShare: 0 })
  })
})

describe('isDegenerate / degeneracyReasons', () => {
  it('мода ≥ 80 % — вырожден', () => {
    const stats = analyzeSignal([...repeat([7], 16), 8, 8, 9, 9])
    expect(isDegenerate(stats)).toBe(true)
    expect(degeneracyReasons(stats)).toEqual(expect.arrayContaining([expect.stringContaining('мода')]))
  })

  it('различных значений ≤ 2 — вырожден, даже если мода не доминирует', () => {
    const stats = analyzeSignal(repeat([7, 8], 20))
    expect(isDegenerate(stats)).toBe(true)
  })

  it('заполненность < 30 % — вырожден', () => {
    const stats = analyzeSignal([...repeat([1, 2, 3, 4, 5], 12), ...repeat([null], 40)])
    expect(isDegenerate(stats)).toBe(true)
  })

  it('здоровый сигнал не вырожден и причин нет', () => {
    const stats = analyzeSignal(repeat([3, 4, 5], 18))
    expect(isDegenerate(stats)).toBe(false)
    expect(degeneracyReasons(stats)).toEqual([])
  })

  it('три причины могут быть одновременно', () => {
    const stats = analyzeSignal([...repeat([7], 12), ...repeat([null], 60)])
    expect(degeneracyReasons(stats).length).toBe(3)
  })
})

describe('порог выборки', () => {
  // Без порога окно в 4 недели кричало бы «вырожден» на каждый сигнал: на трёх
  // значениях условие «различных ≤ 2» выполняется почти всегда.
  it('малая выборка не объявляется вырожденной, хотя формально подходит', () => {
    const stats = analyzeSignal([7, 8, 7])
    expect(stats.distinct).toBe(2)
    expect(isUndersampled(stats)).toBe(true)
    expect(isDegenerate(stats)).toBe(false)
  })

  it('ровно на пороге судим как обычно', () => {
    const stats = analyzeSignal(repeat([7, 8], DEGENERATE_MIN_SAMPLE))
    expect(isUndersampled(stats)).toBe(false)
    expect(isDegenerate(stats)).toBe(true)
  })

  it('«мало данных» — это не «сигнал в норме»: пустая выборка не вырождена и не здорова', () => {
    const stats = analyzeSignal([])
    expect(isUndersampled(stats)).toBe(true)
    expect(isDegenerate(stats)).toBe(false)
  })
})

describe('unobservedBranches', () => {
  it('ветки с нулём срабатываний попадают в отчёт', () => {
    const counts = new Map([
      ['add', 10],
      ['hold', 5],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toEqual(['cut'])
  })

  it('все наблюдались — пусто', () => {
    const counts = new Map([
      ['add', 1],
      ['hold', 1],
      ['cut', 1],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toEqual([])
  })

  it('порог 12 недель ловит cut = 0 (#248)', () => {
    const counts = new Map([
      ['add', 20],
      ['hold', 16],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toContain('cut')
    expect(totalObservations(counts)).toBe(36)
  })

  it('знаменатель для суждения о ветках — сумма, а не число ключей', () => {
    expect(totalObservations(new Map())).toBe(0)
    expect(totalObservations(new Map([['add', 3], ['hold', 2]]))).toBe(5)
  })
})

describe('кламп из payload решения', () => {
  // body в recommendations — колонка text, а не jsonb, поэтому JSON разбирается
  // здесь. Главное — не схлопнуть «не записано» в «клампа не было».
  it('признак есть — читается как есть', () => {
    expect(readClamped(JSON.stringify({ clamped: true }))).toBe(true)
    expect(readClamped(JSON.stringify({ clamped: false }))).toBe(false)
  })

  it('признак вложен в decision', () => {
    expect(readClamped(JSON.stringify({ decision: { clamped: true } }))).toBe(true)
  })

  it('признака нет, payload пуст или битый — null, а не false', () => {
    expect(readClamped(JSON.stringify({ decision: {} }))).toBeNull()
    expect(readClamped(null)).toBeNull()
    expect(readClamped('не json')).toBeNull()
  })

  it('в ключе отчёта три состояния различимы', () => {
    expect(clampedKey('Решение тренера', 'rules', true)).toContain('(кламп)')
    expect(clampedKey('Решение тренера', 'rules', false)).not.toContain('кламп')
    expect(clampedKey('Решение тренера', 'llm', null)).toContain('не записан')
  })
})

describe('readAvgRepDeviation', () => {
  // body в recommendations — весь JSON записи training_record
  // (server/coachTrainingRecord.ts:162-217): { userId, sessionId, createdAt,
  // input, decision, outcome }. avgDeviation лежит в outcome.repDeviation.
  const baseRecord = {
    userId: 'u1',
    sessionId: 's1',
    createdAt: '2026-08-27T18:00:00.000Z',
    input: { readinessScore: 70, recoveryStatus: 'unknown', weeklyLoadStatus: 'unknown' },
    decision: { exercises: [], lowReadiness: false, loadPolicy: 'hold', source: 'rules', changes: [] },
    outcome: {
      completedReps: 10,
      avgRpe: 7,
      painCount: 0,
      totalVolume: 1000,
      qualityScore: 8,
    },
  }

  it('читает avgDeviation из outcome.repDeviation (форма записи training_record)', () => {
    const record = {
      ...baseRecord,
      outcome: {
        ...baseRecord.outcome,
        repDeviation: { avgDeviation: -1.5, setsWithExpectation: 4, setsWithoutExpectation: 0, exercises: [] },
      },
    }
    expect(readAvgRepDeviation(JSON.stringify(record))).toBe(-1.5)
  })

  it('avgDeviation: null (ожидание не построилось) — null', () => {
    const record = {
      ...baseRecord,
      outcome: {
        ...baseRecord.outcome,
        repDeviation: { avgDeviation: null, setsWithExpectation: 0, setsWithoutExpectation: 4, exercises: [] },
      },
    }
    expect(readAvgRepDeviation(JSON.stringify(record))).toBeNull()
  })

  it('пустой body — null без исключения', () => {
    expect(readAvgRepDeviation(null)).toBeNull()
  })
})

describe('normalizeE1rmTrendValue', () => {
  it('реальное значение тренда возвращается как есть', () => {
    expect(normalizeE1rmTrendValue('up')).toBe('up')
    expect(normalizeE1rmTrendValue('flat')).toBe('flat')
  })

  it('insufficient_data — sentinel домена, а не заполненное значение', () => {
    expect(normalizeE1rmTrendValue('insufficient_data')).toBeNull()
  })

  it('пустые значения — null', () => {
    expect(normalizeE1rmTrendValue(null)).toBeNull()
    expect(normalizeE1rmTrendValue(undefined)).toBeNull()
  })
})

describe('e1rmTrend вне лога решений (issue #273)', () => {
  it('loadSignalValues не кладёт e1rmTrend и не читает coach_decision_log', async () => {
    const queries = []
    const fakePool = {
      async query(text) {
        queries.push(text)
        return { rows: [] }
      },
    }

    const values = await loadSignalValues(fakePool, 4)

    expect(values.has('e1rmTrend')).toBe(false)
    expect(queries.some((sql) => sql.includes('coach_decision_log'))).toBe(false)
  })
})

describe('weightBucket (issue #413)', () => {
  it('знак отклонения → бакет', () => {
    expect(weightBucket(2.5)).toBe('heavier')
    expect(weightBucket(-2.5)).toBe('lighter')
    expect(weightBucket(0)).toBe('as_planned')
  })

  it('нет отклонения → null, а не «как в плане»', () => {
    expect(weightBucket(null)).toBeNull()
    expect(weightBucket(undefined)).toBeNull()
    expect(weightBucket(Number.NaN)).toBeNull()
  })
})

describe('tallyWeightAdherence (issue #413)', () => {
  function record(userId, exercises) {
    return { userId, body: JSON.stringify({ outcome: { weightDeviation: { exercises } } }) }
  }

  it('раскладывает по бакетам, пользователям и причинам', () => {
    const records = [
      record('u1', [{
        easingReasons: ['deload'],
        sets: [
          { deviation: 2, repOutcome: 'at_ceiling' },
          { deviation: -1, repOutcome: 'in_range' },
        ],
      }]),
      record('u2', [{
        easingReasons: [],
        sets: [{ deviation: 0, repOutcome: 'below_min' }],
      }]),
    ]

    const tally = tallyWeightAdherence(records)

    expect(tally.buckets.get('heavier')).toBe(1)
    expect(tally.buckets.get('lighter')).toBe(1)
    expect(tally.buckets.get('as_planned')).toBe(1)
    expect(tally.repOutcomes.get('at_ceiling')).toBe(1)
    expect(tally.repOutcomes.get('in_range')).toBe(1)
    expect(tally.repOutcomes.get('below_min')).toBe(1)
    expect(tally.byUser.get('u1').get('heavier')).toBe(1)
    expect(tally.byUser.get('u2').get('as_planned')).toBe(1)
    expect(tally.byReason.get('deload').get('heavier')).toBe(1)
    expect(tally.byReason.get('__none__').get('as_planned')).toBe(1)
    expect(tally.reasonTotals.get('deload')).toBe(2)
    expect(tally.reasonTotals.has('__none__')).toBe(false)
  })

  it('упражнение с двумя причинами попадает в обе ветки', () => {
    const records = [record('u1', [{
      easingReasons: ['deload', 'low_readiness'],
      sets: [{ deviation: 3, repOutcome: null }],
    }])]

    const tally = tallyWeightAdherence(records)

    expect(tally.byReason.get('deload').get('heavier')).toBe(1)
    expect(tally.byReason.get('low_readiness').get('heavier')).toBe(1)
    expect(tally.reasonTotals.get('deload')).toBe(1)
    expect(tally.reasonTotals.get('low_readiness')).toBe(1)
  })

  it('битый JSON пропускается, не кидает', () => {
    const records = [
      { userId: 'u1', body: 'не json' },
      { userId: 'u1', body: null },
      record('u1', [{ easingReasons: [], sets: [{ deviation: 1, repOutcome: 'in_range' }] }]),
    ]

    expect(() => tallyWeightAdherence(records)).not.toThrow()
    expect(tallyWeightAdherence(records).buckets.get('heavier')).toBe(1)
  })

  it('repOutcome null не считается, а пустые записи не создают ключей', () => {
    const tally = tallyWeightAdherence([])
    expect(tally.buckets.size).toBe(0)
    expect(tally.repOutcomes.size).toBe(0)
    expect(tally.byReason.size).toBe(0)

    const withNull = tallyWeightAdherence([record('u1', [{ easingReasons: [], sets: [{ deviation: null, repOutcome: null }] }])])
    expect(withNull.buckets.size).toBe(0)
    expect(withNull.repOutcomes.size).toBe(0)
  })
})

describe('parseLlmOutcomeLine (issue #426)', () => {
  it('разбирает валидную строку llm.outcome', () => {
    const line = `TRAINER_EVENT ${JSON.stringify({
      ts: '2026-10-12T09:00:00.000Z',
      event: 'llm.outcome',
      caller: 'coachNarrator',
      outcome: 'fallback',
      reason: 'not_configured',
    })}`
    expect(parseLlmOutcomeLine(line)).toEqual({
      caller: 'coachNarrator',
      outcome: 'fallback',
      reason: 'not_configured',
    })
  })

  it('отсутствующий reason читается как null', () => {
    const line = `TRAINER_EVENT ${JSON.stringify({ event: 'llm.outcome', caller: 'x', outcome: 'ok' })}`
    expect(parseLlmOutcomeLine(line)).toEqual({ caller: 'x', outcome: 'ok', reason: null })
  })

  it('мусорная строка → null, не бросает', () => {
    expect(parseLlmOutcomeLine('TRAINER_EVENT {битый')).toBeNull()
    expect(parseLlmOutcomeLine('обычная строка без маркера')).toBeNull()
    expect(parseLlmOutcomeLine('')).toBeNull()
    expect(parseLlmOutcomeLine(`TRAINER_EVENT ${JSON.stringify({ event: 'llm.call', caller: 'x' })}`)).toBeNull()
    expect(parseLlmOutcomeLine(`TRAINER_EVENT ${JSON.stringify({ event: 'llm.outcome', caller: 'x', outcome: 'weird' })}`)).toBeNull()
    expect(parseLlmOutcomeLine(`TRAINER_EVENT ${JSON.stringify({ event: 'llm.outcome', outcome: 'ok' })}`)).toBeNull()
  })
})

describe('tallyLlmOutcomes (issue #426)', () => {
  it('группирует по вызывающему: всего, исходы, причины', () => {
    const tally = tallyLlmOutcomes([
      { caller: 'a', outcome: 'ok', reason: null },
      { caller: 'a', outcome: 'fallback', reason: 'timeout' },
      { caller: 'a', outcome: 'fallback', reason: 'timeout' },
      { caller: 'b', outcome: 'degraded', reason: 'truncated' },
    ])

    expect(tally.get('a').total).toBe(3)
    expect(tally.get('a').outcomes.get('ok')).toBe(1)
    expect(tally.get('a').outcomes.get('fallback')).toBe(2)
    expect(tally.get('a').reasons.get('timeout')).toBe(2)
    expect(tally.get('b').total).toBe(1)
    expect(tally.get('b').reasons.get('truncated')).toBe(1)
  })

  it('пустой вход не падает', () => {
    expect(tallyLlmOutcomes([]).size).toBe(0)
  })
})

describe('llmOutcomeAlarms (issue #426)', () => {
  function callerTally(total, outcomes, reasons = new Map()) {
    return { total, outcomes: new Map(Object.entries(outcomes)), reasons: new Map(Object.entries(reasons)) }
  }

  it('мало данных — не судим', () => {
    const alarms = llmOutcomeAlarms('a', callerTally(3, { ok: 3 }))
    expect(alarms.some((line) => line.includes('мало данных'))).toBe(true)
    expect(alarms.some((line) => line.includes('ok = 0'))).toBe(false)
    expect(LLM_OUTCOME_MIN_SAMPLE).toBe(10)
  })

  it('ok равен нулю — тревога', () => {
    const alarms = llmOutcomeAlarms('a', callerTally(LLM_OUTCOME_MIN_SAMPLE, { degraded: 10 }, { truncated: 10 }))
    expect(alarms.some((line) => line.includes('ok = 0'))).toBe(true)
  })

  it('доля fallback выше порога — тревога', () => {
    const alarms = llmOutcomeAlarms('a', callerTally(10, { ok: 4, fallback: 6 }, { timeout: 6 }))
    expect(LLM_FALLBACK_SHARE_ALARM_THRESHOLD).toBe(0.5)
    expect(alarms.some((line) => line.includes('ДОЛЯ FALLBACK'))).toBe(true)
  })

  it('здоровый случай — без алармов', () => {
    expect(llmOutcomeAlarms('a', callerTally(10, { ok: 10 }))).toEqual([])
  })

  it('топ-3 причины по частоте', () => {
    const alarms = llmOutcomeAlarms('x', callerTally(10, { degraded: 10 }, { a: 1, b: 5, c: 2, d: 4 }))
    const topLine = alarms.find((line) => line.includes('топ причин'))
    expect(topLine).toContain('b: 5')
    expect(topLine).toContain('d: 4')
    expect(topLine).toContain('c: 2')
    expect(topLine).not.toContain('a: 1')
  })
})
