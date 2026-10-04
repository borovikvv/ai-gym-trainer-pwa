import { describe, it, expect, vi } from 'vitest'
import { applyPendingMigrations, getAppliedFilenames, markBaseline } from './migrateLib.mjs'

/**
 * Фейковый клиент без Postgres: хранит уже записанные файлы и лог запросов.
 * `select filename from public.schema_migrations` отвечает текущим состоянием,
 * `insert into public.schema_migrations` дописывает запись (с учётом
 * `on conflict (filename) do nothing`), тексты из `failingSql` бросают ошибку,
 * всё остальное (begin/commit/rollback/create table/тело миграции) логируется.
 */
function fakeClient({ failingSql = [] } = {}) {
  const statements = []
  const appliedRows = []
  const query = vi.fn(async (text, params) => {
    statements.push(text)
    if (/select filename from public\.schema_migrations/i.test(text)) {
      return { rows: appliedRows.map((filename) => ({ filename })), rowCount: appliedRows.length }
    }
    if (/insert into public\.schema_migrations/i.test(text)) {
      const filename = params[0]
      const onConflict = /on conflict/i.test(text)
      if (!onConflict || !appliedRows.includes(filename)) appliedRows.push(filename)
      return { rows: [], rowCount: 1 }
    }
    if (failingSql.includes(text)) throw new Error(`no such table for ${text}`)
    return { rows: [], rowCount: 0 }
  })
  return { statements, appliedRows, query }
}

describe('getAppliedFilenames', () => {
  it('возвращает множество записанных файлов', async () => {
    const client = fakeClient()
    client.appliedRows.push('a.sql', 'b.sql')

    const applied = await getAppliedFilenames(client)

    expect(applied).toBeInstanceOf(Set)
    expect([...applied]).toEqual(['a.sql', 'b.sql'])
  })
})

describe('applyPendingMigrations', () => {
  const migrations = [
    { filename: 'a.sql', sql: 'select 1' },
    { filename: 'b.sql', sql: 'select 2' },
  ]

  it('первый запуск применяет каждый файл в своей транзакции', async () => {
    const client = fakeClient()

    const result = await applyPendingMigrations(client, migrations)

    expect(result).toEqual([
      { filename: 'a.sql', status: 'applied' },
      { filename: 'b.sql', status: 'applied' },
    ])
    expect(client.appliedRows).toEqual(['a.sql', 'b.sql'])
    expect(client.statements.filter((s) => s === 'begin')).toHaveLength(2)
    expect(client.statements.filter((s) => s === 'commit')).toHaveLength(2)
  })

  it('повторный запуск ничего не применяет', async () => {
    const client = fakeClient()
    await applyPendingMigrations(client, migrations)
    const before = client.statements.length

    const result = await applyPendingMigrations(client, migrations)

    expect(result).toEqual([])
    const repeated = client.statements.slice(before)
    expect(repeated).not.toContain('begin')
    expect(repeated).not.toContain('select 1')
    expect(repeated).not.toContain('select 2')
    expect(client.appliedRows).toEqual(['a.sql', 'b.sql'])
  })

  it('ошибка в файле откатывает только его и останавливает цепочку', async () => {
    const client = fakeClient({ failingSql: ['select 2'] })

    const result = await applyPendingMigrations(client, [
      { filename: 'a.sql', sql: 'select 1' },
      { filename: 'b.sql', sql: 'select 2' },
      { filename: 'c.sql', sql: 'select 3' },
    ])

    expect(result).toEqual([
      { filename: 'a.sql', status: 'applied' },
      { filename: 'b.sql', status: 'failed', error: 'no such table for select 2' },
    ])
    expect(client.appliedRows).toEqual(['a.sql'])
    // a: begin + commit; b: begin + rollback; c: не начинался вообще.
    expect(client.statements.filter((s) => s === 'begin')).toHaveLength(2)
    expect(client.statements.filter((s) => s === 'commit')).toHaveLength(1)
    expect(client.statements.filter((s) => s === 'rollback')).toHaveLength(1)
    expect(client.statements.filter((s) => /insert into public\.schema_migrations/i.test(s))).toHaveLength(1)
    expect(client.statements).not.toContain('select 3')
  })
})

describe('markBaseline', () => {
  it('помечает файлы без выполнения SQL и без дублей', async () => {
    const client = fakeClient()

    await markBaseline(client, ['x.sql'])

    expect(client.appliedRows).toEqual(['x.sql'])
    expect(client.statements).not.toContain('begin')
    expect(client.statements).not.toContain('commit')
    expect(client.statements).not.toContain('rollback')

    await markBaseline(client, ['x.sql'])

    expect(client.appliedRows).toEqual(['x.sql'])
  })
})
