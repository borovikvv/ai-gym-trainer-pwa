import { useCallback, useMemo, useState } from 'react'
import type { ExercisePlan  } from '../../shared/types'
import type { ReadinessCheckIn } from '../domain/readinessCheckIn'
import {
  isProgramApiConfigured,
  requestCoachLiveStrategyFromApi,
  requestCoachNextSetFromApi,
} from '../data/programApi'
import { recommendNextSet } from '../domain/coachPlanning'
import type { WorkoutSetInput } from '../domain/progression'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { NextSetHint } from '../components/gymTypes'

type UseCoachRecommendationsParams = {
  activeUserId: string
  activeExercise: ExercisePlan
  activeLog: ExerciseLog
  activeWorkoutDayExercises?: ExercisePlan[]
  activeExerciseIndex?: number
  exerciseLibrary?: ExercisePlan[]
  availableMinutes?: number
  readinessCheckIn?: ReadinessCheckIn
  apiConfigured?: boolean
}

type RequestServerNextSetParams = {
  completedSets: WorkoutSetInput[]
  remainingSets: number
  pain: boolean
}

type RequestLiveStrategyParams = RequestServerNextSetParams

export function useCoachRecommendations({
  activeUserId,
  activeExercise,
  activeLog,
  activeWorkoutDayExercises = [],
  activeExerciseIndex = 0,
  exerciseLibrary = [],
  availableMinutes,
  readinessCheckIn,
  apiConfigured = isProgramApiConfigured,
}: UseCoachRecommendationsParams) {
  const [coachNextSetHint, setCoachNextSetHint] = useState<NextSetHint | null>(null)

  const getLocalNextSetRecommendation = useCallback(
    (completedSets: WorkoutSetInput[]) => recommendNextSet({
      completedSets,
      repMin: activeExercise.repMin,
      repMax: activeExercise.repMax,
      weightStep: activeExercise.weightStep,
    }),
    [activeExercise.repMin, activeExercise.repMax, activeExercise.weightStep],
  )

  const localNextSetRecommendation = useMemo(
    () => getLocalNextSetRecommendation(activeLog.sets.filter((set) => set.completed)),
    [activeLog.sets, getLocalNextSetRecommendation],
  )

  const visibleNextSetRecommendation = coachNextSetHint ?? (localNextSetRecommendation
    ? {
        weight: localNextSetRecommendation.weight,
        reps: localNextSetRecommendation.reps,
        restSeconds: activeExercise.restSeconds,
        reason: localNextSetRecommendation.reason,
        action: 'local',
      }
    : null)

  const requestServerNextSet = useCallback(
    async ({ completedSets, remainingSets, pain }: RequestServerNextSetParams) => {
      if (!apiConfigured) return null
      const serverRecommendation = await requestCoachNextSetFromApi({
        userId: activeUserId,
        exercise: {
          id: activeExercise.id,
          name: activeExercise.name,
          muscleGroup: activeExercise.muscleGroup,
          repMin: activeExercise.repMin,
          repMax: activeExercise.repMax,
          targetWeight: activeExercise.targetWeight,
          weightStep: activeExercise.weightStep,
          restSeconds: activeExercise.restSeconds,
        },
        completedSets: completedSets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          completed: Boolean(set.completed),
        })),
        remainingSets,
        pain,
        context: {
          session: {
            activeExerciseIndex,
            availableMinutes,
            readinessCheckIn,
            nextExercise: activeWorkoutDayExercises[activeExerciseIndex + 1] ?? null,
            workoutExercises: activeWorkoutDayExercises,
            exerciseLibrary,
          },
        },
      })
      if (!serverRecommendation) return null
      return {
        weight: serverRecommendation.recommendedWeight,
        reps: serverRecommendation.recommendedReps,
        restSeconds: serverRecommendation.recommendedRestSeconds,
        reason: serverRecommendation.reason,
        action: serverRecommendation.action,
        remainingSetUpdates: serverRecommendation.remainingSetUpdates,
        suggestedExercise: serverRecommendation.suggestedExercise,
        suggestedExercises: serverRecommendation.suggestedExercises,
      }
    },
    [
      activeUserId,
      activeExercise.id,
      activeExercise.name,
      activeExercise.muscleGroup,
      activeExercise.repMin,
      activeExercise.repMax,
      activeExercise.targetWeight,
      activeExercise.weightStep,
      activeExercise.restSeconds,
      activeWorkoutDayExercises,
      activeExerciseIndex,
      exerciseLibrary,
      availableMinutes,
      readinessCheckIn,
      apiConfigured,
    ],
  )

  const requestLiveStrategy = useCallback(
    async ({ completedSets, remainingSets, pain }: RequestLiveStrategyParams) => {
      if (!apiConfigured) return null
      const decision = await requestCoachLiveStrategyFromApi({
        userId: activeUserId,
        exercise: {
          id: activeExercise.id,
          name: activeExercise.name,
          muscleGroup: activeExercise.muscleGroup,
          repMin: activeExercise.repMin,
          repMax: activeExercise.repMax,
          targetWeight: activeExercise.targetWeight,
          weightStep: activeExercise.weightStep,
          restSeconds: activeExercise.restSeconds,
        },
        completedSets: completedSets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          completed: Boolean(set.completed),
        })),
        pain,
        context: {
          session: {
            activeExerciseIndex,
            availableMinutes,
            readinessCheckIn,
            remainingSets,
            nextExercise: activeWorkoutDayExercises[activeExerciseIndex + 1] ?? null,
            workoutExercises: activeWorkoutDayExercises,
            exerciseLibrary,
          },
        },
      })
      const action = decision?.actions?.[0]
      if (!decision || !action || action.type === 'hold_strategy') return null
      const suggestedExercise = action.exerciseId
        ? exerciseLibrary.find((exercise) => exercise.id === action.exerciseId)
        : undefined
      return {
        weight: 0,
        reps: 0,
        restSeconds: 0,
        reason: decision.summary || action.reason,
        action: mapLiveStrategyAction(action.type, remainingSets),
        suggestedExercise,
      }
    },
    [
      activeUserId,
      activeExercise.id,
      activeExercise.name,
      activeExercise.muscleGroup,
      activeExercise.repMin,
      activeExercise.repMax,
      activeExercise.targetWeight,
      activeExercise.weightStep,
      activeExercise.restSeconds,
      activeWorkoutDayExercises,
      activeExerciseIndex,
      exerciseLibrary,
      availableMinutes,
      readinessCheckIn,
      apiConfigured,
    ],
  )

  return {
    coachNextSetHint,
    setCoachNextSetHint,
    visibleNextSetRecommendation,
    getLocalNextSetRecommendation,
    requestServerNextSet,
    requestLiveStrategy,
  }
}

function mapLiveStrategyAction(action: string, remainingSets: number) {
  if (action === 'finish_workout_early') return 'finish_workout'
  if (action === 'replace_next_exercise') return 'replace_next_exercise'
  if (action === 'add_accessory') return 'add_exercise'
  if (action === 'reduce_remaining_volume') return remainingSets > 0 ? 'skip_remaining_sets' : 'stop_exercise'
  return 'local'
}
