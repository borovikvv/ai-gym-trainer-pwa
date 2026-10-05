import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('db (issue #322)', () => {
  it('падает с понятной ошибкой, если DATABASE_URL не задан', async () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.resetModules()

    await expect(import('./db.ts')).rejects.toThrow(/DATABASE_URL/)
  })
})
