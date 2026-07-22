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

import type {
  AgeRecoveryPhase,
  CoachMemory,
  MesocyclePhase,
  MesocycleState,
  MuscleKey,
  WorkoutHistoryEntry,
} from '../shared/types.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from './userTrainingPolicies.js'
import { CANONICAL_MUSCLE_KEYS, labelFor, isAssistedExerciseName } from './lib/muscleGroups.js'
import { classifyVolumeStatus, getVolumeLandmarks } from './volumeLandmarks.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface MesocyclePhaseConfig {
  loadingWeeks: number
  deloadWeeks: number
}

const MESOCYCLE_CONFIG: Record<AgeRecoveryPhase, MesocyclePhaseConfig> = {
  teen:         { loadingWeeks: 3, deloadWeeks: 1 },
  adult:        { loadingWeeks: 4, deloadWeeks: 1 },
  mature_adult: { loadingWeeks: 3, deloadWeeks: 1 },
}

const PHASE_NAMES: Record<MesocyclePhase, string> = {
  idle:            'Ожидание первой тренировки',
  loading:         'Загрузка — первую неделю мезоцикла, умеренный объём',
  accumulation:    'Накопление — рабочий объём растёт',
  intensification: 'Интенсификация — пик нагрузки мезоцикла',
  deload:          'Разгрузочная неделя — снижение объёма и интенсивности',
}

/** Minimal profile shape consumed by computeMesocycleState. */
interface ProfileForMesocycle {
  userId?: string
  age?: number | null
  workoutsPerWeek?: number
}

interface ComputeMesocycleStateInput {
  profile: ProfileForMesocycle
  history: WorkoutHistoryEntry[]
  coachMemory: CoachMemory | null
  now?: Date
}

/** Internal: a single ISO-week bucket of completed workouts. */
interface WeekBucket {
  weekKey: string
  start: Date
  end: Date
  workouts: Array<WorkoutHistoryEntry & { completedAtDate: Date }>
}

interface CyclePosition {
  weekInCycle: number
  cycleStartWeekIndex: number
  workoutsThisCycle: number
  plannedThisCycle: number
}

interface EarlyDeloadResult {
  force: boolean
  reason: string | null
}

/** Minimal exercise shape for applyDeloadReduction. */
interface ExerciseForDeload {
  name?: string
  setsCount: number
  targetWeight: number
  repMin: number
  repMax: number
  weightStep: number
}

