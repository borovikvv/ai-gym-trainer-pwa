// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
/**
 * Volume Landmark Overrides — persistence layer
 *
 * Phase 3 issue #6 step 3 of 5: loads and saves per-user adaptive
 * volume landmark adjustments in the volume_landmark_overrides table.
 *
 * The schema (see supabase/2026-06-23_volume_landmark_overrides.sql):
 *   (user_id, muscle_key) → mev_override, mrv_override,
 *                            last_adjustment_iso, last_adjustment_reason
 *
 * This module is the only place that talks to that table — coachState
 * calls loadVolumeLandmarkOverrides() to get current overrides + last
 * adjustment timestamps, then computeAllAdjustments() decides if a new
 * adjustment is warranted, then saveVolumeLandmarkAdjustments() persists
 * any non-hold decisions.
 */

import { CANONICAL_MUSCLE_KEYS } from './lib/muscleGroups.js'

/**
 * Load all volume landmark overrides for a user.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} userId
 * @returns {Promise<Record<string, OverrideRow>>} map muscleKey → row
 */
export async function loadVolumeLandmarkOverrides(client, userId) {
  const result = await client.query(
    `select muscle_key, mev_override, mrv_override,
            last_adjustment_iso,
            last_adjustment_reason
     from public.volume_landmark_overrides
     where user_id = $1`,
    [userId],
  )

  const byMuscle = {}
  for (const row of result.rows ?? []) {
    const iso = row.last_adjustment_iso instanceof Date
      ? row.last_adjustment_iso.toISOString()
      : (row.last_adjustment_iso ?? null)
    byMuscle[row.muscle_key] = {
      muscleKey: row.muscle_key,
      mevOverride: row.mev_override,
      mrvOverride: row.mrv_override,
      lastAdjustmentIso: iso,
      lastAdjustmentReason: row.last_adjustment_reason,
    }
  }
  return byMuscle
}

/**
 * Save (UPSERT) non-hold adjustment decisions for a user.
 *
 * Only decisions with action !== 'hold' are persisted. The 'hold' action
 * means 'no change this cycle' and writing it would overwrite the
 * lastAdjustmentIso with the current timestamp, breaking the 2-week
 * cooldown logic on the next call.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} userId
 * @param {Array<AdjustmentDecision>} adjustments — output of
 *        computeAllAdjustments()
 * @param {Date} now — timestamp to record as last_adjustment_iso
 * @returns {Promise<number>} count of rows actually upserted
 */
export async function saveVolumeLandmarkAdjustments(client, userId, adjustments, now = new Date()) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  let upserted = 0

  for (const adj of adjustments ?? []) {
    if (adj.action === 'hold') continue
    if (!CANONICAL_MUSCLE_KEYS.includes(adj.muscleKey)) continue

    await client.query(
      `insert into public.volume_landmark_overrides
         (user_id, muscle_key, mev_override, mrv_override,
          last_adjustment_iso, last_adjustment_reason, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (user_id, muscle_key) do update set
         mev_override = excluded.mev_override,
         mrv_override = excluded.mrv_override,
         last_adjustment_iso = excluded.last_adjustment_iso,
         last_adjustment_reason = excluded.last_adjustment_reason,
         updated_at = now()`,
      [
        userId,
        adj.muscleKey,
        adj.newMev ?? null,
        adj.newMrv ?? null,
        nowIso,
        adj.reason,
      ],
    )
    upserted++
  }

  return upserted
}

/**
 * Build the 'lastAdjustments' map consumed by buildAllMuscleVolumeSnapshots
 * from a loaded overrides map.
 *
 * @param {Record<string, OverrideRow>} overridesMap
 * @returns {Record<string, string|null>} muscleKey → ISO date or null
 */
export function extractLastAdjustments(overridesMap) {
  const result = {}
  for (const key of CANONICAL_MUSCLE_KEYS) {
    result[key] = overridesMap[key]?.lastAdjustmentIso ?? null
  }
  return result
}

/**
 * Build the effective landmark table for a user by merging base landmarks
 * with overrides. NULL overrides fall back to base values.
 *
 * @param {string} phase — 'teen' | 'adult' | 'mature_adult'
 * @param {Record<string, OverrideRow>} overridesMap
 * @param {function} getVolumeLandmarksFn — getVolumeLandmarks (injected for testability)
 * @returns {Record<string, {mev: number, mav: number, mrv: number}>}
 */
export function mergeLandmarkOverrides(phase, overridesMap, getVolumeLandmarksFn) {
  const result = {}
  for (const key of CANONICAL_MUSCLE_KEYS) {
    const base = getVolumeLandmarksFn(key, phase)
    if (!base) continue
    const override = overridesMap[key]
    result[key] = {
      mev: override?.mevOverride ?? base.mev,
      mav: base.mav, // MAV is not adjusted in this version
      mrv: override?.mrvOverride ?? base.mrv,
    }
  }
  return result
}

/**
 * @typedef {Object} OverrideRow
 * @property {string} muscleKey
 * @property {number|null} mevOverride
 * @property {number|null} mrvOverride
 * @property {string|null} lastAdjustmentIso
 * @property {string|null} lastAdjustmentReason
 */

/**
 * @typedef {Object} AdjustmentDecision
 * @property {string} muscleKey
 * @property {'increase_mrv'|'decrease_mrv'|'decrease_mev'|'hold'} action
 * @property {number} delta
 * @property {string} reason
 * @property {number} newMrv
 * @property {number} newMev
 */
