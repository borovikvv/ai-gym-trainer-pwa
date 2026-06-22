/**
 * Adaptive Mesocycle State Machine
 *
 * Stateless — derived entirely from workout history + profile.
 * No persistent storage needed; the mesocycle position is computed
 * on every coach state refresh by counting calendar weeks with
 * completed workouts.
 *
 * Cycle structure (differentiated by ageRecoveryProfile.phase):
 *   teen:         3 loading weeks + 1 deload = 4-week cycle
 *   adult:        4 loading weeks + 1 deload = 5-week cycle
 *   mature_adult: 3 loading weeks + 1 deload = 4-week cycle
 *
 * Early deload triggers (override the calendar):
 *   - 2+ muscle groups at/above MRV simultaneously
 *   - 2+ pain-flagged sessions within the current cycle
 *
 * Deload delay:
 *   - If user completed <50% of planned workouts this cycle,
 *     the loading phase extends by 1 week (don't deload yet —
 *     not enough accumulated stress to warrant recovery).
 */

import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { CANONICAL_MUSCLE_KEYS, labelFor } from './lib/muscleGroups.js'
import { classifyVolumeStatus, getVolumeLandmarks } from './volumeLandmarks.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MESOCYCLE_CONFIG = {
  teen:         { loadingWeeks: 3, deloadWeeks: 1 },
  adult:        { loadingWeeks: 4, deloadWeeks: 1 },
  mature_adult: { loadingWeeks: 3, deloadWeeks: 1 },
}

