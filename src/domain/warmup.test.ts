import { describe, expect, it } from 'vitest'
import { WARMUP_WEIGHT_THRESHOLD_KG, buildWarmupSets, needsWarmup } from './warmup'

describe('needsWarmup', () => {
  it('нужна для тяжёлых базовых движений', () => {
    expect(needsWarmup({ name: 'Присед со штангой', muscleGroup: 'Ноги' }, 60)).toBe(true)
    expect(needsWarmup({ name: 'Жим лёжа', muscleGroup: 'Грудь' }, 60)).toBe(true)
    expect(needsWarmup({ name: 'Тяга штанги в наклоне', muscleGroup: 'Спина' }, 60)).toBe(true)
  })

  it('не нужна на весе ниже порога', () => {
    expect(needsWarmup({ name: 'Присед со штангой', muscleGroup: 'Ноги' }, WARMUP_WEIGHT_THRESHOLD_KG - 5)).toBe(false)
  })

  it('не нужна для изоляции на руки', () => {
    expect(needsWarmup({ name: 'Подъём на бицепс', muscleGroup: 'Руки' }, 20)).toBe(false)
  })

  it('не нужна для упражнений с собственным весом', () => {
    expect(needsWarmup({ name: 'Отжимания на брусьях', muscleGroup: 'Грудь', equipment: 'bodyweight' }, 60)).toBe(false)
  })
})

describe('buildWarmupSets', () => {
  it('строит лесенку 40%×8, 60%×5, 80%×3 с округлением по шагу', () => {
    const sets = buildWarmupSets(
      { name: 'Присед со штангой', muscleGroup: 'Ноги', weightStep: 2.5 },
      100,
    )

    expect(sets).toEqual([
      { weight: 40, reps: 8, isWarmup: true },
      { weight: 60, reps: 5, isWarmup: true },
      { weight: 80, reps: 3, isWarmup: true },
    ])
  })

  it('округляет ступени к шагу упражнения', () => {
    const sets = buildWarmupSets(
      { name: 'Присед со штангой', muscleGroup: 'Ноги', weightStep: 5 },
      100,
    )

    expect(sets.map((set) => set.weight)).toEqual([40, 60, 80])
  })

  it('ниже порога разминки нет', () => {
    expect(buildWarmupSets({ name: 'Присед со штангой', muscleGroup: 'Ноги' }, 15)).toEqual([])
  })

  it('для изоляции разминки нет', () => {
    expect(buildWarmupSets({ name: 'Подъём на бицепс', muscleGroup: 'Руки' }, 60)).toEqual([])
  })
})
