import { describe, expect, it } from 'vitest'
import { formatDayMonth } from './format'

describe('formatDayMonth', () => {
  it('formats an ISO date-only string as DD.MM', () => {
    expect(formatDayMonth('2026-07-19')).toBe('19.07')
    expect(formatDayMonth('2026-01-05')).toBe('05.01')
  })

  it('formats an ISO datetime string as DD.MM (ignoring time)', () => {
    expect(formatDayMonth('2026-07-19T18:30:00')).toBe('19.07')
  })

  it('does not include the weekday', () => {
    expect(formatDayMonth('2026-07-19')).not.toContain('вс')
    expect(formatDayMonth('2026-07-19')).not.toMatch(/[а-яё]/i)
  })

  it('is timezone-stable: parses the date-only portion directly', () => {
    // Must not shift across timezones — `new Date('2026-07-19')` in UTC-N
    // can land on the previous day. We assert DD stays 19 regardless.
    expect(formatDayMonth('2026-07-19')).toMatch(/^19\.07$/)
  })

  it('falls back to the input on invalid values', () => {
    expect(formatDayMonth('')).toBe('')
    expect(formatDayMonth('not-a-date')).toBe('not-a-date')
  })
})
