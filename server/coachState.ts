// @ts-nocheck — gradual TS migration (issue #4); types will be tightened in follow-up
import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, isAssistedExerciseName } from './lib/muscleGroups.js'
import { computeMesocycleState } from './mesocycle.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'
import { computeAllAdjustments } from './adaptiveVolumeLandmarks.js'
import { buildAllMuscleVolumeSnapshots } from './buildVolumeSnapshot.js'
import { extractLastAdjustments, mergeLandmarkOverrides } from './volumeLandmarkOverrides.js'

export function computeCoachState({ profile = {}, workoutDays = [], history = [], now = new Date(), lastWorkoutQualityScore = null, coachMemory = null, volumeLandmarkOverrides = null, e1rmHistories = null }) {
  const nowDate = new Date(now)
  const normalizedHistory = [...(history ?? [])]
    .filter((session) => session?.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())

  const lastWorkout = normalizedHistory[0] ?? null
  const userTrainingPolicy = getUserTrainingPolicy(profile)
  const trainingDataConfidence = computeTrainingDataConfidence(normalizedHistory)
  const daysSinceLastWorkout = lastWorkout ? wholeDaysBetween(new Date(lastWorkout.completedAt), nowDate) : null
  const workoutsLast7Days = normalizedHistory.filter((session) => daysBetween(new Date(session.completedAt), nowDate) <= 7).length
  const plannedWorkoutsPerWeek = clampNumber(profile.workoutsPerWeek, 1, 7, 3)
  const weeklyLoadRatio = plannedWorkoutsPerWeek > 0 ? workoutsLast7Days / plannedWorkoutsPerWeek : 0
  const weeklyLoadStatus = weeklyLoadRatio >= 1.35 ? 'above_plan' : weeklyLoadRatio >= 0.75 ? 'on_plan' : 'below_plan'

  const exerciseCatalog = buildExerciseCatalog(workoutDays)
  const muscleGroups = buildMuscleGroupState({ history: normalizedHistory, exerciseCatalog, now: nowDate })
  const exercises = buildExerciseState({ history: normalizedHistory, exerciseCatalog })
  const highFatigueGroups = Object.values(muscleGroups).filter((group) => group.fatigue === 'high').length
  const recentMaxEffortSets = Object.values(muscleGroups).reduce((sum, group) => sum + group.recentMaxEffortSets, 0)
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

  const mesocycle = computeMesocycleState({ profile, history, coachMemory, now: nowDate })

  // --- Adaptive volume landmark adjustments (Phase 3 issue #6) ---
  // Build snapshots from history + e1RM trends, compute adjustments, and
  // merge with existing overrides to produce the effective landmark table.
  // The caller (loadCoachMemoryForUser) is responsible for persisting any
  // non-hold decisions via saveVolumeLandmarkAdjustments().
  const phase = userTrainingPolicy?.ageRecoveryProfile?.phase ?? 'adult'
  const lastAdjustments = extractLastAdjustments(volumeLandmarkOverrides ?? {})
  const snapshots = buildAllMuscleVolumeSnapshots(
    normalizedHistory,
    e1rmHistories ?? [],
    phase,
    nowDate,
    lastAdjustments,
  )
  const adjustmentDecisions = computeAllAdjustments(snapshots, phase, nowDate)
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

function buildExerciseCatalog(workoutDays: any) {
  const catalog = new Map()
  for (const day of workoutDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (!id) continue
      catalog.set(id, {
        ...exercise,
        id,
        canonicalExerciseId: id,
        muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`),
      })
    }
  }
  return catalog
}

function buildMuscleGroupState({ history, exerciseCatalog, now }: any) {
  const groups = new Map()
  for (const session of history ?? []) {
    const completedAt = new Date(session.completedAt)
    const ageDays = daysBetween(completedAt, now)
    if (ageDays > 14) continue
    for (const exercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(exercise)
      const catalogItem = exerciseCatalog.get(exerciseId)
      const muscleKey = catalogItem?.muscleKey ?? normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
      const current = groups.get(muscleKey) ?? {
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

  const result = {}
  for (const [key, group] of groups.entries()) {
    result[key] = {
      ...group,
      fatigue: classifyMuscleFatigue(group),
    }
  }
  return result
}

function buildExerciseState({ history, exerciseCatalog }: any) {
  const result = {}
  for (const [exerciseId, catalogItem] of exerciseCatalog.entries()) {
    const sessions = []
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

function computeRecoveryStatus({ daysSinceLastWorkout, highFatigueGroups, recentMaxEffortSets, painFlagsLast14Days, userTrainingPolicy = null, trainingDataConfidence = 0 }: any) {
  if (daysSinceLastWorkout === null) return 'unknown'
  if (painFlagsLast14Days > 0 || daysSinceLastWorkout < 1 || recentMaxEffortSets >= 2) return 'low'
  if (daysSinceLastWorkout < 2 || highFatigueGroups > 0 || recentMaxEffortSets >= 1) return 'partial'
  const priorWeight = 1 - clampNumber(trainingDataConfidence, 0, 1, 0)
  const recoveryBuffer = Number(userTrainingPolicy?.ageRecoveryProfile?.sparseHistoryRecoveryBufferDays ?? 0)
  if (priorWeight > 0 && recoveryBuffer > 0 && daysSinceLastWorkout < 2 + recoveryBuffer) return 'partial'
  return 'ready'
}

function computeReadinessScore({ daysSinceLastWorkout, weeklyLoadRatio, highFatigueGroups, recentMaxEffortSets, painFlagsLast14Days, userTrainingPolicy = null, trainingDataConfidence = 0, lastWorkoutQualityScore = null }: any) {
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
  const priorWeight = 1 - clampNumber(trainingDataConfidence, 0, 1, 0)
  score += Number(userTrainingPolicy?.ageRecoveryProfile?.readinessPriorAdjustment ?? 0) * priorWeight
  return Math.max(0, Math.min(100, Math.round(score)))
}

function computeTrainingDataConfidence(history: any) {
  return clampNumber((history ?? []).length / 8, 0, 1, 0)
}

function classifyMuscleFatigue(group: any) {
  const recentlyTrained = group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1
  if (group.recentMaxEffortSets > 0 || (recentlyTrained && group.recentHardSets >= 2)) return 'high'
  if (recentlyTrained || group.recentHardSets > 0) return 'medium'
  return 'low'
}

function buildWarnings({ recoveryStatus, weeklyLoadStatus, painFlagsLast14Days, highFatigueGroups, mesocycle }: any) {
  const warnings = []
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

function completedSetsOf(exercise: any) {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
}

function targetTextForStatus(status, exerciseName = '') {
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

function daysBetween(from: any, to: any) {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

function wholeDaysBetween(from: any, to: any) {
  return Math.floor(daysBetween(from, to))
}

function clampNumber(value: any, min: any, max: any, fallback: any) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function roundNumber(value: any) {
  return Number(Number(value).toFixed(1))
}
