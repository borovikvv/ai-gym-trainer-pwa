import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePlan } from '../../shared/types'
import { createWorkoutHistoryEntry } from '../domain/workoutHistory'

const saveWorkoutDraftToApi = vi.fn<(draft: unknown) => Promise<void>>()
const clearWorkoutDraftFromApi = vi.fn<(draftId: string) => Promise<void>>()

// В тестовом режиме реальный workoutApi не сконфигурирован (apiBaseUrl undefined),
// поэтому сетевые ветки черновика иначе не исполняются вовсе.
vi.mock('../data/workoutApi', () => ({
  isWorkoutApiConfigured: true,
  saveWorkoutDraftToApi: (draft: unknown) => saveWorkoutDraftToApi(draft),
  clearWorkoutDraftFromApi: (draftId: string) => clearWorkoutDraftFromApi(draftId),
}))

const { loadActiveWorkoutDraft, saveActiveWorkoutDraft, useDraftAutosave } = await import('./useDraftAutosave')

const ACTIVE_DRAFT_KEY = 'ai-gym-trainer:v0.1:active-draft'

function makeExercise(id: string, name: string): ExercisePlan {
  return {
    id,
    name,
    muscleGroup: 'Грудь',
    prescription: '3×8',
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    targetWeight: 40,
    weightStep: 2.5,
    restSeconds: 90,
    previous: '',
    todayGoal: '8–10',
    coachFocus: '',
    alternatives: [],
    instruction: '',
    commonMistakes: [],
  }
}

const planned = makeExercise('bench-press', 'Жим лёжа')
const extra = makeExercise('cable-fly-extra-1786000000000', 'Сведе́ния в кроссовере')

function completedLog(exerciseId: string, weight: number, reps: number) {
  return {
    exerciseId,
    pain: false,
    sets: [{ weight, weightInput: String(weight), reps, repsInput: String(reps), rpe: 8, completed: true }],
  }
}

function renderAutosave(sessionExercises: ExercisePlan[]) {
  return renderHook(() => useDraftAutosave({
    initialDraft: null,
    activeUserId: 'oleg',
    workoutDayId: 'day-1',
    activeExerciseIndex: 1,
    sessionExercises,
    formatDateTime: () => '10.08 20:00',
  }))
}

const flushMicrotasks = () => new Promise((resolve) => { setTimeout(resolve, 0) })

beforeEach(() => {
  window.localStorage.clear()
  saveWorkoutDraftToApi.mockReset().mockResolvedValue(undefined)
  clearWorkoutDraftFromApi.mockReset().mockResolvedValue(undefined)
})

