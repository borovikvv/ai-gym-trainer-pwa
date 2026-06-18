import { describe, expect, it } from 'vitest'
import { defaultReadinessCheckIn, resolveReadinessMode, summarizeReadinessCheckIn } from './readinessCheckIn'

describe('readiness check-in', () => {
  it('keeps a normal plan for balanced inputs', () => {
    expect(resolveReadinessMode(defaultReadinessCheckIn)).toBe('normal')
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

  it('switches to very light when pain is reported', () => {
    expect(resolveReadinessMode({
      ...defaultReadinessCheckIn,
      painAreas: ['Плечо'],
    })).toBe('very_light')
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

  it('turns pain areas into a stronger safety decision', () => {
    expect(summarizeReadinessCheckIn({
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })).toBe('Есть боль: Спина. Уберём рискованные движения и оставим безопасную работу.')
  })
})
