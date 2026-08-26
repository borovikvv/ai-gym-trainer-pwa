import { describe, expect, it } from 'vitest'
import {
  analyzeSignal,
  clampedKey,
  degeneracyReasons,
  DEGENERATE_MIN_SAMPLE,
  isDegenerate,
  isUndersampled,
  readClamped,
  totalObservations,
  unobservedBranches,
  VOLUME_ACTIONS,
} from './coach-self-audit.ts'

/** Выборка длины n из повторяющихся значений — чтобы пройти порог DEGENERATE_MIN_SAMPLE. */
function repeat(values, times) {
  return Array.from({ length: times }, (_, index) => values[index % values.length])
}

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
    const stats = analyzeSignal([...repeat([7], 16), 8, 8, 9, 9])
    expect(isDegenerate(stats)).toBe(true)
    expect(degeneracyReasons(stats)).toEqual(expect.arrayContaining([expect.stringContaining('мода')]))
  })

  it('различных значений ≤ 2 — вырожден, даже если мода не доминирует', () => {
    const stats = analyzeSignal(repeat([7, 8], 20))
    expect(isDegenerate(stats)).toBe(true)
  })

  it('заполненность < 30 % — вырожден', () => {
    const stats = analyzeSignal([...repeat([1, 2, 3, 4, 5], 12), ...repeat([null], 40)])
    expect(isDegenerate(stats)).toBe(true)
  })

  it('здоровый сигнал не вырожден и причин нет', () => {
    const stats = analyzeSignal(repeat([3, 4, 5], 18))
    expect(isDegenerate(stats)).toBe(false)
    expect(degeneracyReasons(stats)).toEqual([])
  })

  it('три причины могут быть одновременно', () => {
    const stats = analyzeSignal([...repeat([7], 12), ...repeat([null], 60)])
    expect(degeneracyReasons(stats).length).toBe(3)
  })
})

describe('порог выборки', () => {
  // Без порога окно в 4 недели кричало бы «вырожден» на каждый сигнал: на трёх
  // значениях условие «различных ≤ 2» выполняется почти всегда.
  it('малая выборка не объявляется вырожденной, хотя формально подходит', () => {
    const stats = analyzeSignal([7, 8, 7])
    expect(stats.distinct).toBe(2)
    expect(isUndersampled(stats)).toBe(true)
    expect(isDegenerate(stats)).toBe(false)
  })

  it('ровно на пороге судим как обычно', () => {
    const stats = analyzeSignal(repeat([7, 8], DEGENERATE_MIN_SAMPLE))
    expect(isUndersampled(stats)).toBe(false)
    expect(isDegenerate(stats)).toBe(true)
  })

  it('«мало данных» — это не «сигнал в норме»: пустая выборка не вырождена и не здорова', () => {
    const stats = analyzeSignal([])
    expect(isUndersampled(stats)).toBe(true)
    expect(isDegenerate(stats)).toBe(false)
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
    expect(totalObservations(counts)).toBe(36)
  })

  it('знаменатель для суждения о ветках — сумма, а не число ключей', () => {
    expect(totalObservations(new Map())).toBe(0)
    expect(totalObservations(new Map([['add', 3], ['hold', 2]]))).toBe(5)
  })
})

describe('кламп из payload решения', () => {
  // body в recommendations — колонка text, а не jsonb, поэтому JSON разбирается
  // здесь. Главное — не схлопнуть «не записано» в «клампа не было».
  it('признак есть — читается как есть', () => {
    expect(readClamped(JSON.stringify({ clamped: true }))).toBe(true)
    expect(readClamped(JSON.stringify({ clamped: false }))).toBe(false)
  })

  it('признак вложен в decision', () => {
    expect(readClamped(JSON.stringify({ decision: { clamped: true } }))).toBe(true)
  })

  it('признака нет, payload пуст или битый — null, а не false', () => {
    expect(readClamped(JSON.stringify({ decision: {} }))).toBeNull()
    expect(readClamped(null)).toBeNull()
    expect(readClamped('не json')).toBeNull()
  })

  it('в ключе отчёта три состояния различимы', () => {
    expect(clampedKey('Решение тренера', 'rules', true)).toContain('(кламп)')
    expect(clampedKey('Решение тренера', 'rules', false)).not.toContain('кламп')
    expect(clampedKey('Решение тренера', 'llm', null)).toContain('не записан')
  })
})
