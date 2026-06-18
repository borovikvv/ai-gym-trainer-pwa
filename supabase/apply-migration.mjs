import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer' });
try {
  await pool.query(`alter table public.workout_sessions add column if not exists quality_score integer check (quality_score >= 0 and quality_score <= 100)`);
  console.log('OK: quality_score column added');
} catch (err) {
  console.error('Migration error:', err.message);
} finally {
  await pool.end();
}