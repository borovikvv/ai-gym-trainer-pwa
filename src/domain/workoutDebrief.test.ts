import { describe, expect, it } from 'vitest'
import { buildWorkoutDebrief, computeWorkoutQualityScore } from './workoutDebrief'
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
    expect(debrief.qualityScore).toBeGreaterThan(0)
    expect(debrief.qualityScore).toBeLessThanOrEqual(100)
  })

  it('calculates a high quality score for controlled RPE and progression', () => {
    const score = computeWorkoutQualityScore({
      id: 'session-2',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      totalVolume: 2000,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          sets: [
            { weight: 40, reps: 8, rpe: 7, completed: true },
            { weight: 40, reps: 8, rpe: 8, completed: true },
          ],
          volume: 640,
          nextRecommendedWeight: 42.5,
          progressionType: 'increase',
          progressionReason: 'вес освоен',
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
          progressionReason: 'можно повысить',
        },
      ],
    } satisfies WorkoutHistoryEntry)

    expect(score).toBeGreaterThanOrEqual(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('calculates a low quality score for pain and RPE 10 sets', () => {
    const score = computeWorkoutQualityScore({
      id: 'session-3',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      totalVolume: 500,
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: true,
          sets: [
            { weight: 40, reps: 8, rpe: 10, completed: true },
          ],
          volume: 320,
          nextRecommendedWeight: 37.5,
          progressionType: 'pain',
          progressionReason: 'была боль',
        },
      ],
    } satisfies WorkoutHistoryEntry)

    expect(score).toBeLessThan(70)
  })

  it('returns 0 for empty exercises', () => {
    const score = computeWorkoutQualityScore({
      id: 'session-4',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      totalVolume: 0,
      exercises: [],
    } satisfies WorkoutHistoryEntry)

    expect(score).toBe(0)
  })

  it('uses "уменьшить помощь" wording for gravitron exercises in progressed list', () => {
    const debrief = buildWorkoutDebrief({
      id: 'session-gravitron',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      totalVolume: 700,
      exercises: [
        {
          exerciseId: 'assisted-pull-up',
          exerciseName: 'Подтягивания в гравитроне',
          pain: false,
          sets: [
            { weight: 35, reps: 10, rpe: 7, completed: true },
            { weight: 35, reps: 10, rpe: 8, completed: true },
          ],
          volume: 700,
          nextRecommendedWeight: 32.5, // decreased (less assistance)
          progressionType: 'increase',
          progressionReason: 'можно уменьшить помощь',
        },
      ],
    } satisfies WorkoutHistoryEntry)

    expect(debrief.progressed).toHaveLength(1)
    expect(debrief.progressed[0]).toContain('уменьшить помощь')
    expect(debrief.progressed[0]).not.toContain('повысить')
  })
})
