// Apply the volume_landmark_overrides migration.
// Usage: node supabase/apply-volume-landmark-overrides.mjs
//
// This script is idempotent — safe to run multiple times.

import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer',
});

const migrationSql = `
create table if not exists public.volume_landmark_overrides (
  user_id text not null,
  muscle_key text not null check (muscle_key in ('chest', 'back', 'legs', 'shoulders', 'arms', 'core')),
  mev_override integer check (mev_override is null or (mev_override >= 2 and mev_override <= 30)),
  mrv_override integer check (mrv_override is null or (mrv_override >= 4 and mrv_override <= 40)),
  last_adjustment_iso timestamptz,
  last_adjustment_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, muscle_key)
);

comment on table public.volume_landmark_overrides is
  'Per-user adaptive adjustments to MEV/MRV volume landmarks. Managed by server/adaptiveVolumeLandmarks.js.';

comment on column public.volume_landmark_overrides.mev_override is
  'Adjusted MEV (Minimum Effective Volume). NULL = use base landmark from volumeLandmarks.js.';
comment on column public.volume_landmark_overrides.mrv_override is
  'Adjusted MRV (Maximum Recoverable Volume). NULL = use base landmark from volumeLandmarks.js.';
comment on column public.volume_landmark_overrides.last_adjustment_iso is
  'Timestamp of the last non-hold adjustment. Used for 2-week cooldown check.';
`;

try {
  await pool.query(migrationSql);
  console.log('OK: volume_landmark_overrides table created');
} catch (err) {
  console.error('Migration error:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
