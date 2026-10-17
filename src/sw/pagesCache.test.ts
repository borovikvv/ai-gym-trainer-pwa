import { describe, expect, it, vi } from 'vitest'
import { PAGES_CACHE, clearPagesCacheOnActivate } from './pagesCache'

// Issue #473: активация нового SW должна сносить кэш оболочки, иначе офлайн-
// фолбэк отдаст index.html прошлой сборки.

describe('clearPagesCacheOnActivate', () => {
  it('удаляет кэш оболочки ровно один раз', async () => {
    const del = vi.fn(async (_name: string) => true)
    const cacheStorage = { delete: del } as unknown as CacheStorage

    await clearPagesCacheOnActivate(cacheStorage)

    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith(PAGES_CACHE)
  })
})
