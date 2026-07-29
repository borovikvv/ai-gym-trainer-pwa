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
  // Issue #163: pain location, intensity 0-10, and red flags
  painLocation?: string
  painIntensity?: number
  redFlags?: string[]
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
      // Issue #163: детали боли идут дальше вместе с булевым признаком —
      // без них сервер соберёт pain_log из одного `pain`, а анкета
      // (локация, интенсивность, красные флаги) не доедет до базы.
      painLocation: log.painLocation,
      painIntensity: log.painIntensity,
      redFlags: log.redFlags,
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

function firstCompletedWeight(sets: WorkoutSetInput[]): number | undefined {
  return sets.find((set) => set.completed)?.weight
}

// Issue #165: compute actual rest between consecutive sets (seconds).
// Returns one entry per adjacent pair (i.e. n-1 results for n sets).
// Skips pairs where either set lacks performedAt — old data, mixed history.
export function computeActualRest(sets: Array<{ performedAt?: string | null }>): number[] {
  const rest: number[] = []
  for (let i = 1; i < sets.length; i++) {
    const prev = sets[i - 1]?.performedAt
    const curr = sets[i]?.performedAt
    if (!prev || !curr) continue
    const ms = new Date(curr).getTime() - new Date(prev).getTime()
    if (Number.isFinite(ms)) rest.push(Math.round(ms / 1000))
  }
  return rest
}
