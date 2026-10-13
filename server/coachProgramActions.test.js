import { afterEach, describe, expect, it, vi } from 'vitest'

// Двигатель применения плана ходит в БД только за вставкой/чтением
// program_change_actions; мутацию упражнения отдаём моку.
vi.mock('./services/programService.js', () => ({
  updateProgramExercise: vi.fn(),
}))

const { applyAdjustVolumeChange, revertProgramChangeAction } = await import('./coachProgramActions.js')
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

// Эхо-клиент: строку строит из bind-параметров вставки.
function insertClient() {
  return {
    query: vi.fn(async (_text, params) => ({
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
    })),
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
})
