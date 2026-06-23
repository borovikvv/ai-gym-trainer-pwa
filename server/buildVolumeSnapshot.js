/**
 * Volume Landmark Snapshot Builder
 *
 * Phase 3 issue #6 step 2 of 5: builds MuscleVolumeSnapshot objects
 * from workout history, which adaptiveVolumeLandmarks.js consumes to
 * decide whether to adjust MEV/MRV per muscle group.
 *
 * Snapshot fields:
 *   weeklySets          — completed sets for this muscle in last 7 days
 *   weeksAtOrAboveMrv   — consecutive ISO weeks (most-recent-first)
 *                          where weekly sets >= base MRV
 *   weeksBelowMev       — consecutive ISO weeks where weekly sets < MEV
 *   e1rmTrend           — 'up' | 'down' | 'flat' | 'insufficient_data'
 *                          aggregated from all exercises in this muscle
 *                          group (takes the one with most data points)
 *   lastAdjustmentIso   — from overrides table, or null (passed in by
 *                          caller; this module is DB-free)
 */

import { normalizeMuscleGroup, CANONICAL_MUSCLE_KEYS } from './lib/muscleGroups.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'

const MS_PER_DAY = 86_400_000
const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Build a snapshot for a single muscle group from workout history.
 *
 * @param {string} muscleKey
 * @param {Array} history — WorkoutHistoryEntry[] (most recent first or
 *                          unsorted; we sort internally)
 * @param {Array} e1rmHistories — ExerciseE1RMHistory[] for this muscle
 *                                group (precomputed by caller to avoid
 *                                duplicating e1RM logic here)
 * @param {string} phase — 'teen' | 'adult' | 'mature_adult'
 * @param {Date} now
 * @param {string|null} lastAdjustmentIso — from overrides table
 * @returns {object} MuscleVolumeSnapshot
 */
export function buildMuscleVolumeSnapshot(muscleKey, history, e1rmHistories, phase = 'adult', now = new Date(), lastAdjustmentIso = null) {
  const landmarks = getVolumeLandmarks(muscleKey, phase)

  // --- weeklySets: count completed sets in last 7 days ---
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const sevenDaysAgoMs = nowMs - MS_PER_WEEK
  let weeklySets = 0
  for (const session of history ?? []) {
    const sessionMs = new Date(session.completedAt).getTime()
    if (!Number.isFinite(sessionMs) || sessionMs < sevenDaysAgoMs) continue
    for (const exercise of session.exercises ?? []) {
      const emk = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
      if (emk === muscleKey) {
        weeklySets += (exercise.sets ?? []).filter((s) => s?.completed !== false && Number(s?.reps) > 0).length
      }
    }
  }

  // --- weeksAtOrAboveMrv / weeksBelowMev: walk ISO weeks backward ---
  // For each of the last N weeks (cap at 12), compute weekly sets and
  // check against landmarks. Stop counting consecutive weeks when the
  // condition breaks.
  let weeksAtOrAboveMrv = 0
  let weeksBelowMev = 0
  if (landmarks) {
    const weeklyBuckets = bucketHistoryByIsoWeek(history, muscleKey, nowMs)
    for (const bucket of weeklyBuckets) {
      if (bucket.sets >= landmarks.mrv) {
        weeksAtOrAboveMrv++
      } else {
        break
      }
    }
    for (const bucket of weeklyBuckets) {
      if (bucket.sets < landmarks.mev) {
        weeksBelowMev++
      } else {
        break
      }
    }
  }

  // --- e1rmTrend: pick the exercise with most data points in this group ---
  let e1rmTrend = 'insufficient_data'
  if (e1rmHistories && e1rmHistories.length > 0) {
    const best = [...e1rmHistories]
      .filter((h) => h && h.dataPoints && h.dataPoints.length > 0)
      .sort((a, b) => (b.dataPoints?.length ?? 0) - (a.dataPoints?.length ?? 0))[0]
    if (best?.trend?.direction) {
      e1rmTrend = best.trend.direction
    }
  }

  return {
    weeklySets,
    weeksAtOrAboveMrv,
    weeksBelowMev,
    e1rmTrend,
    lastAdjustmentIso,
  }
}

/**
 * Build snapshots for all 6 canonical muscle groups at once.
 *
 * @param {Array} history — workout history (any order)
 * @param {Array} allE1rmHistories — ExerciseE1RMHistory[] for all exercises
 *                                   (will be filtered by muscle group)
 * @param {string} phase
 * @param {Date} now
 * @param {Record<string, string|null>} lastAdjustments — map muscleKey →
 *                                                        ISO date or null
 * @returns {Record<string, MuscleVolumeSnapshot>}
 */
export function buildAllMuscleVolumeSnapshots(history, allE1rmHistories, phase = 'adult', now = new Date(), lastAdjustments = {}) {
  const result = {}
  for (const key of CANONICAL_MUSCLE_KEYS) {
    const e1rmsForMuscle = (allE1rmHistories ?? []).filter((h) =>
      normalizeMuscleGroup(`${h.muscleGroup ?? ''} ${h.exerciseName ?? ''}`) === key,
    )
    result[key] = buildMuscleVolumeSnapshot(
      key,
      history,
      e1rmsForMuscle,
      phase,
      now,
      lastAdjustments[key] ?? null,
    )
  }
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Bucket completed workout sets by ISO week, most-recent first.
 * Returns array of { weekStart, sets } for weeks that HAVE at least one
 * completed session. Weeks with no sessions are skipped — this prevents
 * the "below MEV" counter from firing on a brand-new user with no history.
 *
 * Cap at 12 weeks backward from nowMs.
 */
function bucketHistoryByIsoWeek(history, muscleKey, nowMs) {
  // Group sessions into week buckets keyed by week-start timestamp.
  const bucketsByStart = new Map()
  for (const session of history ?? []) {
    const sessionMs = new Date(session.completedAt).getTime()
    if (!Number.isFinite(sessionMs)) continue
    // Skip sessions older than 12 weeks.
    if (nowMs - sessionMs > 12 * MS_PER_WEEK) continue

    // Compute week start (Monday-based, MS_PER_WEEK boundary).
    const weekStart = sessionMs - (sessionMs % MS_PER_WEEK)
    if (!bucketsByStart.has(weekStart)) {
      bucketsByStart.set(weekStart, 0)
    }
    let sets = 0
    for (const exercise of session.exercises ?? []) {
      const emk = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
      if (emk === muscleKey) {
        sets += (exercise.sets ?? []).filter((s) => s?.completed !== false && Number(s?.reps) > 0).length
      }
    }
    bucketsByStart.set(weekStart, bucketsByStart.get(weekStart) + sets)
  }

  // Sort most-recent-first.
  return [...bucketsByStart.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([weekStart, sets]) => ({ weekStart, sets }))
}
