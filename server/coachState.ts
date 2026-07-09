// Issue #65 (#36 decomposition): all `any` replaced with concrete types.
// Removed `// @ts-nocheck` pragma — the file now compiles under tsc.
import type {
  CoachState,
  ExerciseStateInfo,
  MesocycleState,
  MuscleGroupInfo,
  WorkoutHistoryEntry,
} from '../shared/types.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, isAssistedExerciseName } from './lib/muscleGroups.js'
import { computeMesocycleState, computeEffectiveWorkoutsPerWeek } from './mesocycle.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'
import { computeAllAdjustments } from './adaptiveVolumeLandmarks.js'
import { buildAllMuscleVolumeSnapshots } from './buildVolumeSnapshot.js'
import { extractLastAdjustments, mergeLandmarkOverrides } from './volumeLandmarkOverrides.js'

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

interface ProfileForCoachState {
  userId?: string
  user_id?: string
  age?: number | null
  level?: string
  workoutsPerWeek?: number
  preferences?: { focusAreas?: string[] } | null
}

interface WorkoutDayInput {
  id?: string
  name?: string
  exercises?: Array<{
    id?: string
    name?: string
    muscleGroup?: string
    targetWeight?: number
    repMin?: number
    repMax?: number
  }>
}

interface E1rmHistoryInput {
  muscleGroup?: string | null
  exerciseName?: string | null
  dataPoints?: { date?: string; e1rm?: number }[] | null
  trend?: { direction?: 'up' | 'down' | 'flat' | 'insufficient_data' } | null
}

interface VolumeLandmarkOverridesInput {
  [muscleKey: string]: {
    mev?: number
    mav?: number
    mrv?: number
    lastAdjustmentIso?: string | null
    [key: string]: unknown
  } | undefined
}

interface ComputeCoachStateInput {
  profile?: ProfileForCoachState
  workoutDays?: WorkoutDayInput[]
  history?: WorkoutHistoryEntryInput[]
  now?: Date
  lastWorkoutQualityScore?: number | null
  coachMemory?: { muscleGroupProfiles?: Record<string, unknown> } | null
  volumeLandmarkOverrides?: VolumeLandmarkOverridesInput | null
  e1rmHistories?: E1rmHistoryInput[] | null
}

interface WorkoutHistoryEntryInput extends Omit<WorkoutHistoryEntry, 'workoutDayId'> {
  workoutDayId?: string
  workout_day_id?: string
}

interface CatalogItem {
  id: string
  name: string
  muscleGroup: string
  muscleKey: string
  targetWeight?: number
  repMin?: number
  repMax?: number
}

interface MuscleGroupState extends MuscleGroupInfo {
  fatigue: 'low' | 'medium' | 'high' | 'unknown'
}

interface ComputeRecoveryStatusInput {
  daysSinceLastWorkout: number | null
  highFatigueGroups: number
  recentMaxEffortSets: number
  painFlagsLast14Days: number
  userTrainingPolicy?: UserTrainingPolicy | null
  trainingDataConfidence?: number
}

interface ComputeReadinessScoreInput extends ComputeRecoveryStatusInput {
  weeklyLoadRatio: number
  lastWorkoutQualityScore?: number | null
}

interface BuildWarningsInput {
  recoveryStatus: string
  weeklyLoadStatus: string
  painFlagsLast14Days: number
  highFatigueGroups: number
  mesocycle: MesocycleState | null
}

interface BuildMuscleGroupStateInput {
  history: WorkoutHistoryEntryInput[]
  exerciseCatalog: Map<string, CatalogItem>
  now: Date
}

interface BuildExerciseStateInput {
  history: WorkoutHistoryEntryInput[]
  exerciseCatalog: Map<string, CatalogItem>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeCoachState({
  profile = {},
  workoutDays = [],
  history = [],
  now = new Date(),
  lastWorkoutQualityScore = null,
  coachMemory = null,
  volumeLandmarkOverrides = null,
  e1rmHistories = null,
}: ComputeCoachStateInput): CoachState {
  const nowDate = new Date(now)
  const normalizedHistory = [...(history ?? [])]
    .filter((session): session is WorkoutHistoryEntryInput => Boolean(session?.completedAt))
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())

