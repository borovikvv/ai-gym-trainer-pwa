import type { ProgramData } from '../data/programApi'
import type { WorkoutDay  } from '../../shared/types'
import { buildNextTargets, type WorkoutHistoryEntry, type ExerciseLog } from '../domain/workoutHistory'
import { createInitialLogs } from './useWorkoutSession'

type UseUserSelectionOptions = {
  programData: ProgramData
  activeWorkoutDayId: string
  activeWorkoutDay: WorkoutDay
  history: WorkoutHistoryEntry[]
  users: ProgramData['users']
  setActiveUserId: (userId: string) => void
  setActiveWorkoutDayId: (workoutDayId: string) => void
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  resetCoachTodayWorkout: () => void
  notify: (message: string) => void
}

export function useUserSelection({
  programData,
  activeWorkoutDayId,
  activeWorkoutDay,
  history,
  users,
  setActiveUserId,
  setActiveWorkoutDayId,
  setActiveExerciseIndex,
  setLogs,
  resetCoachTodayWorkout,
  notify,
}: UseUserSelectionOptions) {
  function selectUser(userId: string) {
    setActiveUserId(userId)
    resetCoachTodayWorkout()
    setActiveExerciseIndex(0)
    const nextProfile = programData.profilesByUser?.[userId]
    const allNextDays = programData.workoutDaysByUser[userId] ?? programData.workoutDays
    const nextDays = allNextDays.slice(0, Math.min(allNextDays.length, Math.max(1, nextProfile?.workoutsPerWeek || 3)))
    const nextWorkoutDay = nextDays.find((day) => day.id === activeWorkoutDayId) ?? nextDays[0] ?? allNextDays[0] ?? activeWorkoutDay
    setActiveWorkoutDayId(nextWorkoutDay.id)
    const userTargets = buildNextTargets(history.filter((workout) => workout.userId === userId))
    setLogs(createInitialLogs(nextWorkoutDay, userTargets))
    const nextUser = users.find((user) => user.id === userId)
    notify(`Выбран пользователь: ${nextUser?.name ?? userId}`)
  }

  return { selectUser }
}
