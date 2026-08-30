import { useMemo } from 'react'
import type { ProgramData, PlannedWorkout } from '../data/programApi'
import { fallbackProgramData } from '../data/programApi'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import { buildTrainingCalendar } from '../domain/coachPlanning'
import { buildProgressDashboard } from '../domain/progressDashboard'
import { calculateProgression, countPreviousFailures, type WorkoutSetInput } from '../domain/progression'
import { computeSessionRepDeviation } from '../domain/repExpectation'
import { buildNextTargets, type ExerciseLog, type WorkoutHistoryEntry } from '../domain/workoutHistory'
import { nextActionablePlannedWorkout, visibleActionablePlannedWorkouts } from '../domain/plannedWorkoutStatus'
import { getCanonicalExerciseId } from '../domain/exerciseIdentity'
import { isTimedExercise } from '../domain/exerciseMetrics'
import { createDefaultQuestionnaire } from './useQuestionnaire'
import { createSets } from './useWorkoutSession'
import { formatWeight } from '../lib/format'

function formatSetSummary(set: WorkoutSetInput, exercise?: Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup'>) {
  if (exercise && isTimedExercise(exercise)) return `${set.reps} сек`
  return `${formatWeight(set.weight)}×${set.reps}`
}

type UseActiveWorkoutContextOptions = {
  programData: ProgramData
  activeUserId: string
  activeWorkoutDayId: string
  plannedWorkouts: PlannedWorkout[]
  history: WorkoutHistoryEntry[]
  extraWorkoutDays: WorkoutDay[]
  coachTodayWorkoutDay: WorkoutDay | null
  extraExercisesByDay: Record<string, ExercisePlan[]>
  activeSessionWorkoutDay: WorkoutDay | null
  // Issue #242: состав дня из восстановленного черновика.
  draftSessionExercises?: { workoutDayId: string; exercises: ExercisePlan[] } | null
  activeExerciseIndex: number
  logs: Record<string, ExerciseLog>
}

