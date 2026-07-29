import { describe, expect, it } from 'vitest'
import {
  buildWeeklyMuscleFacts,
  buildWeeklyVolumeStatus,
  decideWeeklyVolumeTarget,
  formatWeeklyVolumeForPrompt,
  reconcileWeeklyVolume,
  syncWeeklyVolumeTargets,
} from './weeklyVolumeTargets.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEK_START = '2026-07-20'
const LANDMARKS = { mev: 8, mav: 16, mrv: 20 }

function sets(count, { rpe = 7, reps = 8 } = {}) {
  return Array.from({ length: count }, () => ({ weight: 60, reps, rpe, completed: true }))
}

function session(date, exercises, readinessCheckIn = null) {
  return { id: `s-${date}`, completedAt: `${date}T10:00:00.000Z`, exercises, readinessCheckIn }
}

function exercise(muscleGroup, setCount, extras = {}) {
  return {
    exerciseId: `${muscleGroup}-ex`,
    exerciseName: `${muscleGroup} упражнение`,
    muscleGroup,
    pain: false,
    sets: sets(setCount, extras),
    ...extras,
  }
}

function facts(overrides = {}) {
  return { sets: 10, avgRpe: 7, painSessions: 0, soreSessions: 0, sessions: 2, ...overrides }
}

// ---------------------------------------------------------------------------
// Учёт факта
// ---------------------------------------------------------------------------

describe('buildWeeklyMuscleFacts', () => {
  const history = [
    session('2026-07-21', [exercise('Ноги', 3), exercise('Спина', 4)]),
    session('2026-07-24', [exercise('Ноги', 2)], { soreMuscleGroups: ['Ноги'] }),
    // Соседние недели в счёт не идут.
    session('2026-07-19', [exercise('Ноги', 5)]),
    session('2026-07-27', [exercise('Ноги', 5)]),
  ]

  it('считает рабочие подходы по группам за календарную неделю', () => {
    const result = buildWeeklyMuscleFacts(history, WEEK_START, '2026-07-26')
    expect(result.legs.sets).toBe(5)
    expect(result.back.sets).toBe(4)
    expect(result.legs.sessions).toBe(2)
  })

  it('не считает незавершённые подходы', () => {
    const result = buildWeeklyMuscleFacts([
      session('2026-07-21', [{ ...exercise('Ноги', 0), sets: [{ weight: 60, reps: 8, rpe: 7, completed: true }, { weight: 60, reps: 0, rpe: 0, completed: false }] }]),
    ], WEEK_START, '2026-07-26')
    expect(result.legs.sets).toBe(1)
  })

  it('собирает крепатуру из чек-инов и боль из упражнений', () => {
    const result = buildWeeklyMuscleFacts([
      session('2026-07-21', [{ ...exercise('Ноги', 3), pain: true }], { soreMuscleGroups: ['Ноги'] }),
      session('2026-07-23', [exercise('Ноги', 3)], { soreMuscleGroups: ['Ноги'] }),
    ], WEEK_START, '2026-07-26')
    expect(result.legs.painSessions).toBe(1)
    expect(result.legs.soreSessions).toBe(2)
  })

  it('считает средний RPE по группе', () => {
    const result = buildWeeklyMuscleFacts([
      session('2026-07-21', [exercise('Ноги', 2, { rpe: 8 })]),
      session('2026-07-23', [exercise('Ноги', 2, { rpe: 9 })]),
    ], WEEK_START, '2026-07-26')
    expect(result.legs.avgRpe).toBe(8.5)
  })

  it('пустая история — нули по всем группам', () => {
    const result = buildWeeklyMuscleFacts([], WEEK_START, '2026-07-26')
    expect(result.legs).toEqual({ sets: 0, avgRpe: null, painSessions: 0, soreSessions: 0, sessions: 0 })
  })
})

// ---------------------------------------------------------------------------
// Правило изменения цели
// ---------------------------------------------------------------------------

