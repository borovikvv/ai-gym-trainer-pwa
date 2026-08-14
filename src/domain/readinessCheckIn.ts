// Issue #98 PR2: types moved to shared/types.ts. This file keeps the
// runtime helpers (defaultReadinessCheckIn, resolveReadinessMode,
// summarizeReadinessCheckIn) and re-exports the types for backward
// compatibility.
export type { CheckInLevel, SorenessLevel, ReadinessCheckIn } from '../../shared/types'
import type { ReadinessCheckIn } from '../../shared/types'
import type { ReadinessMode } from './workoutReadiness'

export const defaultReadinessCheckIn: ReadinessCheckIn = {
  sleepQuality: 3,
  energy: 3,
  stress: 3,
  soreness: 'light',
  soreMuscleGroups: [],
  painAreas: [],
  availableMinutes: 60,
  notes: '',
}

export function resolveReadinessMode(checkIn: ReadinessCheckIn): ReadinessMode {
  if (checkIn.painAreas.length > 0 || checkIn.soreness === 'high') {
    return 'very_light'
  }

  if (checkIn.availableMinutes > 0 && checkIn.availableMinutes < 35) {
    return 'very_light'
  }

  if (
    (checkIn.sleepQuality <= 2 && checkIn.energy <= 2) ||
    checkIn.stress >= 5 ||
    checkIn.soreness === 'medium'
  ) {
    return 'light'
  }

  if (
    checkIn.sleepQuality >= 4 &&
    checkIn.energy >= 4 &&
    checkIn.stress <= 2
  ) {
    return 'heavy'
  }

  return 'normal'
}

export function summarizeReadinessCheckIn(checkIn: ReadinessCheckIn): string {
  const parts: string[] = []

  if (checkIn.sleepQuality <= 2) {
    parts.push('Мало спал')
  }

  if (checkIn.energy <= 2) {
    parts.push('мало энергии')
  }

  if (checkIn.stress >= 4) {
    parts.push('высокий стресс')
  }

  if (checkIn.soreness === 'medium' || checkIn.soreness === 'high') {
    const groups = checkIn.soreMuscleGroups?.length ? `: ${checkIn.soreMuscleGroups.join(', ')}` : ''
    parts.push(`забиты мышцы${groups}`)
  }

  if (checkIn.painAreas.length > 0) {
    parts.push(`Есть боль: ${checkIn.painAreas.join(', ')}`)
  }

  if (checkIn.availableMinutes > 0 && checkIn.availableMinutes < 45) {
    parts.push(`времени ${checkIn.availableMinutes} мин`)
  }

  const mode = resolveReadinessMode(checkIn)
  const intro = parts.length > 0 ? `${parts.join(', ')}.` : 'Готовность ровная.'

  if (mode === 'heavy') {
    return `${intro} Можно работать тяжелее, но технику не ломаем.`
  }

  if (mode === 'normal') {
    return `${intro} Работаем по плану.`
  }

  if (checkIn.painAreas.length > 0) {
    return `${intro} Уберём рискованные движения и оставим безопасную работу.`
  }

  return `${intro} Снизим объём и оставим главное.`
}