export function useActiveWorkoutContext({
  programData,
  activeUserId,
  activeWorkoutDayId,
  plannedWorkouts,
  history,
  extraWorkoutDays,
  coachTodayWorkoutDay,
  extraExercisesByDay,
  activeSessionWorkoutDay,
  draftSessionExercises,
  activeExerciseIndex,
  logs,
}: UseActiveWorkoutContextOptions) {
  const users = programData.users
  const allUserWorkoutDays = programData.workoutDaysByUser[activeUserId] ?? programData.workoutDays
  const activeProfile = programData.profilesByUser?.[activeUserId]
    ?? fallbackProgramData.profilesByUser?.[activeUserId]
    ?? fallbackProgramData.profilesByUser?.[fallbackProgramData.users[0].id]
    ?? createDefaultQuestionnaire(activeUserId, users.find((user) => user.id === activeUserId)?.goal ?? '')

  const userHistory = useMemo(
    () => history.filter((workout) => workout.userId === activeUserId),
    [activeUserId, history],
  )
  const actionablePlannedWorkouts = useMemo(
    () => visibleActionablePlannedWorkouts(plannedWorkouts, userHistory),
    [plannedWorkouts, userHistory],
  )
  const plannedWorkoutDays = actionablePlannedWorkouts.map((workout) => workout.workoutDay)
  const scheduledWorkoutDays = plannedWorkoutDays.length > 0
    ? plannedWorkoutDays
    : allUserWorkoutDays.slice(0, Math.min(allUserWorkoutDays.length, Math.max(1, activeProfile.workoutsPerWeek || 3)))

  const nextTargets = useMemo(
    () => buildNextTargets(history.filter((workout) => workout.userId === activeUserId)),
    [activeUserId, history],
  )

  const userWorkoutDays = useMemo(
    () => [...scheduledWorkoutDays, ...extraWorkoutDays, ...(coachTodayWorkoutDay ? [coachTodayWorkoutDay] : [])],
    [scheduledWorkoutDays, extraWorkoutDays, coachTodayWorkoutDay],
  )
  const firstWorkoutDay = userWorkoutDays[0] ?? allUserWorkoutDays[0] ?? fallbackProgramData.workoutDays[0]
  const baseActiveWorkoutDay = userWorkoutDays.find((day) => day.id === activeWorkoutDayId) ?? firstWorkoutDay
  const activeWorkoutDayBase = useMemo(
    () => ({
      ...baseActiveWorkoutDay,
      exercises: [...baseActiveWorkoutDay.exercises, ...(extraExercisesByDay[baseActiveWorkoutDay.id] ?? [])],
    }),
    [baseActiveWorkoutDay, extraExercisesByDay],
  )
  // Issue #242: пока пользователь не менял состав в этой сессии
  // (activeSessionWorkoutDay ещё null), день берётся из черновика — иначе
  // добавленные и заменённые упражнения исчезали после перезагрузки, а
  // выполненные на них подходы молча терялись при сохранении.
  const restoredSessionWorkoutDay = draftSessionExercises?.workoutDayId === baseActiveWorkoutDay.id
    ? { ...activeWorkoutDayBase, exercises: draftSessionExercises.exercises }
    : null
  const activeWorkoutDay = activeSessionWorkoutDay ?? restoredSessionWorkoutDay ?? activeWorkoutDayBase
  const workoutDays = userWorkoutDays

  const trainingCalendar = useMemo(
    () => buildTrainingCalendar({
      trainingDays: activeProfile.trainingDays,
      workoutDays,
      completedWorkouts: history
        .filter((workout) => workout.userId === activeUserId)
        .map((workout) => ({ workoutDayId: workout.workoutDayId, completedAt: workout.completedAt })),
    }),
    [activeProfile.trainingDays, activeUserId, history, workoutDays],
  )

  const activeUser = users.find((user) => user.id === activeUserId) ?? users[0] ?? fallbackProgramData.users[0]
  const activeExercise = activeWorkoutDay.exercises[activeExerciseIndex] ?? activeWorkoutDay.exercises[0]

  const createExerciseLog = (exercise: ExercisePlan): ExerciseLog => ({
    exerciseId: exercise.id,
    pain: false,
    sets: createSets(exercise, nextTargets[exercise.id] ?? exercise.targetWeight),
  })
  const activeLog = logs[activeExercise.id] ?? createExerciseLog(activeExercise)
  const activeSetIndex = activeLog.sets.findIndex((set) => !set.completed)
  const allSetsCompleted = activeSetIndex === -1
  const nextExercise = activeWorkoutDay.exercises[activeExerciseIndex + 1]
  const nextPlannedWorkout = nextActionablePlannedWorkout(plannedWorkouts, userHistory)
  const progressDashboard = useMemo(
    () => buildProgressDashboard({ history: userHistory, workoutDays, bodyWeightKg: activeProfile?.weightKg, age: activeProfile?.age }),
    [userHistory, workoutDays, activeProfile?.weightKg, activeProfile?.age],
  )

  const previousExerciseHistory = userHistory
    .flatMap((workout) => workout.exercises)
    .find((exercise) => getCanonicalExerciseId(exercise) === getCanonicalExerciseId(activeExercise))
  const previousCompletedSets = previousExerciseHistory?.sets.filter((set) => set.completed) ?? []
  const previousSetsSummary = previousCompletedSets.length > 0
    ? previousCompletedSets.map((set) => formatSetSummary(set, activeExercise)).join(' / ')
    : activeExercise.previous || 'нет данных'

  const progressionSummary = useMemo(
    () =>
      activeWorkoutDay.exercises.slice(0, Math.max(1, activeExerciseIndex + 1)).map((exercise) => {
        const log = logs[exercise.id] ?? createExerciseLog(exercise)
        // Issue #247: то же отклонение повторов, что считает сохранение, — иначе
        // предпросмотр на экране обзора обещал бы increase, а запись — hold.
        const avgRepDeviation = computeSessionRepDeviation(
          {
            completedAt: new Date().toISOString(),
            exercises: [{ exerciseId: exercise.id, canonicalExerciseId: getCanonicalExerciseId(exercise), sets: log.sets }],
          },
          userHistory,
        ).avgDeviation
        return calculateProgression({
          exerciseName: exercise.name,
          currentWeight: log.sets.find((set) => set.completed)?.weight ?? nextTargets[exercise.id] ?? exercise.targetWeight,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          weightStep: exercise.weightStep,
          equipment: exercise.equipment,
          sets: log.sets,
          pain: log.pain,
          avgRepDeviation,
          // Issue #245: история тянет ветку deload — без счётчика снижение
          // веса между тренировками недостижимо.
          previousFailureCount: countPreviousFailures(userHistory, {
            canonicalExerciseId: getCanonicalExerciseId(exercise),
            repMin: exercise.repMin,
          }),
        })
      }),
    [activeExerciseIndex, activeWorkoutDay, logs, nextTargets, userHistory],
  )

  const totalVolume = useMemo(
    () => Object.values(logs).reduce(
      (sum, log) => sum + log.sets.reduce((setSum, set) => setSum + (set.completed ? set.weight * set.reps : 0), 0),
      0,
    ),
    [logs],
  )

  return {
    users,
    allUserWorkoutDays,
    activeProfile,
    scheduledWorkoutDays,
    nextTargets,
    userWorkoutDays,
    firstWorkoutDay,
    activeWorkoutDayBase,
    activeWorkoutDay,
    workoutDays,
    trainingCalendar,
    activeUser,
    activeExercise,
    createExerciseLog,
    activeLog,
    activeSetIndex,
    allSetsCompleted,
    nextExercise,
    nextPlannedWorkout,
    userHistory,
    progressDashboard,
    previousSetsSummary,
    progressionSummary,
    totalVolume,
  }
}