  const lastWorkout = normalizedHistory[0] ?? null
  const userTrainingPolicy = getUserTrainingPolicy(profile as unknown as string)
  const trainingDataConfidence = computeTrainingDataConfidence(normalizedHistory)
  const daysSinceLastWorkout = lastWorkout ? wholeDaysBetween(new Date(lastWorkout.completedAt), nowDate) : null
  const workoutsLast7Days = normalizedHistory.filter((session) => daysBetween(new Date(session.completedAt), nowDate) <= 7).length
  // Issue #77: use actual workout frequency from history, not questionnaire.
  const plannedWorkoutsPerWeek = computeEffectiveWorkoutsPerWeek(normalizedHistory, nowDate, profile.workoutsPerWeek)
  const weeklyLoadRatio = plannedWorkoutsPerWeek > 0 ? workoutsLast7Days / plannedWorkoutsPerWeek : 0
  const weeklyLoadStatus = weeklyLoadRatio >= 1.35 ? 'above_plan' : weeklyLoadRatio >= 0.75 ? 'on_plan' : 'below_plan'

  const exerciseCatalog = buildExerciseCatalog(workoutDays)
  const muscleGroups = buildMuscleGroupState({ history: normalizedHistory, exerciseCatalog, now: nowDate })
  const exercises = buildExerciseState({ history: normalizedHistory, exerciseCatalog })
  const highFatigueGroups = Object.values(muscleGroups).filter((group) => group?.fatigue === 'high').length
  const recentMaxEffortSets = Object.values(muscleGroups).reduce((sum, group) => sum + (group?.recentMaxEffortSets ?? 0), 0)
  const painFlagsLast14Days = normalizedHistory
    .filter((session) => daysBetween(new Date(session.completedAt), nowDate) <= 14)
    .flatMap((session) => session.exercises ?? [])
    .filter((exercise) => Boolean(exercise.pain)).length

  const recoveryStatus = computeRecoveryStatus({
    daysSinceLastWorkout,
    highFatigueGroups,
    recentMaxEffortSets,
    painFlagsLast14Days,
    userTrainingPolicy,
    trainingDataConfidence,
  })
  const readinessScore = computeReadinessScore({
    daysSinceLastWorkout,
    weeklyLoadRatio,
    highFatigueGroups,
    recentMaxEffortSets,
    painFlagsLast14Days,
    userTrainingPolicy,
    trainingDataConfidence,
    lastWorkoutQualityScore,
  })

  const mesocycle = computeMesocycleState({
    profile: profile as Parameters<typeof computeMesocycleState>[0]['profile'],
    history: normalizedHistory as unknown as WorkoutHistoryEntry[],
    coachMemory: coachMemory as Parameters<typeof computeMesocycleState>[0]['coachMemory'],
    now: nowDate,
  })

  // --- Adaptive volume landmark adjustments (Phase 3 issue #6) ---
  const phase = userTrainingPolicy?.ageRecoveryProfile?.phase ?? 'adult'
  const lastAdjustments = extractLastAdjustments(volumeLandmarkOverrides ?? {})
  const snapshots = buildAllMuscleVolumeSnapshots(
    normalizedHistory as unknown as Parameters<typeof buildAllMuscleVolumeSnapshots>[0],
    e1rmHistories ?? [],
    phase,
    nowDate,
    lastAdjustments,
  )
  const adjustmentDecisions = computeAllAdjustments(
    snapshots as Parameters<typeof computeAllAdjustments>[0],
    phase,
    nowDate,
  )
  const volumeAdjustmentLog = adjustmentDecisions.filter((a) => a.action !== 'hold')
  const effectiveVolumeLandmarks = mergeLandmarkOverrides(
    phase,
    volumeLandmarkOverrides ?? {},
    getVolumeLandmarks,
  )

  return {
    userId: profile.userId ?? profile.user_id ?? null,
    generatedAt: nowDate.toISOString(),
    daysSinceLastWorkout,
    lastWorkoutId: lastWorkout?.id ?? null,
    lastWorkoutDayId: lastWorkout?.workoutDayId ?? lastWorkout?.workout_day_id ?? null,
    actualWorkoutsLast7Days: workoutsLast7Days,
    plannedWorkoutsPerWeek,
    weeklyLoadStatus,
    recoveryStatus,
    readinessScore,
    muscleGroups,
    exercises,
    personalization: {
      trainingDataConfidence,
    },
    mesocycle,
    warnings: buildWarnings({ recoveryStatus, weeklyLoadStatus, painFlagsLast14Days, highFatigueGroups, mesocycle }),
    // Adaptive volume landmark state (Phase 3 issue #6)
    volumeLandmarkOverrides: effectiveVolumeLandmarks,
    volumeAdjustmentLog,
    volumeSnapshots: snapshots,
  }
}

