/**
 * Adaptive Volume Landmark Calibration
 *
 * Phase 3 plan item 2.4: 'Автокоррекция ландмарок по фактическим данным'.
 *
 * Initial MEV/MAV/MRV values come from sports science literature and are
 * population averages. After 8-12 weeks of use the system has enough data
 * to identify individual optima. This module computes per-user adjustments
 * based on observed e1RM trends and current volume position.
 *
 * Adjustment rules (apply at most one per muscle group per call):
 *
 *  1. MRV increase: user spent 4+ weeks at/above MRV AND e1RM trend is 'up'
 *     → MRV += 1 (the user is recovering better than population average).
 *
 *  2. MRV decrease: user spent 3+ weeks at/above MRV AND e1RM trend is
 *     'down' or 'flat' → MRV -= 1 (overtraining, lower the ceiling).
 *
 *  3. MEV decrease: user spent 4+ weeks below MEV AND e1RM trend is 'up'
 *     → MEV -= 1 (the user adapts on lower volume than average).
 *
 * Constraints:
 *   - At most 1 set adjustment per muscle per call (no jumps).
 *   - Minimum 2 weeks between adjustments (caller tracks last adjustment).
 *   - MRV cannot drop below MEV + 2.
 *   - MEV cannot drop below 2.
 *   - All adjustments are logged with timestamp + reason for manual review.
 */

import { CANONICAL_MUSCLE_KEYS } from './lib/muscleGroups.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'

/**
 * @typedef {Object} MuscleVolumeSnapshot
 * @property {number} weeklySets              — current 7-day set count
 * @property {number} weeksAtOrAboveMrv       — consecutive weeks at/above MRV
 * @property {number} weeksBelowMev           — consecutive weeks below MEV
 * @property {('up'|'down'|'flat'|'insufficient_data')} e1rmTrend
 * @property {string|null} lastAdjustmentIso  — ISO date of last adj, or null
 */

/**
 * @typedef {Object} AdjustmentDecision
 * @property {string} muscleKey
 * @property {'increase_mrv'|'decrease_mrv'|'decrease_mev'|'hold'} action
 * @property {number} delta                   — signed change in sets (0 for hold)
 * @property {string} reason                  — Russian explanation
 * @property {number} newMrv                  — proposed MRV (unchanged for hold)
 * @property {number} newMev                  — proposed MEV (unchanged for hold)
 */

const TWO_WEEKS_MS = 14 * 86_400_000

/**
 * Compute a single muscle group's adjustment.
 *
 * @param {string} muscleKey
 * @param {MuscleVolumeSnapshot} snapshot
 * @param {string} phase
 * @param {Date} now
 * @returns {AdjustmentDecision}
 */
export function computeMuscleAdjustment(muscleKey: any, snapshot, phase = 'adult', now = new Date()) {
  const landmarks = getVolumeLandmarks(muscleKey, phase)
  const result = {
    muscleKey,
    action: 'hold',
    delta: 0,
    reason: 'Нет сигнала к коррекции.',
    newMrv: landmarks?.mrv ?? 0,
    newMev: landmarks?.mev ?? 0,
  }

  if (!landmarks) return result

  // Cooldown: at least 2 weeks since last adjustment.
  if (snapshot.lastAdjustmentIso) {
    const last = new Date(snapshot.lastAdjustmentIso).getTime()
    if (Number.isFinite(last) && now.getTime() - last < TWO_WEEKS_MS) {
      return result
    }
  }

  // Rule 1: MRV increase — recovering well above MRV and still progressing.
  if (snapshot.weeksAtOrAboveMrv >= 4 && snapshot.e1rmTrend === 'up') {
    return {
      muscleKey,
      action: 'increase_mrv',
      delta: +1,
      reason: `${muscleKey}: 4+ недель на MRV с ростом e1RM — повышаем MRV на 1 подход (восстановление лучше среднего).`,
      newMrv: landmarks.mrv + 1,
      newMev: landmarks.mev,
    }
  }

  // Rule 2: MRV decrease — at MRV but stagnating or regressing.
  if (snapshot.weeksAtOrAboveMrv >= 3 && (snapshot.e1rmTrend === 'down' || snapshot.e1rmTrend === 'flat')) {
    const newMrv = Math.max(landmarks.mev + 2, landmarks.mrv - 1)
    if (newMrv === landmarks.mrv) {
      return result // already at floor
    }
    return {
      muscleKey,
      action: 'decrease_mrv',
      delta: -1,
      reason: `${muscleKey}: 3+ недель на MRV без роста e1RM (${snapshot.e1rmTrend}) — снижаем MRV на 1 подход (риск перетренированности).`,
      newMrv,
      newMev: landmarks.mev,
    }
  }

  // Rule 3: MEV decrease — adapting on lower volume than average.
  if (snapshot.weeksBelowMev >= 4 && snapshot.e1rmTrend === 'up') {
    const newMev = Math.max(2, landmarks.mev - 1)
    if (newMev === landmarks.mev) {
      return result // already at floor
    }
    return {
      muscleKey,
      action: 'decrease_mev',
      delta: -1,
      reason: `${muscleKey}: 4+ недель ниже MEV с ростом e1RM — снижаем MEV на 1 подход (достаточно меньшего объёма).`,
      newMrv: landmarks.mrv,
      newMev,
    }
  }

  return result
}

/**
 * Compute adjustments for all 6 canonical muscle groups at once.
 *
 * @param {Record<string, MuscleVolumeSnapshot>} snapshots
 * @param {string} phase
 * @param {Date} now
 * @returns {AdjustmentDecision[]}
 */
export function computeAllAdjustments(snapshots: any, phase = 'adult', now = new Date()) {
  return CANONICAL_MUSCLE_KEYS.map((key) =>
    computeMuscleAdjustment(key, snapshots[key] ?? {}, phase, now),
  )
}

/**
 * Apply a list of adjustments to a base landmark table, returning a new
 * per-user landmark override. Adjustments with action 'hold' are ignored.
 *
 * @param {AdjustmentDecision[]} adjustments
 * @param {string} phase
 * @returns {Record<string, { mev: number, mav: number, mrv: number }>}
 */
export function applyAdjustments(adjustments: any, phase = 'adult') {
  const result = {}
  for (const adj of adjustments) {
    const base = getVolumeLandmarks(adj.muscleKey, phase)
    if (!base) continue
    result[adj.muscleKey] = {
      mev: adj.newMev || base.mev,
      mav: base.mav, // MAV is not adjusted in this version
      mrv: adj.newMrv || base.mrv,
    }
  }
  return result
}
