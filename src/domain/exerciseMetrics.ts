import type { ExercisePlan  } from '../../shared/types'
// Issue #192: разбор названия переехал в shared/muscleGroups — сервер считает
// упражнение «на время» по тому же правилу, что и клиент.
import { isTimedExerciseName } from '../../shared/muscleGroups'

export function isTimedExercise(exercise: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'>) {
  return isTimedExerciseName(`${exercise.id} ${exercise.name} ${exercise.muscleGroup}`)
}

export function effortUnitLabel(exercise: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'>) {
  return isTimedExercise(exercise) ? 'сек' : 'повт'
}
