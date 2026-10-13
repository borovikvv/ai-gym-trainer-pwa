import { afterEach, describe, expect, it, vi } from 'vitest'

// Двигатель применения плана ходит в БД только за вставкой/чтением
// program_change_actions; мутацию упражнения отдаём моку.
vi.mock('./services/programService.js', () => ({
  updateProgramExercise: vi.fn(),
}))

const { applyAdjustVolumeChange, applyAdjustVolumeChanges, applySwapExerciseChange, applySwapExerciseChanges, refreshAppliedActionStatuses, revertProgramChangeAction } = await import('./coachProgramActions.js')
const { updateProgramExercise } = await import('./services/programService.js')

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

// Issue #442: замена упражнения применяется из детерминированного белого списка
// генератора. Вес/повторы нового упражнения считает applyPrescription.
describe('applySwapExerciseChange (#442)', () => {
  const library = [
    { id: 'bench-barbell', name: 'Жим штанги лёжа', muscleGroup: 'Грудь', equipment: 'barbell', exerciseType: 'compound', movementPattern: 'push', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 60, weightStep: 2.5, restSeconds: 90 },
    { id: 'bench-dumbbell', name: 'Жим гантелей лёжа', muscleGroup: 'Грудь', equipment: 'dumbbell', exerciseType: 'compound', movementPattern: 'push', setsCount: 3, repMin: 8, repMax: 12, targetWeight: 30, weightStep: 2.5, restSeconds: 90 },
    { id: 'squat', name: 'Присед', muscleGroup: 'Ноги', equipment: 'barbell', exerciseType: 'compound', movementPattern: 'squat', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 80, weightStep: 5, restSeconds: 120 },
  ]

  function swapProgramDays() {
    return [{
      name: 'День A',
      exercises: [{
        name: 'Жим штанги лёжа', programExerciseId: 'pe-1', exerciseId: 'bench-barbell', id: 'bench-barbell',
        muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 60, weightStep: 2.5, restSeconds: 90,
      }],
    }]
  }

  function swapChange(newExerciseName, exerciseName = 'Жим штанги лёжа') {
    return { type: 'swap_exercise', description: '', rationale: 'застой', exerciseName, newExerciseName, priority: 'high' }
  }

  function swapInput(overrides = {}) {
    return {
      userId: 'oleg',
      change: swapChange('Жим гантелей лёжа'),
      programDays: swapProgramDays(),
      exerciseLibrary: library,
      coachState: null,
      coachMemory: null,
      profile: { userId: 'oleg', age: 30, bannedExercises: [] },
      history: [],
      now: NOW,
      ...overrides,
    }
  }

  it('применяет замену из белого списка и пишет снимок before/after', async () => {
    const client = insertClient()
    const result = await applySwapExerciseChange(client, swapInput())

    expect(result.status).toBe('applied')
    expect(result.before.exerciseId).toBe('bench-barbell')
    expect(result.after.exerciseId).toBe('bench-dumbbell')
    expect(updateProgramExercise).toHaveBeenCalledWith(client, expect.objectContaining({
      id: 'pe-1',
      exerciseId: 'bench-dumbbell',
    }))
  })

  it('вне белого списка (другая группа) — unmatched, БД не трогаем', async () => {
    const client = { query: vi.fn() }
    const result = await applySwapExerciseChange(client, swapInput({ change: swapChange('Присед') }))

    expect(result.status).toBe('unmatched')
    expect(updateProgramExercise).not.toHaveBeenCalled()
    expect(client.query).not.toHaveBeenCalled()
  })

  it('кандидат той же группы в бан-листе — unmatched', async () => {
    const client = { query: vi.fn() }
    const result = await applySwapExerciseChange(client, swapInput({
      profile: { userId: 'oleg', age: 30, bannedExercises: ['Жим гантелей лёжа'] },
    }))

    expect(result.status).toBe('unmatched')
    expect(updateProgramExercise).not.toHaveBeenCalled()
  })

  // Issue #171: подростку на осевом свободновесном движении нельзя назначить
  // подход короче пяти повторов. Проверяем, что метаданные и профиль реально
  // дошли до applyPrescription: убирать их — регрессия ровно на #171.
  it('подросток: осевое свободновесное движение получает repMin не ниже 5', async () => {
    const client = insertClient()
    const teenLibrary = [
      library[0],
      { ...library[1], repMin: 3, repMax: 6 },
      library[2],
    ]
    const result = await applySwapExerciseChange(client, swapInput({
      profile: { userId: 'oleg', age: 15, bannedExercises: [] },
      exerciseLibrary: teenLibrary,
    }))

    expect(result.status).toBe('applied')
    expect(result.after.exerciseId).toBe('bench-dumbbell')
    expect(result.after.repMin).toBeGreaterThanOrEqual(5)
    expect(updateProgramExercise.mock.calls.at(-1)[1].repMin).toBeGreaterThanOrEqual(5)
  })

  it('не трогает изменения других типов и сбой одного не роняет проход', async () => {
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
    const changes = [
      { ...swapChange('Жим гантелей лёжа'), appliedAction: undefined },
      { type: 'adjust_volume', description: '', rationale: '', exerciseName: 'Жим штанги лёжа', newSetsCount: 4, priority: 'low' },
      swapChange('Жим гантелей лёжа'),
    ]

    await applySwapExerciseChanges(client, {
      userId: 'oleg',
      changes,
      programDays: swapProgramDays(),
      exerciseLibrary: library,
      coachState: null,
      coachMemory: null,
      profile: { userId: 'oleg', age: 30, bannedExercises: [] },
      history: [],
      now: NOW,
    })

    expect(changes[0].appliedAction).toBeUndefined()
    expect(changes[1].appliedAction).toBeUndefined()
    expect(changes[2].appliedAction).toMatchObject({ status: 'applied' })
  })
})

describe('revertProgramChangeAction — swap_exercise (#442)', () => {
  function swapActionRow() {
    return {
      id: 'action-swap',
      user_id: 'oleg',
      program_exercise_id: 'pe-1',
      change_type: 'swap_exercise',
      status: 'applied',
      before: { exerciseId: 'bench-barbell', exerciseName: 'Жим штанги лёжа', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 60, weightStep: 2.5, restSeconds: 90 },
      after: { exerciseId: 'bench-dumbbell', exerciseName: 'Жим гантелей лёжа', setsCount: 3, repMin: 8, repMax: 12, targetWeight: 30, weightStep: 2.5, restSeconds: 90 },
      rationale: 'застой',
      safety_note: 'замена в белом списке',
      applied_at: '2026-07-09T00:00:00.000Z',
      reverted_at: null,
      created_at: '2026-07-09T00:00:00.000Z',
    }
  }

  function swapRevertClient(initial) {
    return {
      query: vi.fn(async (text) => {
        if (text.includes('update public.program_change_actions')) {
          return { rows: [{ ...initial, status: 'reverted', reverted_at: '2026-07-09T13:00:00.000Z' }], rowCount: 1 }
        }
        if (text.includes('from public.program_change_actions')) {
          return { rows: [initial], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    }
  }

  it('возвращает прежнее упражнение с его предписанием', async () => {
    const client = swapRevertClient(swapActionRow())
    const result = await revertProgramChangeAction(client, { actionId: 'action-swap', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateProgramExercise).toHaveBeenCalledWith(client, expect.objectContaining({
      id: 'pe-1',
      exerciseId: 'bench-barbell',
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 60,
    }))
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
