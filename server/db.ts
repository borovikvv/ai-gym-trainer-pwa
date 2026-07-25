import pg from 'pg'
import type { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer'

export const pool: Pool = new pg.Pool({ connectionString: databaseUrl })
