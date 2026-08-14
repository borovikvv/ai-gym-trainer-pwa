import { describe, expect, it } from 'vitest'
import { buildNextTargets, computeSetIntervals, createWorkoutHistoryEntry } from './workoutHistory'
import type { ExercisePlan  } from '../../shared/types'

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
  })

  // Issue #165: computeSetIntervals — интервал завершение→завершение,
  // отдых плюс работа следующего подхода (чистый отдых без второго
  // таймстемпа не отделим).
  describe('computeSetIntervals', () => {
    it('returns empty array for a single set', () => {
      expect(computeSetIntervals([{ performedAt: '2026-07-29T12:00:00.000Z' }])).toEqual([])
    })

    it('returns interval seconds between consecutive sets', () => {
      const result = computeSetIntervals([
        { performedAt: '2026-07-29T12:00:00.000Z' },
        { performedAt: '2026-07-29T12:02:30.000Z' },
        { performedAt: '2026-07-29T12:05:00.000Z' },
      ])
      expect(result).toEqual([150, 150])
    })

    it('skips pairs where either set lacks performedAt', () => {
      const result = computeSetIntervals([
        { performedAt: '2026-07-29T12:00:00.000Z' },
        {},
        { performedAt: '2026-07-29T12:05:00.000Z' },
        { performedAt: '2026-07-29T12:07:00.000Z' },
      ])
      // pair 0→1 skipped (no performedAt), 1→2 skipped, 2→3 = 120s
      expect(result).toEqual([120])
    })

    it('returns empty array for empty input', () => {
      expect(computeSetIntervals([])).toEqual([])
    })
  })

  // Issue #247: отклонение повторов от личного ожидания (#167) становится
  // стоп-фактором решения о весе: человек упирается в repMax, но делает на
  // этом весе заметно меньше повторов, чем раньше, — вес не растёт.
  describe('rep deviation as progression guard (#247)', () => {
    const historyEntry = (completedAt: string, reps: number[]) =>
      createWorkoutHistoryEntry({
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        exercises: [bench],
        logs: {
          'bench-press': {
            exerciseId: 'bench-press',
            pain: false,
            sets: reps.map((reps) => ({ weight: 60, reps, rpe: 7, completed: true })),
          },
        },
        completedAt,
      })

    const decliningSession = () => ({
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      exercises: [bench],
      logs: {
        'bench-press': {
          exerciseId: 'bench-press',
          pain: false,
          sets: [
            { weight: 60, reps: 10, rpe: 8, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
            { weight: 60, reps: 10, rpe: 8, completed: true },
          ],
        },
      },
      completedAt: '2026-06-15T15:00:00.000Z',
    })

    it('держивает вес при падении отдачи на том же весе', () => {
      const history = [
        historyEntry('2026-06-01T15:00:00.000Z', [12, 12, 12]),
        historyEntry('2026-06-08T15:00:00.000Z', [12, 12, 12]),
      ]

      const entry = createWorkoutHistoryEntry({ ...decliningSession(), history })

      expect(entry.exercises[0].progressionType).toBe('hold')
      expect(entry.exercises[0].nextRecommendedWeight).toBe(60)
    })

    it('без накопленного ожидания фолбэк не меняется — вес растёт как раньше', () => {
      const history = [historyEntry('2026-06-01T15:00:00.000Z', [12, 12, 12])]

      const entry = createWorkoutHistoryEntry({ ...decliningSession(), history })

      expect(entry.exercises[0].progressionType).toBe('increase')
      expect(entry.exercises[0].nextRecommendedWeight).toBe(62.5)
    })
  })
})