function buildExerciseCatalog(workoutDays: WorkoutDayInput[]): Map<string, CatalogItem> {
  const catalog = new Map<string, CatalogItem>()
  for (const day of workoutDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (!id) continue
      catalog.set(id, {
        ...exercise,
        id,
        canonicalExerciseId: id,
        muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`),
      } as CatalogItem)
    }
  }
  return catalog
}

function buildMuscleGroupState({ history, exerciseCatalog, now }: BuildMuscleGroupStateInput): Record<string, MuscleGroupState> {
  const groups = new Map<string, MuscleGroupState>()
  for (const session of history ?? []) {
    const completedAt = new Date(session.completedAt)
    const ageDays = daysBetween(completedAt, now)
    if (ageDays > 14) continue
    for (const exercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(exercise)
      const catalogItem = exerciseCatalog.get(exerciseId)
      const muscleKey = catalogItem?.muscleKey ?? normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
      const current: MuscleGroupState = groups.get(muscleKey) ?? {
        fatigue: 'low',
        recentHardSets: 0,
        recentMaxEffortSets: 0,
        recentVolume: 0,
        lastTrainedDaysAgo: null,
      }
      const completedSets = completedSetsOf(exercise)
      const hardSets = ageDays <= 4 ? completedSets.filter((set) => Number(set.rpe) >= 9).length : 0
      const maxEffortSets = ageDays <= 3 ? completedSets.filter((set) => Number(set.rpe) >= 10).length : 0
      const volume = completedSets.reduce((sum, set) => sum + Number(set.weight ?? 0) * Number(set.reps ?? 0), 0)
      current.recentHardSets += hardSets
      current.recentMaxEffortSets += maxEffortSets
      current.recentVolume = roundNumber(current.recentVolume + volume)
      current.lastTrainedDaysAgo = current.lastTrainedDaysAgo === null ? wholeDaysBetween(completedAt, now) : Math.min(current.lastTrainedDaysAgo, wholeDaysBetween(completedAt, now))
      groups.set(muscleKey, current)
    }
  }

  const result: Record<string, MuscleGroupState> = {}
  for (const [key, group] of groups.entries()) {
    result[key] = {
      ...group,
      fatigue: classifyMuscleFatigue(group),
    }
  }
  return result
}

function buildExerciseState({ history, exerciseCatalog }: BuildExerciseStateInput): Record<string, ExerciseStateInfo> {
  const result: Record<string, ExerciseStateInfo> = {}
  for (const [exerciseId, catalogItem] of exerciseCatalog.entries()) {
    const sessions: Array<{ session: WorkoutHistoryEntryInput; exercise: WorkoutHistoryEntryInput['exercises'][number] }> = []
    for (const session of history ?? []) {
      const exercise = (session.exercises ?? []).find((item) => canonicalExerciseId(item) === exerciseId)
      if (exercise) sessions.push({ session, exercise })
    }
    const latest = sessions[0]
    if (!latest) {
      result[exerciseId] = {
        name: catalogItem.name,
        muscleGroup: catalogItem.muscleGroup,
        status: 'no_data',
        lastWeight: Number(catalogItem.targetWeight ?? 0),
        lastReps: null,
        maxEffortSets: 0,
        hardSets: 0,
        pain: false,
        target: 'собрать первые данные',
      }
      continue
    }
    const sets = completedSetsOf(latest.exercise)
    const lastSet = sets.at(-1) ?? {}
    const topSet = sets.reduce((best, set) => Number(set.weight ?? 0) > Number(best.weight ?? 0) ? set : best, lastSet)
    const maxEffortSets = sets.filter((set) => Number(set.rpe) >= 10).length
    const hardSets = sets.filter((set) => Number(set.rpe) >= 9).length
    const pain = Boolean(latest.exercise.pain)
    const allAtUpperRange = sets.length > 0 && sets.every((set) => Number(set.reps) >= Number(catalogItem.repMax ?? 999) && Number(set.rpe) <= 8)
    const status = pain ? 'pain' : maxEffortSets > 0 || hardSets >= 2 ? 'consolidate' : allAtUpperRange ? 'progress_possible' : 'hold'
    result[exerciseId] = {
      name: catalogItem.name,
      muscleGroup: catalogItem.muscleGroup,
      status,
      lastWeight: roundNumber(Number(topSet.weight ?? catalogItem.targetWeight ?? 0)),
      lastReps: lastSet.reps === undefined ? null : Number(lastSet.reps),
      maxEffortSets,
      hardSets,
      pain,
      target: targetTextForStatus(status, catalogItem.name),
    }
  }
  return result
}

function computeRecoveryStatus({ daysSinceLastWorkout, highFatigueGroups, recentMaxEffortSets, painFlagsLast14Days, userTrainingPolicy = null, trainingDataConfidence = 0 }: ComputeRecoveryStatusInput): string {
  if (daysSinceLastWorkout === null) return 'unknown'
  if (painFlagsLast14Days > 0 || daysSinceLastWorkout < 1 || recentMaxEffortSets >= 2) return 'low'
  if (daysSinceLastWorkout < 2 || highFatigueGroups > 0 || recentMaxEffortSets >= 1) return 'partial'
  const priorWeight = 1 - clampNumber(trainingDataConfidence, 0, 1, 0)
  const recoveryBuffer = Number(userTrainingPolicy?.ageRecoveryProfile?.sparseHistoryRecoveryBufferDays ?? 0)
  if (priorWeight > 0 && recoveryBuffer > 0 && daysSinceLastWorkout < 2 + recoveryBuffer) return 'partial'
  return 'ready'
}

function computeReadinessScore({ daysSinceLastWorkout, weeklyLoadRatio, highFatigueGroups, recentMaxEffortSets, painFlagsLast14Days, userTrainingPolicy = null, trainingDataConfidence = 0, lastWorkoutQualityScore = null }: ComputeReadinessScoreInput): number {
  let score = 75
  if (daysSinceLastWorkout === null) score -= 5
  else if (daysSinceLastWorkout < 1) score -= 35
  else if (daysSinceLastWorkout < 2) score -= 15
  else if (daysSinceLastWorkout >= 3) score += 10
  if (weeklyLoadRatio > 1.35) score -= 15
  if (weeklyLoadRatio < 0.5) score -= 5
  score -= highFatigueGroups * 8
  score -= recentMaxEffortSets * 7
  score -= painFlagsLast14Days * 20
  if (lastWorkoutQualityScore !== null) {
    if (lastWorkoutQualityScore >= 80) score += 5
    else if (lastWorkoutQualityScore >= 60) score += 2
    else if (lastWorkoutQualityScore >= 40) score -= 5
    else if (lastWorkoutQualityScore >= 20) score -= 10
    else score -= 15
  }
  // Issue #111: priorWeight must have a minimum floor (0.3) so the age-based
  // readiness adjustment is always applied, even after 8+ workouts. Without
  // this floor, teen (+5) and mature_adult (-8) adjustments are completely
  // ignored once trainingDataConfidence reaches 1.0.
  const priorWeight = 0.3 + (1 - clampNumber(trainingDataConfidence, 0, 1, 0)) * 0.7
  score += Number(userTrainingPolicy?.ageRecoveryProfile?.readinessPriorAdjustment ?? 0) * priorWeight
  return Math.max(0, Math.min(100, Math.round(score)))
}

function computeTrainingDataConfidence(history: WorkoutHistoryEntryInput[]): number {
  return clampNumber((history ?? []).length / 8, 0, 1, 0)
}

function classifyMuscleFatigue(group: MuscleGroupInfo): 'low' | 'medium' | 'high' | 'unknown' {
  const recentlyTrained = group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1
  if (group.recentMaxEffortSets > 0 || (recentlyTrained && group.recentHardSets >= 2)) return 'high'
  if (recentlyTrained || group.recentHardSets > 0) return 'medium'
  return 'low'
}

function buildWarnings({ recoveryStatus, weeklyLoadStatus, painFlagsLast14Days, highFatigueGroups, mesocycle }: BuildWarningsInput): string[] {
  const warnings: string[] = []
  if (recoveryStatus === 'low') warnings.push('восстановление низкое — следующую нагрузку стоит облегчить')
  if (weeklyLoadStatus === 'above_plan') warnings.push('фактическая частота выше анкеты — нужен контроль объёма')
  if (painFlagsLast14Days > 0) warnings.push('были отметки боли — упражнения с дискомфортом не прогрессировать')
  if (highFatigueGroups > 0) warnings.push('есть группы с высокой усталостью')
  if (mesocycle?.isDeload && mesocycle?.triggerReason) {
    warnings.push(`Разгрузочная неделя мезоцикла: ${mesocycle.triggerReason}`)
  }
  if (mesocycle?.deloadScheduled) {
    warnings.push('Следующая неделя — разгрузка по мезоциклу.')
  }
  return warnings
}

function completedSetsOf(exercise: WorkoutHistoryEntryInput['exercises'][number]): Array<{ weight?: number; reps?: number; rpe?: number; completed?: boolean }> {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
}

function targetTextForStatus(status: string, exerciseName = ''): string {
  if (status === 'progress_possible') {
    // For assisted exercises (gravitron, assisted dips) progression means
    // decreasing the counterweight, not increasing weight.
    const assisted = isAssistedExerciseName(exerciseName)
    return assisted ? 'можно уменьшать помощь' : 'можно повышать нагрузку'
  }
  if (status === 'consolidate') return 'закрепить вес без отказа'
  if (status === 'pain') return 'не прогрессировать и подобрать замену'
  if (status === 'no_data') return 'собрать первые данные'
  return 'держать качество и добрать план'
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor(daysBetween(from, to))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function roundNumber(value: unknown): number {
  return Number(Number(value).toFixed(1))
}
