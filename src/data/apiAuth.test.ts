import { afterEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'test-client-token'

function configureToken(token: string, baseUrl = 'http://api.test') {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_API_AUTH_TOKEN', token)
  vi.stubEnv('VITE_API_BASE_URL', baseUrl)
  vi.resetModules()
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('apiAuth', () => {
  it('attaches the Bearer token to headers when a token is configured', async () => {
    configureToken(TOKEN)
    const { apiAuthHeaders } = await import('./apiAuth')

    expect(apiAuthHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    })
  })

  it('leaves headers untouched when no token is configured', async () => {
    configureToken('')
    const { apiAuthHeaders } = await import('./apiAuth')

    expect(apiAuthHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('sends the Authorization header through the global fetch', async () => {
    configureToken(TOKEN)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('./apiAuth')

    await apiFetch('http://api.test/program-data')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/program-data', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  })
})

describe('programApi client auth', () => {
  it('loadProgramDataFromApi fetches through apiFetch so the API token is attached', async () => {
    configureToken(TOKEN)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [], profiles: [], workoutDays: [], exerciseLibrary: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { loadProgramDataFromApi } = await import('./programApi')

    await loadProgramDataFromApi()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/program-data')
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })
})