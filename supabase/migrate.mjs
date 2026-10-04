#!/usr/bin/env node
// Apply pending SQL migrations, recorded in public.schema_migrations.
// Usage:
//   npm run migrate
//   node supabase/migrate.mjs --baseline [file1 file2 ...]
//
// Without flags: applies only the supabase/YYYY-MM-DD*.sql files not yet
// recorded, in filename order (the date prefix is the chronology).
// With --baseline: marks the given files (or all files matching the pattern
// when none are given) as applied without reading or running their SQL.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from 'pg'
import { applyPendingMigrations, markBaseline } from './migrateLib.mjs'

const { Pool } = pkg

const MIGRATION_PATTERN = /^\d{4}-\d{2}-\d{2}.*\.sql$/
const supabaseDir = dirname(fileURLToPath(import.meta.url))

function listMigrationFiles() {
  return readdirSync(supabaseDir)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort()
}

const args = process.argv.slice(2)
const baseline = args[0] === '--baseline'
const baselineFiles = baseline ? args.slice(1) : []

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer',
})

try {
  const client = await pool.connect()
  try {
    if (baseline) {
      const filenames = baselineFiles.length > 0 ? baselineFiles : listMigrationFiles()
      await markBaseline(client, filenames)
      for (const filename of filenames) console.log(`baseline: ${filename}`)
    } else {
      const migrations = listMigrationFiles().map((filename) => ({
        filename,
        sql: readFileSync(join(supabaseDir, filename), 'utf-8'),
      }))
      const results = await applyPendingMigrations(client, migrations)
      for (const result of results) {
        if (result.status === 'applied') {
          console.log(`applied: ${result.filename}`)
        } else {
          console.error(`failed: ${result.filename}: ${result.error}`)
          process.exitCode = 1
        }
      }
    }
  } finally {
    client.release()
  }
} catch (err) {
  console.error('Migration error:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
