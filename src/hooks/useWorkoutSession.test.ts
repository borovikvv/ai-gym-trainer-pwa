import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSets, useWorkoutNavigation, useWorkoutSetActions } from './useWorkoutSession'
import type { ExercisePlan, WorkoutDay } from '../../shared/types'
import type { ExerciseLog } from '../domain/workoutHistory'

const bench: ExercisePlan = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  setsCount: 3,
  repMin: 6,
  repMax: 8,
  targetWeight: 50,
  weightStep: 2.5,
  restSeconds: 120,
} as unknown as ExercisePlan

function makeOptions(setLogs: ReturnType<typeof vi.fn>) {
  const activeLog = { exerciseId: bench.id, pain: false, sets: createSets(bench) }
  return {
    activeExercise: bench,
    activeLog,
    activeSetIndex: 0,
    logs: { [bench.id]: activeLog },
    setLogs,
    nextTargets: {},
    setRestRemainingSeconds: vi.fn(),
    setCoachNextSetHint: vi.fn(),
    getLocalNextSetRecommendation: () => null,
    requestServerNextSet: vi.fn().mockResolvedValue(null),
    persistWorkoutDraft: vi.fn(),
    notify: vi.fn(),
  } as unknown as Parameters<typeof useWorkoutSetActions>[0]
}

// Issue #165: момент завершения снимается на клиенте — при пакетном
// сохранении колонка в БД зафиксировала бы время сохранения, а не подхода.
describe('markSetDone — таймстемп подхода (#165)', () => {
  it('записывает performedAt в завершённый подход', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:34:56.000Z'))
    const setLogs = vi.fn()
    const { result } = renderHook(() => useWorkoutSetActions(makeOptions(setLogs)))

    await act(async () => { result.current.markSetDone(0, { rpe: 8 }) })

    const nextLogs = setLogs.mock.calls[0][0]
    expect(nextLogs[bench.id].sets[0]).toMatchObject({
      completed: true,
      rpe: 8,
      performedAt: '2026-07-29T12:34:56.000Z',
    })
    vi.useRealTimers()
  })

  it('не проставляет performedAt незавершённым подходам', async () => {
    const setLogs = vi.fn()
    const { result } = renderHook(() => useWorkoutSetActions(makeOptions(setLogs)))

    await act(async () => { result.current.markSetDone(0) })

    const nextLogs = setLogs.mock.calls[0][0]
    expect(nextLogs[bench.id].sets[1].performedAt).toBeUndefined()
  })
})

// Issue #268: начало подхода — момент окончания отдыха. Отдельный таймстемп
// позволяет посчитать чистый отдых («начало текущего − конец предыдущего»).
// Функция идемпотентна: уже стоящий startedAt не перезаписывается.
describe('markSetStarted — начало подхода (#268)', () => {
  it('записывает startedAt в подход через reducer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:34:56.000Z'))
    const setLogs = vi.fn()
    const { result } = renderHook(() => useWorkoutSetActions(makeOptions(setLogs)))

    await act(async () => { result.current.markSetStarted(0) })

    const reducer = setLogs.mock.calls[0][0] as (current: Record<string, ExerciseLog>) => Record<string, ExerciseLog>
    const nextLogs = reducer(makeOptions(setLogs).logs)
    expect(nextLogs[bench.id].sets[0].startedAt).toBe('2026-07-29T12:34:56.000Z')
    vi.useRealTimers()
  })

  it('не перезаписывает уже стоящий startedAt (идемпотентность)', async () => {
    const setLogs = vi.fn()
    const options = makeOptions(setLogs)
    options.activeLog.sets[0] = { ...options.activeLog.sets[0], startedAt: '2026-07-29T12:00:00.000Z' }
    const { result } = renderHook(() => useWorkoutSetActions(options))

    await act(async () => { result.current.markSetStarted(0) })

    const reducer = setLogs.mock.calls[0][0] as (current: Record<string, ExerciseLog>) => Record<string, ExerciseLog>
    const nextLogs = reducer(options.logs)
    expect(nextLogs[bench.id].sets[0].startedAt).toBe('2026-07-29T12:00:00.000Z')
  })
})

