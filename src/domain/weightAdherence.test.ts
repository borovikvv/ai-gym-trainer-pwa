import { describe, expect, it } from 'vitest'
import { computeSessionWeightDeviation, pickWeightDeviationQuestionTarget, type WeightDeviationQuestionInput } from './weightAdherence'

function bench(sets: Array<{ weight: number; reps: number; completed?: boolean }>, assignedWeight?: number | null) {
  return { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', assignedWeight, sets }
}

describe('computeSessionWeightDeviation', () => {
  it('назначено 20, выполнено 35 → расхождение +15', () => {
    const entry = { exercises: [bench([{ weight: 35, reps: 5, completed: true }], 20)] }
    const result = computeSessionWeightDeviation(entry)

    expect(result.exercises[0].sets[0].deviation).toBe(15)
    expect(result.exercises[0].sets[0].actualWeight).toBe(35)
    expect(result.exercises[0].sets[0].assignedWeight).toBe(20)
    expect(result.avgDeviation).toBe(15)
    expect(result.setsWithAssignment).toBe(1)
    expect(result.setsWithoutAssignment).toBe(0)
  })

  it('назначено = выполнено → расхождение 0', () => {
    const entry = { exercises: [bench([{ weight: 60, reps: 5, completed: true }], 60)] }
    const result = computeSessionWeightDeviation(entry)

    expect(result.exercises[0].sets[0].deviation).toBe(0)
    expect(result.avgDeviation).toBe(0)
  })

  it('нет назначения → null, а не 0', () => {
    const entry = { exercises: [bench([{ weight: 60, reps: 5, completed: true }])] }
    const result = computeSessionWeightDeviation(entry)

    expect(result.exercises[0].sets[0].assignedWeight).toBeNull()
    expect(result.exercises[0].sets[0].deviation).toBeNull()
    expect(result.avgDeviation).toBeNull()
    expect(result.setsWithAssignment).toBe(0)
    expect(result.setsWithoutAssignment).toBe(1)
  })
})

describe('computeSessionWeightDeviation — исход по повторам (#413)', () => {
  function benchWithPlanned(reps: number, planned?: { repMin?: number; repMax?: number } | null) {
    return {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      assignedWeight: 60,
      planned,
      sets: [{ weight: 60, reps, completed: true }],
    }
  }

  it('ниже минимума → below_min', () => {
    const result = computeSessionWeightDeviation({ exercises: [benchWithPlanned(5, { repMin: 6, repMax: 8 })] })
    expect(result.exercises[0].sets[0].repOutcome).toBe('below_min')
    expect(result.exercises[0].sets[0].reps).toBe(5)
  })

  it('в диапазоне → in_range', () => {
    const result = computeSessionWeightDeviation({ exercises: [benchWithPlanned(7, { repMin: 6, repMax: 8 })] })
    expect(result.exercises[0].sets[0].repOutcome).toBe('in_range')
  })

  it('на потолке и выше → at_ceiling', () => {
    const atMax = computeSessionWeightDeviation({ exercises: [benchWithPlanned(8, { repMin: 6, repMax: 8 })] })
    expect(atMax.exercises[0].sets[0].repOutcome).toBe('at_ceiling')
    const aboveMax = computeSessionWeightDeviation({ exercises: [benchWithPlanned(12, { repMin: 6, repMax: 8 })] })
    expect(aboveMax.exercises[0].sets[0].repOutcome).toBe('at_ceiling')
  })

  it('диапазон плана не задан → null, а не «в норме»', () => {
    const result = computeSessionWeightDeviation({ exercises: [benchWithPlanned(7)] })
    expect(result.exercises[0].sets[0].repOutcome).toBeNull()
    const empty = computeSessionWeightDeviation({ exercises: [benchWithPlanned(7, {})] })
    expect(empty.exercises[0].sets[0].repOutcome).toBeNull()
  })

  it('bodyweight без назначенного веса: отклонение null, а исход по повторам есть', () => {
    const exercise = {
      exerciseId: 'push-up',
      exerciseName: 'Отжимания',
      assignedWeight: null,
      planned: { repMin: 10, repMax: 15 },
      sets: [{ weight: 1, reps: 15, completed: true }],
    }
    const result = computeSessionWeightDeviation({ exercises: [exercise] })
    expect(result.exercises[0].sets[0].deviation).toBeNull()
    expect(result.exercises[0].sets[0].repOutcome).toBe('at_ceiling')
  })
})

describe('computeSessionWeightDeviation — причины облегчения (#413)', () => {
  it('easingReasons берётся из assignedEasingReasons упражнения', () => {
    const entry = {
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        assignedWeight: 60,
        assignedEasingReasons: ['deload', 'low_readiness'],
        sets: [{ weight: 60, reps: 6, completed: true }],
      }],
    }
    const result = computeSessionWeightDeviation(entry)
    expect(result.exercises[0].easingReasons).toEqual(['deload', 'low_readiness'])
  })

  it('причины не заданы → пустой массив, а не undefined', () => {
    const entry = { exercises: [bench([{ weight: 60, reps: 6, completed: true }], 60)] }
    const result = computeSessionWeightDeviation(entry)
    expect(result.exercises[0].easingReasons).toEqual([])
  })
})

// Issue #419: выбор единственного повода для вопроса на экране итогов.
describe('pickWeightDeviationQuestionTarget (#419)', () => {
  function exercise(overrides: Partial<WeightDeviationQuestionInput> = {}): WeightDeviationQuestionInput {
    return {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      targetWeight: 77.5,
      weightStep: 2.5,
      sets: [{ weight: 80, reps: 6, completed: true }],
      ...overrides,
    }
  }

  it('отклонение ровно на шаг веса → цель с этим отклонением', () => {
    const target = pickWeightDeviationQuestionTarget([exercise()])

    expect(target).not.toBeNull()
    expect(target?.exerciseId).toBe('bench-press')
    expect(target?.targetWeight).toBe(77.5)
    expect(target?.actualWeight).toBe(80)
    expect(target?.deviation).toBe(2.5)
    expect(target?.heavier).toBe(true)
  })

  it('отклонение меньше шага веса → null (не спрашиваем из-за округления)', () => {
    const target = pickWeightDeviationQuestionTarget([
      exercise({ targetWeight: 77.5, weightStep: 2.5, sets: [{ weight: 78.5, reps: 6, completed: true }] }),
    ])

    expect(target).toBeNull()
  })

  it('несколько упражнений выше порога → берётся максимальное по модулю отклонение', () => {
    const target = pickWeightDeviationQuestionTarget([
      exercise({ exerciseId: 'squat', exerciseName: 'Присед', targetWeight: 80, sets: [{ weight: 85, reps: 6, completed: true }] }),
      exercise({ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', targetWeight: 60, sets: [{ weight: 70, reps: 6, completed: true }] }),
    ])

    expect(target?.exerciseId).toBe('bench-press')
    expect(target?.deviation).toBe(10)
  })

  it('targetWeight <= 0 (вес тела/на время) пропускается, даже если факт большой', () => {
    const target = pickWeightDeviationQuestionTarget([
      exercise({ exerciseId: 'push-up', exerciseName: 'Отжимания', targetWeight: 0, weightStep: 0, sets: [{ weight: 50, reps: 15, completed: true }] }),
    ])

    expect(target).toBeNull()
  })
})