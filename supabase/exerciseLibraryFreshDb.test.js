// Issue #374: на чистой БД schema.sql не объявляла шесть колонок default_*,
// в которые пишут миграции справочника, а backfill weight_direction не
// находил гравитрон, потому что колонка уже была NOT NULL к моменту его
// запуска. Проверяем текст .sql-файлов напрямую — в CI нет живого Postgres.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const schemaSql = readFileSync(resolve(process.cwd(), 'supabase/schema.sql'), 'utf-8')
const weightDirectionMigration = readFileSync(
  resolve(process.cwd(), 'supabase/2026-07-28_exercise_library_weight_direction.sql'),
  'utf-8',
)

describe('exercise_library default_* columns', () => {
  const defaultColumns = [
    'default_sets_count',
    'default_rep_min',
    'default_rep_max',
    'default_target_weight',
    'default_weight_step',
    'default_rest_seconds',
  ]

  it.each(defaultColumns)('%s has DDL in schema.sql', (column) => {
    expect(schemaSql).toMatch(
      new RegExp(`alter table public\\.exercise_library add column if not exists ${column}\\b`),
    )
  })
})

describe('exercise_library weight_direction backfill', () => {
  it('matches assisted exercises by name regardless of current value', () => {
    const match = weightDirectionMigration.match(
      /update public\.exercise_library\s+set weight_direction = 'assistance'\s+where ([\s\S]*?);/,
    )
    expect(match).not.toBeNull()
    expect(match[1]).not.toMatch(/is null/)
    expect(match[1]).toMatch(/гравитрон/)
  })
})