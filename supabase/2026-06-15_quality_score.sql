-- Add quality_score column to workout_sessions.
-- Range 0-100, computed from RPE, pain, progression, and volume.

alter table public.workout_sessions add column if not exists quality_score integer
  check (quality_score >= 0 and quality_score <= 100);