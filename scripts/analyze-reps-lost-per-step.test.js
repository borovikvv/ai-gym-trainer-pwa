import { describe, expect, it } from 'vitest'
import {
  MIN_HELDOUT_POINTS,
  hasEnoughHeldoutPoints,
  meanAbsoluteError,
} from './analyze-reps-lost-per-step.ts'

describe('meanAbsoluteError', () => {
  it('считает среднюю абсолютную ошибку по парам', () => {
    expect(meanAbsoluteError([{ predicted: 10, actual: 9 }, { predicted: 8, actual: 8 }])).toBeCloseTo(0.5)
  })

  it('знак разницы не важен — берётся модуль', () => {
    expect(meanAbsoluteError([{ predicted: 8, actual: 10 }])).toBe(2)
  })

  it('пустой массив — null, а не NaN', () => {
    expect(meanAbsoluteError([])).toBeNull()
  })
})

describe('hasEnoughHeldoutPoints', () => {
  it('ровно на пороге — достаточно', () => {
    expect(hasEnoughHeldoutPoints(MIN_HELDOUT_POINTS)).toBe(true)
  })

  it('меньше порога — недостаточно', () => {
    expect(hasEnoughHeldoutPoints(MIN_HELDOUT_POINTS - 1)).toBe(false)
  })
})
