import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackProgramData, loadProgramDataFromApi, type ProgramData } from '../data/programApi'
import { loadCachedProgramData, saveCachedProgramData } from '../data/programDataCache'
import { useProgramData } from './useProgramData'

// Issue #368: при настроенном API мок из mockProgram.ts не должен выдаваться
// за данные из базы. Конфигурацию API включаем моком модуля: в MODE=test
// isProgramApiConfigured всегда false.
vi.mock('../data/programApi', async (importActual) => ({
  ...(await importActual<typeof import('../data/programApi')>()),
  isProgramApiConfigured: true,
  loadProgramDataFromApi: vi.fn(),
  loadPlannedWorkoutsFromApi: vi.fn().mockResolvedValue([]),
}))

const loadProgram = vi.mocked(loadProgramDataFromApi)

// Issue #329: эффект загрузки программы теперь зависит от переданных колбэков.
// В проде они стабильны (setState-сеттеры, модульная функция, useCallback),
// поэтому здесь тоже держим их на уровне модуля — иначе renderHook пересоздаёт
// их на каждом рендере и эффект уходит в бесконечный цикл.
const stableCreateInitialLogs = vi.fn(() => ({}))
const stableSetActiveExerciseIndex = vi.fn()
const stableSetLogs = vi.fn()
const stableRestoreSessionExercises = vi.fn()
const notifyMock = vi.fn()

const remoteProgramData: ProgramData = {
  ...fallbackProgramData,
  users: [{ id: 'remote-user', name: 'Из базы', initials: 'Б', goal: 'сила', streak: '1 неделя' }],
  workoutDaysByUser: { 'remote-user': fallbackProgramData.workoutDays },
}

function httpError(status: number) {
  return Object.assign(new Error(`API program load failed: ${status}`), { status })
}

function renderProgramData() {
  const hook = renderHook(() =>
    useProgramData({
      initialDraft: null,
      fallbackFirstUserId: fallbackProgramData.users[0].id,
      fallbackFirstWorkoutDayId: fallbackProgramData.workoutDays[0].id,
      createInitialLogs: stableCreateInitialLogs,
      setActiveExerciseIndex: stableSetActiveExerciseIndex,
      setLogs: stableSetLogs,
      restoreSessionExercises: stableRestoreSessionExercises,
      notify: notifyMock,
    }),
  )
  return { ...hook, notify: notifyMock }
}

describe('useProgramData: состояние загрузки программы (#368)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    loadProgram.mockReset()
    notifyMock.mockClear()
  })

  it('пока программа грузится — статус loading, а не готовый мок', () => {
    loadProgram.mockReturnValue(new Promise(() => undefined))
    const { result } = renderProgramData()
    expect(result.current.programLoad).toEqual({ status: 'loading' })
  })

  it('успешная загрузка — статус ready, данные из API', async () => {
    loadProgram.mockResolvedValue(remoteProgramData)
    const { result } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad).toEqual({ status: 'ready' }))
    expect(result.current.programData.users[0].id).toBe('remote-user')
  })

  it('401 без сохранённой копии — статус error с кодом, мок не подставляется', async () => {
    loadProgram.mockRejectedValue(httpError(401))
    const { result } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad).toEqual({ status: 'error', httpStatus: 401 }))
  })

  it('сетевая ошибка без сохранённой копии — статус error без кода', async () => {
    loadProgram.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad).toEqual({ status: 'error', httpStatus: null }))
  })

  it('успешная загрузка сохраняет копию программы на устройстве', async () => {
    loadProgram.mockResolvedValue(remoteProgramData)
    const { result } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad.status).toBe('ready'))
    expect(loadCachedProgramData()?.users[0].id).toBe('remote-user')
  })

  it('ошибка при сохранённой копии — показываем копию, статус ready, тост предупреждает', async () => {
    saveCachedProgramData(remoteProgramData)
    loadProgram.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result, notify } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad).toEqual({ status: 'ready' }))
    expect(result.current.programData.users[0].id).toBe('remote-user')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('повтор после ошибки — снова loading, затем ready с данными из API', async () => {
    loadProgram.mockRejectedValueOnce(httpError(401)).mockResolvedValueOnce(remoteProgramData)
    const { result } = renderProgramData()
    await waitFor(() => expect(result.current.programLoad.status).toBe('error'))

    act(() => result.current.retryProgramLoad())
    expect(result.current.programLoad).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.programLoad).toEqual({ status: 'ready' }))
    expect(result.current.programData.users[0].id).toBe('remote-user')
    expect(loadProgram).toHaveBeenCalledTimes(2)
  })
})
