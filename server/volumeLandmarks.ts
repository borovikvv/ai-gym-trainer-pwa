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

import type { AgeRecoveryPhase, MuscleKey, VolumeLandmark, VolumeRecommendation, VolumeStatus } from '../shared/types.js'
import { labelFor } from './lib/muscleGroups.js'

// Base landmarks (adult) — working sets per 7-day rolling window
const BASE_LANDMARKS: Record<Exclude<MuscleKey, 'other'>, VolumeLandmark> = {
  chest:     { mev: 6,  mav: 12, mrv: 16 },
  back:      { mev: 8,  mav: 14, mrv: 18 },
  legs:      { mev: 8,  mav: 16, mrv: 20 },
  shoulders: { mev: 4,  mav: 8,  mrv: 12 },
  arms:      { mev: 4,  mav: 8,  mrv: 12 },
  core:      { mev: 3,  mav: 6,  mrv: 10 },
}

// Phase-specific multipliers applied to MAV and MRV (MEV stays the same)
const PHASE_MULTIPLIERS: Record<AgeRecoveryPhase, { mav: number; mrv: number }> = {
  teen:         { mav: 0.85, mrv: 0.80 },
  adult:        { mav: 1.00, mrv: 1.00 },
  mature_adult: { mav: 0.90, mrv: 0.85 },
}

/**
 * Get volume landmarks for a specific muscle group and age phase.
 * @returns landmarks object, or null if muscleKey is unknown.
 */
export function getVolumeLandmarks(
  muscleKey: string,
  phase: AgeRecoveryPhase = 'adult',
): VolumeLandmark | null {
  const base = BASE_LANDMARKS[muscleKey as Exclude<MuscleKey, 'other'>]
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
 */
export function getAllVolumeLandmarks(
  phase: AgeRecoveryPhase = 'adult',
): Record<string, VolumeLandmark> {
  const result: Record<string, VolumeLandmark> = {}
  for (const key of Object.keys(BASE_LANDMARKS)) {
    const lm = getVolumeLandmarks(key, phase)
    if (lm) result[key] = lm
  }
  return result
}

/**
 * Classify current weekly set count against landmarks.
 */
export function classifyVolumeStatus(
  weeklySets: number,
  landmarks: VolumeLandmark | null,
): VolumeStatus {
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
 * @returns recommendation object, or null if muscleKey is unknown.
 */
export function getVolumeRecommendation(
  muscleKey: string,
  weeklySets: number,
  phase: AgeRecoveryPhase = 'adult',
): VolumeRecommendation | null {
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
        reason: `${label}: объём ${weeklySets} подходов/нед превышает MRV (${mrv}) на ${excess}. Сильный риск перетренированности. Настоятельно рекомендую разгрузочную неделю: сократите объём до MAV (${mav}) или ниже.`,
        priority: 5,
      }
    }
    default:
      return null
  }
}
