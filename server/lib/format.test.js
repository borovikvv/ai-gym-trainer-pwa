import { describe, expect, it } from 'vitest'
import { formatWeight, roundWeight, pluralRu } from './format.js'

// ---------------------------------------------------------------------------
// formatWeight
// ---------------------------------------------------------------------------

describe('formatWeight', () => {
  it('formats integer without decimals', () => {
    expect(formatWeight(40)).toBe('40')
  })

  it('formats decimal with Russian comma (ru-RU locale)', () => {
    expect(formatWeight(40.5)).toBe('40,5')
  })

  it('limits to 1 decimal place (rounds half up)', () => {
    expect(formatWeight(40.55)).toBe('40,6')
    expect(formatWeight(40.44)).toBe('40,4')
  })

  it('handles zero', () => {
    expect(formatWeight(0)).toBe('0')
  })

  it('handles negative weights (unlikely but defensive)', () => {
    expect(formatWeight(-2.5)).toBe('-2,5')
  })

  it('coerces string input via Number()', () => {
    expect(formatWeight('42.5')).toBe('42,5')
  })

  it('coerces null to 0 (Number(null) === 0)', () => {
    expect(formatWeight(null)).toBe('0')
  })

  it('returns localized "не число" for undefined input (Number(undefined) === NaN)', () => {
    // Documenting existing behavior — ru-RU locale spells NaN as "не число"
    // with a non-breaking space (U+00A0) between words. Defensive callers
    // should clamp input before calling formatWeight.
    expect(formatWeight(undefined)).toBe('не\u00a0число')
  })

  it('returns localized "не число" for NaN input', () => {
    expect(formatWeight('not-a-number')).toBe('не\u00a0число')
  })
})

// ---------------------------------------------------------------------------
// roundWeight
// ---------------------------------------------------------------------------

describe('roundWeight', () => {
  it('rounds to 1 decimal place', () => {
    // Note: JS toFixed uses banker's-ish rounding for .5 edge cases
    // (40.55 → "40.5" due to float repr). Use clear-cut values.
    expect(roundWeight(40.46)).toBe(40.5)
    expect(roundWeight(40.44)).toBe(40.4)
    expect(roundWeight(40)).toBe(40)
  })

  it('returns a number type', () => {
    expect(typeof roundWeight(40)).toBe('number')
  })

  it('handles string input', () => {
    expect(roundWeight('42.46')).toBe(42.5)
  })
})

// ---------------------------------------------------------------------------
// pluralRu
// ---------------------------------------------------------------------------

describe('pluralRu', () => {
  const one = 'упражнение'
  const few = 'упражнения'
  const many = 'упражнений'

  it('uses "one" form for 1, 21, 31, 41 (but not 11)', () => {
    expect(pluralRu(1, one, few, many)).toBe(one)
    expect(pluralRu(21, one, few, many)).toBe(one)
    expect(pluralRu(31, one, few, many)).toBe(one)
    expect(pluralRu(101, one, few, many)).toBe(one)
  })

  it('uses "few" form for 2-4, 22-24 (but not 12-14)', () => {
    expect(pluralRu(2, one, few, many)).toBe(few)
    expect(pluralRu(3, one, few, many)).toBe(few)
    expect(pluralRu(4, one, few, many)).toBe(few)
    expect(pluralRu(22, one, few, many)).toBe(few)
    expect(pluralRu(23, one, few, many)).toBe(few)
    expect(pluralRu(104, one, few, many)).toBe(few)
  })

  it('uses "many" form for 0, 5-20, 25-30', () => {
    expect(pluralRu(0, one, few, many)).toBe(many)
    expect(pluralRu(5, one, few, many)).toBe(many)
    expect(pluralRu(10, one, few, many)).toBe(many)
    expect(pluralRu(15, one, few, many)).toBe(many)
    expect(pluralRu(20, one, few, many)).toBe(many)
    expect(pluralRu(25, one, few, many)).toBe(many)
    expect(pluralRu(100, one, few, many)).toBe(many)
  })

  it('handles 11-14 edge case (always "many")', () => {
    expect(pluralRu(11, one, few, many)).toBe(many)
    expect(pluralRu(12, one, few, many)).toBe(many)
    expect(pluralRu(13, one, few, many)).toBe(many)
    expect(pluralRu(14, one, few, many)).toBe(many)
    expect(pluralRu(111, one, few, many)).toBe(many)
    expect(pluralRu(112, one, few, many)).toBe(many)
  })
})
