import { afterEach, describe, expect, it, vi } from 'vitest'

// Двигатель применения плана ходит в БД только за вставкой/чтением
// program_change_actions; мутацию упражнения отдаём моку.
vi.mock('./services/programService.js', () => ({
  updateProgramExercise: vi.fn(),
  loadUserProfile: vi.fn(async () => ({ workoutsPerWeek: 3 })),
}))
// Issue #445: move_workout пересобирает тренировку — генерацию мокаем.
// Issue #444: применение add_deload пересобирает тренировки недели каскадом.
vi.mock('./services/plannedWorkoutService.js', () => ({
  regeneratePlannedWorkout: vi.fn(),
  cascadeRegenerateFutureWorkouts: vi.fn(async () => 0),
}))
vi.mock('./services/athleteAvailability.js', () => ({
  markDateUnavailable: vi.fn(),
  loadUnavailableDates: vi.fn(async () => []),
}))

const { applyAdjustVolumeChange, applyAdjustVolumeChanges, applyAddDeloadChange, applyAddDeloadChanges, applyMoveWorkoutChange, refreshAppliedActionStatuses, revertProgramChangeAction } = await import('./coachProgramActions.js')
const { updateProgramExercise } = await import('./services/programService.js')
const { regeneratePlannedWorkout, cascadeRegenerateFutureWorkouts } = await import('./services/plannedWorkoutService.js')
const { loadUnavailableDates } = await import('./services/athleteAvailability.js')
const { dateToDateOnly, endOfWeek, startOfWeek } = await import('./utils.js')

const NOW = new Date('2026-07-09T12:00:00Z')
const RECENT = '2026-07-08T18:00:00Z'

function historyWithSets(muscleGroup, exerciseName, totalSets) {
  const sets = Array.from({ length: totalSets }, () => ({ weight: 50, reps: 8, completed: true }))
  return [{
    id: 's1',
    userId: 'oleg',
    workoutDayId: 'd1',
    workoutDayName: 'День A',
    completedAt: RECENT,
    totalVolume: 0,
    exercises: [{ exerciseId: 'bench-press', exerciseName, muscleGroup, pain: false, sets }],
  }]
}

function programDaysWith(name, setsCount, muscleGroup = 'Грудь') {
  return [{ name: 'День A', exercises: [{ name, programExerciseId: 'pe-1', muscleGroup, setsCount }] }]
}

function adjustChange(newSetsCount, exerciseName = 'Жим лёжа') {
  return {
    type: 'adjust_volume',
    description: '',
    rationale: 'недельный обзор',
    exerciseName,
    newSetsCount,
    priority: 'medium',
  }
}

