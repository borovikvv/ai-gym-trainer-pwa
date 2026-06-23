-- Volume Landmark Overrides — per-user adaptive MEV/MRV adjustments.
--
-- Phase 3 issue #6: stores individual adjustments to MEV/MAV/MRV landmarks
-- computed by server/adaptiveVolumeLandmarks.js based on observed e1RM
-- trends and volume position.
--
-- Schema:
--   user_id               — references users.user_id (text, no FK because
--                           the project uses a simple allow-list, not a
--                           users table)
--   muscle_key            — canonical muscle key (chest/back/legs/...)
--   mev_override          — adjusted MEV, NULL means use base landmark
--   mrv_override          — adjusted MRV, NULL means use base landmark
--   last_adjustment_iso   — when the last non-hold adjustment was applied
--                           (used for the 2-week cooldown check)
--   last_adjustment_reason — human-readable Russian explanation
--   created_at, updated_at — audit timestamps
--
-- One row per (user_id, muscle_key). UPSERT pattern is used by the
-- persistence layer.

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
