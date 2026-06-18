import { canonicalExerciseId } from './exerciseIdentity.js'

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

  const library = normalizeExerciseLibrary(exerciseLibrary)
  const usedExerciseIds = new Set((workoutDays ?? []).flatMap((day) => (day.exercises ?? []).map((exercise) => canonicalExerciseId(exercise))))
  const changes = nextWorkoutDay.exercises.map((exercise) => {
    const recent = latestExerciseHistory(history, exercise.exerciseId)
    const targetWeight = recent?.nextRecommendedWeight ?? exercise.targetWeight
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
    const baseChange = {
      programExerciseId: exercise.programExerciseId,
      targetWeight: roundWeight(targetWeight),
      setsCount,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      restSeconds: exercise.restSeconds,
      todayGoal: formatTodayGoal(targetWeight, setsCount, exercise.repMin),
      coachFocus: hadPain
        ? `${exercise.name}: была боль в истории — вес не повышаем, техника и амплитуда важнее.`
        : hardRecent
          ? `${exercise.name}: после тяжёлой прошлой работы держим качество, без отказа.`
          : `${qualityNote}${exercise.name}: ${recoveryNote}.`,
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
      coachFocus: `${replacement.name}: замена вместо ${exercise.name}, потому что ${muscleLabel(exerciseMuscleKey(exercise))} ещё не восстановились. Держим умеренный объём и качество движения.`,
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

export function buildCoachPrompt({ profile, workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary = [] }) {
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

function normalizeMuscleGroup(text) {
  const normalized = String(text ?? '').toLowerCase()
  if (normalized.includes('груд') || normalized.includes('жим') || normalized.includes('chest')) return 'chest'
  if (normalized.includes('спин') || normalized.includes('тяга') || normalized.includes('back')) return 'back'
  if (normalized.includes('ног') || normalized.includes('бедр') || normalized.includes('ягод') || normalized.includes('икр') || normalized.includes('присед') || normalized.includes('выпад') || normalized.includes('leg')) return 'legs'
  if (normalized.includes('плеч') || normalized.includes('дельт') || normalized.includes('shoulder')) return 'shoulders'
  if (normalized.includes('бицеп') || normalized.includes('трицеп') || normalized.includes('рук') || normalized.includes('arm')) return 'arms'
  if (normalized.includes('кор') || normalized.includes('пресс') || normalized.includes('планк') || normalized.includes('core')) return 'core'
  return 'other'
}

function muscleLabel(key) {
  return {
    chest: 'грудь',
    back: 'спина',
    legs: 'ноги',
    shoulders: 'плечи',
    arms: 'руки',
    core: 'кор',
  }[key] ?? 'эта группа'
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

function formatWeight(value) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function roundWeight(value) {
  return Number(Number(value).toFixed(1))
}
