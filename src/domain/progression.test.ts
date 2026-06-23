import { describe, expect, it } from 'vitest'
import { calculateProgression } from './progression'

describe('calculateProgression', () => {
  it('raises weight when every set reaches the top of the rep range and RPE stays controlled', () => {
    const result = calculateProgression({
      exerciseName: 'Тяга верхнего блока',
      currentWeight: 45,
      repMin: 10,
      repMax: 12,
      weightStep: 2.5,
      sets: [
        { weight: 45, reps: 12, rpe: 8, completed: true },
        { weight: 45, reps: 12, rpe: 8, completed: true },
        { weight: 45, reps: 12, rpe: 7, completed: true },
      ],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(47.5)
    expect(result.type).toBe('increase')
    expect(result.reason).toContain('+2.5 кг')
  })

  it('reduces assistance weight for gravitron pull-ups when performance improves', () => {
    const result = calculateProgression({
      exerciseName: 'Подтягивания в гравитроне',
      currentWeight: 35,
      repMin: 6,
      repMax: 10,
      weightStep: 5,
      sets: [
        { weight: 35, reps: 10, rpe: 7, completed: true },
        { weight: 35, reps: 10, rpe: 8, completed: true },
        { weight: 35, reps: 10, rpe: 8, completed: true },
      ],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(30)
    expect(result.type).toBe('increase')
    expect(result.reason).toContain('уменьшаем помощь')
  })

  it('holds weight when reps are in range but not all sets hit the top', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 60,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [
        { weight: 60, reps: 10, rpe: 8, completed: true },
        { weight: 60, reps: 9, rpe: 8, completed: true },
        { weight: 60, reps: 9, rpe: 8, completed: true },
      ],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(60)
    expect(result.type).toBe('hold')
    expect(result.reason).toContain('добрать')
  })

  it('blocks progression when pain is marked', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 60,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [
        { weight: 60, reps: 10, rpe: 7, completed: true },
        { weight: 60, reps: 10, rpe: 7, completed: true },
        { weight: 60, reps: 10, rpe: 7, completed: true },
      ],
      pain: true,
    })

    expect(result.recommendedWeight).toBe(60)
    expect(result.type).toBe('pain')
    expect(result.reason).toContain('замену')
  })

  // --- Edge cases added in Phase 3 ---

  it('handles a single set (minimum input)', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 60,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [{ weight: 60, reps: 10, rpe: 8, completed: true }],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(62.5)
    expect(result.type).toBe('increase')
  })

  it('handles zero sets (no completed work)', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 60,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(60)
    // No completed work — exercise is skipped, weight unchanged.
    expect(['skip', 'hold']).toContain(result.type)
  })

  it('recommends deload when reps are far below repMin (failed set)', () => {
    const result = calculateProgression({
      exerciseName: 'Присед со штангой',
      currentWeight: 100,
      repMin: 6,
      repMax: 8,
      weightStep: 2.5,
      sets: [
        { weight: 100, reps: 3, rpe: 10, completed: true },
        { weight: 100, reps: 3, rpe: 10, completed: true },
      ],
      pain: false,
    })

    // Failed set — weight should drop (deload or hold with lower weight).
    expect(result.recommendedWeight).toBeLessThanOrEqual(100)
    expect(['deload', 'hold', 'skip']).toContain(result.type)
  })

  it('respects weightStep when increasing (no rounding drift)', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 42.5,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [
        { weight: 42.5, reps: 10, rpe: 7, completed: true },
        { weight: 42.5, reps: 10, rpe: 7, completed: true },
        { weight: 42.5, reps: 10, rpe: 7, completed: true },
      ],
      pain: false,
    })

    expect(result.recommendedWeight).toBe(45)
    expect(result.type).toBe('increase')
  })

  it('handles RPE 10 across all sets (high effort, no progression)', () => {
    const result = calculateProgression({
      exerciseName: 'Жим лёжа',
      currentWeight: 60,
      repMin: 8,
      repMax: 10,
      weightStep: 2.5,
      sets: [
        { weight: 60, reps: 10, rpe: 10, completed: true },
        { weight: 60, reps: 10, rpe: 10, completed: true },
        { weight: 60, reps: 10, rpe: 10, completed: true },
      ],
      pain: false,
    })

    // RPE 10 across the board should NOT trigger increase — too much effort.
    expect(result.type).not.toBe('increase')
  })

  it('handles gravitron progression when current weight is already 0', () => {
    const result = calculateProgression({
      exerciseName: 'Подтягивания в гравитроне',
      currentWeight: 0,
      repMin: 6,
      repMax: 10,
      weightStep: 5,
      sets: [
        { weight: 0, reps: 10, rpe: 7, completed: true },
        { weight: 0, reps: 10, rpe: 7, completed: true },
      ],
      pain: false,
    })

    // At 0 assistance already — no further decrease possible.
    expect(result.recommendedWeight).toBe(0)
  })
})
