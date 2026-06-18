import { describe, expect, it } from 'vitest'
import { computeCoachState } from './coachState.js'

const profile = {
  userId: 'vyacheslav',
  workoutsPerWeek: 2,
  trainingDays: ['Четверг', 'Воскресенье'],
}

const workoutDays = [
  {
    id: 'vyacheslav-program-day-a',
    dayKey: 'day-a',
    name: 'Full Body A',
    exercises: [
      { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'грудь', targetWeight: 40, repMin: 6, repMax: 8 },
      { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'спина', targetWeight: 22.5, repMin: 8, repMax: 10 },
      { id: 'plank', name: 'Планка', muscleGroup: 'кор', targetWeight: 0, repMin: 40, repMax: 60 },
    ],
  },
]

const history = [
  {
    id: 'session-yesterday',
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    workoutDayName: 'Full Body A',
    completedAt: '2026-06-04T18:00:00.000Z',
    totalVolume: 1500,
    exercises: [
      {
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [
          { weight: 40, reps: 6, rpe: 10, completed: true },
          { weight: 37.5, reps: 6, rpe: 9, completed: true },
        ],
      },
      {
        exerciseId: 'lat-pulldown',
        exerciseName: 'Тяга верхнего блока',
        pain: false,
        sets: [
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
        ],
      },
    ],
  },
]

describe('Coach State', () => {
  it('summarizes recovery, weekly load, muscle fatigue and exercise readiness from recent workouts', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state).toMatchObject({
      userId: 'vyacheslav',
      daysSinceLastWorkout: 1,
      actualWorkoutsLast7Days: 1,
      plannedWorkoutsPerWeek: 2,
      weeklyLoadStatus: 'below_plan',
      recoveryStatus: 'partial',
    })

    expect(state.muscleGroups).toMatchObject({
      chest: { fatigue: 'high', recentHardSets: 2, lastTrainedDaysAgo: 1 },
      back: { fatigue: 'medium', recentHardSets: 0, lastTrainedDaysAgo: 1 },
    })

    expect(state.exercises['bench-press']).toMatchObject({
      status: 'consolidate',
      lastWeight: 40,
      maxEffortSets: 1,
      target: 'закрепить вес без отказа',
    })

    expect(state.exercises['lat-pulldown']).toMatchObject({
      status: 'progress_possible',
      lastWeight: 22.5,
      target: 'можно повышать нагрузку',
    })
  })

  it('marks recovery as low after a very recent high-intensity workout', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-06-04T22:00:00.000Z'),
    })

    expect(state.daysSinceLastWorkout).toBe(0)
    expect(state.recoveryStatus).toBe('low')
    expect(state.readinessScore).toBeLessThan(60)
  })

  it('uses age as a recovery prior while early personal statistics are sparse', () => {
    const easyHistory = [{
      id: 'session-two-days-ago',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'Full Body A',
      completedAt: '2026-06-03T18:00:00.000Z',
      totalVolume: 900,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [{ weight: 35, reps: 8, rpe: 7, completed: true }],
      }],
    }]

    const vyacheslav = computeCoachState({
      profile: { ...profile, age: 43 },
      workoutDays,
      history: easyHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })
    const oleg = computeCoachState({
      profile: { ...profile, userId: 'oleg', age: 15 },
      workoutDays,
      history: easyHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(vyacheslav.recoveryStatus).toBe('partial')
    expect(oleg.recoveryStatus).toBe('ready')
    expect(vyacheslav.readinessScore).toBeLessThan(oleg.readinessScore)
  })

  it('lets accumulated clean training history outweigh the age prior', () => {
    const cleanHistory = Array.from({ length: 8 }, (_, index) => ({
      id: `clean-session-${index}`,
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'Full Body A',
      completedAt: new Date(Date.UTC(2026, 5, 3 - index, 18, 0, 0)).toISOString(),
      totalVolume: 900,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [{ weight: 35, reps: 8, rpe: 7, completed: true }],
      }],
    }))

    const state = computeCoachState({
      profile: { ...profile, age: 43 },
      workoutDays,
      history: cleanHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state.recoveryStatus).toBe('ready')
    expect(state.personalization.trainingDataConfidence).toBe(1)
  })

  it('uses canonical exercise ids for generated extra exercises', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history: [{
        id: 'session-extra-plank',
        userId: 'vyacheslav',
        workoutDayId: 'planned-day',
        workoutDayName: 'Персональная',
        completedAt: '2026-06-04T18:00:00.000Z',
        totalVolume: 0,
        exercises: [{
          exerciseId: 'plank-extra-1780844823365',
          exerciseName: 'Планка',
          pain: false,
          sets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
        }],
      }],
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state.exercises.plank).toMatchObject({
      status: 'progress_possible',
      lastWeight: 0,
      lastReps: 60,
    })
    expect(state.exercises['plank-extra-1780844823365']).toBeUndefined()
    expect(state.muscleGroups.core).toMatchObject({ lastTrainedDaysAgo: 1 })
  })
})
