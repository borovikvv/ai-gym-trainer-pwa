#!/usr/bin/env node
// Apply a SQL migration file to the database.
// Usage: node supabase/apply-migration.mjs <file.sql>
//   or:  cat file.sql | node supabase/apply-migration.mjs
//   or:  DATABASE_URL=postgres://... node supabase/apply-migration.mjs <file.sql>
import { readFileSync } from 'node:fs'
import pkg from 'pg'
const { Pool } = pkg

const sqlFile = process.argv[2]
let sql

if (sqlFile) {
  try {
    sql = readFileSync(sqlFile, 'utf-8')
  } catch (err) {
    console.error(`Cannot read migration file: ${sqlFile}`)
    process.exit(1)
  }
} else if (!process.stdin.isTTY) {
  // Read from stdin (piped)
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  sql = Buffer.concat(chunks).toString('utf-8')
} else {
  console.error('Usage: node supabase/apply-migration.mjs <file.sql>')
  console.error('   or:  cat file.sql | node supabase/apply-migration.mjs')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer',
})

try {
  await pool.query(sql)
  const label = sqlFile
    ? sqlFile.replace(/^.*[/\\]/, '')   // just the filename
    : 'stdin'
  console.log(`OK: ${label} applied`)
} catch (err) {
  console.error('Migration error:', err.message)
  process.exit(1)
} finally {
  await pool.end()
}