const PHASE_NAMES = {
  loading:        'Загрузка — первый неделю мезоцикла, умеренный объём',
  accumulation:   'Накопление — рабочий объём растёт',
  intensification: 'Интенсификация — пик нагрузки мезоцикла',
  deload:         'Разгрузочная неделя — снижение объёма и интенсивности',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the current mesocycle state.
 *
 * @param {{ profile: object, history: object[], coachMemory: object|null, now: Date }} input
 * @returns {object} mesocycle state
 */
export function computeMesocycleState({ profile = {}, history = [], coachMemory = null, now = new Date() }) {
  const nowDate = new Date(now)
  const policy = getUserTrainingPolicy(profile)
  const phase = policy?.ageRecoveryProfile?.phase ?? 'adult'
  const config = MESOCYCLE_CONFIG[phase] ?? MESOCYCLE_CONFIG.adult
  const cycleLength = config.loadingWeeks + config.deloadWeeks
  const workoutsPerWeek = clampNumber(profile.workoutsPerWeek, 1, 7, 3)

  // --- 1. Build calendar-week buckets ---
  const weeks = buildWeekBuckets(history, nowDate)

  // --- 2. Walk weeks to find current cycle position ---
  const { weekInCycle, cycleStartWeekIndex, workoutsThisCycle, plannedThisCycle } =
    findCyclePosition(weeks, cycleLength, workoutsPerWeek)

  // --- 3. Determine phase name ---
  const currentPhase = weekInCycle <= config.loadingWeeks
    ? loadingPhaseName(weekInCycle, config.loadingWeeks)
    : 'deload'

  // --- 4. Early deload triggers ---
  const earlyDeload = checkEarlyDeloadTriggers({
    coachMemory,
    history,
    weeks,
    cycleStartWeekIndex,
    phase,
    now: nowDate,
  })

  // --- 5. Deload delay (not enough stress accumulated) ---
  const completionRatio = plannedThisCycle > 0 ? workoutsThisCycle / plannedThisCycle : 0
  const shouldDelayDeload = !earlyDeload.force
    && currentPhase === 'deload'
    && completionRatio < 0.5

  // --- 6. Resolve final phase ---
  let finalPhase = currentPhase
  let triggerReason = null
  let deloadScheduled = weekInCycle === config.loadingWeeks && !shouldDelayDeload

  if (earlyDeload.force) {
    finalPhase = 'deload'
    triggerReason = earlyDeload.reason
    deloadScheduled = false // already IN deload
  } else if (shouldDelayDeload) {
    // Extend loading — treat as if we're still in the last loading week
    finalPhase = loadingPhaseName(config.loadingWeeks, config.loadingWeeks)
    triggerReason = `Загрузка продлена: выполнено только ${Math.round(completionRatio * 100)}% плановых тренировок цикла — разгрузка пока не нужна.`
    deloadScheduled = true // deload should come after one more loading week
  } else if (currentPhase === 'deload') {
    triggerReason = 'Запланированная разгрузка по календарю мезоцикла.'
  }

  return {
    phase: finalPhase,
    weekInCycle,
    cycleLength,
    loadingWeeks: config.loadingWeeks,
    deloadWeeks: config.deloadWeeks,
    workoutsThisCycle,
    plannedWorkoutsThisCycle: plannedThisCycle,
    completionRatio: Math.round(completionRatio * 100) / 100,
    deloadScheduled,
    triggerReason,
    phaseDescription: PHASE_NAMES[finalPhase] ?? finalPhase,
    isDeload: finalPhase === 'deload',
  }
}

/**
 * Whether the next workout should be treated as a deload workout.
 * Convenience wrapper — equivalent to `state.isDeload`.
 */
export function isDeloadWeek(mesocycleState) {
  return mesocycleState?.isDeload === true
}

/**
 * Apply deload reductions to an exercise prescription.
 * Called by plannedWorkoutGenerator and coachPlanner when mesocycle.isDeload.
 *
 * @param {{ setsCount: number, targetWeight: number, repMin: number, repMax: number, weightStep: number }} exercise
 * @returns {{ setsCount: number, targetWeight: number, repMin: number, repMax: number, intensityTarget: string, deloadNote: string }}
 */
export function applyDeloadReduction(exercise) {
  const originalSets = clampNumber(exercise.setsCount, 1, 6, 3)
  // Reduce to ~60% of normal sets, minimum 2
  const deloadSets = Math.max(2, Math.round(originalSets * 0.6))
  // Reduce weight by one step
  const step = Math.max(0, Number(exercise.weightStep ?? 2.5))
  const deloadWeight = Math.max(0, Number(exercise.targetWeight ?? 0) - step)
  // Keep rep range but shift down slightly
  const deloadRepMin = Math.max(6, Number(exercise.repMin ?? 8))
  const deloadRepMax = Math.max(deloadRepMin + 2, Number(exercise.repMax ?? 12))

  return {
    setsCount: deloadSets,
    targetWeight: deloadWeight,
    repMin: deloadRepMin,
    repMax: deloadRepMax,
    intensityTarget: 'easy',
    deloadNote: `Разгрузка: ${deloadSets}×${deloadRepMin}–${deloadRepMax} вместо ${originalSets}×${exercise.repMin}–${exercise.repMax}, вес -${step} кг. RPE ≤ 7.`,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Group completed workouts into ISO calendar-week buckets.
 * Returns array of { weekStart (Date), weekEnd (Date), workouts: [...] },
 * most recent first.
 */
function buildWeekBuckets(history, now) {
  const nowDate = new Date(now)
  const completedSessions = (history ?? [])
    .filter((s) => s?.completedAt)
    .map((s) => ({ ...s, completedAtDate: new Date(s.completedAt) }))
    .sort((a, b) => b.completedAtDate.getTime() - a.completedAtDate.getTime())

  if (completedSessions.length === 0) return []

  // Use a Map keyed by ISO week string "YYYY-Www"
  const weekMap = new Map()
  for (const session of completedSessions) {
    const isoWeek = isoWeekKey(session.completedAtDate)
    if (!weekMap.has(isoWeek)) {
      weekMap.set(isoWeek, {
        weekKey: isoWeek,
        start: startOfWeek(session.completedAtDate),
        end: endOfWeek(session.completedAtDate),
        workouts: [],
      })
    }
    weekMap.get(isoWeek).workouts.push(session)
  }

  // Return most-recent-week-first, only weeks within last 90 days
  const cutoff = new Date(nowDate.getTime() - 90 * 86_400_000)
  return [...weekMap.values()]
    .filter((w) => w.start >= cutoff)
    .sort((a, b) => b.start.getTime() - a.start.getTime())
}

/**
 * Walk weeks from most recent to find the current cycle position.
 * A new cycle starts after:
 *   - A gap of 10+ days between week buckets (extended break)
 *   - Reaching the configured cycle length
 */
function findCyclePosition(weeks, cycleLength, workoutsPerWeek) {
  let weekInCycle = 0
  let cycleStartWeekIndex = 0
  let workoutsThisCycle = 0
  let plannedThisCycle = 0

  for (let i = 0; i < weeks.length; i++) {
    // Check for gap before this week
    if (i > 0) {
      const prevEnd = weeks[i - 1].end
      const currStart = weeks[i].start
      const gapDays = (prevEnd.getTime() - currStart.getTime()) / 86_400_000
      if (gapDays > 10) {
        // Extended break — new cycle
        cycleStartWeekIndex = i
        weekInCycle = 1
        workoutsThisCycle = weeks[i].workouts.length
        plannedThisCycle = workoutsPerWeek
        continue
      }
    }

    weekInCycle++
    workoutsThisCycle += weeks[i].workouts.length
    plannedThisCycle += workoutsPerWeek

    if (weekInCycle >= cycleLength) {
      // Cycle complete — this starts a new one
      cycleStartWeekIndex = i
      weekInCycle = 1
      // Reset counters for the new cycle starting at this week
      workoutsThisCycle = weeks[i].workouts.length
      plannedThisCycle = workoutsPerWeek
    } else if (i === 0) {
      cycleStartWeekIndex = 0
    }
  }

  return { weekInCycle, cycleStartWeekIndex, workoutsThisCycle, plannedThisCycle }
}

/**
 * Check for early deload triggers.
 * Returns { force: boolean, reason: string|null }
 */
function checkEarlyDeloadTriggers({ coachMemory, history, weeks, cycleStartWeekIndex, phase, now }) {
  // Only check during loading weeks, not if already in deload
  const reasons = []

  // Trigger 1: 2+ muscle groups at/above MRV
  if (coachMemory?.weeklyBalance?.muscleSetCounts) {
    const muscleSetCounts = coachMemory.weeklyBalance.muscleSetCounts
    const landmarks = {}
    for (const key of CANONICAL_MUSCLE_KEYS) {
      landmarks[key] = getVolumeLandmarks(key, phase)
    }
    const criticalGroups = CANONICAL_MUSCLE_KEYS.filter((key) => {
      const lm = landmarks[key]
      if (!lm) return false
      const status = classifyVolumeStatus(muscleSetCounts[key] ?? 0, lm)
      return status === 'at_mrv' || status === 'above_mrv'
    })
    if (criticalGroups.length >= 2) {
      const labels = criticalGroups.slice(0, 3).map(labelFor).join(', ')
      reasons.push(`Ранний делод: ${labels} на уровне MRV или выше. Нужна разгрузка для восстановления.`)
    }
  }

  // Trigger 2: 2+ pain-flagged sessions in current cycle
  const cycleWeeks = weeks.slice(cycleStartWeekIndex)
  const painSessions = cycleWeeks.flatMap((w) => w.workouts).filter((w) =>
    (w.exercises ?? []).some((e) => Boolean(e.pain))
  )
  if (painSessions.length >= 2) {
    reasons.push(`Ранний делод: ${painSessions.length} тренировок с болью в текущем цикле.`)
  }

  if (reasons.length > 0) {
    return { force: true, reason: reasons[0] }
  }

  return { force: false, reason: null }
}

function loadingPhaseName(weekInCycle, totalLoadingWeeks) {
  if (weekInCycle === 1) return 'loading'
  if (weekInCycle >= totalLoadingWeeks) return 'intensification'
  return 'accumulation'
}

// ---------------------------------------------------------------------------
// Date / ISO week utilities
// ---------------------------------------------------------------------------

function isoWeekKey(date) {
  const d = new Date(date)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const oneDay = 86_400_000
  const weekNumber = Math.ceil(((d.getTime() - jan4.getTime()) / oneDay + jan4.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const start = new Date(d.setDate(diff))
  start.setHours(0, 0, 0, 0)
  return start
}

function endOfWeek(date) {
  const start = startOfWeek(date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}