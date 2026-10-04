// Pure migration bookkeeping logic. Takes an already-connected client (an
// object with query(text, params), like DbClient in server/dbClient.ts) so the
// behaviour can be tested without a real Postgres.

export async function ensureMigrationsTable(client) {
  await client.query(
    'create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now())',
  )
}

export async function getAppliedFilenames(client) {
  const { rows } = await client.query('select filename from public.schema_migrations')
  return new Set(rows.map((row) => row.filename))
}

/**
 * Applies every migration not recorded in schema_migrations, in the given
 * order (the caller sorts; this function does not). Each file runs in its own
 * transaction: begin -> sql -> insert record -> commit. A failing file is
 * rolled back, reported as `failed`, and stops the chain — later files are
 * left untouched.
 *
 * @param {{query: (text: string, params?: unknown[]) => Promise<{rows: any[]}>}} client
 * @param {{filename: string, sql: string}[]} migrations already sorted
 * @returns {Promise<{filename: string, status: 'applied'|'failed', error?: string}[]>}
 */
export async function applyPendingMigrations(client, migrations) {
  await ensureMigrationsTable(client)
  const applied = await getAppliedFilenames(client)
  const results = []
  for (const { filename, sql } of migrations) {
    if (applied.has(filename)) continue
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into public.schema_migrations (filename) values ($1)', [filename])
      await client.query('commit')
      results.push({ filename, status: 'applied' })
    } catch (error) {
      await client.query('rollback')
      results.push({
        filename,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      break
    }
  }
  return results
}

/**
 * Marks files as applied without reading or executing their SQL. Used once on
 * a database where migrations were applied by hand before schema_migrations
 * existed. Not idempotent in intent: passing a set that includes unpublished
 * files would falsely mark them as done.
 *
 * @param {{query: (text: string, params?: unknown[]) => Promise<unknown>}} client
 * @param {string[]} filenames
 */
export async function markBaseline(client, filenames) {
  await ensureMigrationsTable(client)
  for (const filename of filenames) {
    await client.query(
      'insert into public.schema_migrations (filename) values ($1) on conflict (filename) do nothing',
      [filename],
    )
  }
}
