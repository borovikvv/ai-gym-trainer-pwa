import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRestTimer } from './useRestTimer'

describe('useRestTimer (Фаза 3.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('отсчитывает от timestamp и доходит до нуля', () => {
    const { result } = renderHook(() => useRestTimer())
    act(() => result.current.setRestRemainingSeconds(90))
    expect(result.current.restRemainingSeconds).toBe(90)

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current.restRemainingSeconds).toBe(60)

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current.restRemainingSeconds).toBe(0)
  })

  it('после «фона» показывает корректный остаток (нет дрейфа тиков)', () => {
    const { result } = renderHook(() => useRestTimer())
    act(() => result.current.setRestRemainingSeconds(120))
    // Симулируем фон: время идёт, тики срабатывают редко — но остаток
    // считается от endsAt, поэтому один тик через 70 секунд даёт точный
    // результат.
    act(() => { vi.advanceTimersByTime(70_000) })
    expect(result.current.restRemainingSeconds).toBe(50)
  })

  it('функция-обновлятор добавляет время к текущему остатку (+30 с)', () => {
    const { result } = renderHook(() => useRestTimer())
    act(() => result.current.setRestRemainingSeconds(60))
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(result.current.restRemainingSeconds).toBe(40)
    act(() => result.current.setRestRemainingSeconds((current) => current + 30))
    expect(result.current.restRemainingSeconds).toBe(70)
  })

  it('clearRestTimer сбрасывает отсчёт без событий окончания', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    const { result } = renderHook(() => useRestTimer())
    act(() => result.current.setRestRemainingSeconds(60))
    act(() => result.current.clearRestTimer())
    expect(result.current.restRemainingSeconds).toBe(0)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('по окончании вибрирует и строит текст уведомления', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    const buildFinishText = vi.fn().mockReturnValue('Следующий подход: 62.5 кг × 8')
    const { result } = renderHook(() => useRestTimer({ buildFinishText }))
    act(() => result.current.setRestRemainingSeconds(2))
    act(() => { vi.advanceTimersByTime(2_500) })
    expect(result.current.restRemainingSeconds).toBe(0)
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200])
    expect(buildFinishText).toHaveBeenCalled()
  })
})
