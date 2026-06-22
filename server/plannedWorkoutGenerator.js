import { buildCoachDecision } from './coachDecision.js'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'

const COACH_PERSONA = 'Профиль тренера: персональный силовой тренер с приоритетом безопасной прогрессии, восстановления и недельного баланса нагрузки.'

export function buildGeneratedPlannedWorkout({ profile = {}, scheduledDate, coachState = {}, coachMemory = null, coachDecision = null, exerciseLibrary = [], history = [], previousGeneratedWorkouts = [] }) {
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const preferences = normalizePreferences(profile)
  const userTrainingPolicy = getUserTrainingPolicy(profile?.userId)
  const weeklyContext = buildWeeklyContext([...buildCompletedWorkoutContext(history, scheduledDate), ...previousGeneratedWorkouts], { scheduledDate, profile })
  const decision = coachDecision ?? buildCoachDecision({ profile, coachState, coachMemory, scheduledDate, previousGeneratedWorkouts })
  const readinessScore = Number(coachState?.readinessScore ?? 70)
  const recoveryStatus = String(coachState?.recoveryStatus ?? 'ready')
  const calendarRecoveryLimited = Number.isFinite(weeklyContext.daysSincePreviousWorkout) && weeklyContext.daysSincePreviousWorkout > 0 && weeklyContext.daysSincePreviousWorkout <= 1
  const calendarLoadLimited = weeklyContext.calendarLoadStatus === 'above_user_calendar'
  const lowReadiness = readinessScore < 55 || recoveryStatus === 'low' || coachState?.weeklyLoadStatus === 'above_plan' || decision.loadPolicy === 'moderate_no_failure' || calendarRecoveryLimited || calendarLoadLimited
  const targetMinutes = Number(profile?.targetWorkoutMinutes ?? 60)
  const exerciseTarget = targetExerciseCount({ targetMinutes, preferences })
  const targetPattern = chooseTargetPattern(coachState, preferences, decision, lowReadiness)

  const selected = []
  const usedExerciseIds = new Set()
  for (const muscleKey of targetPattern) {
    const candidate = chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision: decision, history, usedExerciseIds, lowReadiness, preferences, weeklyContext })
    if (!candidate) continue
    selected.push(applyPrescription({ exercise: candidate, profile, coachState, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy }))
    usedExerciseIds.add(candidate.id)
    if (selected.length >= exerciseTarget) break
  }

  if (selected.length < Math.min(3, exerciseTarget)) {
    const fillers = library
      .filter((exercise) => !usedExerciseIds.has(exercise.id))
      .filter((exercise) => !isBannedExercise(exercise, preferences))
      .filter((exercise) => !isRecoveryRestricted(exercise.muscleKey, weeklyContext))
      .filter((exercise) => !isCoachMemoryRestricted(exercise.muscleKey, coachMemory))
      .filter((exercise) => !isCoachDecisionRestricted(exercise, decision))
      .filter((exercise) => !isHighFatigue(exercise.muscleKey, coachState))
      .sort((a, b) => exerciseScore(b, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, decision) - exerciseScore(a, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, decision))
    for (const exercise of fillers) {
      selected.push(applyPrescription({ exercise, profile, coachState, coachDecision: decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy }))
      usedExerciseIds.add(exercise.id)
      if (selected.length >= exerciseTarget) break
    }
  }

  const selectedWithCoreFinisher = ensureCoreFinisher({
    selected,
    library,
    coachState,
    coachMemory,
    decision,
    history,
    lowReadiness,
    preferences,
    weeklyContext,
    userTrainingPolicy,
    profile,
    exerciseTarget,
  })
  const orderedSelected = orderExercisesForWorkout(selectedWithCoreFinisher)
  const workoutKind = lowReadiness ? 'восстановительная персональная' : 'персональная тренировка'
  return {
    scheduledDate,
    status: 'generated',
    source: 'coach',
    workoutDayId: null,
    workoutDayName: lowReadiness ? 'восстановительная персональная' : 'персональная тренировка',
    goal: lowReadiness
      ? `восстановительная нагрузка под цель: ${profile?.goal ?? 'общий прогресс'}`
      : `эффективная ${workoutKind} под цель: ${profile?.goal ?? 'общий прогресс'}`,
    coachReason: buildCoachReason({ coachState, coachMemory, coachDecision: decision, lowReadiness, scheduledDate, preferences, weeklyContext }),
    readinessSnapshot: { ...(coachState ?? {}), coachDecision: decision, userTrainingPolicy },
    exercises: orderedSelected.map((exercise, index) => ({ ...exercise, sortOrder: index + 1 })),
  }
}

