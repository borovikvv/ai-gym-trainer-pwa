import { describe, expect, it, vi } from 'vitest'
import { loadProgramData, updateProgramExercise } from './services/programService.js'

// Issue #316: GET /program-data отдавал программы и профили всех пользователей
// без фильтра. Теперь сервис принимает allowlist и передаёт его во все
// пользовательские запросы; exercise_library остаётся общим каталогом.
describe('loadProgramData — фильтрация по allowlist (#316)', () => {
  it('передаёт allowedUserIds первым bind-параметром во все 4 пользовательских запроса', async () => {
    const allowedUserIds = ['vyacheslav', 'oleg']
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }

    await loadProgramData(client, allowedUserIds)

    const calls = client.query.mock.calls
    const appUsers = calls.find(([text]) => text.includes('from public.app_users'))
    const userProfiles = calls.find(([text]) => text.includes('from public.user_profiles'))
    const programDays = calls.find(([text]) => text.includes('from public.program_days'))
    const programExercises = calls.find(([text]) => text.includes('from public.program_exercises'))
    const exerciseLibrary = calls.find(([text]) => text.includes('from public.exercise_library'))

    expect(appUsers).toBeDefined()
    expect(appUsers[1]).toEqual([allowedUserIds])

    expect(userProfiles).toBeDefined()
    expect(userProfiles[1]).toEqual([allowedUserIds])

    expect(programDays).toBeDefined()
    expect(programDays[1]).toEqual([allowedUserIds])

    expect(programExercises).toBeDefined()
    expect(programExercises[1]).toEqual([allowedUserIds])

    expect(exerciseLibrary).toBeDefined()
    expect(exerciseLibrary[1]).toBeUndefined()
  })
})

// Issue #316: PATCH /program-exercises/:id уже проверял владельца в сервисе —
// здесь тесты закрывают этот пробел.
describe('updateProgramExercise — владелец строки (#316)', () => {
  const fields = { setsCount: 3, repMin: 8, repMax: 10, targetWeight: 50, weightStep: 2.5, restSeconds: 90 }

  it('возвращает null, когда упражнение не существует', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (text) => {
        if (text.includes('where pe.id = $1')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
    }

    const result = await updateProgramExercise(client, { id: 'missing', ...fields })

    expect(result).toBeNull()
  })

  it('rejects с 403, когда владелец упражнения вне allowlist, update не вызывается', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (text) => {
        if (text.includes('where pe.id = $1')) return { rows: [{ user_id: 'hacker' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    }

    await expect(updateProgramExercise(client, { id: 'pe-1', ...fields })).rejects.toMatchObject({ statusCode: 403 })
    expect(client.query.mock.calls.some(([text]) => text.includes('update public.program_exercises'))).toBe(false)
  })

  it('обновляет и возвращает id, когда владелец в allowlist', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (text) => {
        if (text.includes('where pe.id = $1')) return { rows: [{ user_id: 'oleg' }], rowCount: 1 }
        if (text.includes('update public.program_exercises')) return { rows: [{ id: 'pe-1' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    }

    const result = await updateProgramExercise(client, { id: 'pe-1', ...fields })

    expect(result).toEqual({ id: 'pe-1' })
    const updateCall = client.query.mock.calls.find(([text]) => text.includes('update public.program_exercises'))
    expect(updateCall[1][0]).toBe('pe-1')
  })
})