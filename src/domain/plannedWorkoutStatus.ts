import type { PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from './workoutHistory'

export function visibleActionablePlannedWorkouts(plannedWorkouts: PlannedWorkout[], history: WorkoutHistoryEntry[]) {
  const completedPlannedIds = new Set(
    history
      .filter((workout) => workout.workoutDayId)
      .map((workout) => workout.workoutDayId),
  )
  return plannedWorkouts
    .filter((workout) => ['planned', 'generated', 'moved'].includes(workout.status))
    .filter((workout) => !completedPlannedIds.has(workout.id) && !completedPlannedIds.has(workout.workoutDay?.id ?? ''))
}

export function nextActionablePlannedWorkout(plannedWorkouts: PlannedWorkout[], history: WorkoutHistoryEntry[]) {
  return visibleActionablePlannedWorkouts(plannedWorkouts, history)[0]
}