// Issue #242, п.3: первый подход жима лёжа предзаполнялся 10 повторами для
// всех пользователей — хардкод по id упражнения в createSets.
describe('createSets — без предзаполнения повторов (#242)', () => {
  it('не подставляет повторы первому подходу жима лёжа', () => {
    const sets = createSets(bench)
    expect(sets[0].reps).toBe(0)
    expect(sets[0].repsInput).toBe('')
  })

  it('одинаково пуст для любого упражнения', () => {
    const other = { ...bench, id: 'squat' }
    expect(createSets(other).map((set) => set.repsInput)).toEqual(createSets(bench).map((set) => set.repsInput))
  })

  it('вес по-прежнему предзаполняется', () => {
    const sets = createSets(bench)
    expect(sets).toHaveLength(bench.setsCount)
    expect(sets.every((set) => set.weight === bench.targetWeight)).toBe(true)
  })
})

// Issue #242, п.2: replaceNextExerciseInCurrentWorkout не удалял лог
// заменяемого упражнения — в черновике оставались оба, и при повторном
// добавлении того же упражнения всплывали старые подходы.
describe('replaceNextExerciseInCurrentWorkout — лог старого упражнения (#242)', () => {
  const nextUp: ExercisePlan = { ...bench, id: 'incline-dumbbell-press', name: 'Жим гантелей на наклонной' }
  const workoutDay = {
    id: 'day-1',
    name: 'День 1',
    label: '',
    description: '',
    exercises: [bench, nextUp],
  } as WorkoutDay

  function makeNavigationOptions(setLogs: ReturnType<typeof vi.fn>, persistWorkoutDraft: ReturnType<typeof vi.fn>) {
    return {
      activeWorkoutDay: workoutDay,
      activeWorkoutDayBase: workoutDay,
      activeExerciseIndex: 0,
      logs: {},
      nextExercise: nextUp,
      nextTargets: {},
      draftStatus: '',
      hasActiveDraft: true,
      previewWorkoutDay: workoutDay,
      manualWorkoutDaySelected: false,
      nextPlannedWorkout: undefined,
      trainingCalendar: [],
      extraExercisesByDay: {},
      setManualWorkoutDaySelected: vi.fn(),
      setActiveSessionWorkoutDay: vi.fn(),
      setWorkoutReadinessMode: vi.fn(),
      setActiveWorkoutDayId: vi.fn(),
      setActiveExerciseIndex: vi.fn(),
      setRestRemainingSeconds: vi.fn(),
      setCoachNextSetHint: vi.fn(),
      setExerciseGuideOpen: vi.fn(),
      setExtraExercisesByDay: vi.fn(),
      setExercisePickerOpen: vi.fn(),
      setLogs,
      createExerciseLog: (exercise: ExercisePlan) => ({ exerciseId: exercise.id, pain: false, sets: createSets(exercise) }),
      persistWorkoutDraft,
      navigate: vi.fn(),
      notify: vi.fn(),
      clearActiveWorkoutDraft: vi.fn(),
    } as unknown as Parameters<typeof useWorkoutNavigation>[0]
  }

  it('удаляет лог заменяемого упражнения и заводит лог замены', () => {
    const setLogs = vi.fn()
    const persistWorkoutDraft = vi.fn()
    const { result } = renderHook(() => useWorkoutNavigation(makeNavigationOptions(setLogs, persistWorkoutDraft)))

    act(() => {
      result.current.replaceNextExerciseInCurrentWorkout({ ...bench, id: 'cable-fly', name: 'Сведе́ния' })
    })

    const reducer = setLogs.mock.calls[0][0] as (current: Record<string, unknown>) => Record<string, unknown>
    const nextLogs = reducer({ [bench.id]: { exerciseId: bench.id, pain: false, sets: [] }, [nextUp.id]: { exerciseId: nextUp.id, pain: false, sets: [] } })

    expect(nextLogs[nextUp.id]).toBeUndefined()
    expect(nextLogs[bench.id]).toBeDefined()
    expect(Object.keys(nextLogs).some((id) => id.startsWith('cable-fly-replacement-'))).toBe(true)
  })

  it('передаёт новый состав дня в черновик', () => {
    const setLogs = vi.fn()
    const persistWorkoutDraft = vi.fn()
    const { result } = renderHook(() => useWorkoutNavigation(makeNavigationOptions(setLogs, persistWorkoutDraft)))

    act(() => {
      result.current.replaceNextExerciseInCurrentWorkout({ ...bench, id: 'cable-fly', name: 'Сведе́ния' })
    })

    const reducer = setLogs.mock.calls[0][0] as (current: Record<string, unknown>) => Record<string, unknown>
    reducer({})

    const sessionExercises = persistWorkoutDraft.mock.calls[0][2] as ExercisePlan[]
    expect(sessionExercises).toHaveLength(2)
    expect(sessionExercises[0].id).toBe(bench.id)
    expect(sessionExercises[1].id).toMatch(/^cable-fly-replacement-/)
  })
})
