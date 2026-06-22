import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, MUSCLE_LABELS } from './lib/muscleGroups.js'

const TRAINER_PROFILE = 'Профиль тренера: персональный силовой тренер: безопасность, техника, постепенная прогрессия, восстановление и недельный баланс важнее случайного набора упражнений.'

export function computeCoachMemory({ profile = {}, exerciseLibrary = [], history = [], coachState = null, coachDecisionLogs = [], now = new Date() }) {
  const nowDate = new Date(now)
  const normalizedHistory = [...(history ?? [])]
    .filter((session) => session?.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const exerciseProfiles = buildExerciseProfiles({ library, history: normalizedHistory, profile })
  const muscleGroupProfiles = buildMuscleGroupProfiles({ library, history: normalizedHistory, now: nowDate, profile, coachState })
  const weeklyBalance = buildWeeklyBalance({ profile, history: normalizedHistory, library, now: nowDate })
  const recommendations = buildRecommendations({ profile, muscleGroupProfiles, exerciseProfiles, weeklyBalance, coachState, coachDecisionLogs })
  const summary = buildSummary({ muscleGroupProfiles, weeklyBalance, recommendations })

  return {
    userId: profile.userId ?? profile.user_id ?? null,
    generatedAt: nowDate.toISOString(),
    trainerProfile: TRAINER_PROFILE,
    exerciseProfiles,
    muscleGroupProfiles,
    weeklyBalance,
    recommendations,
    summary,
  }
}

function buildExerciseProfiles({ library, history, profile }) {
  const profiles = {}
  for (const exercise of library) {
    const sessions = []
    for (const session of history) {
      const loggedExercise = (session.exercises ?? []).find((item) => canonicalExerciseId(item) === exercise.id)
      if (loggedExercise) sessions.push({ session, exercise: loggedExercise })
    }
    const latest = sessions[0]
    if (!latest) {
      profiles[exercise.id] = {
        id: exercise.id,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        muscleKey: exercise.muscleKey,
        status: 'no_data',
        currentWorkingWeight: Number(exercise.targetWeight ?? 0),
        lastReps: null,
        lastTrainedAt: null,
        recentSessions: 0,
        hardSets: 0,
        maxEffortSets: 0,
        pain: false,
        recommendation: 'собрать первые данные',
      }
      continue
    }
    const sets = completedSetsOf(latest.exercise)
    const lastSet = sets.at(-1) ?? {}
    const topWeight = sets.reduce((best, set) => Number(set.weight ?? 0) > Number(best.weight ?? 0) ? set : best, lastSet)
    const hardSets = sets.filter((set) => Number(set.rpe) >= 9).length
    const maxEffortSets = sets.filter((set) => Number(set.rpe) >= 10).length
    const pain = Boolean(latest.exercise.pain)
    const allAtUpperRange = sets.length > 0 && sets.every((set) => Number(set.reps) >= Number(exercise.repMax ?? 999) && Number(set.rpe) <= 8)
    const status = pain
      ? 'pain'
      : maxEffortSets > 0 || hardSets >= 2 || (profileIsReturningAfterBreak(profile) && hardSets >= 1)
        ? 'consolidate'
        : allAtUpperRange
          ? 'progress_possible'
          : 'hold'
    profiles[exercise.id] = {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      muscleKey: exercise.muscleKey,
      status,
      currentWorkingWeight: roundNumber(Number(topWeight.weight ?? latest.exercise.nextRecommendedWeight ?? exercise.targetWeight ?? 0)),
      lastReps: lastSet.reps === undefined ? null : Number(lastSet.reps),
      lastTrainedAt: latest.session.completedAt,
      recentSessions: sessions.length,
      hardSets,
      maxEffortSets,
      pain,
      recommendation: recommendationForExerciseStatus(status),
    }
  }
  return profiles
}

function buildMuscleGroupProfiles({ library, history, now, profile, coachState }) {
  const profiles = {}
  for (const exercise of library) {
    const key = exercise.muscleKey
    if (!profiles[key]) profiles[key] = emptyMuscleProfile(key)
  }

  for (const session of history) {
    const completedAt = new Date(session.completedAt)
    const ageDays = daysBetween(completedAt, now)
    if (ageDays > 14) continue
    for (const loggedExercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(loggedExercise)
      const libraryExercise = library.find((item) => item.id === exerciseId)
      const muscleKey = libraryExercise?.muscleKey ?? normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? ''} ${loggedExercise.exerciseName ?? ''}`)
      const profileEntry = profiles[muscleKey] ?? emptyMuscleProfile(muscleKey)
      const sets = completedSetsOf(loggedExercise)
      const hardSets = sets.filter((set) => Number(set.rpe) >= 9).length
      const maxEffortSets = sets.filter((set) => Number(set.rpe) >= 10).length
      profileEntry.workingSetsLast7Days += ageDays <= 7 ? sets.length : 0
      profileEntry.heavySetsLast7Days += ageDays <= 7 ? hardSets : 0
      profileEntry.maxEffortSetsLast7Days += ageDays <= 7 ? maxEffortSets : 0
      profileEntry.recentVolume = roundNumber(profileEntry.recentVolume + sets.reduce((sum, set) => sum + Number(set.weight ?? 0) * Number(set.reps ?? 0), 0))
      profileEntry.lastTrainedDaysAgo = profileEntry.lastTrainedDaysAgo === null ? wholeDaysBetween(completedAt, now) : Math.min(profileEntry.lastTrainedDaysAgo, wholeDaysBetween(completedAt, now))
      profileEntry.pain = profileEntry.pain || Boolean(loggedExercise.pain)
      profiles[muscleKey] = profileEntry
    }
  }

  for (const profileEntry of Object.values(profiles)) {
    const stateGroup = coachState?.muscleGroups?.[profileEntry.key]
    profileEntry.fatigue = stateGroup?.fatigue ?? classifyFatigue(profileEntry)
    profileEntry.status = classifyMuscleStatus(profileEntry, profile)
    profileEntry.label = MUSCLE_LABELS[profileEntry.key] ?? profileEntry.key
  }
  return profiles
}

function buildWeeklyBalance({ profile, history, library, now }) {
  const muscleSetCounts = {}
  const completedWorkoutsLast7Days = history.filter((session) => daysBetween(new Date(session.completedAt), now) <= 7).length
  for (const session of history) {
    if (daysBetween(new Date(session.completedAt), now) > 7) continue
    for (const loggedExercise of session.exercises ?? []) {
      const exerciseId = canonicalExerciseId(loggedExercise)
      const libraryExercise = library.find((item) => item.id === exerciseId)
      const muscleKey = libraryExercise?.muscleKey ?? normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? ''} ${loggedExercise.exerciseName ?? ''}`)
      muscleSetCounts[muscleKey] = (muscleSetCounts[muscleKey] ?? 0) + completedSetsOf(loggedExercise).length
    }
  }
  const plannedWorkoutsPerWeek = clampNumber(profile.workoutsPerWeek, 1, 7, 3)
  return {
    plannedWorkoutsPerWeek,
    completedWorkoutsLast7Days,
    loadStatus: completedWorkoutsLast7Days >= plannedWorkoutsPerWeek + 1 ? 'above_plan' : completedWorkoutsLast7Days >= plannedWorkoutsPerWeek ? 'on_plan' : 'below_plan',
    muscleSetCounts,
    focusAreas: Array.isArray(profile.preferences?.focusAreas) ? profile.preferences.focusAreas : [],
  }
}

