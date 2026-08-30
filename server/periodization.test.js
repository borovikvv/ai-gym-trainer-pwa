import { describe, expect, it } from 'vitest'
import { getPeriodizationAdjustment, applyPeriodization } from './periodization.js'

describe('getPeriodizationAdjustment', () => {
  const step = 2.5

  it('returns zero deltas for idle phase', () => {
    const adj = getPeriodizationAdjustment('idle', step)
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMinDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(0)
    expect(adj.setsCountDelta).toBe(0)
    expect(adj.focusNote).toBe('')
  })

  it('returns zero deltas for deload phase', () => {
    const adj = getPeriodizationAdjustment('deload', step)
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMinDelta).toBe(0)
    expect(adj.focusNote).toBe('')
  })

  it('returns zero deltas for null/undefined', () => {
    expect(getPeriodizationAdjustment(null, step).weightDelta).toBe(0)
    expect(getPeriodizationAdjustment(undefined, step).weightDelta).toBe(0)
  })

  it('loading: no weight change, no rep change, focus on technique', () => {
    const adj = getPeriodizationAdjustment('loading', step)
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMinDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(0)
    expect(adj.intensityShift).toBe('none')
    expect(adj.focusNote).toContain('Загрузка')
  })

  it('accumulation: +1 rep on minimum, same weight', () => {
    const adj = getPeriodizationAdjustment('accumulation', step)
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMinDelta).toBe(1)
    expect(adj.repMaxDelta).toBe(0)
    expect(adj.intensityShift).toBe('none')
    expect(adj.focusNote).toContain('Накопление')
  })

  it('intensification: +1 weightStep, -1 rep on maximum', () => {
    const adj = getPeriodizationAdjustment('intensification', step)
    expect(adj.weightDelta).toBe(step)
    expect(adj.repMinDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(-1)
    expect(adj.intensityShift).toBe('harder')
    expect(adj.focusNote).toContain('Интенсификация')
  })

  it('uses weightStep value for weight delta', () => {
    expect(getPeriodizationAdjustment('intensification', 5).weightDelta).toBe(5)
    expect(getPeriodizationAdjustment('intensification', 1).weightDelta).toBe(1)
  })

  it('falls back to 2.5 for invalid weightStep', () => {
    expect(getPeriodizationAdjustment('intensification', NaN).weightDelta).toBe(2.5)
    expect(getPeriodizationAdjustment('intensification', null).weightDelta).toBe(2.5)
    expect(getPeriodizationAdjustment('intensification', undefined).weightDelta).toBe(2.5)
  })

  // Issue #241: для bodyweight «тяжелее весом» невозможно, поэтому
  // интенсификация выражается ростом повторов, а не их урезанием.
  it('intensification: weightStep 0 (bodyweight) → no weight delta, +2 reps on maximum', () => {
    const adj = getPeriodizationAdjustment('intensification', 0)
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMinDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(2)
    expect(adj.intensityShift).toBe('harder')
  })

  it('intensification: bodyweight focus note never mentions a weight increase', () => {
    const adj = getPeriodizationAdjustment('intensification', 0)
    expect(adj.focusNote).toContain('Интенсификация')
    expect(adj.focusNote).not.toContain('0 кг')
    expect(adj.focusNote).not.toContain('повышаем вес')
  })

  it('intensification: bodyweight rule applies to assistance direction too', () => {
    const adj = getPeriodizationAdjustment('intensification', 0, 'assistance')
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(2)
    expect(adj.focusNote).not.toContain('0 кг')
  })

  it('intensification: weighted exercises keep the -1 rep rule (regression)', () => {
    expect(getPeriodizationAdjustment('intensification', 2.5).repMaxDelta).toBe(-1)
    expect(getPeriodizationAdjustment('intensification', 1).repMaxDelta).toBe(-1)
    // Invalid step falls back to 2.5 → weighted branch, not bodyweight.
    expect(getPeriodizationAdjustment('intensification', null).repMaxDelta).toBe(-1)
    expect(getPeriodizationAdjustment('intensification', NaN).repMaxDelta).toBe(-1)
  })

  // Issue #287: «Отжимания на брусьях» — equipment bodyweight при weight_step 2.5.
  // Признак bodyweight теперь equipment, а не только шаг: вес не прибавляется.
  it('intensification: equipment bodyweight with nonzero step adds no weight (issue #287)', () => {
    const adj = getPeriodizationAdjustment('intensification', 2.5, 'load', 'bodyweight')
    expect(adj.weightDelta).toBe(0)
    expect(adj.repMaxDelta).toBe(2)
    expect(adj.intensityShift).toBe('harder')
  })

  it('intensification: weighted exercise keeps weight increase despite equipment flag (regression, issue #287)', () => {
    const adj = getPeriodizationAdjustment('intensification', 2.5, 'load', 'barbell')
    expect(adj.weightDelta).toBe(2.5)
    expect(adj.repMaxDelta).toBe(-1)
    expect(adj.intensityShift).toBe('harder')
  })
})

