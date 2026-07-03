import { describe, expect, it } from 'vitest'
import type { PlannedWorkout } from '../data/programApi'
import type { WorkoutHistoryEntry } from './workoutHistory'
import { nextActionablePlannedWorkout, visibleActionablePlannedWorkouts } from './plannedWorkoutStatus'

const plannedToday = {
  id: 'planned-vyacheslav-2026-06-07-123',
  userId: 'vyacheslav',
  scheduledDate: '2026-06-07',
  status: 'generated',
  source: 'coach',
  goal: 'тренировка',
  coachReason: 'план',
  workoutDayName: 'персональная',
  workoutDay: { id: 'planned-vyacheslav-2026-06-07-123', name: 'персональная', label: '07.06', description: '', exercises: [] },
} as PlannedWorkout

const plannedNext = {
  ...plannedToday,
  id: 'planned-vyacheslav-2026-06-11-456',
  scheduledDate: '2026-06-11',
  workoutDay: { ...plannedToday.workoutDay, id: 'planned-vyacheslav-2026-06-11-456' },
} as PlannedWorkout

describe('planned workout status', () => {
  it('does not treat a completed planned workout as the next workout', () => {
    const history = [
      {
        id: 'session-1',
        userId: 'vyacheslav',
        workoutDayId: 'planned-vyacheslav-2026-06-07-123',
        workoutDayName: 'персональная',
        completedAt: '2026-06-07T15:16:57.645Z',
        totalVolume: 1535,
        exercises: [],
      },
    ] as WorkoutHistoryEntry[]

    expect(visibleActionablePlannedWorkouts([plannedToday, plannedNext], history).map((workout) => workout.id)).toEqual([
      'planned-vyacheslav-2026-06-11-456',
    ])
    expect(nextActionablePlannedWorkout([plannedToday, plannedNext], history)?.id).toBe('planned-vyacheslav-2026-06-11-456')
  })
})
