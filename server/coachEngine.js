import { getUserTrainingPolicy } from './userTrainingPolicies.js'
import { canonicalExerciseId } from './exerciseIdentity.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'

export function recommendNextSet(input) {
  const exercise = input.exercise ?? {}
  const userTrainingPolicy = input.userTrainingPolicy ?? getUserTrainingPolicy(input.userId)
  const completedSets = (input.completedSets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
  const lastSet = completedSets.at(-1)
  const repMin = safeNumber(exercise.repMin, 8)
  const repMax = Math.max(repMin, safeNumber(exercise.repMax, repMin))
  const step = Math.max(0, safeNumber(exercise.weightStep, 2.5))
  const baseRest = Math.max(45, safeNumber(exercise.restSeconds, 90))
  const readinessConstraint = liveReadinessConstraint({ exercise, readinessCheckIn: input.context?.session?.readinessCheckIn })

  if (input.pain || readinessConstraint === 'pain') {
    return {
      action: 'suggest_replacement',
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: 0,
      reason: 'отмечена боль в целевой зоне — останавливаем упражнение и лучше выбрать безопасную замену',
    }
  }

  if (!lastSet) {
    const coachState = input.context?.coachState
    const muscleKey = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`)
    const targetMuscleFatigue = coachState?.muscleGroups?.[muscleKey]?.fatigue
    if (coachState?.recoveryStatus === 'low' || targetMuscleFatigue === 'high' || readinessConstraint === 'sore') {
      return withRemainingSetUpdates({
        action: 'reduce_load',
        recommendedWeight: roundWeight(Math.max(0, safeNumber(exercise.targetWeight, 0) - step)),
        recommendedReps: repMin,
        recommendedRestSeconds: Math.max(baseRest, 180),
        reason: readinessConstraint === 'sore'
          ? 'целевая группа забита — начинаем легче и держим технику под контролем'
          : 'восстановление или усталость целевой группы низкие — начинаем легче и держим технику под контролем',
      }, input.remainingSets)
    }

    return withRemainingSetUpdates({
      action: 'continue',
      recommendedWeight: roundWeight(safeNumber(exercise.targetWeight, 0)),
      recommendedReps: repMin,
      recommendedRestSeconds: baseRest,
      reason: 'начинаем с планового рабочего веса и нижней границы повторов',
    }, input.remainingSets)
  }

  const maxEffortSets = completedSets.filter((set) => safeNumber(set.rpe, 0) >= 10).length
  if (maxEffortSets >= 2) {
    return {
      action: 'stop_exercise',
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: Math.max(baseRest, 180),
      reason: 'уже было два подхода на пределе — упражнение лучше завершить, чтобы не ухудшать технику и восстановление',
    }
  }

  const lastWeight = safeNumber(lastSet.weight, safeNumber(exercise.targetWeight, 0))
  const lastReps = safeNumber(lastSet.reps, repMin)
  const lastRpe = safeNumber(lastSet.rpe, 7)
  const session = input.context?.session ?? {}
  const timeConstrained = safeNumber(session.availableMinutes, 60) <= 35

  if ((input.remainingSets ?? 0) <= 0) {
    const nextExercise = session.nextExercise
    if (timeConstrained && nextExercise && isAccessoryExercise(nextExercise) && (session.workoutExercises?.length ?? 0) >= 3) {
      return {
        action: 'finish_workout',
        recommendedWeight: 0,
        recommendedReps: 0,
        recommendedRestSeconds: 0,
        reason: `времени мало — следующий аксессуар (${nextExercise.name}) лучше убрать и завершить тренировку без потери главной работы`,
      }
    }

    const nextExerciseSameMuscle = nextExercise && normalizeMuscleGroup(`${nextExercise.muscleGroup ?? ''} ${nextExercise.name ?? ''}`) === normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`)
    if ((lastRpe >= 10 || maxEffortSets > 0) && nextExerciseSameMuscle) {
      const suggestedExercises = chooseSuggestedExercises({
        currentExercise: exercise,
        nextExercise,
        workoutExercises: session.workoutExercises,
        exerciseLibrary: session.exerciseLibrary,
        preferDifferentMuscle: true,
      })
      const suggestedExercise = suggestedExercises[0]
      if (suggestedExercise) {
        return {
          action: 'replace_next_exercise',
          recommendedWeight: 0,
          recommendedReps: 0,
          recommendedRestSeconds: Math.max(baseRest, 180),
          suggestedExercise,
          suggestedExercises,
          reason: `следующее упражнение тоже грузит ${nextExercise.muscleGroup?.toLowerCase?.() ?? 'ту же группу'} после предельного подхода — лучше заменить на ${suggestedExercise.name}`,
        }
      }
    }

    if (!nextExercise && lastRpe <= 6 && lastReps >= repMax && (session.workoutExercises?.length ?? 0) < 6) {
      const suggestedExercises = chooseSuggestedExercises({
        currentExercise: exercise,
        workoutExercises: session.workoutExercises,
        exerciseLibrary: session.exerciseLibrary,
        preferDifferentMuscle: true,
      })
      const suggestedExercise = suggestedExercises[0]
      if (suggestedExercise) {
        return {
          action: 'add_exercise',
          recommendedWeight: 0,
          recommendedReps: 0,
          recommendedRestSeconds: baseRest,
          suggestedExercise,
          suggestedExercises,
          reason: `тренировка идёт легко — можно добавить ${suggestedExercise.name} без перегруза основной работы`,
        }
      }
    }
  }

  if (timeConstrained && (input.remainingSets ?? 0) > 0 && lastRpe >= 9) {
    return {
      action: 'skip_remaining_sets',
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: 0,
      reason: 'времени мало, а рабочий подход уже тяжёлый — засчитываем упражнение и переходим дальше без добивания объёма',
    }
  }

  if (lastRpe >= 10) {
    return withRemainingSetUpdates({
      action: 'reduce_load',
      recommendedWeight: roundWeight(Math.max(0, lastWeight - step)),
      recommendedReps: repMin,
      recommendedRestSeconds: Math.max(baseRest, 180),
      reason: 'прошлый подход был на пределе — снижаем вес на шаг, цель нижняя граница повторов и более длинный отдых',
    }, input.remainingSets)
  }

  if (userTrainingPolicy.allowFailureSets === false && lastRpe >= 9) {
    return withRemainingSetUpdates({
      action: 'reduce_load',
      recommendedWeight: roundWeight(Math.max(0, lastWeight - step)),
      recommendedReps: repMin,
      recommendedRestSeconds: Math.max(baseRest, 180),
      reason: 'Олег: подход уже очень тяжёлый — снижаем вес на шаг, работаем без отказа и держим технику',
    }, input.remainingSets)
  }

  if (lastRpe >= 9 || lastReps < repMin || readinessConstraint === 'sore') {
    return withRemainingSetUpdates({
      action: 'hold_load',
      recommendedWeight: roundWeight(lastWeight),
      recommendedReps: repMin,
      recommendedRestSeconds: Math.max(baseRest, 150),
      reason: readinessConstraint === 'sore'
        ? 'целевая группа забита — вес не повышаем, добираем минимум повторов и отдых чуть длиннее'
        : 'подход был тяжёлым или ниже плана — вес оставляем, цель качественно добрать минимум повторов',
    }, input.remainingSets)
  }

  if (lastReps >= repMax && lastRpe <= 6 && (input.remainingSets ?? 1) > 1) {
    return withRemainingSetUpdates({
      action: 'continue',
      recommendedWeight: roundWeight(lastWeight),
      recommendedReps: repMax,
      recommendedRestSeconds: baseRest,
      reason: 'подход был лёгким — пока повторяем вес и закрепляем верх диапазона без резкого скачка внутри упражнения',
    }, input.remainingSets)
  }

  return withRemainingSetUpdates({
    action: 'continue',
    recommendedWeight: roundWeight(lastWeight),
    recommendedReps: Math.min(repMax, Math.max(repMin, Math.round(lastReps))),
    recommendedRestSeconds: baseRest,
    reason: 'подход под контролем — повторяем рабочий вес и держим качество',
  }, input.remainingSets)
}

function safeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function roundWeight(value) {
  return Number(Number(value).toFixed(1))
}

function chooseSuggestedExercises({ currentExercise = {}, nextExercise = null, workoutExercises = [], exerciseLibrary = [], preferDifferentMuscle = false, limit = 3 }) {
  const usedIds = new Set((workoutExercises ?? []).map((exercise) => canonicalExerciseId(exercise)))
  const usedNames = new Set((workoutExercises ?? []).map((exercise) => normalizeText(exercise.name ?? exercise.exerciseName)))
  const currentMuscle = normalizeMuscleGroup(`${currentExercise.muscleGroup ?? ''} ${currentExercise.name ?? ''}`)
  const nextMuscle = normalizeMuscleGroup(`${nextExercise?.muscleGroup ?? ''} ${nextExercise?.name ?? ''}`)
  return (exerciseLibrary ?? [])
    .filter((candidate) => candidate?.id && candidate?.name)
    .filter((candidate) => !usedIds.has(canonicalExerciseId(candidate)))
    .filter((candidate) => !usedNames.has(normalizeText(candidate.name)))
    .sort((a, b) => scoreSuggestedExercise(b, { currentMuscle, nextMuscle, preferDifferentMuscle }) - scoreSuggestedExercise(a, { currentMuscle, nextMuscle, preferDifferentMuscle }))
    .slice(0, limit)
}

function scoreSuggestedExercise(exercise, { currentMuscle, nextMuscle, preferDifferentMuscle }) {
  const muscle = normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`)
  let score = 0
  if (preferDifferentMuscle && muscle !== currentMuscle && muscle !== nextMuscle) score += 30
  if (muscle === 'core') score += 8
  if (Number(exercise.targetWeight ?? 0) === 0) score += 3
  return score
}

function isAccessoryExercise(exercise) {
  return ['arms', 'shoulders', 'core'].includes(normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`))
}

function withRemainingSetUpdates(decision, remainingSets) {
  const count = Math.max(0, Math.floor(safeNumber(remainingSets, 0)))
  if (count <= 0 || decision.recommendedReps <= 0) return decision
  return {
    ...decision,
    remainingSetUpdates: Array.from({ length: count }, (_, setOffset) => ({
      setOffset,
      recommendedWeight: decision.recommendedWeight,
      recommendedReps: decision.recommendedReps,
      recommendedRestSeconds: decision.recommendedRestSeconds,
    })),
  }
}

function liveReadinessConstraint({ exercise, readinessCheckIn = null }) {
  if (!readinessCheckIn) return null
  const exerciseText = `${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`
  if (matchesAnyTrainingArea(exerciseText, readinessCheckIn.painAreas)) return 'pain'
  if (matchesAnyTrainingArea(exerciseText, readinessCheckIn.soreMuscleGroups)) return 'sore'
  return null
}

function matchesAnyTrainingArea(exerciseText, areas) {
  const muscle = normalizeMuscleGroup(exerciseText)
  return (areas ?? []).some((area) => normalizeMuscleGroup(area) === muscle)
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}
