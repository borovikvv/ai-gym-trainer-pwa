import { afterEach, describe, expect, it, vi } from 'vitest'

// Issue #443: change_focus двигает недельную цель подходов группы
// (weekly_volume_targets.target_sets). Хранилище целей и правку упражнения
// отдаём мокам — проверяем гейт, журнал и отмену.
vi.mock('./services/programService.js', () => ({
  updateProgramExercise: vi.fn(),
}))
vi.mock('./weeklyVolumeTargets.js', () => ({
  loadWeeklyVolumeTargets: vi.fn(),
  updateWeeklyVolumeTargetSets: vi.fn(),
}))

const { applyChangeFocusChange, revertProgramChangeAction } = await import('./coachProgramActions.js')
const { updateProgramExercise } = await import('./services/programService.js')
const { loadWeeklyVolumeTargets, updateWeeklyVolumeTargetSets } = await import('./weeklyVolumeTargets.js')

const NOW = new Date('2026-10-13T12:00:00Z')
const WEEK = '2026-10-12'

function changeFocus(muscleGroup, newSetsCount) {
  return {
    type: 'change_focus',
    description: '',
    rationale: 'недельный обзор',
    muscleGroup,
    newSetsCount,
    priority: 'medium',
  }
}

// loadWeeklyVolumeTargets замокан: движку нужны только id и targetSets.
function chestTarget() {
  return { id: 'wvt-1', muscleKey: 'chest', targetSets: 10 }
}

// Эхо-клиент: строку журнала строит из bind-параметров вставки.
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
          created_at: '2026-10-13T00:00:00.000Z',
        }],
        rowCount: 1,
      }
    }),
  }
}

function input(change) {
  return { userId: 'oleg', change, ageRecoveryPhase: 'adult', weekStart: WEEK, now: NOW }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('applyChangeFocusChange (#443)', () => {
  it('в пределах рамок меняет цель и пишет в журнал', async () => {
    loadWeeklyVolumeTargets.mockResolvedValue({ chest: chestTarget() })
    const client = insertClient()

    const result = await applyChangeFocusChange(client, input(changeFocus('грудь', 12)))

    expect(result.status).toBe('applied')
    expect(result.before).toEqual({ setsCount: 10 })
    expect(result.after).toEqual({ setsCount: 12 })
    expect(updateWeeklyVolumeTargetSets).toHaveBeenCalledWith(client, { id: 'wvt-1', targetSets: 12 })
    const insert = client.query.mock.calls.find(([text]) => text.includes('insert into public.program_change_actions'))
    expect(insert[1][2]).toBe('change_focus')
    expect(insert[1][1]).toBe('wvt-1')
  })

  it('клэмп сверху: цель выше MRV режется до границы', async () => {
    loadWeeklyVolumeTargets.mockResolvedValue({ chest: chestTarget() })

    const result = await applyChangeFocusChange(insertClient(), input(changeFocus('грудь', 20)))

    expect(result.status).toBe('clamped')
    expect(result.after).toEqual({ setsCount: 16 })
    expect(updateWeeklyVolumeTargetSets).toHaveBeenCalledWith(expect.anything(), { id: 'wvt-1', targetSets: 16 })
  })

  it('клэмп снизу: цель ниже MEV поднимается до границы', async () => {
    loadWeeklyVolumeTargets.mockResolvedValue({ chest: chestTarget() })

    const result = await applyChangeFocusChange(insertClient(), input(changeFocus('грудь', 2)))

    expect(result.status).toBe('clamped')
    expect(result.after).toEqual({ setsCount: 6 })
  })

  it('unmatched: группа не распознана — БД не трогаем', async () => {
    const client = { query: vi.fn() }

    const result = await applyChangeFocusChange(client, input(changeFocus('неведомая группа', 12)))

    expect(result.status).toBe('unmatched')
    expect(result.id).toBe('')
    expect(loadWeeklyVolumeTargets).not.toHaveBeenCalled()
    expect(client.query).not.toHaveBeenCalled()
  })

  it('unmatched: нет цели по группе на эту неделю — БД не трогаем', async () => {
    loadWeeklyVolumeTargets.mockResolvedValue({})
    const client = { query: vi.fn() }

    const result = await applyChangeFocusChange(client, input(changeFocus('грудь', 12)))

    expect(result.status).toBe('unmatched')
    expect(updateWeeklyVolumeTargetSets).not.toHaveBeenCalled()
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('revertProgramChangeAction: change_focus (#443)', () => {
  function actionRow(status) {
    return {
      id: 'action-1',
      user_id: 'oleg',
      program_exercise_id: 'wvt-1',
      change_type: 'change_focus',
      status,
      before: { setsCount: 10 },
      after: { setsCount: 12 },
      rationale: null,
      safety_note: null,
      applied_at: NOW.toISOString(),
      reverted_at: null,
      created_at: NOW.toISOString(),
    }
  }

  function revertClient(initial) {
    return {
      query: vi.fn(async (text) => {
        if (text.includes('select') && text.includes('program_change_actions')) {
          return { rows: [initial], rowCount: 1 }
        }
        if (text.includes('update public.program_change_actions')) {
          return { rows: [{ ...initial, status: 'reverted', reverted_at: NOW.toISOString() }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    }
  }

  it('возвращает прежнюю цель группы и не трогает упражнение', async () => {
    const client = revertClient(actionRow('applied'))

    const result = await revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateWeeklyVolumeTargetSets).toHaveBeenCalledWith(client, { id: 'wvt-1', targetSets: 10 })
    expect(updateProgramExercise).not.toHaveBeenCalled()
  })

  it('повторная отмена идемпотентна — цель не меняется снова', async () => {
    const client = revertClient(actionRow('reverted'))

    const result = await revertProgramChangeAction(client, { actionId: 'action-1', userId: 'oleg' })

    expect(result.status).toBe('reverted')
    expect(updateWeeklyVolumeTargetSets).not.toHaveBeenCalled()
    expect(updateProgramExercise).not.toHaveBeenCalled()
  })
})
