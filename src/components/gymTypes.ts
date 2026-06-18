import type { WorkoutSetInput } from '../domain/progression'
import type { ExercisePlan } from '../data/mockProgram'

export type SetDraft = WorkoutSetInput & { weightInput?: string; repsInput?: string }

export type NextSetHint = {
  weight: number
  reps: number
  restSeconds: number
  reason: string
  action: string
  remainingSetUpdates?: Array<{
    setOffset: number
    recommendedWeight: number
    recommendedReps: number
    recommendedRestSeconds: number
  }>
  suggestedExercise?: ExercisePlan
  suggestedExercises?: ExercisePlan[]
}

export type DifficultyOption = {
  label: string
  value: number
  hint: string
}

export const difficultyOptions: DifficultyOption[] = [
  { label: 'Легко', value: 6, hint: 'ещё 4+ повтора в запасе' },
  { label: 'Нормально', value: 7, hint: 'ещё 3 повтора' },
  { label: 'Тяжело', value: 8, hint: 'ещё 1–2 повтора' },
  { label: 'На пределе', value: 10, hint: 'больше не смог бы' },
]

export const difficultyLabel = (rpe: number) => {
  if (rpe <= 6) return 'Легко'
  if (rpe === 7) return 'Нормально'
  if (rpe === 8) return 'Тяжело'
  return 'На пределе'
}

export function formatRestSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const restSeconds = safeSeconds % 60
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`
}
