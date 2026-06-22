/**
 * Volume Landmarks — MEV / MAV / MRV per muscle group (working sets per 7 days).
 *
 * MEV = Minimum Effective Volume — below this, no adaptation stimulus
 * MAV = Maximum Adaptive Volume — optimal range for growth
 * MRV = Maximum Recoverable Volume — above this, recovery risk
 *
 * Differentiated by ageRecoveryProfile.phase:
 *   - teen: lower MRV (developing recovery), but same MEV
 *   - adult: standard values
 *   - mature_adult: lower MRV, slightly lower MAV (slower recovery)
 */

import { labelFor } from './lib/muscleGroups.js'

// Base landmarks (adult) — working sets per 7-day rolling window
const BASE_LANDMARKS = {
  chest:    { mev: 6,  mav: 12, mrv: 16 },
  back:     { mev: 8,  mav: 14, mrv: 18 },
  legs:     { mev: 8,  mav: 16, mrv: 20 },
  shoulders: { mev: 4,  mav: 8,  mrv: 12 },
  arms:     { mev: 4,  mav: 8,  mrv: 12 },
  core:     { mev: 3,  mav: 6,  mrv: 10 },
}

// Phase-specific multipliers applied to MAV and MRV (MEV stays the same)
const PHASE_MULTIPLIERS = {
  teen:         { mav: 0.85, mrv: 0.80 },
  adult:        { mav: 1.00, mrv: 1.00 },
  mature_adult: { mav: 0.90, mrv: 0.85 },
}

/**
 * Get volume landmarks for a specific muscle group and age phase.
 * @param {string} muscleKey - canonical muscle key (chest, back, legs, etc.)
 * @param {string} phase - ageRecoveryProfile phase: 'teen' | 'adult' | 'mature_adult'
 * @returns {{ mev: number, mav: number, mrv: number } | null}
 */
export function getVolumeLandmarks(muscleKey, phase = 'adult') {
  const base = BASE_LANDMARKS[muscleKey]
  if (!base) return null

  const mult = PHASE_MULTIPLIERS[phase] ?? PHASE_MULTIPLIERS.adult

  return {
    mev: base.mev,
    mav: Math.round(base.mav * mult.mav),
    mrv: Math.round(base.mrv * mult.mrv),
  }
}

/**
 * Get all volume landmarks for a given phase.
 * @param {string} phase
 * @returns {Record<string, { mev: number, mav: number, mrv: number }>}
 */
export function getAllVolumeLandmarks(phase = 'adult') {
  const result = {}
  for (const key of Object.keys(BASE_LANDMARKS)) {
    result[key] = getVolumeLandmarks(key, phase)
  }
  return result
}

/**
 * Classify current weekly set count against landmarks.
 * Returns 'below_mev' | 'in_mev_mav' | 'above_mav' | 'at_mrv' | 'above_mrv'
 * @param {number} weeklySets - working sets for this muscle group in last 7 days
 * @param {{ mev: number, mav: number, mrv: number }} landmarks
 * @returns {string}
 */
export function classifyVolumeStatus(weeklySets, landmarks) {
  if (!landmarks) return 'below_mev'

  const { mev, mav, mrv } = landmarks

  if (weeklySets < mev) return 'below_mev'
  if (weeklySets < mav) return 'in_mev_mav'
  if (weeklySets < mrv) return 'above_mav'
  if (weeklySets < mrv + 2) return 'at_mrv'
  return 'above_mrv'
}

/**
 * Get a volume adjustment recommendation based on current status.
 * Returns an object with suggested sets delta and reason string.
 * @param {string} muscleKey
 * @param {number} weeklySets
 * @param {string} phase
 * @returns {{ action: string, reason: string, priority: number } | null}
 */
export function getVolumeRecommendation(muscleKey, weeklySets, phase = 'adult') {
  const landmarks = getVolumeLandmarks(muscleKey, phase)
  if (!landmarks) return null

  const label = labelFor(muscleKey)
  const status = classifyVolumeStatus(weeklySets, landmarks)
  const { mev, mav, mrv } = landmarks

  switch (status) {
    case 'below_mev': {
      const deficit = mev - weeklySets
      return {
        action: 'increase',
        reason: `${label}: текущий объём ${weeklySets} подходов/нед — ниже MEV (${mev}). Добавьте ещё ~${deficit} рабочих подходов для создания адаптационного стимула.`,
        priority: 4,
      }
    }
    case 'in_mev_mav': {
      return {
        action: 'hold',
        reason: `${label}: объём ${weeklySets} подходов/нед в оптимальном диапазоне MEV–MAV (${mev}–${mav}). Держите текущий объём.`,
        priority: 1,
      }
    }
    case 'above_mav': {
      const headroom = mrv - weeklySets
      return {
        action: 'caution',
        reason: `${label}: объём ${weeklySets} подходов/нед выше MAV (${mav}), но ниже MRV (${mrv}). Остаток до MRV: ${headroom}. Будьте осторожны — приближаетесь к верхней границе восстанавливаемого объёма.`,
        priority: 2,
      }
    }
    case 'at_mrv': {
      return {
        action: 'reduce_or_deload',
        reason: `${label}: объём ${weeklySets} подходов/нед на уровне MRV (${mrv}) или выше. Высокая стоимость восстановления. Рекомендую разгрузку или сокращение рабочих подходов в следующей неделе.`,
        priority: 3,
      }
    }
    case 'above_mrv': {
      const excess = weeklySets - mrv
      return {
        action: 'deload',
        reason: `${label}: объём ${weeklySets} подходов/нед превышает MRV (${mrv}) на ${excess}. Сильный риск перетренированности. Настоятельно рекомендую разгрузочную неделю: сократите объём до MAВ (${mav}) или ниже.`,
        priority: 5,
      }
    }
    default:
      return null
  }
}