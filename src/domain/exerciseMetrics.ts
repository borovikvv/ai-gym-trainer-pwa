import type { ExercisePlan  } from '../../shared/types'

const timedExercisePatterns = [
  /plank/i,
  /планк/i,
  /планка/i,
  /dead\s*bug/i,
  /дед\s*баг/i,
]

export function isTimedExercise(exercise: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'>) {
  const text = `${exercise.id} ${exercise.name} ${exercise.muscleGroup}`
  return timedExercisePatterns.some((pattern) => pattern.test(text))
}

export function effortUnitLabel(exercise: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'>) {
  return isTimedExercise(exercise) ? 'сек' : 'повт'
}