function targetExerciseCount({ targetMinutes, preferences = {} }) {
  const minutes = Number(targetMinutes)
  const base = !Number.isFinite(minutes)
    ? 5
    : minutes >= 85 ? 7 : minutes >= 70 ? 6 : minutes <= 40 ? 4 : 5
  if (preferences.sessionStyle === 'heavy_short') return Math.max(4, base - 1)
  if (preferences.sessionStyle === 'volume_light') return Math.min(7, base + 1)
  return base
}

function orderExercisesForWorkout(exercises) {
  return [...(exercises ?? [])]
    .map((exercise, index) => ({ exercise, index }))
    .sort((left, right) => {
      const priorityDelta = exerciseOrderPriority(left.exercise) - exerciseOrderPriority(right.exercise)
      return priorityDelta || left.index - right.index
    })
    .map(({ exercise }) => exercise)
}

function ensureCoreFinisher({ selected, library, coachState, coachMemory, decision, history, lowReadiness, preferences, weeklyContext, userTrainingPolicy, profile, exerciseTarget }) {
  const current = [...(selected ?? [])]
  if (current.length === 0 || workoutIsCoreFocused(current) || current.some((exercise) => normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`) === 'core')) return current
  if (decision?.avoidMuscleGroups?.includes('core') || isRecoveryRestricted('core', weeklyContext) || isCoachMemoryRestricted('core', coachMemory)) return current

  const usedExerciseIds = new Set(current.map((exercise) => exercise.exerciseId))
  const coreCandidate = chooseBestExerciseForMuscle({
    muscleKey: 'core',
    library,
    coachState,
    coachMemory,
    coachDecision: decision,
    history,
    usedExerciseIds,
    lowReadiness,
    preferences,
    weeklyContext,
  })
  if (!coreCandidate) return current

  const coreExercise = applyPrescription({
    exercise: coreCandidate,
    profile,
    coachState,
    coachDecision: decision,
    history,
    lowReadiness,
    preferences,
    weeklyContext,
    userTrainingPolicy,
  })
  if (current.length <= exerciseTarget) return [...current, coreExercise]

  const replacementIndex = findCoreFinisherReplacementIndex(current)
  if (replacementIndex < 0) return current
  const next = [...current]
  next[replacementIndex] = coreExercise
  return next
}

function workoutIsCoreFocused(exercises) {
  const coreCount = (exercises ?? []).filter((exercise) => normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`) === 'core').length
  return coreCount > 0 && coreCount / Math.max(1, exercises.length) >= 0.6
}

