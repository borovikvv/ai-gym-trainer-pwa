// Issue #219: контекст ротации для генерации дня.
//
// Тренировки на 07 и 09 августа получались идентичными по составу: выборка
// контекста шла через общий `loadPlannedWorkouts` с сортировкой по возрастанию
// даты и `limit 20`, поэтому при истории длиннее 20 строк возвращались самые
// СТАРЫЕ тренировки, а свежие обрезались. Генерация отдельного дня по тапу
// вдобавок вообще шла с пустым контекстом.
//
// Клиент здесь эмулирует те два свойства Postgres, из-за которых баг и
// возникал: порядок строк и обрезку по limit.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildGeneratedPlannedWorkout = vi.fn()

vi.mock('./plannedWorkoutGenerator.js', () => ({
  buildGeneratedPlannedWorkout: (...args) => buildGeneratedPlannedWorkout(...args),
}))
vi.mock('./services/programService.js', () => ({
  loadUserProfile: vi.fn().mockResolvedValue({ userId: 'vyacheslav', workoutsPerWeek: 3 }),
  loadUserWorkoutDays: vi.fn().mockResolvedValue([]),
  loadExerciseLibrary: vi.fn().mockResolvedValue([]),
  loadRecentHistory: vi.fn().mockResolvedValue([]),
}))
vi.mock('./coachState.js', () => ({ computeCoachState: vi.fn().mockReturnValue({}) }))
vi.mock('./coachMemory.js', () => ({ computeCoachMemory: vi.fn().mockReturnValue({}) }))
vi.mock('./coachLongTermMemory.js', () => ({ loadLongTermMemoryBlock: vi.fn().mockResolvedValue('') }))
vi.mock('./weeklyVolumeTargets.js', () => ({
  loadWeeklyVolumeStatus: vi.fn().mockResolvedValue({}),
  formatWeeklyVolumeForPrompt: vi.fn().mockReturnValue(''),
}))

const { createGeneratedPlannedWorkoutForDate, regeneratePlannedWorkout } = await import('./services/plannedWorkoutService.js')

