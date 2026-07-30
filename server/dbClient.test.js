import { describe, it, expect, vi } from 'vitest'
import { nonFatal } from './dbClient.ts'

/** Клиент с открытой транзакцией: savepoint принимается. */
function transactionClient() {
  const statements = []
  return {
    statements,
    query: vi.fn(async (text) => {
      statements.push(text)
      return { rows: [], rowCount: 0 }
    }),
  }
}

describe('nonFatal', () => {
  it('сбой некритичной работы не мешает следующим запросам транзакции', async () => {
    const client = transactionClient()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const value = await nonFatal(client, 'weeklyVolume', async () => {
      throw new Error('relation "public.weekly_volume_targets" does not exist')
    }, { fallback: true })

    expect(value).toEqual({ fallback: true })
    // Ключевое: транзакция откачена к savepoint, иначе следующий запрос упал бы
    // с 25P02 «current transaction is aborted».
    expect(client.statements).toEqual(['savepoint nonfatal_weeklyVolume', 'rollback to savepoint nonfatal_weeklyVolume'])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('успешная работа освобождает savepoint и возвращает результат', async () => {
    const client = transactionClient()

    const value = await nonFatal(client, 'longTermMemory', async () => 'память', '')

    expect(value).toBe('память')
    expect(client.statements).toEqual(['savepoint nonfatal_longTermMemory', 'release savepoint nonfatal_longTermMemory'])
  })

  it('ошибка, проглоченная внутри, ловится через release: возвращается запасное значение', async () => {
    // Транзакция уже aborted, но сама работа ошибки не бросила (внутренний
    // catch) — тогда падает release, и это единственный признак беды.
    const statements = []
    const client = {
      statements,
      query: vi.fn(async (text) => {
        statements.push(text)
        if (text.startsWith('release')) throw new Error('current transaction is aborted')
        return { rows: [], rowCount: 0 }
      }),
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const value = await nonFatal(client, 'longTermMemory', async () => 'мусор из аварийной транзакции', '')

    expect(value).toBe('')
    expect(statements).toContain('rollback to savepoint nonfatal_longTermMemory')
    consoleError.mockRestore()
  })

  it('вне транзакции работает без savepoint', async () => {
    // На pool savepoint невозможен (25P01) — оборачивать нечего, но и падать
    // не должно: тот же код зовут и из роутов через pool.
    const client = { query: vi.fn(async () => { throw new Error('SAVEPOINT can only be used in transaction blocks') }) }

    const value = await nonFatal(client, 'weeklyVolume', async () => 'ok', null)

    expect(value).toBe('ok')
    expect(client.query).toHaveBeenCalledTimes(1)
  })
})
