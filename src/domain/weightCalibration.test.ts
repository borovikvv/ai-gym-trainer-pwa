import { describe, expect, it } from 'vitest'
import { calibrateWorkingWeight, type CalibrationInput } from './weightCalibration'

const ramp: CalibrationInput = {
  exerciseName: 'Жим лёжа',
  repMin: 8,
  repMax: 12,
  weightStep: 2.5,
  sets: [
    { weight: 50, reps: 12, rpe: 5, completed: true },
    { weight: 60, reps: 11, rpe: 6, completed: true },
    { weight: 70, reps: 10, rpe: 7.5, completed: true },
  ],
}

describe('calibrateWorkingWeight (#349)', () => {
  it('по калибровочному рампу считает рабочий вес через e1RM и округляет вниз до шага', () => {
    const result = calibrateWorkingWeight(ramp)

    // 70 × (1 + 10/40) = 87.5; 87.5 / (1 + 8/40) = 72.916… → floor to 2.5 = 72.5
    expect(result?.recommendedWeight).toBe(72.5)
    expect(result?.type).toBe('calibration')
    expect(result?.reason).toContain('Жим лёжа')
    expect(result?.reason).toContain('калибровка')
  })

  it('из нескольких качественных подходов берёт тот, у которого выше e1RM, а не последний', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      sets: [
        // Выше e1RM (96) стоит первым — код не должен брать последний качественный.
        { weight: 80, reps: 8, rpe: 8, completed: true },
        { weight: 60, reps: 12, rpe: 7, completed: true },
      ],
    })

    // 80 × (1 + 8/40) = 96; 96 / (1 + 8/40) = 80
    expect(result?.recommendedWeight).toBe(80)
    expect(result?.reason).toContain('80 кг × 8')
  })

  it('все подходы на одном весе — это не рам, калибровки нет', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      sets: [
        { weight: 60, reps: 10, rpe: 7.5, completed: true },
        { weight: 60, reps: 10, rpe: 7.5, completed: true },
        { weight: 60, reps: 10, rpe: 7.5, completed: true },
      ],
    })

    expect(result).toBeNull()
  })

  it('ни один подход не попал в RPE 7–8 — калибровки нет', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      sets: [
        { weight: 50, reps: 10, rpe: 5, completed: true },
        { weight: 60, reps: 10, rpe: 6, completed: true },
        { weight: 70, reps: 10, rpe: 9, completed: true },
      ],
    })

    expect(result).toBeNull()
  })

  it('подходы вне целевого диапазона повторов не считаются даже при RPE 7–8', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      sets: [
        { weight: 60, reps: 5, rpe: 7.5, completed: true },
        { weight: 70, reps: 15, rpe: 7.5, completed: true },
      ],
    })

    expect(result).toBeNull()
  })

  it('assisted-направление (гравитрон) всегда даёт null', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      exerciseName: 'Подтягивания в гравитроне',
      sets: [
        { weight: 50, reps: 10, rpe: 7.5, completed: true },
        { weight: 60, reps: 10, rpe: 7.5, completed: true },
      ],
    })

    expect(result).toBeNull()
  })

  it('подходы с нулевым весом (bodyweight) не участвуют — одних их мало для калибровки', () => {
    const result = calibrateWorkingWeight({
      ...ramp,
      sets: [
        { weight: 0, reps: 10, rpe: 7.5, completed: true },
        { weight: 0, reps: 9, rpe: 8, completed: true },
      ],
    })

    expect(result).toBeNull()
  })
})
