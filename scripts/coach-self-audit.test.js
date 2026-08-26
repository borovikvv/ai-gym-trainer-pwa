import { describe, expect, it } from 'vitest'
import {
  analyzeSignal,
  degeneracyReasons,
  isDegenerate,
  unobservedBranches,
  VOLUME_ACTIONS,
} from './coach-self-audit.ts'

describe('analyzeSignal', () => {
  it('считает заполненность, distinct, min/max, моду и её долю', () => {
    const stats = analyzeSignal([7, 7, 7, 8, null, null])
    expect(stats).toMatchObject({
      total: 6,
      filled: 4,
      distinct: 2,
      min: 7,
      max: 8,
      mode: 7,
    })
    expect(stats.fillRate).toBeCloseTo(4 / 6)
    expect(stats.modeShare).toBeCloseTo(0.75)
  })

  it('категориальный сигнал (строки) даёт моду и distinct, но не min/max', () => {
    const stats = analyzeSignal(['light', 'light', 'medium', null])
    expect(stats).toMatchObject({ distinct: 2, mode: 'light', min: null, max: null })
    expect(stats.modeShare).toBeCloseTo(2 / 3)
  })

  it('пустая выборка не падает', () => {
    const stats = analyzeSignal([])
    expect(stats).toMatchObject({ total: 0, filled: 0, distinct: 0, min: null, max: null, mode: null, modeShare: 0 })
  })
})

describe('isDegenerate / degeneracyReasons', () => {
  it('мода ≥ 80 % — вырожден', () => {
    const stats = analyzeSignal([7, 7, 7, 7, 8])
    expect(isDegenerate(stats)).toBe(true)
    expect(degeneracyReasons(stats)).toEqual(expect.arrayContaining([expect.stringContaining('мода')]))
  })

  it('различных значений ≤ 2 — вырожден, даже если мода не доминирует', () => {
    const stats = analyzeSignal([7, 8])
    expect(isDegenerate(stats)).toBe(true)
  })

  it('заполненность < 30 % — вырожден', () => {
    const stats = analyzeSignal([5, null, null, null])
    expect(isDegenerate(stats)).toBe(true)
  })

  it('здоровый сигнал не вырожден и причин нет', () => {
    const stats = analyzeSignal([3, 4, 5, 3, 4, 5, 3, 4, 5])
    expect(isDegenerate(stats)).toBe(false)
    expect(degeneracyReasons(stats)).toEqual([])
  })

  it('три причины могут быть одновременно', () => {
    const stats = analyzeSignal([7, 7, 7, 7, null, null, null, null, null, null, null, null, null, null, null, null])
    expect(degeneracyReasons(stats).length).toBe(3)
  })
})

describe('unobservedBranches', () => {
  it('ветки с нулём срабатываний попадают в отчёт', () => {
    const counts = new Map([
      ['add', 10],
      ['hold', 5],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toEqual(['cut'])
  })

  it('все наблюдались — пусто', () => {
    const counts = new Map([
      ['add', 1],
      ['hold', 1],
      ['cut', 1],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toEqual([])
  })

  it('порог 12 недель ловит cut = 0 (#248)', () => {
    const counts = new Map([
      ['add', 20],
      ['hold', 16],
    ])
    expect(unobservedBranches(VOLUME_ACTIONS, counts)).toContain('cut')
  })
})
