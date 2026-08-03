import { resolveWeightDirection, harderWeight, easierWeight, isWeightlessProgression, nextRepRange } from '../../shared/weightDirection'
import { isTimedExerciseName } from '../../shared/muscleGroups'
// Issue #98 PR2: ProgressionType unified in shared/types.ts
export type { ProgressionType } from '../../shared/types'
import type { ProgressionType } from '../../shared/types'

export type WorkoutSetInput = {
  weight: number
  reps: number
  rpe: number
  completed: boolean
  // Issue #165: client-side timestamp when the set was performed
  performedAt?: string
}

export type ProgressionInput = {
  exerciseName: string
  currentWeight: number
  repMin: number
  repMax: number
  weightStep: number
  sets: WorkoutSetInput[]
  pain: boolean
  previousFailureCount?: number
}

export type ProgressionResult = {
  recommendedWeight: number
  type: ProgressionType
  reason: string
}

export function calculateProgression(input: ProgressionInput): ProgressionResult {
  const completedSets = input.sets.filter((set) => set.completed && set.reps > 0)
  // Issue #173: направление веса из общего хелпера (поле справочника приоритетно,
  // здесь — фолбэк по названию, т.к. вход содержит только exerciseName).
  const direction = resolveWeightDirection(input.exerciseName)
  const assisted = direction === 'assistance'
  // Issue #192: ни веса, ни шага — прогрессия идёт по повторам (у планки — по
  // секундам), и все тексты ниже говорят о них, а не о нулевых килограммах.
  const weightless = isWeightlessProgression(input.currentWeight, input.weightStep)
  const timed = isTimedExerciseName(input.exerciseName)
  const unit = timed ? 'сек' : 'повторов'

  if (input.pain) {
    return {
      recommendedWeight: input.currentWeight,
      type: 'pain',
      reason: `${input.exerciseName}: вес не повышаем из-за отметки боли. Лучше подобрать замену и проверить технику.`,
    }
  }

  if (completedSets.length === 0) {
    return {
      recommendedWeight: input.currentWeight,
      type: 'skip',
      reason: `${input.exerciseName}: упражнение не выполнено, рекомендацию не меняем.`,
    }
  }

  const allAtTop = completedSets.every((set) => set.reps >= input.repMax)
  const allControlled = completedSets.every((set) => set.rpe <= 8)
  const highRpeCount = completedSets.filter((set) => set.rpe >= 9).length
  const belowMinCount = completedSets.filter((set) => set.reps < input.repMin).length

  if (allAtTop && allControlled) {
    const nextWeight = harderWeight(input.currentWeight, input.weightStep, direction)
    // Issue #192: у отжиманий и планки шага веса нет — «+0 кг» было советом
    // сделать ровно то, что уже сделано. Растёт диапазон повторов (планировщик
    // выписывает его в следующий план), у потолка — вариант посложнее.
    const next = weightless
      ? nextRepRange({ repMin: input.repMin, repMax: input.repMax, timed })
      : null
    return {
      recommendedWeight: nextWeight,
      type: 'increase',
      reason: next
        ? next.atCeiling
          ? `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — по ${unit} расти дальше некуда, следующий шаг — вариант посложнее.`
          : `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — следующий раз ${next.repMin}–${next.repMax} ${unit}.`
        : assisted
          ? `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — следующий раз уменьшаем помощь на ${input.weightStep} кг.`
          : `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — следующий раз +${input.weightStep} кг.`,
    }
  }

  if (belowMinCount >= 2 && (input.previousFailureCount ?? 0) >= 1) {
    return {
      recommendedWeight: easierWeight(input.currentWeight, input.weightStep, direction),
      type: 'deload',
      // Issue #192: «снижаем вес на 0 кг» — та же слепота к нулю, что и в
      // ветке роста. Снижать нечего, поэтому обещаем то, что действительно
      // произойдёт: цель по повторам не растёт.
      reason: weightless
        ? `${input.exerciseName}: второй провал подряд ниже диапазона — цель по ${unit} не повышаем, добираем качество.`
        : assisted
          ? `${input.exerciseName}: второй провал подряд ниже диапазона — увеличиваем помощь на ${input.weightStep} кг.`
          : `${input.exerciseName}: второй провал подряд ниже диапазона — снижаем вес на ${input.weightStep} кг.`,
    }
  }

  if (highRpeCount >= Math.ceil(completedSets.length / 2)) {
    return {
      recommendedWeight: input.currentWeight,
      type: 'hold',
      reason: `${input.exerciseName}: RPE высокий, вес оставляем и добираем качество повторений.`,
    }
  }

  return {
    recommendedWeight: input.currentWeight,
    type: 'hold',
    reason: `${input.exerciseName}: вес пока оставляем, цель — добрать повторы до верхней границы диапазона.`,
  }
}