function buildRecommendations({ profile, muscleGroupProfiles, exerciseProfiles, weeklyBalance, coachState, coachDecisionLogs = [] }) {
  const recommendations = []
  if (profileIsReturningAfterBreak(profile) && muscleGroupProfiles.legs?.status === 'avoid') {
    recommendations.push('Ноги ещё восстанавливаются — не ставить тяжёлую нагрузку ног в ближайшую тренировку.')
  }
  const consolidate = Object.values(exerciseProfiles).filter((exercise) => exercise.status === 'consolidate').slice(0, 2)
  for (const exercise of consolidate) recommendations.push(`${exercise.name}: закрепить текущий вес без отказа.`)
  if (weeklyBalance.loadStatus === 'below_plan') recommendations.push('Недельная частота ниже плана — следующую тренировку лучше сделать умеренной, а не максимальной.')
  if (coachState?.warnings?.length) recommendations.push(...coachState.warnings.slice(0, 2))
  for (const log of coachDecisionLogs.slice(0, 2)) {
    if (log?.decisionSummary) recommendations.push(log.decisionSummary)
  }
  return [...new Set(recommendations)].slice(0, 5)
}

function buildSummary({ muscleGroupProfiles, weeklyBalance, recommendations }) {
  const statuses = Object.values(muscleGroupProfiles)
    .filter((group) => group.lastTrainedDaysAgo !== null)
    .sort((a, b) => Number(a.lastTrainedDaysAgo) - Number(b.lastTrainedDaysAgo))
    .slice(0, 3)
    .map((group) => `${group.label}: ${statusText(group.status)}`)
  const firstRecommendation = recommendations[0] ? ` ${recommendations[0]}` : ''
  return `Память тренера: ${weeklyBalance.completedWorkoutsLast7Days}/${weeklyBalance.plannedWorkoutsPerWeek} тренировок за 7 дней. ${statuses.join('; ')}.${firstRecommendation}`
}