const shiftDate = (dateOnly, days) => {
  const date = new Date(`${dateOnly}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// 24 тренировки: 20 старых (июнь–июль) и 4 свежих. Ровно та история, на которой
// воспроизводится баг — старых строк хватает, чтобы выбрать весь limit.
const OLD_DATES = Array.from({ length: 20 }, (_, index) => shiftDate('2026-06-07', index * 2))
const RECENT_DATES = ['2026-07-30', '2026-08-04', '2026-08-07', '2026-08-09']

const fakePlannedWorkoutsClient = () => {
  const plannedRows = [...OLD_DATES, ...RECENT_DATES].map((scheduledDate) => ({
    id: `pw-${scheduledDate}`,
    user_id: 'vyacheslav',
    scheduled_date: scheduledDate,
    status: 'generated',
    source: 'user',
    workout_day_id: null,
    workout_day_name: 'Силовая',
    goal: '',
    coach_reason: '',
    readiness_snapshot: {},
  }))

  return {
    plannedRows,
    query: vi.fn().mockImplementation(async (text, params = []) => {
      if (/^(savepoint|release savepoint|rollback to savepoint)/.test(text.trim())) return { rows: [], rowCount: 0 }

      if (text.includes('from public.planned_workouts') && text.includes('limit')) {
        const [, , from, to, limit] = params
        const rows = plannedRows
          .filter((row) => (from == null || row.scheduled_date >= from) && (to == null || row.scheduled_date <= to))
          .sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date))
          // Postgres обрезает по limit УЖЕ отсортированную выборку — именно
          // поэтому при сортировке по возрастанию отбрасываются свежие строки.
          .slice(0, Number(limit ?? 20))
        return { rows, rowCount: rows.length }
      }

      if (text.includes('from public.planned_workout_exercises pwe')) {
        const rows = (params[0] ?? []).map((plannedWorkoutId) => ({
          planned_workout_id: plannedWorkoutId,
          planned_exercise_id: `${plannedWorkoutId}-1`,
          id: 'lat-pulldown',
          name: 'Тяга верхнего блока',
          muscle_group: 'Спина',
          instruction: '',
          common_mistakes: null,
          alternatives: null,
          weight_direction: 'load',
          sort_order: 1,
          sets_count: 3,
          rep_min: 8,
          rep_max: 10,
          target_weight: 40,
          weight_step: 2.5,
          rest_seconds: 90,
          coach_focus: '',
          reason: '',
        }))
        return { rows, rowCount: rows.length }
      }

      if (text.includes('insert into public.planned_workouts')) {
        plannedRows.push({
          id: params[0],
          user_id: params[1],
          scheduled_date: params[2],
          status: 'generated',
          source: params[3],
          workout_day_id: params[4],
          workout_day_name: params[5],
          goal: params[6],
          coach_reason: params[7],
          readiness_snapshot: params[8],
        })
        return { rows: [], rowCount: 1 }
      }

      return { rows: [], rowCount: 0 }
    }),
  }
}

const contextDates = () => {
  const [args] = buildGeneratedPlannedWorkout.mock.calls.at(-1)
  return (args.previousGeneratedWorkouts ?? []).map((workout) => workout.scheduledDate)
}

describe('issue #219: контекст ротации не обрезается длинной историей', () => {
  beforeEach(() => {
    buildGeneratedPlannedWorkout.mockReset()
    buildGeneratedPlannedWorkout.mockImplementation(async ({ scheduledDate }) => ({
      scheduledDate,
      workoutDayId: null,
      workoutDayName: 'Силовая',
      goal: '',
      coachReason: '',
      readinessSnapshot: {},
      exercises: [],
    }))
  })

  it('перегенерация видит соседние тренировки, а не двадцать самых старых', async () => {
    const client = fakePlannedWorkoutsClient()

    await regeneratePlannedWorkout(client, {
      plannedWorkoutId: 'pw-2026-08-09',
      userId: 'vyacheslav',
      scheduledDate: '2026-08-09',
    })

    expect(contextDates()).toEqual(['2026-08-04', '2026-08-07'])
  })

  it('контекст доезжает вместе с составом, а не одними датами', async () => {
    const client = fakePlannedWorkoutsClient()

    await regeneratePlannedWorkout(client, {
      plannedWorkoutId: 'pw-2026-08-09',
      userId: 'vyacheslav',
      scheduledDate: '2026-08-09',
    })

    const [args] = buildGeneratedPlannedWorkout.mock.calls.at(-1)
    expect(args.previousGeneratedWorkouts.every((workout) => workout.exercises.length > 0)).toBe(true)
  })

  it('генерация дня по тапу тоже получает контекст соседних тренировок', async () => {
    const client = fakePlannedWorkoutsClient()

    const created = await createGeneratedPlannedWorkoutForDate(client, {
      userId: 'vyacheslav',
      scheduledDate: '2026-08-11',
      source: 'user',
    })

    expect(contextDates()).toEqual(['2026-08-04', '2026-08-07', '2026-08-09'])
    // Созданная тренировка возвращается наружу: раньше её искали в общем
    // списке, обрезанном по limit, и при длинной истории она в него не попадала.
    expect(created?.scheduledDate).toBe('2026-08-11')
  })

  it('недельный план: уже сгенерированные в этом же прогоне дни идут впереди истории', async () => {
    const client = fakePlannedWorkoutsClient()

    await createGeneratedPlannedWorkoutForDate(client, {
      userId: 'vyacheslav',
      scheduledDate: '2026-08-11',
      source: 'user',
      previousGeneratedWorkouts: [{ scheduledDate: '2026-08-10', exercises: [{ exerciseName: 'Присед', muscleGroup: 'Ноги' }] }],
    })

    expect(contextDates()[0]).toBe('2026-08-10')
    expect(contextDates()).toContain('2026-08-09')
  })
})