// Эхо-клиент: строку строит из bind-параметров вставки. Управляющие команды
// транзакции (begin/commit/rollback) отдаём как есть.
function insertClient() {
  return {
    query: vi.fn(async (text, params) => {
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return { rows: [], rowCount: null }
      }
      return {
        rows: [{
          id: 'action-1',
          user_id: params[0],
          program_exercise_id: params[1],
          change_type: params[2],
          status: params[3],
          before: params[4],
          after: params[5],
          rationale: params[6],
          safety_note: params[7],
          applied_at: params[8],
          reverted_at: null,
          created_at: '2026-07-09T00:00:00.000Z',
        }],
        rowCount: 1,
      }
    }),
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('applyAdjustVolumeChange (#420)', () => {
  it('в пределах диапазона применяет без подрезки (applied)', async () => {
    const client = insertClient()
    const result = await applyAdjustVolumeChange(client, {
      userId: 'oleg',
      change: adjustChange(5),
      programDays: programDaysWith('Жим лёжа', 3),
      history: historyWithSets('Грудь', 'Жим лёжа', 10),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(result.status).toBe('applied')
    expect(result.before).toEqual({ setsCount: 3 })
    expect(result.after).toEqual({ setsCount: 5 })
    expect(updateProgramExercise).toHaveBeenCalledWith(client, { id: 'pe-1', setsCount: 5 })
  })

  it('клэмп по фазе: adult режет до MRV=16, teen — до MRV=13 (ниже исходного)', async () => {
    const history = historyWithSets('Грудь', 'Жим лёжа', 14)

    const adult = await applyAdjustVolumeChange(insertClient(), {
      userId: 'oleg',
      change: adjustChange(6),
      programDays: programDaysWith('Жим лёжа', 3),
      history,
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })
    expect(adult.status).toBe('clamped')
    expect(adult.after).toEqual({ setsCount: 5 })
    expect(updateProgramExercise).toHaveBeenLastCalledWith(expect.anything(), { id: 'pe-1', setsCount: 5 })

    const teen = await applyAdjustVolumeChange(insertClient(), {
      userId: 'oleg',
      change: adjustChange(6),
      programDays: programDaysWith('Жим лёжа', 3),
      history,
      e1rmHistories: [],
      ageRecoveryPhase: 'teen',
      now: NOW,
    })
    // 16 × 0.80 = 12.8 → 13. Проекция требует 6, но граница — 2 подхода,
    // меньше исходных 3: движок обязан урезать объём, а не только рост.
    expect(teen.status).toBe('clamped')
    expect(teen.after).toEqual({ setsCount: 2 })
    expect(updateProgramExercise).toHaveBeenLastCalledWith(expect.anything(), { id: 'pe-1', setsCount: 2 })
  })

  it('unmatched: упражнения нет в программе — БД не трогаем', async () => {
    const client = { query: vi.fn() }
    const result = await applyAdjustVolumeChange(client, {
      userId: 'oleg',
      change: adjustChange(4, 'Неизвестное упражнение'),
      programDays: programDaysWith('Жим лёжа', 3),
      history: historyWithSets('Грудь', 'Жим лёжа', 10),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(result.status).toBe('unmatched')
    expect(updateProgramExercise).not.toHaveBeenCalled()
    expect(client.query).not.toHaveBeenCalled()
  })

  // Issue #420: раньше updateProgramExercise получал только { id, setsCount } и
  // при полной перезаписи колонок обнулял not null rep_min/rep_max — на реальной
  // БД это роняло весь apply (и весь недельный обзор). Здесь мок подменяем на
  // настоящую функцию и проверяем, что её UPDATE частичный (coalesce).
  it('с настоящим updateProgramExercise частичное обновление не затирает NOT NULL', async () => {
    const actual = await vi.importActual('./services/programService.js')
    updateProgramExercise.mockImplementationOnce(actual.updateProgramExercise)

    const query = vi.fn(async (text) => {
      if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [], rowCount: null }
      if (text.includes('insert into public.program_change_actions')) {
        return {
          rows: [{
            id: 'action-1', user_id: 'oleg', program_exercise_id: 'pe-1',
            change_type: 'adjust_volume', status: 'applied',
            before: JSON.stringify({ setsCount: 3 }), after: JSON.stringify({ setsCount: 5 }),
            rationale: null, safety_note: null,
            applied_at: NOW.toISOString(), reverted_at: null, created_at: NOW.toISOString(),
          }],
          rowCount: 1,
        }
      }
      if (text.includes('where pe.id = $1')) return { rows: [{ user_id: 'oleg' }], rowCount: 1 }
      if (text.includes('update public.program_exercises')) return { rows: [{ id: 'pe-1' }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    const result = await applyAdjustVolumeChange({ query }, {
      userId: 'oleg',
      change: adjustChange(5),
      programDays: programDaysWith('Жим лёжа', 3),
      history: historyWithSets('Грудь', 'Жим лёжа', 10),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(result.status).toBe('applied')
    const updateCall = query.mock.calls.find(([text]) => text.includes('update public.program_exercises'))
    expect(updateCall).toBeDefined()
    expect(updateCall[0]).toMatch(/rep_min\s*=\s*coalesce\(/i)
    expect(updateCall[1][1]).toBe(5)
  })

  it('вставка в журнал упала — упражнение не мутируется, транзакция откатывается', async () => {
    const client = {
      query: vi.fn(async (text) => {
        if (text === 'begin' || text === 'rollback') return { rows: [], rowCount: null }
        if (text.includes('insert into public.program_change_actions')) {
          throw new Error('relation "program_change_actions" does not exist')
        }
        return { rows: [], rowCount: 0 }
      }),
    }

    await expect(applyAdjustVolumeChange(client, {
      userId: 'oleg',
      change: adjustChange(5),
      programDays: programDaysWith('Жим лёжа', 3),
      history: historyWithSets('Грудь', 'Жим лёжа', 10),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })).rejects.toThrow('does not exist')

    expect(updateProgramExercise).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith('rollback')
    expect(client.query).not.toHaveBeenCalledWith('commit')
  })
})

describe('гейт объёма: границы (#420)', () => {
  function apply(change, programDays, totalSets) {
    return applyAdjustVolumeChange(insertClient(), {
      userId: 'oleg',
      change,
      programDays,
      history: historyWithSets('Грудь', 'Жим лёжа', totalSets),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })
  }

  // Группа уже выше MRV (факт 20 при MRV 16): граница требует −1 подход.
  // В схеме sets_count > 0 — ноль уронил бы транзакцию и весь обзор.
  it('не опускает число подходов ниже одного', async () => {
    const result = await apply(adjustChange(4), programDaysWith('Жим лёжа', 3), 20)

    expect(result.status).toBe('clamped')
    expect(result.after).toEqual({ setsCount: 1 })
    expect(updateProgramExercise).toHaveBeenLastCalledWith(expect.anything(), { id: 'pe-1', setsCount: 1 })
  })

  // Неделя с пропуском: факт 1 подход при MEV 6. Нижняя граница не должна
  // вытягивать упражнение до 8 подходов, когда LLM предложил 4.
  it('MEV не наращивает объём выше предложенного', async () => {
    const result = await apply(adjustChange(4), programDaysWith('Жим лёжа', 3), 1)

    expect(result.status).toBe('applied')
    expect(result.after).toEqual({ setsCount: 4 })
  })

  it('ниже MEV не урезает: предложенное снижение остаётся на прежнем числе', async () => {
    const result = await apply(adjustChange(2), programDaysWith('Жим лёжа', 3), 1)

    expect(result.status).toBe('clamped')
    expect(result.after).toEqual({ setsCount: 3 })
  })
})

describe('applyAdjustVolumeChanges (#420)', () => {
  function twoChestExercises() {
    return [{
      name: 'День A',
      exercises: [
        { name: 'Жим лёжа', programExerciseId: 'pe-1', muscleGroup: 'Грудь', setsCount: 3 },
        { name: 'Разводка гантелей', programExerciseId: 'pe-2', muscleGroup: 'Грудь', setsCount: 3 },
      ],
    }]
  }

  // Факт 12 при MRV 16. Каждое изменение по отдельности даёт проекцию 15, но
  // вместе +6 подходов к 12 — это 18 > MRV: второе обязано быть подрезано.
  it('изменения одной группы в одном проходе учитывают друг друга', async () => {
    const changes = [adjustChange(6, 'Жим лёжа'), adjustChange(6, 'Разводка гантелей')]

    await applyAdjustVolumeChanges(insertClient(), {
      userId: 'oleg',
      changes,
      programDays: twoChestExercises(),
      history: historyWithSets('Грудь', 'Жим лёжа', 12),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(changes[0].appliedAction).toMatchObject({ status: 'applied', after: { setsCount: 6 } })
    expect(changes[1].appliedAction).toMatchObject({ status: 'clamped', after: { setsCount: 4 } })
  })

  it('сбой одного изменения не роняет остальные и сам проход', async () => {
    const client = insertClient()
    const echo = client.query.getMockImplementation()
    let inserts = 0
    client.query.mockImplementation(async (text, params) => {
      if (text.includes('insert into public.program_change_actions') && inserts++ === 0) {
        throw new Error('connection reset')
      }
      return echo(text, params)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const changes = [adjustChange(4, 'Жим лёжа'), adjustChange(4, 'Разводка гантелей')]

    await applyAdjustVolumeChanges(client, {
      userId: 'oleg',
      changes,
      programDays: twoChestExercises(),
      history: historyWithSets('Грудь', 'Жим лёжа', 10),
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(changes[0].appliedAction).toBeUndefined()
    expect(changes[1].appliedAction).toMatchObject({ status: 'applied', after: { setsCount: 4 } })
  })

  it('не трогает изменения других типов', async () => {
    const client = { query: vi.fn() }
    const changes = [{ type: 'swap_exercise', description: '', rationale: '', exerciseName: 'Жим лёжа', priority: 'low' }]

    await applyAdjustVolumeChanges(client, {
      userId: 'oleg',
      changes,
      programDays: twoChestExercises(),
      history: [],
      e1rmHistories: [],
      ageRecoveryPhase: 'adult',
      now: NOW,
    })

    expect(changes[0].appliedAction).toBeUndefined()
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('revertProgramChangeAction (#420)', () => {
  function actionRow(status = 'applied') {
    return {
      id: 'action-1',
      user_id: 'oleg',
      program_exercise_id: 'pe-1',
      change_type: 'adjust_volume',
      status,
      before: { setsCount: 3 },
      after: { setsCount: 5 },
      rationale: 'недельный обзор',
      safety_note: 'в пределах нормы',
      applied_at: '2026-07-09T00:00:00.000Z',
      reverted_at: null,
      created_at: '2026-07-09T00:00:00.000Z',
    }
  }

  function revertClient(initial) {
    return {
      query: vi.fn(async (text) => {
        if (text.includes('select') && text.includes('program_change_actions')) {
          return { rows: [initial], rowCount: 1 }
        }
        if (text.includes('update public.program_change_actions')) {
          return { rows: [{ ...initial, status: 'reverted', reverted_at: '2026-07-09T13:00:00.000Z' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    }
  }

  it('возвращает прежнее число подходов и помечает reverted', async () => {
    const client = revertClient(actionRow('applied'))
    const result = await revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(result.before).toEqual({ setsCount: 3 })
    expect(updateProgramExercise).toHaveBeenCalledWith(client, { id: 'pe-1', setsCount: 3 })
  })

  it('повторная отмена идемпотентна — мутация не повторяется', async () => {
    const client = revertClient(actionRow('reverted'))
    const result = await revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateProgramExercise).not.toHaveBeenCalled()
  })

  it('чужим userId отвечает 403, мутация не вызывается', async () => {
    const client = revertClient(actionRow('applied'))
    await expect(
      revertProgramChangeAction(client, { actionId: 'action-1', userId: 'vyacheslav' }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(updateProgramExercise).not.toHaveBeenCalled()
  })

  it('несуществующее действие → null', async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }
    const result = await revertProgramChangeAction(client, { actionId: 'missing', userId: 'oleg' })
    expect(result).toBeNull()
  })

  it('восстановление подходов упало — статус откатывается, повтор сработает', async () => {
    const client = revertClient(actionRow('applied'))
    updateProgramExercise.mockRejectedValueOnce(new Error('update failed'))

    await expect(
      revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' }),
    ).rejects.toThrow('update failed')

    expect(client.query).toHaveBeenCalledWith('rollback')
    expect(client.query).not.toHaveBeenCalledWith('commit')
  })
})

describe('refreshAppliedActionStatuses (#420)', () => {
  // Кэш недельного обзора хранит статус на момент применения; после отмены
  // кэш должен показать reverted, а не снова «применено».
  it('подтягивает статус и время отмены из журнала', async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [{ id: 'action-1', status: 'reverted', reverted_at: '2026-07-10T08:00:00.000Z' }],
        rowCount: 1,
      })),
    }
    const changes = [
      { ...adjustChange(5), appliedAction: { id: 'action-1', status: 'applied', revertedAt: null } },
      { ...adjustChange(4, 'Разводка гантелей') },
    ]

    await refreshAppliedActionStatuses(client, 'oleg', changes)

    expect(changes[0].appliedAction).toMatchObject({ status: 'reverted', revertedAt: '2026-07-10T08:00:00.000Z' })
    expect(changes[1].appliedAction).toBeUndefined()
    expect(client.query.mock.calls[0][1]).toEqual(['oleg', ['action-1']])
  })

  it('без применённых действий в БД не ходит', async () => {
    const client = { query: vi.fn() }
    await refreshAppliedActionStatuses(client, 'oleg', [adjustChange(5)])
    expect(client.query).not.toHaveBeenCalled()
  })
})

// Issue #445: перенос тренировки под отметку «день недоступен».
describe('applyMoveWorkoutChange (#445)', () => {
  function actionRow(params) {
    return {
      id: 'action-move-1',
      user_id: params[0],
      program_exercise_id: params[1],
      change_type: params[2],
      status: params[3],
      before: params[4],
      after: params[5],
      rationale: params[6],
      safety_note: params[7],
      applied_at: params[8],
      reverted_at: null,
      created_at: NOW.toISOString(),
    }
  }

  function moveClient({ status = 'generated', scheduledDate = '2026-07-09', userId = 'oleg', siblings = [] } = {}) {
    return {
      query: vi.fn(async (text, params) => {
        if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [], rowCount: null }
        if (text.includes('from public.planned_workouts where id = $1')) {
          return {
            rows: [{
              id: params[0],
              user_id: userId,
              scheduled_date: new Date(`${scheduledDate}T00:00:00.000Z`),
              status,
              workout_day_name: 'День A',
            }],
            rowCount: 1,
          }
        }
        if (text.includes('select scheduled_date from public.planned_workouts')) {
          return { rows: siblings.map((date) => ({ scheduled_date: new Date(`${date}T00:00:00.000Z`) })), rowCount: siblings.length }
        }
        if (text.includes('insert into public.program_change_actions')) {
          return { rows: [actionRow(params)], rowCount: 1 }
        }
        if (text.includes('update public.planned_workouts set scheduled_date')) {
          return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    }
  }

  it('переносит на свободный день недели, пишет applied и журнал с before/after датами', async () => {
    const client = moveClient({ siblings: ['2026-07-07'] })

    const result = await applyMoveWorkoutChange(client, { userId: 'oleg', plannedWorkoutId: 'planned-w1', now: NOW })

    expect(result.status).toBe('applied')
    expect(result.before).toEqual({ scheduledDate: '2026-07-09' })
    expect(result.after).toEqual({ scheduledDate: '2026-07-10' })
    const plannedUpdate = client.query.mock.calls.find(([text]) => text.includes('update public.planned_workouts set scheduled_date'))
    expect(plannedUpdate[1]).toEqual(['planned-w1', '2026-07-10'])
    expect(regeneratePlannedWorkout).toHaveBeenCalledWith(client, { plannedWorkoutId: 'planned-w1', userId: 'oleg', scheduledDate: '2026-07-10' })
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledWith(client, { userId: 'oleg' })
  })

  it('нарушение восстановления: свободен только день через день — unmatched, дата не меняется', async () => {
    loadUnavailableDates.mockResolvedValueOnce(['2026-07-10', '2026-07-11', '2026-07-12'])
    const client = moveClient({ siblings: ['2026-07-07'] })

    const result = await applyMoveWorkoutChange(client, {
      userId: 'oleg',
      plannedWorkoutId: 'planned-w1',
      now: new Date('2026-07-07T12:00:00Z'),
    })

    expect(result.status).toBe('unmatched')
    expect(result.before).toEqual({ scheduledDate: '2026-07-09' })
    expect(result.after).toBeNull()
    expect(client.query.mock.calls.some(([text]) => text.includes('update public.planned_workouts set scheduled_date'))).toBe(false)
    expect(regeneratePlannedWorkout).not.toHaveBeenCalled()
  })

  it('тренировка не в статусе planned/generated — null, журнал не пишется', async () => {
    const client = moveClient({ status: 'completed' })

    const result = await applyMoveWorkoutChange(client, { userId: 'oleg', plannedWorkoutId: 'planned-w1', now: NOW })

    expect(result).toBeNull()
    expect(client.query.mock.calls.some(([text]) => text.includes('insert into public.program_change_actions'))).toBe(false)
  })

  it('отмена move_workout возвращает прежнюю дату и пересобирает тренировку', async () => {
    const client = {
      query: vi.fn(async (text) => {
        if (text === 'begin' || text === 'commit' || text === 'rollback') return { rows: [], rowCount: null }
        if (text.includes('select') && text.includes('program_change_actions')) {
          return {
            rows: [{
              id: 'action-move-1',
              user_id: 'oleg',
              program_exercise_id: 'planned-w1',
              change_type: 'move_workout',
              status: 'applied',
              before: { scheduledDate: '2026-07-09' },
              after: { scheduledDate: '2026-07-10' },
              rationale: null,
              safety_note: null,
              applied_at: NOW.toISOString(),
              reverted_at: null,
              created_at: NOW.toISOString(),
            }],
            rowCount: 1,
          }
        }
        if (text.includes('update public.program_change_actions')) {
          return {
            rows: [{
              id: 'action-move-1',
              user_id: 'oleg',
              program_exercise_id: 'planned-w1',
              change_type: 'move_workout',
              status: 'reverted',
              before: { scheduledDate: '2026-07-09' },
              after: { scheduledDate: '2026-07-10' },
              rationale: null,
              safety_note: null,
              applied_at: NOW.toISOString(),
              reverted_at: NOW.toISOString(),
              created_at: NOW.toISOString(),
            }],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 0 }
      }),
    }

    const result = await revertProgramChangeAction(client, { actionId: 'action-move-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateProgramExercise).not.toHaveBeenCalled()
    const plannedUpdate = client.query.mock.calls.find(([text]) => text.includes('update public.planned_workouts set scheduled_date'))
    expect(plannedUpdate[1]).toEqual(['planned-w1', '2026-07-09'])
    expect(regeneratePlannedWorkout).toHaveBeenCalledWith(client, { plannedWorkoutId: 'planned-w1', userId: 'oleg', scheduledDate: '2026-07-09' })
  })
})

describe('applyAddDeloadChange (#444)', () => {
  const MESO = { isDeload: false, weekInCycle: 3, cycleStartedOn: '2026-07-06' }

  function addDeloadChange() {
    return { type: 'add_deload', description: 'разгрузка', rationale: 'высокая усталость', priority: 'high' }
  }

  function expectedHorizon(now) {
    return Math.max(1, Math.ceil((endOfWeek(now).getTime() - now.getTime()) / 86_400_000))
  }

  it('проходит гейт: applied, weekStart — понедельник недели now, каскад пересборки', async () => {
    const client = insertClient()
    const change = addDeloadChange()

    await applyAddDeloadChanges(client, {
      userId: 'oleg',
      changes: [change],
      mesocycleState: MESO,
      latestAppliedAddDeloadAt: null,
      now: NOW,
    })

    expect(change.appliedAction).toMatchObject({ status: 'applied', after: { weekStart: dateToDateOnly(startOfWeek(NOW)) } })
    const insert = client.query.mock.calls.find(([text]) => text.includes('insert into public.program_change_actions'))
    expect(insert[1][2]).toBe('add_deload')
    expect(insert[1][1]).toBe('')
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledWith(client, {
      userId: 'oleg',
      horizonDays: expectedHorizon(NOW),
    })
  })

  it('гейт «неделя уже разгрузочная»: unmatched, БД и каскад не трогаем', async () => {
    const client = { query: vi.fn() }
    const result = await applyAddDeloadChange(client, {
      userId: 'oleg',
      change: addDeloadChange(),
      mesocycleState: { ...MESO, isDeload: true },
      latestAppliedAddDeloadAt: null,
      now: NOW,
    })

    expect(result.status).toBe('unmatched')
    expect(client.query).not.toHaveBeenCalled()
    expect(cascadeRegenerateFutureWorkouts).not.toHaveBeenCalled()
  })

  it('гейт «первая неделя цикла»: unmatched', async () => {
    const client = { query: vi.fn() }
    const result = await applyAddDeloadChange(client, {
      userId: 'oleg',
      change: addDeloadChange(),
      mesocycleState: { ...MESO, weekInCycle: 1 },
      latestAppliedAddDeloadAt: null,
      now: NOW,
    })

    expect(result.status).toBe('unmatched')
    expect(client.query).not.toHaveBeenCalled()
  })

  it('гейт «уже назначено в этом цикле»: unmatched', async () => {
    const client = { query: vi.fn() }
    const result = await applyAddDeloadChange(client, {
      userId: 'oleg',
      change: addDeloadChange(),
      mesocycleState: MESO,
      latestAppliedAddDeloadAt: new Date('2026-07-08T00:00:00Z'),
      now: NOW,
    })

    expect(result.status).toBe('unmatched')
    expect(client.query).not.toHaveBeenCalled()
  })

  it('два add_deload в одном обзоре: второй unmatched, каскад ровно один раз', async () => {
    const client = insertClient()
    const changes = [addDeloadChange(), addDeloadChange()]

    await applyAddDeloadChanges(client, {
      userId: 'oleg',
      changes,
      mesocycleState: MESO,
      latestAppliedAddDeloadAt: null,
      now: NOW,
    })

    expect(changes[0].appliedAction).toMatchObject({ status: 'applied' })
    expect(changes[1].appliedAction).toMatchObject({ status: 'unmatched' })
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledTimes(1)
  })

  it('revert add_deload: статус reverted, подходы не трогаем, каскад один раз', async () => {
    const row = {
      id: 'action-1',
      user_id: 'oleg',
      program_exercise_id: '',
      change_type: 'add_deload',
      status: 'applied',
      before: null,
      after: { weekStart: '2026-07-06' },
      rationale: 'высокая усталость',
      safety_note: null,
      applied_at: '2026-07-09T00:00:00.000Z',
      reverted_at: null,
      created_at: '2026-07-09T00:00:00.000Z',
    }
    const client = {
      query: vi.fn(async (text) => {
        if (text.includes('select') && text.includes('program_change_actions')) return { rows: [row], rowCount: 1 }
        if (text.includes('update public.program_change_actions')) return { rows: [{ ...row, status: 'reverted', reverted_at: NOW.toISOString() }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    }

    const result = await revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateProgramExercise).not.toHaveBeenCalled()
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledTimes(1)
    expect(cascadeRegenerateFutureWorkouts).toHaveBeenCalledWith(client, expect.objectContaining({ userId: 'oleg' }))
  })
})