function emptyMuscleProfile(key) {
  return {
    key,
    label: MUSCLE_LABELS[key] ?? key,
    status: 'ready',
    fatigue: 'low',
    lastTrainedDaysAgo: null,
    workingSetsLast7Days: 0,
    heavySetsLast7Days: 0,
    maxEffortSetsLast7Days: 0,
    recentVolume: 0,
    pain: false,
  }
}

function classifyMuscleStatus(group, profile) {
  if (group.pain) return 'avoid'
  if (profileIsReturningAfterBreak(profile) && group.key === 'legs' && group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 2) return 'avoid'
  if (group.fatigue === 'high') return 'fatigued'
  if (group.fatigue === 'medium' || (group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1)) return 'medium'
  return 'ready'
}

function classifyFatigue(group) {
  if (group.maxEffortSetsLast7Days > 0 || group.heavySetsLast7Days >= 3) return 'high'
  if (group.heavySetsLast7Days > 0 || (group.lastTrainedDaysAgo !== null && group.lastTrainedDaysAgo <= 1)) return 'medium'
  return 'low'
}

function recommendationForExerciseStatus(status) {
  if (status === 'progress_possible') return 'можно осторожно повышать нагрузку'
  if (status === 'consolidate') return 'закрепить вес без отказа'
  if (status === 'pain') return 'не прогрессировать и подобрать замену'
  if (status === 'no_data') return 'собрать первые данные'
  return 'держать качество и добрать план'
}

function normalizeExerciseLibrary(exerciseLibrary) {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise),
    name: exercise.name,
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 8),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
  })).filter((exercise) => exercise.id && exercise.name)
}

function completedSetsOf(exercise) {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
}

function profileIsReturningAfterBreak(profile = {}) {
  const level = String(profile.level ?? '').toLowerCase()
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

function statusText(status) {
  if (status === 'avoid') return 'не грузить тяжело'
  if (status === 'fatigued') return 'усталость высокая'
  if (status === 'medium') return 'умеренно'
  return 'готова'
}

function daysBetween(from, to) {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

function wholeDaysBetween(from, to) {
  const fromDay = new Date(`${new Date(from).toISOString().slice(0, 10)}T00:00:00.000Z`)
  const toDay = new Date(`${new Date(to).toISOString().slice(0, 10)}T00:00:00.000Z`)
  return Math.floor(daysBetween(fromDay, toDay))
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function roundNumber(value) {
  return Number(Number(value).toFixed(1))
}
