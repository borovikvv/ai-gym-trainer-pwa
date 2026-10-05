import pg from 'pg'
import type { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL не задан: сервер не может подключиться к БД без явной строки подключения')
}

export const pool: Pool = new pg.Pool({ connectionString: databaseUrl })
