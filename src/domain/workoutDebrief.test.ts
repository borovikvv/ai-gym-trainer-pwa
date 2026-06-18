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
    expect(debrief.qualityScore).toBeGreaterThanOrEqual(0)
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
    // Base 75 + increase bonus 10 (2x5) + RPE 7-8 bonus 8 (4x2) + exerciseUnderControl 6 (2x3)
    // + allUnderControl 5 + easy sets 3 ≈ 107 → clamped to 100
    expect(score).toBeGreaterThanOrEqual(85)
  })

  it('calculates a low quality score for pain and max-effort sets', () => {
    const score = computeWorkoutQualityScore({
      id: 'session-3',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: '2026-06-07T15:00:00.000Z',
      totalVolume: 800,
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
        {
          exerciseId: 'lat-pulldown',
          exerciseName: 'Тяга верхнего блока',
          pain: false,
          sets: [
            { weight: 29, reps: 10, rpe: 10, completed: true },
          ],
          volume: 290,
          nextRecommendedWeight: 29,
          progressionType: 'deload',
          progressionReason: 'на пределе',
        },
      ],
    } satisfies WorkoutHistoryEntry)
    // Base 75 - pain 15 - deload 5 - RPE 10 penalty 5 - deload 5 - RPE 10 penalty 5 = 40
    expect(score).toBeLessThanOrEqual(50)
  })
})
