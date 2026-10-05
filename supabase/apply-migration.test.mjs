import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const scriptPath = resolve(process.cwd(), 'supabase/apply-migration.mjs')

describe('apply-migration.mjs (issue #322)', () => {
  it('падает с понятной ошибкой, если DATABASE_URL не задан', () => {
    const env = { ...process.env }
    delete env.DATABASE_URL

    let error
    try {
      execFileSync('node', [scriptPath], { env, input: '', stdio: 'pipe' })
    } catch (err) {
      error = err
    }

    expect(error).toBeDefined()
    expect(error.status).toBe(1)
    expect(error.stderr.toString()).toMatch(/DATABASE_URL/)
  })
})
