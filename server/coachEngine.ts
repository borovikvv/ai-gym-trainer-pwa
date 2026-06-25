// Issue #65 (#36 decomposition): all `any` replaced with concrete types.
import type {
  CoachEngineContext,
  CoachSessionContext,
  ExerciseRef,
  ReadinessCheckIn,
} from '../shared/types.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from './userTrainingPolicies.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'
import { roundWeight } from './lib/format.js'
import { findComplementaryExercises } from './exerciseMatcher.js'

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

interface ExerciseInput {
  id?: string
  name?: string
  muscleGroup?: string
  exerciseName?: string
  targetWeight?: number
  weightStep?: number
  repMin?: number
  repMax?: number
  restSeconds?: number
}

interface SetInput {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

interface RecommendNextSetInput {
  userId?: string
  exercise?: ExerciseInput
  userTrainingPolicy?: UserTrainingPolicy | null
  completedSets?: SetInput[]
  pain?: boolean
  context?: CoachEngineContext
  remainingSets?: number
}

interface SetRecommendation {
  action: string
  recommendedWeight: number
  recommendedReps: number
  recommendedRestSeconds: number
  reason: string
  suggestedExercise?: ExerciseRef
  suggestedExercises?: ExerciseRef[]
  remainingSetUpdates?: Array<{
    setOffset: number
    recommendedWeight: number
    recommendedReps: number
    recommendedRestSeconds: number
  }>
}

interface ChooseSuggestedExercisesParams {
  currentExercise?: ExerciseInput
  nextExercise?: ExerciseInput | null
  workoutExercises?: ExerciseInput[]
  exerciseLibrary?: unknown[]
  preferDifferentMuscle?: boolean
  limit?: number
}

interface LiveReadinessConstraintInput {
  exercise: ExerciseInput
  readinessCheckIn?: ReadinessCheckIn | null
}

type ReadinessConstraint = 'pain' | 'sore' | null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recommendNextSet(input: RecommendNextSetInput): SetRecommendation {
  const exercise: ExerciseInput = input.exercise ?? {}
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
  const session: CoachSessionContext = input.context?.session ?? {}
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
        workoutExercises: session.workoutExercises as ExerciseInput[] | undefined,
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
        workoutExercises: session.workoutExercises as ExerciseInput[] | undefined,
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

  if (userTrainingPolicy?.allowFailureSets === false && lastRpe >= 9) {
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

function safeNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function chooseSuggestedExercises({
  currentExercise = {},
  nextExercise = null,
  workoutExercises = [],
  exerciseLibrary = [],
  preferDifferentMuscle: _preferDifferentMuscle = false,
  limit = 3,
}: ChooseSuggestedExercisesParams): ExerciseRef[] {
  // Phase 3 issue #13: delegate to exerciseMatcher which uses target_muscles,
  // movement_pattern, equipment, and exercise_type for smarter suggestions.
  // The preferDifferentMuscle flag is handled inside the matcher (different
  // muscle group gets +30 score).
  return findComplementaryExercises({
    currentExercise,
    nextExercise,
    workoutExercises,
    library: exerciseLibrary as unknown as Parameters<typeof findComplementaryExercises>[0]['library'],
    limit,
  }) as unknown as ExerciseRef[]
}

function isAccessoryExercise(exercise: ExerciseInput): boolean {
  return ['arms', 'shoulders', 'core'].includes(normalizeMuscleGroup(`${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`))
}

function withRemainingSetUpdates(decision: SetRecommendation, remainingSets: unknown): SetRecommendation {
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

function liveReadinessConstraint({ exercise, readinessCheckIn = null }: LiveReadinessConstraintInput): ReadinessConstraint {
  if (!readinessCheckIn) return null
  const exerciseText = `${exercise.muscleGroup ?? ''} ${exercise.name ?? ''}`
  if (matchesAnyTrainingArea(exerciseText, readinessCheckIn.painAreas)) return 'pain'
  if (matchesAnyTrainingArea(exerciseText, readinessCheckIn.soreMuscleGroups)) return 'sore'
  return null
}

function matchesAnyTrainingArea(exerciseText: string, areas: string[] | undefined): boolean {
  const muscle = normalizeMuscleGroup(exerciseText)
  return (areas ?? []).some((area) => normalizeMuscleGroup(area) === muscle)
}
