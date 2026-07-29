import { describe, expect, it } from 'vitest'
import {
  MIN_SESSIONS_FOR_EXPECTATION,
  buildRepExpectation,
  computeSessionRepDeviation,
} from './repExpectation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function set(weight: number, reps: number, completed = true) {
  return { weight, reps, rpe: 7, completed }
}

function bench(sets: Array<{ weight: number; reps: number; completed?: boolean }>) {
  return { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', sets }
}

function session(date: string, exercises: ReturnType<typeof bench>[]) {
  return { completedAt: `${date}T10:00:00.000Z`, exercises }
}

/** Три сессии на 60 кг: 8/7/6, 8/7/6, 9/8/7 — ряд по каждому подходу растёт. */
const history = [
  session('2026-07-01', [bench([set(60, 8), set(60, 7), set(60, 6)])]),
  session('2026-07-08', [bench([set(60, 8), set(60, 7), set(60, 6)])]),
  session('2026-07-15', [bench([set(60, 9), set(60, 8), set(60, 7)])]),
]

// ---------------------------------------------------------------------------
// Ожидание
// ---------------------------------------------------------------------------

describe('buildRepExpectation', () => {
  it('строит ожидание по истории на том же весе и наклону прогрессии', () => {
    const expectation = buildRepExpectation(history, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    // Ряд 8, 8, 9 → наклон +0.5, отсчёт от последней сессии: 9 + 0.5 → 10 (округление)
    expect(expectation.basis).toBe('history_at_weight')
    expect(expectation.sessionsUsed).toBe(3)
    expect(expectation.slopePerSession).toBe(0.5)
    expect(expectation.expectedReps).toBe(10)
  })

  it('ожидание считается по номеру подхода, а не по среднему упражнения', () => {
    const first = buildRepExpectation(history, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    const third = buildRepExpectation(history, { exerciseId: 'bench-press', weight: 60, setIndex: 3 })
    expect(third.expectedReps).toBeLessThan(first.expectedReps!)
  })

  it('без истории на этом весе ожидания нет — и это помечено явно', () => {
    const expectation = buildRepExpectation(history, { exerciseId: 'bench-press', weight: 70, setIndex: 1 })
    expect(expectation.expectedReps).toBeNull()
    expect(expectation.basis).toBe('insufficient_data')
    expect(expectation.sessionsUsed).toBe(0)
  })

  it('одной сессии на весе не хватает', () => {
    const expectation = buildRepExpectation([history[0]], { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    expect(expectation.sessionsUsed).toBe(1)
    expect(expectation.sessionsUsed).toBeLessThan(MIN_SESSIONS_FOR_EXPECTATION)
    expect(expectation.expectedReps).toBeNull()
  })

  it('подхода, которого раньше не делали, ожидание не получает', () => {
    const expectation = buildRepExpectation(history, { exerciseId: 'bench-press', weight: 60, setIndex: 4 })
    expect(expectation.expectedReps).toBeNull()
  })

  it('наклон ограничен повтором за сессию — скачок не экстраполируется', () => {
    const jump = [
      session('2026-07-01', [bench([set(60, 5)])]),
      session('2026-07-08', [bench([set(60, 12)])]),
    ]
    const expectation = buildRepExpectation(jump, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    expect(expectation.slopePerSession).toBe(1)
    expect(expectation.expectedReps).toBe(13)
  })

  it('падение повторов даёт отрицательный наклон', () => {
    const decline = [
      session('2026-07-01', [bench([set(60, 10)])]),
      session('2026-07-08', [bench([set(60, 9)])]),
      session('2026-07-15', [bench([set(60, 8)])]),
    ]
    const expectation = buildRepExpectation(decline, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    expect(expectation.slopePerSession).toBe(-1)
    expect(expectation.expectedReps).toBe(7)
  })

  it('невыполненные подходы и подходы без веса в историю не идут', () => {
    const noisy = [
      session('2026-07-01', [bench([set(60, 8), set(60, 0, false)])]),
      session('2026-07-08', [bench([set(0, 20), set(60, 8)])]),
    ]
    const expectation = buildRepExpectation(noisy, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    expect(expectation.sessionsUsed).toBe(2)
    expect(expectation.expectedReps).toBe(8)
  })

  it('учитывает только сессии раньше указанной даты', () => {
    const expectation = buildRepExpectation(history, {
      exerciseId: 'bench-press', weight: 60, setIndex: 1, before: '2026-07-08T00:00:00.000Z',
    })
    expect(expectation.sessionsUsed).toBe(1)
    expect(expectation.expectedReps).toBeNull()
  })

  it('упражнение узнаётся по канонической идентичности', () => {
    const withSuffix = history.map((entry) => ({
      ...entry,
      exercises: entry.exercises.map((exercise) => ({ ...exercise, exerciseId: 'bench-press-extra-1750000000000' })),
    }))
    const expectation = buildRepExpectation(withSuffix, { exerciseId: 'bench-press', weight: 60, setIndex: 1 })
    expect(expectation.sessionsUsed).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Отклонение
// ---------------------------------------------------------------------------

describe('computeSessionRepDeviation', () => {
  it('считает отклонение по каждому рабочему подходу', () => {
    const entry = session('2026-07-22', [bench([set(60, 9), set(60, 8), set(60, 6)])])
    const result = computeSessionRepDeviation(entry, history)
    const exercise = result.exercises[0]

    expect(exercise.sets.map((s) => s.expectedReps)).toEqual([10, 9, 8])
    expect(exercise.sets.map((s) => s.deviation)).toEqual([-1, -1, -2])
    expect(exercise.sets.map((s) => s.setIndex)).toEqual([1, 2, 3])
  })

  it('агрегирует по упражнению и по сессии', () => {
    const entry = session('2026-07-22', [bench([set(60, 9), set(60, 9), set(60, 8)])])
    const result = computeSessionRepDeviation(entry, history)

    expect(result.exercises[0].avgDeviation).toBe(-0.3)
    expect(result.avgDeviation).toBe(-0.3)
    expect(result.setsWithExpectation).toBe(3)
    expect(result.setsWithoutExpectation).toBe(0)
  })

  it('подходы без ожидания считаются отдельно и не портят среднее', () => {
    const entry = session('2026-07-22', [bench([set(60, 9), set(70, 5)])])
    const result = computeSessionRepDeviation(entry, history)

    expect(result.setsWithExpectation).toBe(1)
    expect(result.setsWithoutExpectation).toBe(1)
    expect(result.exercises[0].sets[1].deviation).toBeNull()
    expect(result.avgDeviation).toBe(-1)
  })

  it('без истории вся сессия остаётся без ожидания', () => {
    const entry = session('2026-07-22', [bench([set(60, 9), set(60, 8)])])
    const result = computeSessionRepDeviation(entry, [])

    expect(result.avgDeviation).toBeNull()
    expect(result.setsWithExpectation).toBe(0)
    expect(result.setsWithoutExpectation).toBe(2)
  })

  it('текущая сессия не участвует в собственном ожидании', () => {
    const entry = session('2026-07-22', [bench([set(60, 9), set(60, 8), set(60, 7)])])
    const result = computeSessionRepDeviation(entry, [...history, entry])
    expect(result.exercises[0].sets[0].expectedReps).toBe(10)
  })

  it('упражнение без рабочих подходов в отчёт не попадает', () => {
    const entry = session('2026-07-22', [bench([set(60, 0, false)])])
    expect(computeSessionRepDeviation(entry, history).exercises).toHaveLength(0)
  })
})