// Issue #242: состав дня жил только в React-состоянии — после перезагрузки
// добавленные/заменённые упражнения исчезали, а подходы на них молча
// терялись при сохранении тренировки.
describe('черновик хранит состав дня (#242)', () => {
  it('persistWorkoutDraft кладёт упражнения сессии в черновик', () => {
    const { result } = renderAutosave([planned, extra])

    act(() => {
      result.current.persistWorkoutDraft({ [extra.id]: completedLog(extra.id, 20, 12) })
    })

    const stored = JSON.parse(window.localStorage.getItem(ACTIVE_DRAFT_KEY) ?? '{}')
    expect(stored.exercises).toHaveLength(2)
    expect(stored.exercises.map((item: ExercisePlan) => item.id)).toEqual([planned.id, extra.id])
  })

  it('persistWorkoutDraft принимает явный состав дня (добавление упражнения)', () => {
    const { result } = renderAutosave([planned])

    act(() => {
      result.current.persistWorkoutDraft({}, 0, [planned, extra])
    })

    const stored = JSON.parse(window.localStorage.getItem(ACTIVE_DRAFT_KEY) ?? '{}')
    expect(stored.exercises.map((item: ExercisePlan) => item.id)).toEqual([planned.id, extra.id])
  })

  it('loadActiveWorkoutDraft возвращает сохранённый состав дня', () => {
    saveActiveWorkoutDraft({
      userId: 'oleg',
      workoutDayId: 'day-1',
      activeExerciseIndex: 1,
      logs: {},
      exercises: [planned, extra],
      savedAt: '2026-08-10T17:00:00.000Z',
    })

    const restored = loadActiveWorkoutDraft()
    expect(restored?.exercises).toHaveLength(2)
    expect(restored?.exercises?.[1]).toMatchObject({ id: extra.id, name: extra.name })
  })

  it('loadActiveWorkoutDraft переживает черновик без упражнений (старый формат)', () => {
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify({
      userId: 'oleg',
      workoutDayId: 'day-1',
      activeExerciseIndex: 0,
      logs: { [planned.id]: completedLog(planned.id, 50, 8) },
      savedAt: '2026-08-04T17:36:00.000Z',
    }))

    const restored = loadActiveWorkoutDraft()
    expect(restored).not.toBeNull()
    expect(restored?.exercises).toBeUndefined()
    expect(restored?.logs[planned.id]).toBeDefined()
  })

  // Сценарий из issue: добавить упражнение → выполнить подход → перезагрузка →
  // сохранение. До фикса лог добавленного упражнения оставался сиротским и
  // createWorkoutHistoryEntry молча его отбрасывал.
  it('подходы на добавленном упражнении переживают перезагрузку и попадают в историю', () => {
    const { result } = renderAutosave([planned, extra])
    const logs = {
      [planned.id]: completedLog(planned.id, 50, 8),
      [extra.id]: completedLog(extra.id, 20, 12),
    }

    act(() => { result.current.persistWorkoutDraft(logs) })

    const restored = loadActiveWorkoutDraft()
    expect(restored?.exercises).toBeDefined()

    const entry = createWorkoutHistoryEntry({
      userId: 'oleg',
      workoutDayId: 'day-1',
      workoutDayName: 'День 1',
      exercises: restored!.exercises!,
      logs: restored!.logs,
    })

    expect(entry.exercises.map((item) => item.exerciseId)).toContain(extra.id)
    const extraEntry = entry.exercises.find((item) => item.exerciseId === extra.id)
    expect(extraEntry?.sets).toHaveLength(1)
    expect(extraEntry?.sets[0]).toMatchObject({ weight: 20, reps: 12 })
  })
})

// Issue #242, п.4: DELETE мог обогнать in-flight POST — поздний POST
// пересоздавал черновик уже сохранённой тренировки в БД.
describe('очистка черновика не гонится с сохранением (#242)', () => {
  it('DELETE уходит только после завершения in-flight POST', async () => {
    const order: string[] = []
    let resolveSave: (() => void) | undefined
    saveWorkoutDraftToApi.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSave = () => { order.push('save'); resolve() }
    }))
    clearWorkoutDraftFromApi.mockImplementation(async () => { order.push('clear') })

    const { result } = renderAutosave([planned])

    await act(async () => { result.current.persistWorkoutDraft({}) })
    expect(saveWorkoutDraftToApi).toHaveBeenCalledTimes(1)

    await act(async () => { result.current.clearActiveWorkoutDraft() })
    // POST ещё висит — DELETE обязан ждать, иначе поздний POST воскресит черновик.
    expect(clearWorkoutDraftFromApi).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave?.()
      await flushMicrotasks()
    })

    expect(order).toEqual(['save', 'clear'])
  })

  it('локальный черновик стирается сразу, не дожидаясь сети', () => {
    saveWorkoutDraftToApi.mockImplementation(() => new Promise<void>(() => {}))
    const { result } = renderAutosave([planned])

    act(() => { result.current.persistWorkoutDraft({}) })
    expect(window.localStorage.getItem(ACTIVE_DRAFT_KEY)).not.toBeNull()

    act(() => { result.current.clearActiveWorkoutDraft() })
    expect(window.localStorage.getItem(ACTIVE_DRAFT_KEY)).toBeNull()
  })

  it('ошибка удаления черновика не проглатывается — статус сообщает о ней', async () => {
    clearWorkoutDraftFromApi.mockRejectedValue(new Error('500'))
    const { result } = renderAutosave([planned])

    await act(async () => {
      result.current.clearActiveWorkoutDraft()
      await Promise.resolve()
    })

    expect(result.current.draftStatus).toMatch(/черновик/i)
  })
})
