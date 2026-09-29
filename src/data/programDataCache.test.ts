import { beforeEach, describe, expect, it } from 'vitest'
import { fallbackProgramData } from './programApi'
import { PROGRAM_DATA_CACHE_KEY, loadCachedProgramData, saveCachedProgramData } from './programDataCache'

describe('programDataCache (#368)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('без записи — null', () => {
    expect(loadCachedProgramData()).toBeNull()
  })

  it('сохранённая программа читается обратно', () => {
    saveCachedProgramData(fallbackProgramData)
    expect(loadCachedProgramData()?.users.map((user) => user.id)).toEqual(fallbackProgramData.users.map((user) => user.id))
  })

  it('битый JSON — null, без исключения', () => {
    window.localStorage.setItem(PROGRAM_DATA_CACHE_KEY, '{not json')
    expect(loadCachedProgramData()).toBeNull()
  })

  it('запись не той формы — null', () => {
    window.localStorage.setItem(PROGRAM_DATA_CACHE_KEY, JSON.stringify({ users: [], workoutDays: [] }))
    expect(loadCachedProgramData()).toBeNull()
  })
})
