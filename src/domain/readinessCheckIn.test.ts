import { describe, expect, it } from 'vitest'
import { defaultReadinessCheckIn, resolveReadinessMode, summarizeReadinessCheckIn, timeBudgetMinutes } from './readinessCheckIn'

describe('readiness check-in', () => {
  it('keeps a normal plan for balanced inputs', () => {
    expect(resolveReadinessMode(defaultReadinessCheckIn)).toBe('normal')
  })

  it('keeps a normal mode when time is short but recovery is balanced', () => {
    expect(resolveReadinessMode({
      ...defaultReadinessCheckIn,
      availableMinutes: 30,
    })).toBe('normal')
  })

  it('allows a heavy day only when recovery signals are strong', () => {
    expect(resolveReadinessMode({
      ...defaultReadinessCheckIn,
      sleepQuality: 5,
      energy: 5,
      stress: 1,
      soreness: 'none',
    })).toBe('heavy')
  })

  it('switches to light when sleep and energy are low', () => {
    expect(resolveReadinessMode({
      ...defaultReadinessCheckIn,
      sleepQuality: 2,
      energy: 2,
    })).toBe('light')
  })

  it('keeps the global mode unaffected by pain areas alone', () => {
    expect(resolveReadinessMode({
      ...defaultReadinessCheckIn,
      painAreas: ['Плечо'],
    })).toBe('normal')
  })

  it('summarizes the check-in as a trainer note', () => {
    expect(summarizeReadinessCheckIn({
      ...defaultReadinessCheckIn,
      sleepQuality: 2,
      energy: 2,
      stress: 4,
      soreness: 'medium',
      soreMuscleGroups: ['Грудь', 'Плечи'],
      availableMinutes: 35,
    })).toBe('Мало спал, мало энергии, высокий стресс, забиты мышцы: Грудь, Плечи, времени 35 мин. Снизим объём и оставим главное.')
  })

  it('does not turn pain areas into a global safety decision', () => {
    expect(summarizeReadinessCheckIn({
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })).toBe('Есть боль: Спина. Работаем по плану.')
  })

  it('warns when the pain area is not linked to specific exercises', () => {
    expect(summarizeReadinessCheckIn({
      ...defaultReadinessCheckIn,
      painAreas: ['Другое'],
    })).toContain('зона «Другое» не привязана к конкретным упражнениям')
  })

  it('включает бюджет времени только при сокращённом времени (issue #346)', () => {
    expect(timeBudgetMinutes({ ...defaultReadinessCheckIn, availableMinutes: 60 })).toBe(0)
    expect(timeBudgetMinutes({ ...defaultReadinessCheckIn, availableMinutes: 90 })).toBe(0)
    expect(timeBudgetMinutes({ ...defaultReadinessCheckIn, availableMinutes: 35 })).toBe(35)
  })
})