function findCoreFinisherReplacementIndex(exercises) {
  for (let index = exercises.length - 1; index >= 0; index -= 1) {
    const exercise = exercises[index]
    const muscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.exerciseName ?? ''}`)
    const text = normalizeText(`${exercise.exerciseName ?? ''} ${exercise.muscleGroup ?? ''}`)
    if (muscleKey === 'core') return -1
    if (isIsolationOrAccessory(text, muscleKey) || muscleKey === 'arms' || muscleKey === 'shoulders') return index
  }
  return exercises.length - 1
}

function exerciseOrderPriority(exercise) {
  const text = normalizeText(`${exercise?.exerciseName ?? exercise?.name ?? ''} ${exercise?.muscleGroup ?? ''}`)
  const muscleKey = normalizeMuscleGroup(text)
  if (muscleKey === 'core') return 70
  if (isLowerBackAccessory(text)) return 55
  if (isPrimaryCompound(text, muscleKey)) return 10 + compoundMuscleOrder(muscleKey)
  if (isSecondaryCompound(text, muscleKey)) return 25 + compoundMuscleOrder(muscleKey)
  if (isIsolationOrAccessory(text, muscleKey)) return 45 + compoundMuscleOrder(muscleKey)
  if (muscleKey === 'arms') return 50
  if (muscleKey === 'shoulders') return 35
  return 60
}

function compoundMuscleOrder(muscleKey) {
  if (muscleKey === 'legs') return 1
  if (muscleKey === 'chest') return 2
  if (muscleKey === 'back') return 3
  if (muscleKey === 'shoulders') return 4
  return 5
}

function isPrimaryCompound(text, muscleKey) {
  if (muscleKey === 'legs' && /(присед|squat|станов|deadlift|румын|romanian|выпад|lunge)/u.test(text)) return true
  if (muscleKey === 'chest' && /(жим|bench|press|отжим)/u.test(text)) return true
  if (muscleKey === 'back' && /(тяга|row|pulldown|pull-up|подтяг)/u.test(text) && !isLowerBackAccessory(text)) return true
  return false
}

function isSecondaryCompound(text, muscleKey) {
  if (muscleKey === 'shoulders' && /(жим|press)/u.test(text)) return true
  if (muscleKey === 'legs' && /(leg press|жим ногами|step-up|болгар)/u.test(text)) return true
  return false
}

function isIsolationOrAccessory(text, muscleKey) {
  if (muscleKey === 'arms') return true
  if (muscleKey === 'legs' && /(сгиб|разгиб|curl|extension|икр|calf)/u.test(text)) return true
  if (muscleKey === 'shoulders' && /(развед|raise|face pull|мах)/u.test(text)) return true
  return false
}

function isLowerBackAccessory(text) {
  return /(гиперэкстенз|hyperextension|back extension|разгибание спины)/u.test(text)
}

function chooseTargetPattern(coachState, preferences = {}, coachDecision = null, lowReadiness = false) {
  const all = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core']
  const avoid = new Set(coachDecision?.avoidMuscleGroups ?? [])
  const fresh = all.filter((muscleKey) => !avoid.has(muscleKey) && !isHighFatigue(muscleKey, coachState))
  const hasFresh = (muscleKey) => fresh.includes(muscleKey)
  const pattern = []
  for (const priority of coachDecision?.priorityMuscleGroups ?? []) {
    if (hasFresh(priority) && !pattern.includes(priority)) pattern.push(priority)
  }
  for (const focus of preferences.focusMuscleKeys ?? []) {
    if (hasFresh(focus) && !pattern.includes(focus)) pattern.push(focus)
  }
  if (lowReadiness) {
    for (const key of ['back', 'shoulders', 'arms', 'core']) if (hasFresh(key) && !pattern.includes(key)) pattern.push(key)
    return pattern.length ? pattern : ['arms', 'shoulders', 'core'].filter((key) => !avoid.has(key))
  }
  if (hasFresh('legs')) pattern.push('legs', 'legs')
  if (hasFresh('back')) pattern.push('back')
  if (hasFresh('chest')) pattern.push('chest')
  if (hasFresh('shoulders')) pattern.push('shoulders')
  if (hasFresh('arms')) pattern.push('arms')
  if (hasFresh('core')) pattern.push('core')
  return pattern.length ? pattern : ['arms', 'shoulders', 'core'].filter((key) => !avoid.has(key))
}

function chooseBestExerciseForMuscle({ muscleKey, library, coachState, coachMemory, coachDecision, history, usedExerciseIds, lowReadiness, preferences, weeklyContext }) {
  if (isRecoveryRestricted(muscleKey, weeklyContext) || isCoachMemoryRestricted(muscleKey, coachMemory) || coachDecision?.avoidMuscleGroups?.includes(muscleKey)) return null
  const candidates = library
    .filter((exercise) => exercise.muscleKey === muscleKey)
    .filter((exercise) => !usedExerciseIds.has(exercise.id))
    .filter((exercise) => !isBannedExercise(exercise, preferences))
    .filter((exercise) => !isCoachDecisionRestricted(exercise, coachDecision))
    .filter((exercise) => lowReadiness ? !isHighFatigue(exercise.muscleKey, coachState) : true)
    .sort((a, b) => exerciseScore(b, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, coachDecision) - exerciseScore(a, coachState, history, lowReadiness, preferences, weeklyContext, coachMemory, coachDecision))
  return candidates[0] ?? null
}

function applyPrescription({ exercise, profile, coachState, coachDecision = null, history, lowReadiness, preferences = {}, weeklyContext = {}, userTrainingPolicy = null }) {
  const recent = latestExerciseHistory(history, exercise.id)
  const recentWeight = Number(recent?.nextRecommendedWeight ?? NaN)
  const baseWeight = Number.isFinite(recentWeight) && recentWeight >= 0 ? recentWeight : exercise.targetWeight
  const baseSetsCount = preferences.sessionStyle === 'volume_light'
    ? clamp(exercise.setsCount + 1, 2, 4)
    : clamp(exercise.setsCount, 2, preferences.sessionStyle === 'heavy_short' ? 3 : 4)
  const setsCount = baseSetsCount
  const repMin = lowReadiness ? Math.max(exercise.repMin, Math.min(exercise.repMax, 10)) : exercise.repMin
  const repMax = lowReadiness ? Math.max(repMin, exercise.repMax) : exercise.repMax
  const hasRecentWorkingWeight = Boolean(recent) && Number.isFinite(recentWeight)
  const policy = coachDecision?.exercisePolicies?.[exercise.id]
  const shouldConsolidate = policy === 'consolidate'
  const targetWeight = roundWeight(lowReadiness && baseWeight > 0 && !hasRecentWorkingWeight ? Math.max(0, baseWeight - exercise.weightStep) : baseWeight)
  const restSeconds = lowReadiness ? Math.min(120, Math.max(60, exercise.restSeconds)) : exercise.restSeconds
  const noFailurePolicy = userTrainingPolicy?.allowFailureSets === false
  const intensityTarget = lowReadiness || shouldConsolidate || noFailurePolicy || preferences.intensityTolerance === 'avoid_max'
    ? 'easy'
    : preferences.intensityTolerance === 'rare_max'
      ? 'controlled'
      : preferences.intensityTolerance === 'aggressive'
        ? 'max_effort_allowed'
        : intensityForGoal(profile?.goal)
  const focusText = noFailurePolicy
    ? 'контролируемая работа без отказа, техника важнее веса'
    : lowReadiness
      ? 'лёгкий контролируемый объём, без отказа'
      : 'рабочая нагрузка под цель, 1–2 повтора в запасе'
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    muscleGroup: exercise.muscleGroup,
    setsCount,
    repMin,
    repMax,
    targetWeight,
    weightStep: exercise.weightStep,
    restSeconds,
    intensityTarget,
    coachFocus: `${exercise.name}: ${shouldConsolidate ? 'закрепляем текущий вес, без повышения и без отказа' : focusText}.`,
    reason: reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext, policy }),
  }
}

function reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext = {}, policy = null }) {
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey]?.fatigue ?? 'unknown'
  const historyText = recent ? 'учтён последний рабочий вес' : 'стартовый вес взят из библиотеки'
  const loadText = lowReadiness ? 'нагрузка снижена из-за восстановления' : 'группа мышц доступна для работы'
  const diversityText = weeklyContext.previousExerciseIds?.size && !weeklyContext.previousExerciseIds.has(exercise.id)
    ? 'учтено разнообразие недели'
    : null
  const policyText = policy === 'consolidate' ? 'решение тренера: закрепить текущий вес' : null
  return `${loadText}; ${exercise.muscleGroup}: усталость ${fatigue}; ${historyText}${diversityText ? `; ${diversityText}` : ''}${policyText ? `; ${policyText}` : ''}.`
}

function buildCoachReason({ coachState, coachMemory, coachDecision, lowReadiness, scheduledDate, preferences = {}, weeklyContext = {} }) {
  const readiness = Number(coachState?.readinessScore ?? 70)
  const recovery = coachState?.recoveryStatus ?? 'unknown'
  const weekly = coachState?.weeklyLoadStatus ?? 'unknown'
  const focusText = preferences.focusAreas?.length ? `, фокус: ${preferences.focusAreas.join(', ')}` : ''
  const diversityText = weeklyContext.previousExerciseIds?.size ? ' Учитывается разнообразие недели: соседние тренировки не должны быть одинаковыми.' : ''
  const calendarText = weeklyContext.calendarWorkoutCountLast7 > 1
    ? ` Прогноз календаря: пользовательский календарь даёт ${weeklyContext.calendarWorkoutCountLast7}/${weeklyContext.effectiveWorkoutsPerWeek} тренировок за 7 дней${Number.isFinite(weeklyContext.daysSincePreviousWorkout) ? `, предыдущая за ${weeklyContext.daysSincePreviousWorkout} дн` : ''}.`
    : ''
  const recoveryGuardText = weeklyContext.recoveryRestrictedMuscleKeys?.has('legs') ? ' Для профиля «возвращение после перерыва» ноги не повторяются через один день отдыха.' : ''
  const decisionText = coachDecision?.summary ? ` Решение тренера: ${coachDecision.summary}` : ''
  const reasonText = coachDecision?.reasons?.length ? ` Почему: ${coachDecision.reasons.slice(0, 3).join(' ')}` : ''
  const memoryText = coachMemory?.summary && !coachDecision?.summary ? ` Память тренера: ${coachMemory.summary.replace(/^Память тренера:\s*/u, '')}` : ''
  return lowReadiness
    ? `${COACH_PERSONA} Coach State на ${scheduledDate}: readiness ${readiness}, восстановление ${recovery}, недельная нагрузка ${weekly}${focusText}. Собрана умеренная тренировка из наиболее свежих групп мышц.${diversityText}${calendarText}${recoveryGuardText}${decisionText}${reasonText}${memoryText}`
    : `${COACH_PERSONA} Coach State на ${scheduledDate}: readiness ${readiness}, восстановление ${recovery}${focusText}. Тренировка собрана по решению тренера, а не как случайный набор упражнений.${diversityText}${calendarText}${recoveryGuardText}${decisionText}${reasonText}${memoryText}`
}

function exerciseScore(exercise, coachState, history, lowReadiness, preferences = {}, weeklyContext = {}, coachMemory = null, coachDecision = null) {
  let score = 0
  if (isBannedExercise(exercise, preferences)) return -10000
  if (isCoachDecisionRestricted(exercise, coachDecision)) return -9800
  if (isCoachMemoryRestricted(exercise.muscleKey, coachMemory)) return -9500
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey]?.fatigue ?? 'low'
  if (fatigue === 'low') score += 30
  if (fatigue === 'medium') score += lowReadiness ? 0 : 12
  if (fatigue === 'high') score -= 100
  if (latestExerciseHistory(history, exercise.id)) score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'progress_possible') score += 8
  if (coachState?.exercises?.[exercise.id]?.status === 'pain') score -= 80
  if (lowReadiness && ['arms', 'shoulders', 'core', 'back'].includes(exercise.muscleKey)) score += 8
  if (!lowReadiness && ['legs', 'back', 'chest'].includes(exercise.muscleKey)) score += 5
  if (preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score += 14
  if (coachDecision?.priorityMuscleGroups?.includes(exercise.muscleKey)) score += 18
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'progress_possible') score += 8
  if (coachDecision?.exercisePolicies?.[exercise.id] === 'consolidate') score += 4
  if (preferences.preferredExerciseNames?.some((name) => matchesExercisePreference(exercise, name))) score += 20
  if (preferences.exerciseStyle === 'machines' && isMachineLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'free_weights' && isFreeWeightLike(exercise)) score += 10
  if (preferences.exerciseStyle === 'bodyweight' && exercise.targetWeight === 0) score += 12
  if (isRecoveryRestricted(exercise.muscleKey, weeklyContext)) score -= 9000
  if (weeklyContext.recentExerciseIds?.has(exercise.id)) score -= 120
  if (weeklyContext.previousExerciseIds?.has(exercise.id)) score -= 34
  const previousMuscleCount = weeklyContext.previousMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (previousMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 6
  const recentMuscleCount = weeklyContext.recentMuscleCounts?.get(exercise.muscleKey) ?? 0
  if (recentMuscleCount > 1 && !preferences.focusMuscleKeys?.includes(exercise.muscleKey)) score -= 18
  if (exercise.targetWeight > 0) score += 1
  return score
}

function buildWeeklyContext(previousGeneratedWorkouts = [], { scheduledDate, profile } = {}) {
  const previousExerciseIds = new Set()
  const recentExerciseIds = new Set()
  const previousMuscleCounts = new Map()
  const recentMuscleCounts = new Map()
  const recoveryRestrictedMuscleKeys = new Set()
  const returningAfterBreak = isReturningAfterBreak(profile)
  const plannedWorkoutsPerWeek = Math.max(1, Math.min(7, Math.round(Number(profile?.workoutsPerWeek ?? 3) || 3)))
  let previousWorkoutCountLast7 = 0
  let calendarWorkoutCountLast7 = 1
  let daysSincePreviousWorkout = null
  const seenWorkoutDates = new Set([String(scheduledDate ?? '').slice(0, 10)])
  for (const workout of previousGeneratedWorkouts ?? []) {
    const daysSinceWorkout = daysBetweenDates(workout?.scheduledDate, scheduledDate)
    const workoutDateKey = String(workout?.scheduledDate ?? '').slice(0, 10)
    if (workoutDateKey && seenWorkoutDates.has(workoutDateKey)) continue
    if (workoutDateKey) seenWorkoutDates.add(workoutDateKey)
    if (Number.isFinite(daysSinceWorkout) && Math.abs(daysSinceWorkout) <= 6) {
      calendarWorkoutCountLast7 += 1
    }
    if (Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 7) {
      previousWorkoutCountLast7 += 1
      daysSincePreviousWorkout = daysSincePreviousWorkout === null ? daysSinceWorkout : Math.min(daysSincePreviousWorkout, daysSinceWorkout)
    }
    for (const exercise of workout?.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (id) previousExerciseIds.add(id)
      if (id && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) recentExerciseIds.add(id)
      const muscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.exerciseName ?? exercise.name ?? ''}`)
      if (muscleKey !== 'other') previousMuscleCounts.set(muscleKey, (previousMuscleCounts.get(muscleKey) ?? 0) + 1)
      if (muscleKey !== 'other' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 3) {
        recentMuscleCounts.set(muscleKey, (recentMuscleCounts.get(muscleKey) ?? 0) + 1)
      }
      if (returningAfterBreak && muscleKey === 'legs' && Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 2) {
        recoveryRestrictedMuscleKeys.add('legs')
      }
    }
  }
  const effectiveWorkoutsPerWeek = Math.max(plannedWorkoutsPerWeek, calendarWorkoutCountLast7)
  const calendarLoadStatus = calendarWorkoutCountLast7 > effectiveWorkoutsPerWeek
    ? 'above_user_calendar'
    : calendarWorkoutCountLast7 >= effectiveWorkoutsPerWeek
      ? 'at_user_calendar'
      : 'below_plan'
  return {
    previousExerciseIds,
    recentExerciseIds,
    previousMuscleCounts,
    recentMuscleCounts,
    recoveryRestrictedMuscleKeys,
    previousWorkoutCountLast7,
    plannedWorkoutsPerWeek,
    calendarWorkoutCountLast7,
    effectiveWorkoutsPerWeek,
    daysSincePreviousWorkout,
    calendarLoadStatus,
  }
}

