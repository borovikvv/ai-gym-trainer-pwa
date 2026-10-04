import { describe, expect, it } from 'vitest'
import { buildBlockSummary } from './blockSummary.js'

// Правило тестов: фиксированные смещения от старта блока, без new Date() в логике.

const BLOCK_START = '2026-07-06'
const NOW = new Date('2026-07-27T10:00:00.000Z') // ровно 3 недели после старта

function point(date, e1rm) {
  return { date: `${date}T10:00:00.000Z`, e1rm }
}

function mesocycle(overrides = {}) {
  return {
    cycleStartedOn: BLOCK_START,
    cycleLength: 5,
    loadingWeeks: 4,
    isDeload: true,
    workoutsThisCycle: 5,
    plannedWorkoutsThisCycle: 8,
    ...overrides,
  }
}

function goal(overrides = {}) {
  return {
    blockStartedOn: BLOCK_START,
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    title: 'Жим лёжа: e1RM 60 → 63 кг за 4 нед',
    baselineValue: 60,
    targetValue: 63,
    expectedRatePerWeek: 0.35,
    regainToValue: null,
    horizonWeeks: 4,
    failureDropValue: 57,
    failurePainSessions: 2,
    diagnosisNote: null,
    ...overrides,
  }
}

// Жим вырос (60 → 64), присед и тяга стоят, «ушедшее» в блоке не делали.
const HISTORIES = [
  {
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    currentBest: 64,
    dataPoints: [point('2026-06-30', 60), point('2026-07-08', 62), point('2026-07-15', 64)],
  },
  {
    exerciseId: 'squat',
    exerciseName: 'Присед',
    currentBest: 80,
    dataPoints: [point('2026-06-30', 80), point('2026-07-08', 79)],
  },
  {
    exerciseId: 'rows',
    exerciseName: 'Тяга',
    currentBest: 40,
    dataPoints: [point('2026-06-30', 40), point('2026-07-08', 38)],
  },
  {
    exerciseId: 'gone',
    exerciseName: 'Ушедшее',
    currentBest: 50,
    dataPoints: [point('2026-06-30', 50)],
  },
]

function build(overrides = {}) {
  return buildBlockSummary({
    goal: goal(),
    mesocycle: mesocycle(),
    e1rmHistories: HISTORIES,
    history: [],
    profile: { level: 'intermediate', age: 43 },
    now: NOW,
    ...overrides,
  })
}

describe('buildBlockSummary (#350)', () => {
  it('прирост e1RM: 60 → 64 даёт delta 4, стоящий присед в «Выросло» не попадает', () => {
    const summary = build()
    expect(summary.gains).toHaveLength(1)
    expect(summary.gains[0]).toMatchObject({ exerciseId: 'bench-press', baseline: 60, actual: 64, delta: 4 })
  })

  it('застой: присед без нового максимума через 3 недели — stalled; не делавшееся упражнение не застой', () => {
    const summary = build()
    const squat = summary.stalled.find((item) => item.exerciseId === 'squat')
    expect(squat).toBeDefined()
    expect(squat.weeks).toBeGreaterThanOrEqual(2)
    expect(summary.stalled.some((item) => item.exerciseId === 'gone')).toBe(false)
  })

  it('причина застоя есть только у упражнения цели блока', () => {
    const note = 'недостаточный стимул: прироста нет — добавить объём.'
    const summary = build({ goal: goal({ exerciseId: 'squat', diagnosisNote: note }) })
    expect(summary.stalled.find((item) => item.exerciseId === 'squat').diagnosisNote).toBe(note)
    expect(summary.stalled.find((item) => item.exerciseId === 'rows').diagnosisNote).toBeNull()
  })

  it('цель блока: факт выше цели — achieved, ниже — missed', () => {
    expect(build().goal.status).toBe('achieved')
    expect(build({ goal: goal({ targetValue: 66 }) }).goal.status).toBe('missed')
  })

  it('соблюдение плана: 5 из 8 даёт 3 пропуска', () => {
    expect(build().adherence).toEqual({ done: 5, planned: 8, skipped: 3 })
  })

  it('план следующего блока: база — лучший e1RM блока, why зависит от статуса', () => {
    const achieved = build()
    const missed = build({ goal: goal({ targetValue: 66 }) })
    expect(achieved.next.goalTitle).toContain('64')
    expect(achieved.next.why).toContain('взята')
    expect(achieved.next.why).not.toContain('не взята')
    expect(missed.next.why).toContain('не взята')
  })

  it('без разгрузки, без мезоцикла или без цели итога нет', () => {
    expect(build({ mesocycle: mesocycle({ isDeload: false }) })).toBeNull()
    expect(build({ mesocycle: null })).toBeNull()
    expect(build({ goal: null })).toBeNull()
  })
})
