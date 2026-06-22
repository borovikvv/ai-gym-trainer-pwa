import { describe, expect, it } from 'vitest'
import { buildWorkoutDebrief } from './workoutDebrief'
import type { WorkoutHistoryEntry } from './workoutHistory'

describe('workout debrief', () => {
  it('summarizes wins, overload, progressions, next changes and why', () => {
    const debrief = buildWorkoutDebrief({
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      readinessCheckIn: {
        sleepQuality: 2,
        energy: 2,
        stress: 4,
        soreness: 'medium',
        soreMuscleGroups: ['Грудь'],
        painAreas: [],
        availableMinutes: 35,
        notes: '',
      },
      totalVolume: 1220,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          sets: [
            { weight: 40, reps: 8, rpe: 7, completed: true },
            { weight: 40, reps: 8, rpe: 10, completed: true },
          ],
          volume: 640,
          nextRecommendedWeight: 37.5,
          progressionType: 'deload',
          progressionReason: 'был подход на пределе',
        },
        {
          exerciseId: 'lat-pulldown',
          exerciseName: 'Тяга верхнего блока',
          pain: false,
          sets: [
            { weight: 29, reps: 10, rpe: 7, completed: true },
            { weight: 29, reps: 10, rpe: 7, completed: true },
          ],
          volume: 580,
          nextRecommendedWeight: 31.5,
          progressionType: 'increase',
          progressionReason: 'можно повысить вес',
        },
      ],
    } satisfies WorkoutHistoryEntry)

    expect(debrief.summary).toContain('2 упражнения')
    expect(debrief.wentWell).toEqual(expect.arrayContaining([expect.stringContaining('Тяга верхнего блока')]))
    expect(debrief.overload).toEqual(expect.arrayContaining([expect.stringContaining('Жим лёжа')]))
    expect(debrief.progressed).toEqual(expect.arrayContaining([expect.stringContaining('Тяга верхнего блока')]))
    expect(debrief.nextChanges).toEqual(expect.arrayContaining([expect.stringContaining('Жим лёжа')]))
    expect(debrief.why).toContain('мало восстановления')
    expect(debrief.qualityScore).toBe(0)
  })
})