function buildCompletedWorkoutContext(history = [], scheduledDate) {
  return (history ?? [])
    .filter((workout) => {
      const daysSinceWorkout = daysBetweenDates(workout?.completedAt ?? workout?.completed_at, scheduledDate)
      return Number.isFinite(daysSinceWorkout) && daysSinceWorkout > 0 && daysSinceWorkout <= 7
    })
    .map((workout) => ({
      scheduledDate: String(workout.completedAt ?? workout.completed_at).slice(0, 10),
      exercises: workout.exercises ?? [],
    }))
}

function isRecoveryRestricted(muscleKey, weeklyContext = {}) {
  return weeklyContext.recoveryRestrictedMuscleKeys?.has(muscleKey) ?? false
}

function isCoachMemoryRestricted(muscleKey, coachMemory = null) {
  return coachMemory?.muscleGroupProfiles?.[muscleKey]?.status === 'avoid'
}

function isCoachDecisionRestricted(exercise, coachDecision = null) {
  if (!coachDecision) return false
  if (coachDecision.avoidMuscleGroups?.includes(exercise.muscleKey)) return true
  return coachDecision.exercisePolicies?.[exercise.id] === 'avoid_today'
}

function isReturningAfterBreak(profile = {}) {
  const level = normalizeText(profile?.level)
  return level.includes('перерыв') || level.includes('возвращ') || level.includes('return') || level.includes('beginner') || level.includes('нович')
}

