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
})