interface DeloadReductionResult {
  setsCount: number
  targetWeight: number
  repMin: number
  repMax: number
  intensityTarget: string
  deloadNote: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the current mesocycle state.
 */
export function computeMesocycleState({
  profile = {},
  history = [],
  coachMemory = null,
  now = new Date(),
}: ComputeMesocycleStateInput): MesocycleState {
  const nowDate = new Date(now)
  const policy: UserTrainingPolicy | null = getUserTrainingPolicy({ ...profile, age: profile.age ?? undefined })
  const phase: AgeRecoveryPhase = policy?.ageRecoveryProfile?.phase ?? 'adult'
  const config: MesocyclePhaseConfig = MESOCYCLE_CONFIG[phase] ?? MESOCYCLE_CONFIG.adult
  const cycleLength = config.loadingWeeks + config.deloadWeeks
  // Issue #77: compute actual workout frequency from history, not from
  // questionnaire. The questionnaire value is only a fallback for new users
  // with insufficient history (< 4 workouts).
  const workoutsPerWeek = computeEffectiveWorkoutsPerWeek(history, nowDate, profile.workoutsPerWeek)

  // --- 1. Build calendar-week buckets ---
  const weeks: WeekBucket[] = buildWeekBuckets(history, nowDate)

  // --- 2. Walk weeks to find current cycle position ---
  const { weekInCycle, cycleStartWeekIndex, workoutsThisCycle, plannedThisCycle } =
    findCyclePosition(weeks, cycleLength, workoutsPerWeek)

  // --- 3. Determine phase name ---
  const currentPhase: MesocyclePhase = weekInCycle <= config.loadingWeeks
    ? loadingPhaseName(weekInCycle, config.loadingWeeks)
    : 'deload'

  // --- 4. Early deload triggers ---
  const earlyDeload: EarlyDeloadResult = checkEarlyDeloadTriggers({
    coachMemory,
    weeks,
    cycleStartWeekIndex,
    phase,
  })

  // --- 5. Deload delay (not enough stress accumulated) ---
  const completionRatio = plannedThisCycle > 0 ? workoutsThisCycle / plannedThisCycle : 0
  const shouldDelayDeload = !earlyDeload.force
    && currentPhase === 'deload'
    && completionRatio < 0.5

  // --- 6. Resolve final phase ---
  let finalPhase: MesocyclePhase = currentPhase
  let triggerReason: string | null = null
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
export function isDeloadWeek(mesocycleState: MesocycleState | null | undefined): boolean {
  return mesocycleState?.isDeload === true
}

/**
 * Apply deload reductions to an exercise prescription.
 * Called by plannedWorkoutGenerator and coachPlanner when mesocycle.isDeload.
 */
export function applyDeloadReduction(exercise: ExerciseForDeload): DeloadReductionResult {
  const originalSets = clampNumber(exercise.setsCount, 1, 6, 3)
  // Reduce to ~60% of normal sets, minimum 2
  const deloadSets = Math.max(2, Math.round(originalSets * 0.6))
  // Reduce weight by one step
  const step = Math.max(0, Number(exercise.weightStep ?? 2.5))
  // For assisted exercises (gravitron), weight = counterweight.
  // Higher counterweight = easier. To make deload EASIER, we need to
  // INCREASE the counterweight (add step, not subtract).
  const exerciseName = String((exercise as { name?: string }).name ?? '')
  const isAssisted = isAssistedExerciseName(exerciseName)
  const deloadWeight = isAssisted
    ? Math.max(0, Number(exercise.targetWeight ?? 0) + step)
    : Math.max(0, Number(exercise.targetWeight ?? 0) - step)
  // For timed exercises (plank), reps = seconds. Don't clamp to 6-8 reps.
  const isTimed = isTimedExerciseName(exerciseName)
  const deloadRepMin = isTimed
    ? Math.max(10, Math.round(Number(exercise.repMin ?? 40) * 0.8))
    : Math.max(6, Number(exercise.repMin ?? 8))
  const deloadRepMax = isTimed
    ? Math.max(deloadRepMin + 5, Math.round(Number(exercise.repMax ?? 60) * 0.8))
    : Math.max(deloadRepMin + 2, Number(exercise.repMax ?? 12))

  const weightNote = isAssisted ? `вес +${step} кг (контрвес)` : `вес -${step} кг`
  return {
    setsCount: deloadSets,
    targetWeight: deloadWeight,
    repMin: deloadRepMin,
    repMax: deloadRepMax,
    intensityTarget: 'easy',
    deloadNote: `Разгрузка: ${deloadSets}×${deloadRepMin}–${deloadRepMax} вместо ${originalSets}×${exercise.repMin}–${exercise.repMax}, ${weightNote}. RPE ≤ 7.`,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Group completed workouts into ISO calendar-week buckets.
 * Returns array of WeekBucket, most recent first.
 */
function buildWeekBuckets(history: WorkoutHistoryEntry[], now: Date): WeekBucket[] {
  const nowDate = new Date(now)
  const completedSessions: Array<WorkoutHistoryEntry & { completedAtDate: Date }> = (history ?? [])
    .filter((s): s is WorkoutHistoryEntry => Boolean(s?.completedAt))
    .map((s) => ({ ...s, completedAtDate: new Date(s.completedAt) }))
    .sort((a, b) => b.completedAtDate.getTime() - a.completedAtDate.getTime())

  if (completedSessions.length === 0) return []

  // Use a Map keyed by ISO week string "YYYY-Www"
  const weekMap = new Map<string, WeekBucket>()
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
    weekMap.get(isoWeek)!.workouts.push(session)
  }

  // Return most-recent-week-first, only weeks within last 90 days
  const cutoff = new Date(nowDate.getTime() - 90 * 86_400_000)
  const buckets = [...weekMap.values()]
    .filter((w) => w.start >= cutoff)
    .sort((a, b) => b.start.getTime() - a.start.getTime())

  // Issue: deload stuck — if the current ISO week has no workouts yet,
  // add an empty bucket for it so findCyclePosition can see the new week
  // and reset the cycle. Without this, the mesocycle stays at the last
  // workout's week (e.g. week 4 = deload) even after the deload week ends.
  const currentWeekKey = isoWeekKey(nowDate)
  if (buckets.length > 0 && buckets[0].weekKey !== currentWeekKey) {
    const currentWeekStart = startOfWeek(nowDate)
    if (currentWeekStart >= cutoff) {
      buckets.unshift({
        weekKey: currentWeekKey,
        start: currentWeekStart,
        end: endOfWeek(nowDate),
        workouts: [],
      })
    }
  }

  return buckets
}

/**
 * Walk weeks from oldest to most recent, tracking cycle position.
 *
 * Issue #96: the old algorithm walked newest-to-oldest and returned the
 * position inside the OLDEST cycle encountered (because it kept resetting
 * and continuing past cycle boundaries). The correct behavior is to return
 * the position inside the CURRENT (most recent) cycle.
 *
 * New approach: walk oldest-to-newest, maintaining running weekInCycle.
 * When a cycle boundary is crossed (gap > 21d OR weekInCycle > cycleLength),
 * reset to week 1. After processing ALL weeks, the final weekInCycle is
 * the position in the current cycle — which is what we want.
 *
 * Workouts/planned counters are computed only for the current (final) cycle:
 * we track cycleStartWeekIndex and accumulate from there to the end.
 */
function findCyclePosition(
  weeks: WeekBucket[],
  cycleLength: number,
  workoutsPerWeek: number,
): CyclePosition {
  if (weeks.length === 0) {
    return { weekInCycle: 0, cycleStartWeekIndex: 0, workoutsThisCycle: 0, plannedThisCycle: 0 }
  }

  // weeks is most-recent-first; reverse to oldest-first for forward walk
  const sorted = [...weeks].reverse() // oldest first

  let weekInCycle = 0
  let cycleStartIndex = 0
  let workoutsThisCycle = 0
  let plannedThisCycle = 0
  // Issue #138: разгрузочная неделя завершает цикл — запоминаем, была ли
  // предыдущая неделя разгрузочной, чтобы следующая рабочая открыла новый цикл.
  let prevWasDeload = false

  const startNewCycle = (i: number) => {
    weekInCycle = 1
    cycleStartIndex = i
    workoutsThisCycle = sorted[i].workouts.length
    plannedThisCycle = workoutsPerWeek
  }

  for (let i = 0; i < sorted.length; i++) {
    const currIsDeload = weekIsDeload(sorted[i])

    if (i === 0) {
      // First (oldest) week starts a new cycle
      startNewCycle(i)
    } else {
      // Check gap between previous (older) week and this (newer) week
      const prevStart = sorted[i - 1].start
      const prevEnd = sorted[i - 1].end
      const currStart = sorted[i].start
      const gapDays = (currStart.getTime() - prevEnd.getTime()) / 86_400_000
      // Issue #74: phantom weeks — count ISO weeks between consecutive buckets
      const weekDiffMs = currStart.getTime() - prevStart.getTime()
      const weekDiff = Math.round(weekDiffMs / (7 * 86_400_000))
      const missingWeeks = Math.max(0, weekDiff - 1)

      if (gapDays > 21) {
        // Issue #96: extended break — this week starts a new cycle
        startNewCycle(i)
      } else if (prevWasDeload) {
        // Issue #138: предыдущая неделя была разгрузочной — мезоцикл завершён,
        // эта рабочая неделя открывает новый цикл (loading), даже если по
        // календарю loadingWeeks ещё не достигнут.
        startNewCycle(i)
      } else {
        // Add phantom weeks then this real week
        weekInCycle += missingWeeks + 1
        plannedThisCycle += (missingWeeks + 1) * workoutsPerWeek
        workoutsThisCycle += sorted[i].workouts.length

        // Check if we've crossed the cycle boundary
        if (weekInCycle > cycleLength) {
          // This week starts a new cycle
          startNewCycle(i)
        }
      }
    }

    // Issue #138: разгрузочная неделя — финальная (deload) неделя цикла.
    // Фиксируем её на deload-слоте, чтобы фаза считалась 'deload', а не
    // 'intensification'/'accumulation' по номеру календарной недели.
    if (currIsDeload) {
      weekInCycle = cycleLength
    }

    prevWasDeload = currIsDeload
  }

  // cycleStartIndex is into `sorted` (oldest-first). Convert back to the
  // most-recent-first index that the rest of the codebase expects.
  // sorted[i] corresponds to weeks[weeks.length - 1 - i]
  const cycleStartWeekIndex = weeks.length - 1 - cycleStartIndex

  return { weekInCycle, cycleStartWeekIndex, workoutsThisCycle, plannedThisCycle }
}

/**
 * Issue #138: неделя считается разгрузочной, если в ней есть тренировки и ВСЕ
 * они — разгрузочные (по названию дня, напр. «Разгрузка», которое проставляет
 * генератор для low-readiness дней и пользователь для ручных разгрузок).
 * Пустые недели (например, добавленный бакет текущей ISO-недели без тренировок)
 * разгрузочными не считаются.
 */
function weekIsDeload(bucket: WeekBucket): boolean {
  const workouts = bucket.workouts ?? []
  if (workouts.length === 0) return false
  return workouts.every((workout) => isDeloadWorkoutName(workout.workoutDayName))
}

function isDeloadWorkoutName(name: unknown): boolean {
  const text = String(name ?? '').toLowerCase()
  return text.includes('разгруз') || text.includes('deload')
}

interface EarlyDeloadInput {
  coachMemory: CoachMemory | null
  weeks: WeekBucket[]
  cycleStartWeekIndex: number
  phase: AgeRecoveryPhase
}

/**
 * Check for early deload triggers.
 */
function checkEarlyDeloadTriggers({
  coachMemory,
  weeks,
  cycleStartWeekIndex,
  phase,
}: EarlyDeloadInput): EarlyDeloadResult {
  const reasons: string[] = []

  // Trigger 1: 2+ muscle groups at/above MRV
  if (coachMemory?.weeklyBalance?.muscleSetCounts) {
    const muscleSetCounts: Record<string, number> = coachMemory.weeklyBalance.muscleSetCounts
    const landmarks: Partial<Record<MuscleKey, ReturnType<typeof getVolumeLandmarks>>> = {}
    for (const key of CANONICAL_MUSCLE_KEYS) {
      landmarks[key as MuscleKey] = getVolumeLandmarks(key, phase)
    }
    const criticalGroups = CANONICAL_MUSCLE_KEYS.filter((key) => {
      const lm = landmarks[key as MuscleKey]
      if (!lm) return false
      const status = classifyVolumeStatus(muscleSetCounts[key] ?? 0, lm)
      return status === 'at_mrv' || status === 'above_mrv'
    })
    if (criticalGroups.length >= 2) {
      const labels = criticalGroups.slice(0, 3).map(labelFor).join(', ')
      reasons.push(`Раннее начало разгрузки: ${labels} на уровне MRV или выше. Нужна разгрузка для восстановления.`)
    }
  }

  // Trigger 2: 2+ pain-flagged sessions in current cycle
  // weeks is most-recent-first; cycleStartWeekIndex is the index of the
  // OLDEST week still in the current cycle. Weeks in the current cycle are
  // weeks[0..cycleStartWeekIndex] inclusive.
  const cycleWeeks = cycleStartWeekIndex > 0
    ? weeks.slice(0, cycleStartWeekIndex + 1)
    : weeks.slice(0, 1)
  const painSessions = cycleWeeks
    .flatMap((w) => w.workouts)
    .filter((w) => (w.exercises ?? []).some((e) => Boolean(e.pain)))
  if (painSessions.length >= 2) {
    reasons.push(`Раннее начало разгрузки: ${painSessions.length} тренировок с болью в текущем цикле.`)
  }

  if (reasons.length > 0) {
    return { force: true, reason: reasons[0] }
  }

  return { force: false, reason: null }
}

function loadingPhaseName(weekInCycle: number, totalLoadingWeeks: number): MesocyclePhase {
  if (weekInCycle === 0) return 'idle'
  if (weekInCycle === 1) return 'loading'
  if (weekInCycle >= totalLoadingWeeks) return 'intensification'
  return 'accumulation'
}

// ---------------------------------------------------------------------------
// Date / ISO week utilities
// ---------------------------------------------------------------------------

function isoWeekKey(date: Date): string {
  const d = new Date(date)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const oneDay = 86_400_000
  const weekNumber = Math.ceil(((d.getTime() - jan4.getTime()) / oneDay + jan4.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const start = new Date(d.setDate(diff))
  start.setHours(0, 0, 0, 0)
  return start
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

/** Check if exercise is timed (plank, dead bug) — reps are seconds. */
function isTimedExerciseName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('планк') || lower.includes('plank') || lower.includes('dead bug') || lower.includes('дед баг')
}

/**
 * Issue #77: Compute effective workouts-per-week from actual history.
 *
 * Uses the average frequency over the last 28 days (4 ISO weeks). If there
 * are fewer than 4 workouts total, falls back to the questionnaire value
 * (profile.workoutsPerWeek). This ensures the mesocycle and coachState
 * reflect what the user ACTUALLY does, not what they INTENDED to do when
 * filling out the questionnaire.
 *
 * Exported so coachState.ts can use the same computation for
 * plannedWorkoutsPerWeek / weeklyLoadRatio.
 */
export function computeEffectiveWorkoutsPerWeek(
  history: Array<{ completedAt: string }>,
  now: Date,
  profileWorkoutsPerWeek?: number,
): number {
  const nowMs = now.getTime()
  const workoutsLast28Days = (history ?? []).filter((s) => {
    const sessionMs = new Date(s.completedAt).getTime()
    return Number.isFinite(sessionMs) && nowMs - sessionMs <= 28 * 86_400_000
  }).length

  // Need at least 4 workouts in 28 days to compute a reliable average
  if (workoutsLast28Days >= 4) {
    return Math.max(1, Math.min(7, Math.round(workoutsLast28Days / 4)))
  }

  // Fallback: check last 14 days (2 workouts minimum)
  const workoutsLast14Days = (history ?? []).filter((s) => {
    const sessionMs = new Date(s.completedAt).getTime()
    return Number.isFinite(sessionMs) && nowMs - sessionMs <= 14 * 86_400_000
  }).length

  if (workoutsLast14Days >= 2) {
    return Math.max(1, Math.min(7, Math.round(workoutsLast14Days / 2)))
  }

  // Final fallback: questionnaire value
  return clampNumber(profileWorkoutsPerWeek, 1, 7, 3)
}
