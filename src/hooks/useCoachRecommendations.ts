import { useCallback, useMemo, useRef, useState } from 'react'
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
  // Фаза 1: все логи сессии — советник видит всю тренировку, не одно упражнение
  logs?: Record<string, ExerciseLog>
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
  logs = {},
}: UseCoachRecommendationsParams) {
  const [coachNextSetHint, setCoachNextSetHint] = useState<NextSetHint | null>(null)
  // Фаза 1: держим один живой запрос next-set. Новый завершённый подход
  // отменяет висящий запрос, чтобы медленный устаревший ответ не затёр
  // свежую подсказку.
  const nextSetAbortRef = useRef<AbortController | null>(null)

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
      // Отменяем предыдущий висящий запрос — его ответ уже устарел.
      nextSetAbortRef.current?.abort()
      const abortController = new AbortController()
      nextSetAbortRef.current = abortController
      // Всё выполненное в этой сессии по другим упражнениям — контекст для LLM.
      const exercisesById = new Map(activeWorkoutDayExercises.map((exercise) => [exercise.id, exercise]))
      const sessionSoFar = Object.values(logs)
        .filter((log) => log.exerciseId !== activeExercise.id && log.sets.some((set) => set.completed && Number(set.reps) > 0))
        .map((log) => ({
          exerciseId: log.exerciseId,
          exerciseName: exercisesById.get(log.exerciseId)?.name,
          muscleGroup: exercisesById.get(log.exerciseId)?.muscleGroup,
          pain: Boolean(log.pain),
          sets: log.sets
            .filter((set) => set.completed && Number(set.reps) > 0)
            .map((set) => ({ weight: set.weight, reps: set.reps, rpe: set.rpe, completed: true })),
        }))
      let serverRecommendation
      try {
        serverRecommendation = await requestCoachNextSetFromApi(
          {
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
            sessionSoFar,
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
          },
          undefined,
          undefined,
          abortController.signal,
        )
      } finally {
        if (nextSetAbortRef.current === abortController) nextSetAbortRef.current = null
      }
      if (!serverRecommendation) return null
      return {
        weight: serverRecommendation.recommendedWeight,
        reps: serverRecommendation.recommendedReps,
        restSeconds: serverRecommendation.recommendedRestSeconds,
        reason: serverRecommendation.reason,
        action: serverRecommendation.action,
        detail: serverRecommendation.detail,
        source: serverRecommendation.source,
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
      logs,
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
