import { describe, expect, it } from 'vitest'
import {
  MAX_REPS_LOST_PER_KG,
  estimateRepsLostPerWeightStep,
  predictReps,
} from './repsLostPerWeightStep'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function set(weight: number, reps: number, overrides: Record<string, unknown> = {}) {
  return { weight, reps, ...overrides }
}

function bench(sets: ReturnType<typeof set>[]) {
  return { exerciseId: 'bench-press', sets }
}

function session(date: string, sets: ReturnType<typeof set>[]) {
  return { completedAt: `${date}T10:00:00.000Z`, exercises: [bench(sets)] }
}

/**
 * 12 наблюдений, 4 различных веса, чёткое падение повторов с весом:
 * 50 → 12, 55 → 10, 60 → 8, 65 → 6 (по три сессии на вес).
 * Наклон регрессии ровно −0.4 повтора на кг.
 */
const history = [
  session('2026-07-01', [set(50, 12)]),
  session('2026-07-02', [set(50, 12)]),
  session('2026-07-03', [set(50, 12)]),
  session('2026-07-04', [set(55, 10)]),
  session('2026-07-05', [set(55, 10)]),
  session('2026-07-06', [set(55, 10)]),
  session('2026-07-07', [set(60, 8)]),
  session('2026-07-08', [set(60, 8)]),
  session('2026-07-09', [set(60, 8)]),
  session('2026-07-10', [set(65, 6)]),
  session('2026-07-11', [set(65, 6)]),
  session('2026-07-12', [set(65, 6)]),
]

// ---------------------------------------------------------------------------
// Личная оценка
// ---------------------------------------------------------------------------

describe('estimateRepsLostPerWeightStep', () => {
  it('на чётком падении повторов с весом строит личную оценку', () => {
    const estimate = estimateRepsLostPerWeightStep(history, { exerciseId: 'bench-press', setIndex: 1 })

    expect(estimate.basis).toBe('personal')
    expect(estimate.repsLostPerKg).toBeGreaterThan(0)
    expect(estimate.repsLostPerKg).toBeLessThanOrEqual(MAX_REPS_LOST_PER_KG)
    expect(estimate.distinctWeights).toBe(4)
    expect(estimate.observations).toBe(12)
  })

  it('предсказывает меньше повторов на весе выше центра', () => {
    const estimate = estimateRepsLostPerWeightStep(history, { exerciseId: 'bench-press', setIndex: 1 })
    const heavier = predictReps(estimate, 67.5)

    expect(heavier).not.toBeNull()
    expect(heavier!).toBeLessThan(estimate.anchorReps!)
  })

  it('двух различных весов мало — откат к общей норме', () => {
    const twoWeights = [
      session('2026-07-01', [set(50, 12)]),
      session('2026-07-02', [set(50, 12)]),
      session('2026-07-03', [set(50, 12)]),
      session('2026-07-04', [set(50, 12)]),
      session('2026-07-05', [set(50, 12)]),
      session('2026-07-06', [set(60, 8)]),
      session('2026-07-07', [set(60, 8)]),
      session('2026-07-08', [set(60, 8)]),
      session('2026-07-09', [set(60, 8)]),
      session('2026-07-10', [set(60, 8)]),
    ]
    const estimate = estimateRepsLostPerWeightStep(twoWeights, { exerciseId: 'bench-press', setIndex: 1 })

    expect(estimate.basis).toBe('fallback_general_norm')
    expect(estimate.repsLostPerKg).toBeNull()
    expect(predictReps(estimate, 70)).toBeNull()
  })

  it('десяти наблюдений мало — откат к общей норме', () => {
    const few = [
      session('2026-07-01', [set(50, 12)]),
      session('2026-07-02', [set(50, 12)]),
      session('2026-07-03', [set(55, 10)]),
      session('2026-07-04', [set(55, 10)]),
      session('2026-07-05', [set(60, 8)]),
      session('2026-07-06', [set(60, 8)]),
    ]
    const estimate = estimateRepsLostPerWeightStep(few, { exerciseId: 'bench-press', setIndex: 1 })

    expect(estimate.basis).toBe('fallback_general_norm')
    expect(estimate.repsLostPerKg).toBeNull()
    expect(predictReps(estimate, 60)).toBeNull()
  })

  it('положительный наклон (шум) клампится в ноль, а не в минус', () => {
    const noisy = [
      session('2026-07-01', [set(50, 6)]),
      session('2026-07-02', [set(50, 6)]),
      session('2026-07-03', [set(50, 6)]),
      session('2026-07-04', [set(55, 8)]),
      session('2026-07-05', [set(55, 8)]),
      session('2026-07-06', [set(55, 8)]),
      session('2026-07-07', [set(60, 10)]),
      session('2026-07-08', [set(60, 10)]),
      session('2026-07-09', [set(60, 10)]),
      session('2026-07-10', [set(65, 12)]),
      session('2026-07-11', [set(65, 12)]),
      session('2026-07-12', [set(65, 12)]),
    ]
    const estimate = estimateRepsLostPerWeightStep(noisy, { exerciseId: 'bench-press', setIndex: 1 })

    expect(estimate.basis).toBe('personal')
    expect(estimate.repsLostPerKg).toBe(0)
  })

  it('before отсекает сессии на/после даты, как buildRepExpectation', () => {
    const withFuture = [...history, session('2026-08-01', [set(90, 1)])]

    const all = estimateRepsLostPerWeightStep(withFuture, { exerciseId: 'bench-press', setIndex: 1 })
    expect(all.observations).toBe(13)

    const truncated = estimateRepsLostPerWeightStep(withFuture, {
      exerciseId: 'bench-press',
      setIndex: 1,
      before: '2026-07-06T00:00:00.000Z',
    })
    expect(truncated.observations).toBe(5)
  })
})
