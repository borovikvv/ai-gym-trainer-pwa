import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup, labelForLower } from './lib/muscleGroups.js'
import { formatWeight, roundWeight } from './lib/format.js'
import { getVolumeLandmarks, classifyVolumeStatus, getVolumeRecommendation } from './volumeLandmarks.js'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { isDeloadWeek, applyDeloadReduction } from './mesocycle.js'

const russianWeekdayOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export const COACH_PERSONA = 'Профиль тренера: персональный силовой тренер, спокойный и строгий по технике. Приоритеты: безопасность, постепенная прогрессия, восстановление, баланс недели, понятные короткие подсказки. Не гони пользователя в отказ без причины, не создавай две одинаковые ближайшие тренировки, не ставь запрещённые упражнения и не ломай цель анкеты.'

export function buildSafeCoachPlan({ profile, workoutDays, completedWorkout, history = [], now = new Date(), coachState = null, exerciseLibrary = [], workoutQualityScore = null }) {
  const nextWorkoutDay = chooseNextWorkoutDay({ workoutDays, completedWorkout, now, profile })
  if (!nextWorkoutDay) {
    return {
      source: 'rules',
      summary: 'Не удалось определить следующую тренировку: нет активных дней программы.',
      nextWorkoutDayId: null,
      changes: [],
      warnings: ['Нет активных тренировочных дней.'],
    }
  }

  const daysUntilNext = daysUntilNextTrainingDay(profile?.trainingDays ?? [], nextWorkoutDay, workoutDays, now)
  const recoveryNote = daysUntilNext !== null && daysUntilNext <= 0
    ? 'следующая тренировка сегодня — держим объём умеренным и без отказа'
    : 'после текущей тренировки даём рабочую, но контролируемую нагрузку'

  const mesocycleDeload = isDeloadWeek(coachState?.mesocycle)

  const library = normalizeExerciseLibrary(exerciseLibrary)
  const usedExerciseIds = new Set((workoutDays ?? []).flatMap((day) => (day.exercises ?? []).map((exercise) => canonicalExerciseId(exercise))))
  const changes = nextWorkoutDay.exercises.map((exercise) => {
    const recent = latestExerciseHistory(history, exercise.exerciseId)
    let targetWeight = recent?.nextRecommendedWeight ?? exercise.targetWeight
    const hadPain = Boolean(recent?.pain)
    const hardRecent = (recent?.sets ?? []).some((set) => set.completed && set.rpe >= 9)
    let setsCount = daysUntilNext !== null && daysUntilNext <= 0 ? Math.max(2, Math.min(exercise.setsCount, 2)) : exercise.setsCount
    if (workoutQualityScore !== null && workoutQualityScore < 40) {
      setsCount = Math.min(setsCount, 2)
    } else if (workoutQualityScore !== null && workoutQualityScore < 60) {
      setsCount = Math.min(setsCount, 3)
    }
    const qualityNote = workoutQualityScore !== null && workoutQualityScore < 60
      ? 'Качество прошлой тренировки низкое — снижаем объём и держим технику. '
      : ''

    // Volume landmark awareness: clamp sets if weekly volume is approaching MRV
    let muscleGroupSetsLast7Days = 0
    const ageProfile = getUserTrainingPolicy(profile?.userId ?? profile)
    const phase = ageProfile?.ageRecoveryProfile?.phase ?? 'adult'
    const volumeMuscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`)
    const landmarks = getVolumeLandmarks(volumeMuscleKey, phase)

    if (landmarks) {
      // Count sets for this muscle group in the last 7 days from history
      const nowMs = new Date().getTime()
      const sevenDaysAgoMs = nowMs - 7 * 86_400_000
      for (const session of history ?? []) {
        const sessionTime = new Date(session.completedAt ?? session.completed_at).getTime()
        if (sessionTime < sevenDaysAgoMs) continue
        for (const loggedExercise of session.exercises ?? []) {
          const emk = normalizeMuscleGroup(`${loggedExercise.muscleGroup ?? loggedExercise.muscle_group ?? ''} ${loggedExercise.exerciseName ?? loggedExercise.name ?? ''}`)
          if (emk === volumeMuscleKey) {
            muscleGroupSetsLast7Days += (loggedExercise.sets ?? []).filter((s) => s?.completed !== false && Number(s?.reps) > 0).length
          }
        }
      }
      const volumeStatus = classifyVolumeStatus(muscleGroupSetsLast7Days, landmarks)
      if (volumeStatus === 'at_mrv' || volumeStatus === 'above_mrv') {
        setsCount = Math.min(setsCount, 2)
      } else if (volumeStatus === 'above_mav') {
        setsCount = Math.min(setsCount, 3)
      }
    }
    const volumeRec = landmarks ? getVolumeRecommendation(volumeMuscleKey, muscleGroupSetsLast7Days, phase) : null
    let volumeNote = volumeRec && volumeRec.priority >= 3 ? `Объём на ${volumeMuscleKey} высокий — снижаем подходы. ` : ''

    // Mesocycle deload: reduce sets, weight, and rep range. Unlike the
    // previous implementation which only updated setsCount and put the rest
    // of the reduction into a text note (resulting in mismatch: the coach
    // said "разгрузка, вес -2.5 кг" but baseChange.targetWeight still had
    // the full working weight), now we apply all fields consistently.
    let deloadRepMin = exercise.repMin
    let deloadRepMax = exercise.repMax
    let deloadIntensityTarget
    if (mesocycleDeload) {
      const deload = applyDeloadReduction({
        setsCount,
        targetWeight,
        repMin: exercise.repMin,
        repMax: exercise.repMax,
        weightStep: exercise.weightStep,
      })
      setsCount = deload.setsCount
      targetWeight = deload.targetWeight
      deloadRepMin = deload.repMin
      deloadRepMax = deload.repMax
      deloadIntensityTarget = deload.intensityTarget
      if (!volumeNote.includes('Разгрузка')) {
        volumeNote = deload.deloadNote + ' ' + volumeNote
      }
    }

    const baseChange = {
      programExerciseId: exercise.programExerciseId,
      targetWeight: roundWeight(targetWeight),
      setsCount,
      repMin: deloadRepMin,
      repMax: deloadRepMax,
      intensityTarget: deloadIntensityTarget,
      restSeconds: exercise.restSeconds,
      todayGoal: formatTodayGoal(targetWeight, setsCount, deloadRepMin),
      coachFocus: hadPain
        ? `${exercise.name}: была боль в истории — вес не повышаем, техника и амплитуда важнее.`
        : hardRecent
          ? `${exercise.name}: после тяжёлой прошлой работы держим качество, без отказа.`
          : `${qualityNote}${volumeNote}${exercise.name}: ${recoveryNote}.`,
    }

    const replacement = chooseLibraryReplacementForFatigue({ exercise, library, usedExerciseIds, coachState })
    if (!replacement) return baseChange

    usedExerciseIds.add(replacement.id)
    return {
      ...baseChange,
      exerciseId: replacement.id,
      exerciseName: replacement.name,
      targetWeight: roundWeight(replacement.targetWeight),
      setsCount: replacement.setsCount,
      repMin: replacement.repMin,
      repMax: replacement.repMax,
      restSeconds: replacement.restSeconds,
      todayGoal: formatTodayGoal(replacement.targetWeight, replacement.setsCount, replacement.repMin),
      coachFocus: `${replacement.name}: замена вместо ${exercise.name}, потому что ${labelForLower(exerciseMuscleKey(exercise))} ещё не восстановились. Держим умеренный объём и качество движения.`,
    }
  })

  const adaptiveNote = changes.some((change) => change.exerciseId)
    ? ' План скорректирован с учётом восстановления и доступной библиотеки упражнений.'
    : ''
  return {
    source: 'rules',
    summary: `Следующая реальная тренировка — ${nextWorkoutDay.name} · ${nextWorkoutDay.label}. ${recoveryNote}.${adaptiveNote}`,
    nextWorkoutDayId: nextWorkoutDay.id,
    changes,
    warnings: [],
  }
}

export function clampCoachPlanToNextWorkout(plan, nextWorkoutDay, exerciseLibrary = []) {
  const warnings = [...(Array.isArray(plan?.warnings) ? plan.warnings : [])]
  const allowedById = new Map((nextWorkoutDay?.exercises ?? []).map((exercise) => [exercise.programExerciseId, exercise]))
  const library = normalizeExerciseLibrary(exerciseLibrary)
  const changes = []

  for (const rawChange of Array.isArray(plan?.changes) ? plan.changes : []) {
    const base = allowedById.get(rawChange?.programExerciseId)
    if (!base) {
      warnings.push(`Изменение ${rawChange?.programExerciseId ?? 'без id'} отклонено: упражнение не из следующей тренировки.`)
      continue
    }
    const replacement = rawChange.exerciseId ? library.find((exercise) => exercise.id === rawChange.exerciseId) : null
    if (rawChange.exerciseId && !replacement) {
      warnings.push(`Замена ${rawChange.exerciseId} не найдено в библиотеке — оставлено текущее упражнение.`)
    }
    const change = {
      programExerciseId: base.programExerciseId,
      targetWeight: clampNumber(Number(rawChange.targetWeight), Math.max(0, base.targetWeight - base.weightStep * 2), base.targetWeight + base.weightStep * 2, base.targetWeight),
      setsCount: Math.round(clampNumber(Number(rawChange.setsCount), 1, 4, base.setsCount)),
      repMin: Math.round(clampNumber(Number(rawChange.repMin), 6, 15, base.repMin)),
      repMax: Math.round(clampNumber(Number(rawChange.repMax), 6, 15, base.repMax)),
      restSeconds: Math.round(clampNumber(Number(rawChange.restSeconds), 45, 240, base.restSeconds)),
      todayGoal: String(rawChange.todayGoal || formatTodayGoal(base.targetWeight, base.setsCount, base.repMin)).slice(0, 140),
      coachFocus: String(rawChange.coachFocus || `${base.name}: держим технику и не работаем в отказ.`).slice(0, 500),
    }
    if (replacement) {
      change.exerciseId = replacement.id
      change.exerciseName = replacement.name
    }
    changes.push(change)
  }

  for (const change of changes) {
    if (change.repMax < change.repMin) change.repMax = change.repMin
  }

  return {
    source: plan?.source === 'llm' ? 'llm' : 'rules',
    summary: String(plan?.summary || `Следующая тренировка — ${nextWorkoutDay?.name ?? 'не определена'}.`).slice(0, 800),
    nextWorkoutDayId: nextWorkoutDay?.id ?? plan?.nextWorkoutDayId ?? null,
    changes,
    warnings,
  }
}

export function chooseNextWorkoutDay({ workoutDays, completedWorkout }) {
  const activeDays = [...(workoutDays ?? [])].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
  if (activeDays.length === 0) return null
  const completedId = String(completedWorkout?.workoutDayId ?? '')
  const completedIndex = activeDays.findIndex((day) => day.id === completedId || day.dayKey === completedId)
  if (completedIndex < 0) return activeDays[0]
  return activeDays[(completedIndex + 1) % activeDays.length]
}

export function buildCoachPrompt({ profile, workoutDays: _workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary = [] }) {
  return `${COACH_PERSONA}\n\nПроанализируй завершённую тренировку и скорректируй ТОЛЬКО следующую календарную тренировку.\n\nАнкета: ${JSON.stringify(profile)}\n\nCoach State пользователя: ${JSON.stringify(coachState ?? null)}\n\nЗавершённая тренировка: ${JSON.stringify(completedWorkout)}\n\nПоследняя история: ${JSON.stringify((history ?? []).slice(0, 6))}\n\nСледующая тренировка, которую можно менять: ${JSON.stringify(nextWorkoutDay)}\n\nДоступная библиотека упражнений для замен: ${JSON.stringify((exerciseLibrary ?? []).map((exercise) => ({ id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup, setsCount: exercise.setsCount, repMin: exercise.repMin, repMax: exercise.repMax, targetWeight: exercise.targetWeight, weightStep: exercise.weightStep, restSeconds: exercise.restSeconds })))}\n\nВерни строго JSON без markdown в формате: {"summary":"...","changes":[{"programExerciseId":"...","exerciseId":"optional-library-exercise-id","targetWeight":50,"setsCount":3,"repMin":8,"repMax":10,"restSeconds":120,"todayGoal":"...","coachFocus":"..."}],"warnings":["..."]}. Учитывай восстановление, усталость мышечных групп, фактическую частоту тренировок, подходы на пределе, боль и цель пользователя. Если мышцы следующей тренировки не восстановились, можешь заменить упражнение на упражнение из библиотеки для другой, более свежей группы мышц, указав exerciseId. Не повышай вес при боли или низком восстановлении. Не меняй programExerciseId вне следующей тренировки.`
}

function chooseLibraryReplacementForFatigue({ exercise, library, usedExerciseIds, coachState }) {
  const currentMuscle = exerciseMuscleKey(exercise)
  const currentGroup = coachState?.muscleGroups?.[currentMuscle]
  if (!currentGroup || currentGroup.fatigue !== 'high') return null
  if (!['low', 'partial'].includes(String(coachState?.recoveryStatus ?? ''))) return null

  const candidates = library
    .filter((candidate) => !usedExerciseIds.has(candidate.id))
    .filter((candidate) => candidate.muscleKey !== currentMuscle)
    .filter((candidate) => coachState?.muscleGroups?.[candidate.muscleKey]?.fatigue !== 'high')
    .sort((a, b) => replacementScore(b, coachState) - replacementScore(a, coachState))
  return candidates[0] ?? null
}

function replacementScore(exercise, coachState) {
  let score = 0
  const fatigue = coachState?.muscleGroups?.[exercise.muscleKey]?.fatigue ?? 'low'
  if (fatigue === 'low') score += 20
  if (fatigue === 'medium') score += 5
  if (coachState?.exercises?.[exercise.id]?.status === 'no_data') score += 4
  if (['arms', 'shoulders', 'core'].includes(exercise.muscleKey)) score += 3
  if (exercise.setsCount <= 2) score += 2
  return score
}

function normalizeExerciseLibrary(exerciseLibrary) {
  return (exerciseLibrary ?? []).map((exercise) => ({
    id: canonicalExerciseId(exercise),
    name: exercise.name,
    muscleGroup: exercise.muscleGroup ?? exercise.muscle_group,
    muscleKey: exerciseMuscleKey(exercise),
    setsCount: Number(exercise.setsCount ?? exercise.sets_count ?? 2),
    repMin: Number(exercise.repMin ?? exercise.rep_min ?? 10),
    repMax: Number(exercise.repMax ?? exercise.rep_max ?? 12),
    targetWeight: Number(exercise.targetWeight ?? exercise.target_weight ?? 0),
    weightStep: Number(exercise.weightStep ?? exercise.weight_step ?? 2.5),
    restSeconds: Number(exercise.restSeconds ?? exercise.rest_seconds ?? 90),
  })).filter((exercise) => exercise.id && exercise.name)
}

function exerciseMuscleKey(exercise) {
  return normalizeMuscleGroup(`${exercise.muscleGroup ?? exercise.muscle_group ?? ''} ${exercise.name ?? ''}`)
}


function latestExerciseHistory(history, exerciseId) {
  return [...(history ?? [])]
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .flatMap((workout) => workout.exercises ?? [])
    .find((exercise) => canonicalExerciseId(exercise) === canonicalExerciseId(exerciseId))
}

function daysUntilNextTrainingDay(trainingDays, nextWorkoutDay, workoutDays, now) {
  const activeDays = [...(workoutDays ?? [])].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
  const dayIndex = activeDays.findIndex((day) => day.id === nextWorkoutDay?.id)
  const weekday = (trainingDays ?? [])[dayIndex]
  if (!weekday) return null
  const targetIndex = russianWeekdayOrder.findIndex((day) => day.toLowerCase() === String(weekday).toLowerCase())
  if (targetIndex < 0) return null
  const currentIndex = (now.getDay() + 6) % 7
  return (targetIndex - currentIndex + 7) % 7
}

function formatTodayGoal(weight, setsCount, reps) {
  return Array.from({ length: setsCount }, () => `${formatWeight(weight)}×${reps}`).join('/')
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}
