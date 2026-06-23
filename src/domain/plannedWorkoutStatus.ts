import type { PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from './workoutHistory'

/**
 * Filter planned workouts to only show actionable ones (not yet completed).
 *
 * Two filtering strategies:
 *   1. By ID: if history has a workout with the same workoutDayId as the
 *      planned workout's ID, it was completed.
 *   2. By date: if history has a workout completed on the same date as
 *      the planned workout's scheduledDate, don't show it — even if the
 *      IDs don't match (server may have generated a new planned_workout
 *      with a different ID for the same date).
 */
export function visibleActionablePlannedWorkouts(plannedWorkouts: PlannedWorkout[], history: WorkoutHistoryEntry[]) {
  // Collect IDs of completed planned workouts from history.
  const completedPlannedIds = new Set(
    history
      .filter((workout) => workout.workoutDayId)
      .map((workout) => workout.workoutDayId),
  )

  // Collect dates of completed workouts (YYYY-MM-DD format).
  const completedDates = new Set(
    history
      .filter((workout) => workout.completedAt)
      .map((workout) => workout.completedAt.slice(0, 10)),
  )

  return plannedWorkouts
    .filter((workout) => ['planned', 'generated', 'moved'].includes(workout.status))
    .filter((workout) => !completedPlannedIds.has(workout.id) && !completedPlannedIds.has(workout.workoutDay?.id ?? ''))
    .filter((workout) => !completedDates.has(workout.scheduledDate))
}

export function nextActionablePlannedWorkout(plannedWorkouts: PlannedWorkout[], history: WorkoutHistoryEntry[]) {
  return visibleActionablePlannedWorkouts(plannedWorkouts, history)[0]
}
