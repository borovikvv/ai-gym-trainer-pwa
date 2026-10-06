import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'test-client-token'

function configureToken(token: string) {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_API_AUTH_TOKEN', token)
  vi.resetModules()
}

beforeEach(() => {
  // jsdom does not implement IndexedDB — without a polyfill the queue
  // functions silently fall into their catch branches and test nothing.
  // A fresh IDBFactory per test keeps tests from sharing DB state.
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('offlineQueue replay', () => {
  it('adds the X-API-Token header when replaying queued requests', async () => {
    configureToken(TOKEN)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const { enqueueRequest, replayQueuedRequests, getQueuedRequests } = await import('./offlineQueue')

    await enqueueRequest(
      'http://api.test/api/workout-history',
      'POST',
      { foo: 'bar' },
      { 'Content-Type': 'application/json' },
    )

    const count = await replayQueuedRequests()

    expect(count).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/workout-history')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-API-Token': TOKEN,
    })
    expect(await getQueuedRequests()).toEqual([])
  })

  it('keeps a request that fails with 401 so it can be replayed after a new login', async () => {
    // Issue #404: с входом по cookie 401 = «сессии нет или она истекла».
    // Это восстановимо: пользователь входит заново, и записанные офлайн
    // подходы должны доехать. Раньше запрос удалялся и терялся молча.
    configureToken(TOKEN)
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    vi.stubGlobal('fetch', fetchMock)
    const { enqueueRequest, replayQueuedRequests, getQueuedRequests } = await import('./offlineQueue')

    await enqueueRequest('http://api.test/api/workout-history', 'POST', { foo: 'bar' })

    await replayQueuedRequests()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const queued = await getQueuedRequests()
    expect(queued).toHaveLength(1)
    expect(queued[0].retryCount).toBe(1)
  })
})