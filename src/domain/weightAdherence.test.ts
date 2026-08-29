import { describe, expect, it } from 'vitest'
import { computeSessionWeightDeviation } from './weightAdherence'

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