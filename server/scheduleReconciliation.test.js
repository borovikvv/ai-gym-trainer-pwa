import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconcileSchedule } from './services/scheduleReconciliation.ts'
import { markPlannedWorkoutCompleted } from './services/workoutService.ts'
import { buildGeneratedPlannedWorkout } from './plannedWorkoutGenerator.js'

vi.mock('./services/plannedWorkoutService.ts', () => ({
  cascadeRegenerateFutureWorkouts: vi.fn().mockResolvedValue(2),
}))

import { cascadeRegenerateFutureWorkouts } from './services/plannedWorkoutService.ts'

describe('reconcileSchedule (Фаза 2Б.2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks overdue planned workouts as missed and cascades regeneration', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ scheduled_date: new Date('2026-07-08T00:00:00Z') }] }),
    }
    const result = await reconcileSchedule(client, 'vyacheslav')
    expect(result.missedDates).toEqual(['2026-07-08'])
    expect(result.regenerated).toBe(2)
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledWith(client, { userId: 'vyacheslav' })
    // The update targets only overdue, not-yet-completed statuses
    const sql = client.query.mock.calls[0][0]
    expect(sql).toContain(`status = 'missed'`)
    expect(sql).toContain(`status in ('planned', 'generated', 'moved')`)
    expect(sql).toContain('scheduled_date < current_date')
  })

  it('does nothing (no cascade) when there are no missed workouts', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const result = await reconcileSchedule(client, 'vyacheslav')
    expect(result).toEqual({ missedDates: [], regenerated: 0 })
    expect(cascadeRegenerateFutureWorkouts).not.toHaveBeenCalled()
  })
})

describe('markPlannedWorkoutCompleted (Фаза 2Б.1, регрессия)', () => {
  it('marks by planned workout id when the entry came from the plan', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'planned-vyacheslav-2026-07-10-123' }] }),
    }
    await markPlannedWorkoutCompleted(client, {
      userId: 'vyacheslav',
      workoutDayId: 'planned-vyacheslav-2026-07-10-123',
      completedAt: '2026-07-10T18:00:00.000Z',
    })
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(client.query.mock.calls[0][1]).toEqual(['planned-vyacheslav-2026-07-10-123', 'vyacheslav'])
  })

  it('falls back to matching by date when workoutDayId is a program day id (таб «Зал»)', async () => {
    const client = {
      query: vi.fn()
        // id match: nothing found (program day id ≠ planned workout id)
        .mockResolvedValueOnce({ rows: [] })
        // date fallback
        .mockResolvedValueOnce({ rows: [] }),
    }
    await markPlannedWorkoutCompleted(client, {
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      completedAt: '2026-07-10T18:00:00.000Z',
    })
    expect(client.query).toHaveBeenCalledTimes(2)
    const [dateSql, dateParams] = client.query.mock.calls[1]
    expect(dateSql).toContain('scheduled_date = $2::date')
    expect(dateParams).toEqual(['vyacheslav', '2026-07-10'])
  })

  it('uses the date fallback for off-plan workouts without workoutDayId', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await markPlannedWorkoutCompleted(client, {
      userId: 'oleg',
      workoutDayId: '',
      completedAt: '2026-07-09T10:00:00.000Z',
    })
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(client.query.mock.calls[0][1]).toEqual(['oleg', '2026-07-09'])
  })
})

describe('генерация зависит от фактического разрыва (Фаза 2Б.5)', () => {
  const profile = {
    userId: 'vyacheslav',
    goal: 'сила и мышечная масса',
    level: 'intermediate',
    workoutsPerWeek: 2,
    targetWorkoutMinutes: 60,
  }

  const exerciseLibrary = [
    { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150, instruction: 'жим' },
    { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 90, instruction: 'тяга' },
    { id: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'Ноги', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 60, weightStep: 2.5, restSeconds: 150, instruction: 'присед' },
    { id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150, instruction: 'тяга' },
    { id: 'db-shoulder-press', name: 'Жим гантелей сидя', muscleGroup: 'Плечи', setsCount: 2, repMin: 8, repMax: 10, targetWeight: 12, weightStep: 2, restSeconds: 90, instruction: 'плечи' },
    { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 10, weightStep: 1, restSeconds: 75, instruction: 'руки' },
    { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60, instruction: 'кор' },
  ]

  const coachState = {
    recoveryStatus: 'ready',
    readinessScore: 75,
    weeklyLoadStatus: 'on_plan',
    muscleGroups: {
      chest: { fatigue: 'low' }, back: { fatigue: 'low' }, legs: { fatigue: 'low' },
      shoulders: { fatigue: 'low' }, arms: { fatigue: 'low' }, core: { fatigue: 'low' },
    },
    exercises: {},
  }

  // Вчерашняя тяжёлая тренировка ног
  const legsWorkout = {
    id: 'session-legs',
    userId: 'vyacheslav',
    workoutDayId: 'day-legs',
    completedAt: '2026-07-08T18:00:00.000Z',
    totalVolume: 3000,
    exercises: [
      {
        exerciseId: 'barbell-squat',
        exerciseName: 'Присед со штангой',
        sets: [
          { weight: 60, reps: 8, rpe: 8, completed: true },
          { weight: 60, reps: 8, rpe: 8, completed: true },
          { weight: 60, reps: 8, rpe: 9, completed: true },
        ],
      },
    ],
  }

  it('свежая нагрузка (2 дня) исключает упражнение, разрыв в 1 день делает тренировку восстановительной', async () => {
    const planAfter2Days = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState,
      exerciseLibrary,
      history: [legsWorkout],
    })
    // 2 дня: приседания в пределах 3-дневного окна свежей нагрузки —
    // то же упражнение не повторяем
    expect(planAfter2Days.exercises.map((exercise) => exercise.exerciseId)).not.toContain('barbell-squat')
    expect(planAfter2Days.workoutDayName).toContain('персональная')

    // 1 день после тренировки: calendarRecoveryLimited → облегчённая
    // восстановительная тренировка, а не обычная
    const planAfter1Day = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-09',
      coachState,
      exerciseLibrary,
      history: [legsWorkout],
    })
    expect(planAfter1Day.workoutDayName).toContain('восстановительная')

    // 5 дней: обычная полная тренировка
    const planAfter5Days = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-13',
      coachState,
      exerciseLibrary,
      history: [legsWorkout],
    })
    expect(planAfter5Days.workoutDayName).toContain('персональная')
    expect(planAfter5Days.workoutDayName).not.toContain('восстановительная')
  })
})
