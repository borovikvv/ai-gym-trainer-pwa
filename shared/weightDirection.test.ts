import { describe, expect, it } from 'vitest'
import {
  resolveWeightDirection,
  harderWeight,
  easierWeight,
  strongerOf,
  easierOf,
  isWeightlessProgression,
  nextRepRange,
  BODYWEIGHT_REP_CEILING,
  TIMED_SECONDS_CEILING,
} from './weightDirection.js'

// ---------------------------------------------------------------------------
// resolveWeightDirection
// ---------------------------------------------------------------------------

describe('resolveWeightDirection', () => {
  it('берёт направление из поля справочника, даже если название не матчится', () => {
    expect(resolveWeightDirection({ name: 'Подтягивания', weightDirection: 'assistance' })).toBe('assistance')
  })

  it('поле справочника load побеждает assisted-название', () => {
    expect(resolveWeightDirection({ name: 'Подтягивания в гравитроне', weightDirection: 'load' })).toBe('load')
  })

  it('без поля — фолбэк на разбор названия (гравитрон)', () => {
    expect(resolveWeightDirection({ name: 'Подтягивания в гравитроне' })).toBe('assistance')
  })

  it('без поля — фолбэк на разбор названия (assisted)', () => {
    expect(resolveWeightDirection({ name: 'Assisted dips' })).toBe('assistance')
  })

  it('принимает строку-название', () => {
    expect(resolveWeightDirection('Подтягивания в гравитроне')).toBe('assistance')
  })

  it('обычное упражнение — load', () => {
    expect(resolveWeightDirection({ name: 'Жим штанги лёжа' })).toBe('load')
    expect(resolveWeightDirection(null)).toBe('load')
    expect(resolveWeightDirection(undefined)).toBe('load')
  })
})

// ---------------------------------------------------------------------------
// harderWeight / easierWeight
// ---------------------------------------------------------------------------

describe('harderWeight', () => {
  it('load: утяжеление = больше вес', () => {
    expect(harderWeight(60, 2.5, 'load')).toBe(62.5)
  })

  it('assistance: утяжеление = меньше помощи', () => {
    expect(harderWeight(30, 5, 'assistance')).toBe(25)
  })

  it('assistance: помощь не уходит ниже нуля', () => {
    expect(harderWeight(2, 2.5, 'assistance')).toBe(0)
  })
})

describe('easierWeight', () => {
  it('load: облегчение = меньше вес, не ниже нуля', () => {
    expect(easierWeight(60, 2.5, 'load')).toBe(57.5)
    expect(easierWeight(2, 2.5, 'load')).toBe(0)
  })

  it('assistance: облегчение = больше помощи', () => {
    expect(easierWeight(30, 5, 'assistance')).toBe(35)
  })
})

// ---------------------------------------------------------------------------
// strongerOf / easierOf
// ---------------------------------------------------------------------------

describe('strongerOf', () => {
  it('load: сильнее = больше вес', () => {
    expect(strongerOf(60, 47.5, 'load')).toBe(60)
  })

  it('assistance: сильнее = меньше помощи', () => {
    expect(strongerOf(30, 16.5, 'assistance')).toBe(16.5)
  })
})

describe('easierOf', () => {
  it('load: легче = меньше вес', () => {
    expect(easierOf(60, 47.5, 'load')).toBe(47.5)
  })

  it('assistance: легче = больше помощи', () => {
    expect(easierOf(30, 16.5, 'assistance')).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Issue #192: прогрессия, когда веса нет
// ---------------------------------------------------------------------------

describe('isWeightlessProgression', () => {
  it('ни веса, ни шага — двигать нечего', () => {
    expect(isWeightlessProgression(0, 0)).toBe(true)
  })

  it('вес ноль при живом шаге — обычная прогрессия по весу', () => {
    expect(isWeightlessProgression(0, 2.5)).toBe(false)
  })

  it('вес есть — прогрессия про вес', () => {
    expect(isWeightlessProgression(40, 0)).toBe(false)
  })

  it('без шага (дебрифы) считает по одному весу', () => {
    expect(isWeightlessProgression(0)).toBe(true)
    expect(isWeightlessProgression(47.5)).toBe(false)
  })
})

describe('nextRepRange', () => {
  it('повторы растут на один с обеих границ', () => {
    expect(nextRepRange({ repMin: 8, repMax: 15 })).toEqual({ repMin: 9, repMax: 16, atCeiling: false })
  })

  it('у потолка диапазон не двигается и просит вариант посложнее', () => {
    expect(nextRepRange({ repMin: 18, repMax: BODYWEIGHT_REP_CEILING })).toEqual({
      repMin: 18,
      repMax: BODYWEIGHT_REP_CEILING,
      atCeiling: true,
    })
  })

  it('верхняя граница не перескакивает потолок', () => {
    expect(nextRepRange({ repMin: 18, repMax: BODYWEIGHT_REP_CEILING - 1 }).repMax).toBe(BODYWEIGHT_REP_CEILING)
  })

  it('на время шаг пять секунд и свой потолок', () => {
    expect(nextRepRange({ repMin: 40, repMax: 60, timed: true })).toEqual({ repMin: 45, repMax: 65, atCeiling: false })
    expect(nextRepRange({ repMin: 60, repMax: TIMED_SECONDS_CEILING, timed: true }).atCeiling).toBe(true)
  })
})
