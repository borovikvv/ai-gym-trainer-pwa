import { describe, expect, it } from 'vitest'
import { buildNextTargets, createWorkoutHistoryEntry, summarizeExerciseHistory } from './workoutHistory'
import type { ExercisePlan } from '../data/mockProgram'

const bench: ExercisePlan = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
  setsCount: 3,
  repMin: 8,
  repMax: 10,
  targetWeight: 60,
  weightStep: 2.5,
  restSeconds: 120,
  previous: '60×10/9/8',
  todayGoal: '60×10/9/9',
  coachFocus: 'контроль',
  alternatives: [],
  instruction: 'инструкция',
  commonMistakes: [],
}

const plank: ExercisePlan = {
  id: 'plank',
  name: 'Планка',
  muscleGroup: 'Кор',
  prescription: '2×40–60 сек',
  setsCount: 2,
  repMin: 40,
  repMax: 60,
  targetWeight: 0,
  weightStep: 0,
  restSeconds: 60,
  previous: '',
  todayGoal: '40–60 сек',
  coachFocus: 'держать корпус',
  alternatives: [],
  instruction: '',
  commonMistakes: [],
}

describe('workout history', () => {
  it('creates a completed workout history entry with per-exercise volume and next recommended weight', () => {
    const entry = createWorkoutHistoryEntry({
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      exercises: [bench],
      logs: {
        'bench-press': {
          exerciseId: 'bench-press',
          pain: false,
          sets: [
            { weight: 60, reps: 10, rpe: 7, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
          ],
        },
      },
      readinessCheckIn: {
        sleepQuality: 2,
        energy: 2,
        stress: 4,
        soreness: 'medium',
        soreMuscleGroups: [],
        painAreas: [],
        availableMinutes: 35,
        notes: '',
      },
      completedAt: '2026-06-03T15:00:00.000Z',
    })

    expect(entry.userId).toBe('vyacheslav')
    expect(entry.readinessCheckIn?.availableMinutes).toBe(35)
    expect(entry.exercises[0].volume).toBe(1800)
    expect(entry.exercises[0].nextRecommendedWeight).toBe(62.5)
    expect(entry.totalVolume).toBe(1800)
  })

  it('summarizes exercise history from newest to oldest', () => {
    const history = [
      createWorkoutHistoryEntry({
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        exercises: [bench],
        logs: {
          'bench-press': {
            exerciseId: 'bench-press',
            pain: false,
            sets: [{ weight: 60, reps: 9, rpe: 8, completed: true }],
          },
        },
        completedAt: '2026-06-01T15:00:00.000Z',
      }),
      createWorkoutHistoryEntry({
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        exercises: [bench],
        logs: {
          'bench-press': {
            exerciseId: 'bench-press',
            pain: false,
            sets: [{ weight: 62.5, reps: 8, rpe: 8, completed: true }],
          },
        },
        completedAt: '2026-06-03T15:00:00.000Z',
      }),
    ]

    expect(summarizeExerciseHistory(history, 'bench-press')).toEqual([
      '03.06 · 62.5 кг · 8 повт. · объём 500 кг',
      '01.06 · 60 кг · 9 повт. · объём 540 кг',
    ])
  })

  it('builds next target weights from the most recent completed workout', () => {
    const history = [
      createWorkoutHistoryEntry({
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        exercises: [bench],
        logs: {
          'bench-press': {
            exerciseId: 'bench-press',
            pain: false,
            sets: [
              { weight: 60, reps: 10, rpe: 7, completed: true },
              { weight: 60, reps: 10, rpe: 7, completed: true },
              { weight: 60, reps: 10, rpe: 7, completed: true },
            ],
          },
        },
        completedAt: '2026-06-03T15:00:00.000Z',
      }),
    ]

    expect(buildNextTargets(history)).toEqual({ 'bench-press': 62.5 })
  })

  it('uses canonical ids for added variants when building next targets and summaries', () => {
    const history = [
      createWorkoutHistoryEntry({
        userId: 'vyacheslav',
        workoutDayId: 'planned-day',
        workoutDayName: 'Персональная',
        exercises: [{ ...plank, id: 'plank-extra-1780844823365' }],
        logs: {
          'plank-extra-1780844823365': {
            exerciseId: 'plank-extra-1780844823365',
            pain: false,
            sets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
          },
        },
        completedAt: '2026-06-03T15:00:00.000Z',
      }),
    ]

    expect(buildNextTargets(history).plank).toBe(0)
    expect(summarizeExerciseHistory(history, 'plank')).toEqual([
      '03.06 · 60 сек · объём 0 кг',
    ])
  })
})
