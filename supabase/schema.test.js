// Issue #362: volume_landmark_overrides was created by a delta migration and
// never added to schema.sql's RLS-enable list or anon policy array — RLS
// stayed off in prod with nobody noticing. This guards against the same
// drift for any future table.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const schemaSql = readFileSync(resolve(process.cwd(), 'supabase/schema.sql'), 'utf-8')

function tableNames(sql) {
  return [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])
}

describe('schema.sql RLS coverage', () => {
  const tables = tableNames(schemaSql)

  it('has at least the known tables', () => {
    expect(tables).toContain('workout_drafts')
    expect(tables).toContain('volume_landmark_overrides')
  })

  it.each(tables)('%s has row level security enabled', (table) => {
    expect(schemaSql).toMatch(new RegExp(`alter table public\\.${table} enable row level security;`))
  })

  it.each(tables)('%s is in the anon policy array', (table) => {
    const arrayMatch = schemaSql.match(/foreach table_name in array array\[([\s\S]*?)\]/)
    expect(arrayMatch).not.toBeNull()
    expect(arrayMatch[1]).toMatch(new RegExp(`'${table}'`))
  })
})