function daysBetweenDates(fromDate, toDate) {
  if (!fromDate || !toDate) return Number.NaN
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`)
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function normalizeExerciseLibrary(exerciseLibrary) {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise),
    name: exercise.name,
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group ?? '',
    muscleKey: normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`),
    setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 8),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
    restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 90),
  })).filter((exercise) => exercise.id && exercise.name)
}

function normalizePreferences(profile = {}) {
  const preferences = profile.preferences ?? {}
  const focusAreas = Array.isArray(preferences.focusAreas) ? preferences.focusAreas.map(String).filter(Boolean) : []
  const bannedExerciseNames = Array.isArray(profile.bannedExercises) ? profile.bannedExercises.map(normalizeText).filter(Boolean) : []
  const preferredExerciseNames = Array.isArray(profile.preferredExercises) ? profile.preferredExercises.map(normalizeText).filter(Boolean) : []
  return {
    focusAreas,
    focusMuscleKeys: focusAreas.map(normalizeMuscleGroup).filter((key) => key !== 'other'),
    bannedExerciseNames,
    preferredExerciseNames,
    exerciseStyle: typeof preferences.exerciseStyle === 'string' ? preferences.exerciseStyle : 'mixed',
    intensityTolerance: typeof preferences.intensityTolerance === 'string' ? preferences.intensityTolerance : 'normal',
    sessionStyle: typeof preferences.sessionStyle === 'string' ? preferences.sessionStyle : 'moderate_stable',
  }
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

function matchesExercisePreference(exercise, preference) {
  const normalized = normalizeText(preference)
  if (!normalized) return false
  return normalizeText(exercise.id).includes(normalized) || normalizeText(exercise.name).includes(normalized)
}

function isBannedExercise(exercise, preferences) {
  return preferences?.bannedExerciseNames?.some((name) => matchesExercisePreference(exercise, name)) ?? false
}

function isMachineLike(exercise) {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('тренаж') || text.includes('блок') || text.includes('машин') || text.includes('machine') || text.includes('cable')
}

function isFreeWeightLike(exercise) {
  const text = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  return text.includes('штанг') || text.includes('гантел') || text.includes('barbell') || text.includes('dumbbell')
}

function latestExerciseHistory(history, exerciseId) {
  return [...(history ?? [])]
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .flatMap((workout) => workout.exercises ?? [])
    .find((exercise) => canonicalExerciseId(exercise) === canonicalExerciseId(exerciseId))
}

function intensityForGoal(goal) {
  const text = String(goal ?? '').toLowerCase()
  if (text.includes('сил')) return 'strength_quality'
  if (text.includes('масс') || text.includes('рост')) return 'hypertrophy'
  return 'normal'
}

function isHighFatigue(muscleKey, coachState) {
  return coachState?.muscleGroups?.[muscleKey]?.fatigue === 'high'
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, Math.round(number)))
}

function roundWeight(value) {
  return Number(Number(value).toFixed(1))
}
