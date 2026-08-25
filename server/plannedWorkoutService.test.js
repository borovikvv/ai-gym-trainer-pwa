import { describe, expect, it, vi } from 'vitest'
import { cascadeRegenerateFutureWorkouts, formatPlannedExerciseGoal } from './services/plannedWorkoutService.js'
import { nextPlannedDatesFromProfile } from './utils.js'

describe('planned workout service formatting', () => {
  it('keeps planned exercise goal compact instead of showing internal reason text', () => {
    expect(formatPlannedExerciseGoal({
      name: 'Жим лёжа',
      muscle_group: 'Грудь',
      sets_count: 2,
      rep_min: 8,
      rep_max: 12,
      target_weight: 40,
      reason: 'нагрузка снижена из-за восстановления; Грудь: усталость medium; учтён последний рабочий вес',
    })).toBe('40×8 / 40×8')
  })

  it('formats plank goals as seconds', () => {
    expect(formatPlannedExerciseGoal({
      exercise_id: 'plank',
      name: 'Планка',
      muscle_group: 'Кор',
      sets_count: 3,
      rep_min: 40,
      rep_max: 60,
      target_weight: 0,
    })).toBe('40–60 сек / 40–60 сек / 40–60 сек')
  })
})

// Issue #169: после сохранения тренировки перестраивается только ближайшая
// запланированная. Каскад «все на две недели вперёд» менял между двумя
// тренировками десяток переменных сразу, и отклик было не к чему привязать.
describe('nextPlannedDatesFromProfile — не возвращает сегодня (#204)', () => {
  it('не включает сегодняшнюю дату когда сегодня тренировочный день', () => {
    const today = new Date()
    const weekday = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][today.getDay()]
    const todayIso = today.toISOString().slice(0, 10)
    const profile = {
      trainingDays: [weekday],
      workoutsPerWeek: 3,
    }
    const dates = nextPlannedDatesFromProfile(profile, 3)

    expect(dates).not.toContain(todayIso)
    expect(dates).toHaveLength(3)
  })
})

// Issue #262: после паузы/пересборки, когда на сегодня строки нет вовсе, автоплан
// должен стартовать с сегодняшнего дня, а не пропускать его (dayOffset=1 из #204
// относится только к случаю, когда сегодняшняя тренировка уже существует).
describe('nextPlannedDatesFromProfile — включает сегодня при includeToday (#262)', () => {
  it('включает сегодняшнюю дату когда includeToday=true и сегодня тренировочный день', () => {
    const today = new Date()
    const weekday = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][today.getDay()]
    const todayIso = today.toISOString().slice(0, 10)
    const profile = {
      trainingDays: [weekday],
      workoutsPerWeek: 3,
    }
    const dates = nextPlannedDatesFromProfile(profile, 3, { includeToday: true })

    expect(dates).toContain(todayIso)
    expect(dates).toHaveLength(3)
  })
})

describe('cascadeRegenerateFutureWorkouts — сужение до ближайшей (#169)', () => {
  const futureRows = [
    { id: 'planned-1', scheduled_date: new Date('2026-08-03T00:00:00Z'), source: 'coach' },
    { id: 'planned-2', scheduled_date: new Date('2026-08-05T00:00:00Z'), source: 'coach' },
    { id: 'planned-3', scheduled_date: new Date('2026-08-07T00:00:00Z'), source: 'coach' },
  ]

  // Клиент отвечает пустыми выборками на всё, кроме списка будущих
  // тренировок: перегенерация проходит целиком, а по DELETE предписаний
  // видно, какие именно тренировки пересобирались.
  const fakeClient = (rows) => {
    const regeneratedIds = []
    const client = {
      regeneratedIds,
      query: vi.fn().mockImplementation(async (text, params) => {
        if (text.includes('select id, scheduled_date, source from public.planned_workouts')) return { rows, rowCount: rows.length }
        if (text.includes('delete from public.planned_workout_exercises')) regeneratedIds.push(params[0])
        return { rows: [], rowCount: 0 }
      }),
    }
    return client
  }

  it('с limit=1 пересобирает только ближайшую по дате', async () => {
    const client = fakeClient(futureRows)
    const regenerated = await cascadeRegenerateFutureWorkouts(client, { userId: 'vyacheslav', limit: 1 })

    expect(regenerated).toBe(1)
    expect(client.regeneratedIds).toEqual(['planned-1'])
  })

  it('без limit пересобирает весь горизонт (перенос даты, пропуск)', async () => {
    const client = fakeClient(futureRows)
    const regenerated = await cascadeRegenerateFutureWorkouts(client, { userId: 'vyacheslav' })

    expect(regenerated).toBe(3)
    expect(client.regeneratedIds).toEqual(['planned-1', 'planned-2', 'planned-3'])
  })

  // Issue #219: source='user' — это «сгенерирована по действию пользователя»
  // (тап по дню, недельный план), а не ручной состав: ручного составления в
  // приложении нет. Пока каскад её пропускал, день, добавленный тапом, не
  // пересобирался после переноса соседней тренировки и оставался с прежним
  // составом — из-за этого пятница и воскресенье совпадали по упражнениям.
  it('пересобирает и созданную по тапу (source=user)', async () => {
    const client = fakeClient([{ ...futureRows[0], source: 'user' }, futureRows[1], futureRows[2]])
    const regenerated = await cascadeRegenerateFutureWorkouts(client, { userId: 'vyacheslav', limit: 1 })

    expect(regenerated).toBe(1)
    expect(client.regeneratedIds).toEqual(['planned-1'])
  })
})
