import type { ExercisePlan, WorkoutDay } from '../data/mockProgram'

export type ExerciseAddSuggestion = {
  exercise: ExercisePlan
  reason: string
}

type SuggestExerciseToAddInput = {
  workoutDay: WorkoutDay
  exerciseLibrary: ExercisePlan[]
  maxExercises?: number
}

export function suggestExerciseToAdd({
  workoutDay,
  exerciseLibrary,
  maxExercises = 6,
}: SuggestExerciseToAddInput): ExerciseAddSuggestion | null {
  if (workoutDay.exercises.length >= maxExercises) return null

  const activeNames = new Set(workoutDay.exercises.map((exercise) => normalize(exercise.name)))
  const activeBaseIds = new Set(workoutDay.exercises.map((exercise) => baseExerciseId(exercise.id)))
  const activeMuscleGroups = new Set(workoutDay.exercises.map((exercise) => normalize(exercise.muscleGroup)))

  const candidates = exerciseLibrary
    .filter((exercise) => !activeNames.has(normalize(exercise.name)))
    .filter((exercise) => !activeBaseIds.has(baseExerciseId(exercise.id)))

  if (candidates.length === 0) return null

  const suggested = [...candidates].sort((a, b) => scoreExercise(b, activeMuscleGroups) - scoreExercise(a, activeMuscleGroups))[0]
  return {
    exercise: suggested,
    reason: `Можно добавить ${suggested.name}: закроем ${suggested.muscleGroup.toLowerCase()} без перестройки всей тренировки.`,
  }
}

function scoreExercise(exercise: ExercisePlan, activeMuscleGroups: Set<string>) {
  let score = 0
  if (!activeMuscleGroups.has(normalize(exercise.muscleGroup))) score += 20
  if (normalize(exercise.muscleGroup).includes('кор')) score += 4
  if (exercise.targetWeight === 0) score += 2
  return score
}

function baseExerciseId(id: string) {
  return String(id).replace(/-extra-\d+$/u, '').replace(/-(light|very_light|heavy)$/u, '')
}

function normalize(value: string) {
  return String(value ?? '').trim().toLowerCase()
}
