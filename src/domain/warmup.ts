// Issue #345: детерминированная разминочная лесенка для базовых/свободновесных
// упражнений. Чистый доменный слой: генерация и признаки разминки, без побочных
// эффектов и без встраивания в активную тренировку (это отдельная задача с
// БД-миграцией). Разминочные подходы помечаются `isWarmup: true` и отсекаются
// там, где считается объём, прогрессия, e1RM и ожидание повторов.

import { normalizeExerciseMuscleGroup } from '../../shared/muscleGroups'
import { roundToStep } from './workoutReadiness'

/**
 * Порог рабочего веса, ниже которого разминка не нужна: пустой гриф (20 кг) уже
 * сам по себе разминка. Осознанный дефолт для старта фичи, не подстраивается под
 * `weightStep`/оборудование.
 */
export const WARMUP_WEIGHT_THRESHOLD_KG = 20

/** Базовые/свободновесные движения, для которых разминка имеет смысл. */
const WARMUP_NAME_PATTERN = /(присед|squat|станов|deadlift|румын|romanian|выпад|lunge|жим|bench|press|тяга|row|pulldown|pull-up|подтяг)/iu

type WarmupExercise = {
  name: string
  muscleGroup: string
  equipment?: string | null
}

/**
 * Нужна ли разминка для упражнения на заданном рабочем весе: тяжёлые базовые
 * движения — да, изоляция (руки, кор) и собственный вес — нет.
 */
export function needsWarmup(exercise: WarmupExercise, workingWeight: number): boolean {
  if (!(workingWeight >= WARMUP_WEIGHT_THRESHOLD_KG)) return false
  if (exercise.equipment === 'bodyweight') return false
  const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup, exercise.name)
  if (muscleKey === 'arms' || muscleKey === 'core') return false
  return WARMUP_NAME_PATTERN.test(exercise.name)
}

const WARMUP_LADDER = [
  { ratio: 0.4, reps: 8 },
  { ratio: 0.6, reps: 5 },
  { ratio: 0.8, reps: 3 },
] as const

/**
 * Разминочная лесенка 40%×8, 60%×5, 80%×3 с округлением веса по шагу
 * упражнения. Ступени не тяжелее рабочего веса: на лёгких весах верхняя ступень
 * может округлиться до рабочего — тогда она не разминка и отбрасывается.
 */
export function buildWarmupSets(
  exercise: WarmupExercise & { weightStep?: number },
  workingWeight: number,
): Array<{ weight: number; reps: number; isWarmup: true }> {
  if (!needsWarmup(exercise, workingWeight)) return []
  const step = exercise.weightStep && exercise.weightStep > 0 ? exercise.weightStep : 2.5
  const sets: Array<{ weight: number; reps: number; isWarmup: true }> = []
  for (const { ratio, reps } of WARMUP_LADDER) {
    const weight = roundToStep(workingWeight * ratio, step)
    if (weight >= workingWeight || weight <= 0) continue
    sets.push({ weight, reps, isWarmup: true })
  }
  return sets
}
