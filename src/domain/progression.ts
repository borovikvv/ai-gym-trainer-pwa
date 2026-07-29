import { resolveWeightDirection, harderWeight, easierWeight } from '../../shared/weightDirection'
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
    return {
      recommendedWeight: nextWeight,
      type: 'increase',
      reason: assisted
        ? `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — следующий раз уменьшаем помощь на ${input.weightStep} кг.`
        : `${input.exerciseName}: все подходы на верхней границе и RPE под контролем — следующий раз +${input.weightStep} кг.`,
    }
  }

  if (belowMinCount >= 2 && (input.previousFailureCount ?? 0) >= 1) {
    return {
      recommendedWeight: easierWeight(input.currentWeight, input.weightStep, direction),
      type: 'deload',
      reason: assisted
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
