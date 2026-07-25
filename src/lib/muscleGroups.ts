/**
 * Client-side muscle group helpers.
 *
 * Issue #147: the implementation lives in shared/muscleGroups.ts so
 * server and client share one source of truth. This module re-exports it
 * for the existing `../lib/muscleGroups` import sites in src/.
 */

export {
  normalizeMuscleGroup,
  isAssistedExercise,
  isAssistedExerciseName,
  MUSCLE_LABELS,
  labelFor,
  labelForLower,
  CANONICAL_MUSCLE_KEYS,
  type MuscleKey,
} from '../../shared/muscleGroups'