describe('applyPeriodization', () => {
  const base = {
    targetWeight: 60,
    repMin: 8,
    repMax: 10,
    setsCount: 3,
    intensityTarget: 'controlled',
    weightStep: 2.5,
  }

  it('returns unchanged values for idle phase', () => {
    const result = applyPeriodization(base, 'idle')
    expect(result.targetWeight).toBe(60)
    expect(result.repMin).toBe(8)
    expect(result.repMax).toBe(10)
    expect(result.setsCount).toBe(3)
    expect(result.periodizationNote).toBe('')
  })

  it('loading: no changes to parameters', () => {
    const result = applyPeriodization(base, 'loading')
    expect(result.targetWeight).toBe(60)
    expect(result.repMin).toBe(8)
    expect(result.repMax).toBe(10)
    expect(result.setsCount).toBe(3)
    expect(result.periodizationNote).toContain('Загрузка')
  })

  it('accumulation: +1 rep on minimum, same weight', () => {
    const result = applyPeriodization(base, 'accumulation')
    expect(result.targetWeight).toBe(60)
    expect(result.repMin).toBe(9)   // 8 + 1
    expect(result.repMax).toBe(10)  // unchanged
    expect(result.setsCount).toBe(3)
    expect(result.periodizationNote).toContain('Накопление')
  })

  it('intensification: +2.5 kg weight, -1 rep on maximum', () => {
    const result = applyPeriodization(base, 'intensification')
    expect(result.targetWeight).toBe(62.5)  // 60 + 2.5
    expect(result.repMin).toBe(8)           // unchanged
    expect(result.repMax).toBe(9)           // 10 - 1
    expect(result.setsCount).toBe(3)
    expect(result.intensityTarget).toBe('controlled')
    expect(result.periodizationNote).toContain('Интенсификация')
  })

  it('intensification: shifts easy → controlled', () => {
    const result = applyPeriodization(
      { ...base, intensityTarget: 'easy' },
      'intensification',
    )
    expect(result.intensityTarget).toBe('controlled')
  })

  it('prevents repMax from going below repMin + 1', () => {
    const result = applyPeriodization(
      { ...base, repMin: 8, repMax: 9, weightStep: 2.5 },
      'intensification',
    )
    // repMax = 9 - 1 = 8, but repMin + 1 = 9 → clamp to 9
    expect(result.repMax).toBe(9)
  })

  it('prevents targetWeight from going negative', () => {
    const result = applyPeriodization(
      { ...base, targetWeight: 0, weightStep: 2.5 },
      'intensification',
    )
    expect(result.targetWeight).toBe(2.5) // 0 + 2.5
  })

  it('intensification: bodyweight (weightStep 0, targetWeight 0) stays at 0 and gains reps', () => {
    const result = applyPeriodization(
      {
        targetWeight: 0,
        repMin: 8,
        repMax: 10,
        setsCount: 3,
        intensityTarget: 'controlled',
        weightStep: 0,
      },
      'intensification',
    )
    expect(result.targetWeight).toBe(0) // no invented +2.5 kg for bodyweight
    expect(result.repMax).toBe(12)      // issue #241: 10 + 2, rep range grows
    expect(result.repMin).toBe(8)       // unchanged
    expect(result.periodizationNote).toContain('Интенсификация')
    expect(result.periodizationNote).not.toContain('0 кг')
  })

  // Issue #241: «Подъём коленей в упоре» — дефолт 8-15, вес собственный.
  // До фикса выдавалось 8-14 и «повышаем вес на 0 кг».
  it('intensification: bodyweight exercise never drops below its library rep range', () => {
    const libraryRepMax = 15
    const result = applyPeriodization(
      {
        targetWeight: 0,
        repMin: 8,
        repMax: libraryRepMax,
        setsCount: 3,
        intensityTarget: 'controlled',
        weightStep: 0,
      },
      'intensification',
    )
    expect(result.repMax).toBeGreaterThanOrEqual(libraryRepMax)
  })

  // Issue #287: bar-dips — equipment bodyweight, но default_weight_step 2.5.
  // Раньше periodization безусловно прибавлял 2.5 кг «из ниоткуда».
  it('intensification: bar-dips (equipment bodyweight, step 2.5) stays at targetWeight 0 (issue #287)', () => {
    const result = applyPeriodization(
      {
        targetWeight: 0,
        repMin: 8,
        repMax: 10,
        setsCount: 3,
        intensityTarget: 'controlled',
        weightStep: 2.5,
        equipment: 'bodyweight',
      },
      'intensification',
    )
    expect(result.targetWeight).toBe(0) // no invented +2.5 kg
    expect(result.repMax).toBe(12)      // +2 reps, progression by volume
    expect(result.repMin).toBe(8)       // unchanged
    expect(result.periodizationNote).toContain('Интенсификация')
    expect(result.periodizationNote).not.toContain('0 кг')
  })

  it('prevents repMin from going below 1', () => {
    const result = applyPeriodization(
      { ...base, repMin: 1, weightStep: 2.5 },
      'accumulation',
    )
    expect(result.repMin).toBe(2) // 1 + 1
  })
})