describe('decideWeeklyVolumeTarget', () => {
  it('добавляет подход, когда признаков потолка нет', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 12,
      lastWeek: facts({ sets: 12 }),
      priorWeek: facts({ sets: 11 }),
      e1rmTrend: 'up',
    })
    expect(decision.action).toBe('add')
    expect(decision.targetSets).toBe(13)
    expect(decision.reason).toContain('добавляем')
  })

  it('догоняет минимальный объём двумя подходами', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 4,
      lastWeek: facts({ sets: 4 }),
      e1rmTrend: 'up',
    })
    expect(decision.action).toBe('add')
    expect(decision.targetSets).toBe(8) // clamp к MEV
  })

  it('держит цель при одном признаке потолка', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 12,
      lastWeek: facts({ sets: 12, soreSessions: 2 }),
      e1rmTrend: 'up',
    })
    expect(decision.action).toBe('hold')
    expect(decision.targetSets).toBe(12)
    expect(decision.ceilingSignals).toEqual(['крепатура не уходит'])
  })

  it('снимает подход при двух признаках потолка', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 14,
      lastWeek: facts({ sets: 14, soreSessions: 2, painSessions: 1 }),
      e1rmTrend: 'flat',
    })
    expect(decision.action).toBe('cut')
    expect(decision.targetSets).toBe(13)
    expect(decision.ceilingSignals).toHaveLength(2)
    expect(decision.reason).toContain('снимаем')
  })

  it('падение производительности и рост усилия — тоже два признака', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 14,
      lastWeek: facts({ sets: 14, avgRpe: 9 }),
      priorWeek: facts({ sets: 14, avgRpe: 7.5 }),
      e1rmTrend: 'down',
    })
    expect(decision.action).toBe('cut')
    expect(decision.ceilingSignals).toContain('производительность падает')
    expect(decision.ceilingSignals).toContain('усилие выросло на тех же весах')
  })

  it('не добавляет, пока прошлая цель не выполнена', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 14,
      lastWeek: facts({ sets: 9 }),
      e1rmTrend: 'up',
    })
    expect(decision.action).toBe('hold')
    expect(decision.targetSets).toBe(14)
    expect(decision.reason).toContain('9 из 14')
  })

  it('не поднимает цель выше потолка восстановления (MRV)', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 20,
      lastWeek: facts({ sets: 20 }),
      e1rmTrend: 'up',
    })
    expect(decision.action).toBe('hold')
    expect(decision.targetSets).toBe(20)
    expect(decision.reason).toContain('MRV')
  })

  it('не опускает цель ниже минимально работающего объёма (MEV)', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: 8,
      lastWeek: facts({ sets: 8, soreSessions: 2, painSessions: 1 }),
      e1rmTrend: 'down',
    })
    expect(decision.action).toBe('cut')
    expect(decision.targetSets).toBe(8)
  })

  it('первая цель берётся от факта, а не от абстрактного числа', () => {
    const decision = decideWeeklyVolumeTarget({
      muscleKey: 'legs',
      landmarks: LANDMARKS,
      previousTarget: null,
      lastWeek: facts({ sets: 3 }),
      e1rmTrend: 'insufficient_data',
    })
    expect(decision.previousTargetSets).toBeNull()
    // Факт 3 подхода, но ниже MEV цель не ставим.
    expect(decision.targetSets).toBe(8)
    expect(decision.reason).toContain('первая цель')
  })

  it('решение всегда несёт обоснование', () => {
    for (const trend of ['up', 'down', 'flat', 'insufficient_data']) {
      const decision = decideWeeklyVolumeTarget({
        muscleKey: 'chest', landmarks: LANDMARKS, previousTarget: 10, lastWeek: facts({ sets: 10 }), e1rmTrend: trend,
      })
      expect(decision.reason.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// Сверка факта с целью
// ---------------------------------------------------------------------------

describe('reconcileWeeklyVolume', () => {
  it('попадание — расхождение в пределах подхода', () => {
    expect(reconcileWeeklyVolume(12, 12).verdict).toBe('hit')
    expect(reconcileWeeklyVolume(12, 11).verdict).toBe('hit')
    expect(reconcileWeeklyVolume(12, 13).verdict).toBe('hit')
  })

  it('недобор и перебор видны в вердикте и в тексте', () => {
    expect(reconcileWeeklyVolume(12, 8)).toMatchObject({ verdict: 'undershoot' })
    expect(reconcileWeeklyVolume(12, 8).note).toContain('8 из 12')
    expect(reconcileWeeklyVolume(12, 18)).toMatchObject({ verdict: 'overshoot' })
  })
})

// ---------------------------------------------------------------------------
// Остаток недельной цели — вход планировщика
// ---------------------------------------------------------------------------

describe('buildWeeklyVolumeStatus', () => {
  it('остаток — цель минус факт', () => {
    const status = buildWeeklyVolumeStatus(
      { legs: { muscleKey: 'legs', targetSets: 12, reason: 'r' } },
      { legs: facts({ sets: 5 }) },
    )
    expect(status.legs).toMatchObject({ targetSets: 12, actualSets: 5, remainingSets: 7 })
  })

  it('перебор даёт отрицательный остаток — планировщик уступит место', () => {
    const status = buildWeeklyVolumeStatus(
      { legs: { muscleKey: 'legs', targetSets: 8, reason: 'r' } },
      { legs: facts({ sets: 11 }) },
    )
    expect(status.legs.remainingSets).toBe(-3)
  })
})

describe('formatWeeklyVolumeForPrompt', () => {
  it('показывает цель, факт и остаток', () => {
    const text = formatWeeklyVolumeForPrompt({
      legs: { muscleKey: 'legs', targetSets: 12, actualSets: 5, remainingSets: 7, reason: 'r' },
    })
    expect(text).toContain('5/12')
    expect(text).toContain('осталось 7')
  })

  it('без целей — пусто', () => {
    expect(formatWeeklyVolumeForPrompt({})).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Оркестрация
// ---------------------------------------------------------------------------

function mockClient(script = []) {
  const queries = []
  const pending = script.map((entry) => ({ ...entry, used: false }))
  const client = {
    async query(text, params) {
      queries.push({ text, params })
      const handler = pending.find((entry) => !entry.used && text.includes(entry.match))
      if (!handler) return { rows: [] }
      handler.used = true
      return { rows: handler.rows ?? [] }
    },
  }
  return { client, queries }
}

function targetRow(overrides = {}) {
  return {
    id: 'target-1',
    user_id: 'u1',
    week_start: WEEK_START,
    muscle_key: 'legs',
    target_sets: 12,
    reason: 'обоснование',
    previous_target_sets: 11,
    action: 'add',
    block_goal_id: null,
    actual_sets: null,
    verdict: null,
    reviewed_at: null,
    ...overrides,
  }
}

const COACH_STATE = {
  volumeLandmarkOverrides: { legs: LANDMARKS, back: LANDMARKS, chest: LANDMARKS, shoulders: LANDMARKS, arms: LANDMARKS, core: LANDMARKS },
  volumeSnapshots: { legs: { e1rmTrend: 'up' } },
}

describe('syncWeeklyVolumeTargets', () => {
  const now = new Date('2026-07-22T12:00:00.000Z') // среда недели WEEK_START

  it('ставит цели текущей неделе, если их ещё нет', async () => {
    const { client, queries } = mockClient([
      { match: 'insert into public.weekly_volume_targets', rows: [] },
    ])
    const result = await syncWeeklyVolumeTargets(client, 'u1', {
      history: [session('2026-07-15', [exercise('Ноги', 5)])],
      coachState: COACH_STATE,
      blockGoalId: 'block-1',
      now,
    })

    expect(result.weekStart).toBe(WEEK_START)
    const inserts = queries.filter((q) => q.text.includes('insert into public.weekly_volume_targets'))
    expect(inserts).toHaveLength(6) // шесть канонических групп
    // Недельная цель ставится как способ достичь цели блока (#174).
    expect(inserts[0].params.at(-1)).toBe('block-1')
  })

  it('готовые цели не переписывает и возвращает остаток недели', async () => {
    const { client, queries } = mockClient([
      { match: 'week_start = $2', rows: [targetRow()] },
    ])
    const result = await syncWeeklyVolumeTargets(client, 'u1', {
      history: [session('2026-07-21', [exercise('Ноги', 4)])],
      coachState: COACH_STATE,
      now,
    })

    expect(queries.some((q) => q.text.includes('insert into'))).toBe(false)
    expect(result.status.legs).toMatchObject({ targetSets: 12, actualSets: 4, remainingSets: 8 })
  })

  it('закрывает прошлую неделю сверкой факта с целью', async () => {
    const { client, queries } = mockClient([
      { match: 'reviewed_at is null', rows: [targetRow({ week_start: '2026-07-13', target_sets: 12 })] },
    ])
    const result = await syncWeeklyVolumeTargets(client, 'u1', {
      history: [session('2026-07-14', [exercise('Ноги', 4)])],
      coachState: COACH_STATE,
      now,
    })

    expect(result.reviewed).toHaveLength(1)
    expect(result.reviewed[0]).toMatchObject({ weekStart: '2026-07-13', muscleKey: 'legs', verdict: 'undershoot' })
    const review = queries.find((q) => q.text.includes('set actual_sets'))
    expect(review.params[2]).toBe(4)
    expect(review.params[3]).toBe('undershoot')
  })
})
