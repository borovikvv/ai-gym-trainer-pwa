import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Issue #368: телефон без входа получил мок-пресеты (День A/B) вместо программы
// из базы. Теперь при ошибке загрузки приложение показывает экран ошибки.

const loadProgramDataFromApi = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem('ai-gym-trainer:v0.1:onboarding-completed', '1')
  loadProgramDataFromApi.mockReset()
  vi.resetModules()
  vi.doMock('./data/programApi', async (importActual) => ({
    ...(await importActual<typeof import('./data/programApi')>()),
    isProgramApiConfigured: true,
    loadProgramDataFromApi,
    loadPlannedWorkoutsFromApi: vi.fn().mockResolvedValue([]),
    loadCoachMemoryFromApi: vi.fn().mockResolvedValue(null),
    loadCoachMemoryAndState: vi.fn().mockResolvedValue({ coachMemory: null, coachState: null }),
    createPlannedWorkoutInApi: vi.fn().mockResolvedValue(null),
    updatePlannedWorkoutInApi: vi.fn().mockResolvedValue([]),
    deletePlannedWorkoutFromApi: vi.fn().mockResolvedValue(undefined),
    fetchMemoryFactsFromApi: vi.fn().mockResolvedValue([]),
    addMemoryFactToApi: vi.fn().mockResolvedValue([]),
    patchMemoryFactInApi: vi.fn().mockResolvedValue([]),
    fetchGoalsFromApi: vi.fn().mockResolvedValue([]),
    addGoalToApi: vi.fn().mockResolvedValue([]),
    patchGoalInApi: vi.fn().mockResolvedValue([]),
  }))
})

describe('App: ошибка загрузки программы (#368)', () => {
  it('401 без сохранённой копии — экран ошибки вместо мок-программы, повтор её загружает', async () => {
    const { fallbackProgramData } = await import('./data/programApi')
    loadProgramDataFromApi
      .mockRejectedValueOnce(Object.assign(new Error('API program load failed: 401'), { status: 401 }))
      .mockResolvedValueOnce(fallbackProgramData)

    const { default: App } = await import('./App')
    render(<App />)

    expect(await screen.findByTestId('program-load-error')).toBeInTheDocument()
    expect(screen.getByTestId('program-load-status')).toHaveTextContent('401')
    expect(screen.getByTestId('program-load-auth-hint')).toBeInTheDocument()
    expect(screen.queryByTestId('home-screen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('program-load-retry'))

    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeInTheDocument())
    expect(screen.queryByTestId('program-load-error')).not.toBeInTheDocument()
  })

  it('сетевая ошибка — экран ошибки без подсказки про вход', async () => {
    loadProgramDataFromApi.mockRejectedValue(new TypeError('Failed to fetch'))

    const { default: App } = await import('./App')
    render(<App />)

    expect(await screen.findByTestId('program-load-error')).toBeInTheDocument()
    expect(screen.queryByTestId('program-load-auth-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-screen')).not.toBeInTheDocument()
  })

  it('пока программа грузится — экран загрузки, а не мок', async () => {
    loadProgramDataFromApi.mockReturnValue(new Promise(() => undefined))

    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.getByTestId('program-load-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('home-screen')).not.toBeInTheDocument()
  })
})
