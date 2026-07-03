import { isAssistedExercise } from '../lib/muscleGroups'

export type WorkoutSetInput = {
  weight: number
  reps: number
  rpe: number
  completed: boolean
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
  type: 'increase' | 'hold' | 'deload' | 'pain' | 'skip'
  reason: string
}

export function calculateProgression(input: ProgressionInput): ProgressionResult {
  const completedSets = input.sets.filter((set) => set.completed && set.reps > 0)
  const assisted = isAssistedExercise(input.exerciseName)

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
    const nextWeight = assisted
      ? Math.max(0, input.currentWeight - input.weightStep)
      : input.currentWeight + input.weightStep
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
      recommendedWeight: Math.max(0, input.currentWeight - input.weightStep),
      type: 'deload',
      reason: `${input.exerciseName}: второй провал подряд ниже диапазона — снижаем вес на ${input.weightStep} кг.`,
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
