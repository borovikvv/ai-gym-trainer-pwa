import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestWakeLock, resetWakeLockStateForTests, useWakeLock } from './useWakeLock'

type FakeSentinel = {
  release: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  fireRelease: () => void
}

function createFakeWakeLock() {
  const sentinels: FakeSentinel[] = []
  const request = vi.fn(async () => {
    const listeners = new Set<() => void>()
    const sentinel: FakeSentinel = {
      release: vi.fn(async () => undefined),
      addEventListener: vi.fn((_type: string, cb: () => void) => void listeners.add(cb)),
      removeEventListener: vi.fn((_type: string, cb: () => void) => void listeners.delete(cb)),
      fireRelease: () => {
        for (const cb of [...listeners]) cb()
      },
    }
    sentinels.push(sentinel)
    return sentinel
  })
  return { request, sentinels }
}

// Object.create поверх реального navigator: подменяем только wakeLock,
// не ломая userAgent и прочее, что читает React/jsdom.
function stubWakeLock(api: unknown) {
  vi.stubGlobal('navigator', Object.create(navigator, { wakeLock: { value: api, configurable: true, writable: true } }))
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

async function mountActive() {
  const { request, sentinels } = createFakeWakeLock()
  stubWakeLock({ request })
  const view = renderHook(() => useWakeLock(true))
  await waitFor(() => expect(view.result.current).toBe('active'))
  return { request, sentinels, ...view }
}

describe('useWakeLock (Issue #458)', () => {
  beforeEach(() => {
    resetWakeLockStateForTests()
    setVisibility('visible')
  })

  afterEach(() => {
    resetWakeLockStateForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('берёт лок при active=true и отпускает при размонтировании', async () => {
    const { request, sentinels, unmount } = await mountActive()
    expect(request).toHaveBeenCalledTimes(1)
    unmount()
    expect(sentinels[0].release).toHaveBeenCalledTimes(1)
  })

  it('после события release от сентинела делает новый запрос', async () => {
    const { request, sentinels, result } = await mountActive()
    act(() => void sentinels[0].fireRelease())
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current).toBe('active'))
  })

  it('при скрытом документе release не перезапрашивает, а ждёт visibilitychange', async () => {
    const { request, sentinels, result } = await mountActive()
    setVisibility('hidden')
    act(() => void sentinels[0].fireRelease())
    expect(result.current).toBe('rejected')
    expect(request).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it('отклонённый запрос не роняет экран и выставляет rejected', async () => {
    const request = vi.fn(async () => {
      throw new DOMException('no wake lock for you', 'NotAllowedError')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubWakeLock({ request })
    const { result } = renderHook(() => useWakeLock(true))
    await waitFor(() => expect(result.current).toBe('rejected'))
    expect(warn).toHaveBeenCalled()
  })

  it('без navigator.wakeLock выставляет unsupported', async () => {
    stubWakeLock(undefined)
    const { result } = renderHook(() => useWakeLock(true))
    await waitFor(() => expect(result.current).toBe('unsupported'))
  })

  it('повторный requestWakeLock при уже взятом локе не шлёт второй запрос', async () => {
    const { request } = await mountActive()
    act(() => void requestWakeLock())
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('active=false отпускает лок', async () => {
    const { request, sentinels } = createFakeWakeLock()
    stubWakeLock({ request })
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useWakeLock(active), {
      initialProps: { active: true },
    })
    await waitFor(() => expect(result.current).toBe('active'))
    rerender({ active: false })
    expect(sentinels[0].release).toHaveBeenCalled()
  })

  it('при размонтировании снимает слушатель и не перезапрашивает', async () => {
    const { request, sentinels, unmount } = await mountActive()
    unmount()
    expect(sentinels[0].removeEventListener).toHaveBeenCalledWith('release', expect.any(Function))
    setVisibility('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('вне тренировки лок не берётся', () => {
    const { request } = createFakeWakeLock()
    stubWakeLock({ request })
    renderHook(() => useWakeLock(false))
    expect(request).not.toHaveBeenCalled()
  })
})
