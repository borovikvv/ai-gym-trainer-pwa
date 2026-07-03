import type { ExercisePlan, WorkoutHistoryEntry } from '../../shared/types'
import type { ReadinessCheckIn } from './readinessCheckIn'
import { calculateProgression, type WorkoutSetInput } from './progression'
import { getCanonicalExerciseId } from './exerciseIdentity'
import { buildWorkoutDebrief } from './workoutDebrief'

// Issue #98 PR3: CompletedExerciseHistory and WorkoutHistoryEntry unified
// in shared/types.ts. Re-export for backward compatibility.
export type { CompletedExerciseHistory, WorkoutHistoryEntry, WorkoutSet, WorkoutDebrief } from '../../shared/types'

export type ExerciseLog = {
  exerciseId: string
  pain: boolean
  sets: WorkoutSetInput[]
}

export type CreateWorkoutHistoryEntryInput = {
  userId: string
  workoutDayId: string
  workoutDayName: string
  exercises: ExercisePlan[]
  logs: Record<string, ExerciseLog>
  readinessCheckIn?: ReadinessCheckIn | null
  completedAt?: string
}

export function createWorkoutHistoryEntry(input: CreateWorkoutHistoryEntryInput): WorkoutHistoryEntry {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const exercises = input.exercises.map((exercise) => {
    const log = input.logs[exercise.id] ?? { exerciseId: exercise.id, pain: false, sets: [] }
    const volume = log.sets.reduce((sum, set) => sum + (set.completed ? set.weight * set.reps : 0), 0)
    const currentWeight = firstCompletedWeight(log.sets) ?? exercise.targetWeight
    const progression = calculateProgression({
      exerciseName: exercise.name,
      currentWeight,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      weightStep: exercise.weightStep,
      sets: log.sets,
      pain: log.pain,
    })

    return {
      exerciseId: exercise.id,
      canonicalExerciseId: getCanonicalExerciseId(exercise),
      exerciseName: exercise.name,
      pain: log.pain,
      sets: log.sets,
      volume,
      nextRecommendedWeight: progression.recommendedWeight,
      progressionType: progression.type,
      progressionReason: progression.reason,
    }
  })

  const entryWithoutDebrief = {
    id: `${input.userId}-${input.workoutDayId}-${completedAt}`,
    userId: input.userId,
    workoutDayId: input.workoutDayId,
    workoutDayName: input.workoutDayName,
    completedAt,
    totalVolume: exercises.reduce((sum, exercise) => sum + exercise.volume, 0),
    readinessCheckIn: input.readinessCheckIn ?? null,
    exercises,
  }
  return {
    ...entryWithoutDebrief,
    debrief: buildWorkoutDebrief(entryWithoutDebrief),
  }
}

export function buildNextTargets(history: WorkoutHistoryEntry[]): Record<string, number> {
  return [...history]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .reduce<Record<string, number>>((targets, workout) => {
      for (const exercise of workout.exercises) {
        const canonicalExerciseId = getCanonicalExerciseId(exercise)
        if (targets[exercise.exerciseId] === undefined) {
          targets[exercise.exerciseId] = exercise.nextRecommendedWeight
        }
        if (targets[canonicalExerciseId] === undefined) {
          targets[canonicalExerciseId] = exercise.nextRecommendedWeight
        }
      }
      return targets
    }, {})
}

export function summarizeExerciseHistory(history: WorkoutHistoryEntry[], exerciseId: string): string[] {
  const canonicalExerciseId = getCanonicalExerciseId(exerciseId)
  return [...history]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .flatMap((workout) => {
      const exercise = workout.exercises.find((item) => getCanonicalExerciseId(item) === canonicalExerciseId)
      if (!exercise) return []
      const bestSet = bestSetByWeightThenReps(exercise.sets)
      if (!bestSet) return []
      if (bestSet.weight === 0) return `${formatDate(workout.completedAt)} · ${bestSet.reps} сек · объём ${Math.round(exercise.volume).toLocaleString('ru-RU')} кг`
      return `${formatDate(workout.completedAt)} · ${formatNumber(bestSet.weight)} кг · ${bestSet.reps} повт. · объём ${Math.round(exercise.volume).toLocaleString('ru-RU')} кг`
    })
}

function firstCompletedWeight(sets: WorkoutSetInput[]): number | undefined {
  return sets.find((set) => set.completed)?.weight
}

function bestSetByWeightThenReps(sets: WorkoutSetInput[]): WorkoutSetInput | undefined {
  return sets
    .filter((set) => set.completed)
    .sort((a, b) => (b.weight === a.weight ? b.reps - a.reps : b.weight - a.weight))[0]
}

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(isoDate))
}

function formatNumber(value: number): string {
  return String(value)
}
