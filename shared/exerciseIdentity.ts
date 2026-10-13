/**
 * Unified exercise-identity normalization — single source of truth shared
 * by the server (server/) and the client (src/). Previously duplicated in
 * server/exerciseIdentity.ts and src/domain/exerciseIdentity.ts (issue #147).
 *
 * The input accepts BOTH camelCase (client objects) and snake_case (DB
 * rows on the server) keys so a single helper covers both sides.
 */

interface ExerciseLike {
  id?: string
  exerciseId?: string
  exercise_id?: string
  name?: string
  exerciseName?: string
  exercise_name?: string
  canonicalExerciseId?: string
  canonical_exercise_id?: string
}

/**
 * Resolve an exercise to its canonical id: explicit canonical id wins,
 * then the generated id is cleaned of extra/replacement/light/heavy
 * suffixes, then the name is slugified (with plank/dead-bug special cases).
 */
export function canonicalExerciseId(exerciseOrId: string | ExerciseLike | null | undefined): string {
  if (typeof exerciseOrId === 'string') return normalizeGeneratedExerciseId(exerciseOrId)
  const exercise: ExerciseLike = exerciseOrId ?? {}
  if (exercise.canonicalExerciseId ?? exercise.canonical_exercise_id) {
    return exercise.canonicalExerciseId ?? exercise.canonical_exercise_id!
  }
  const id = exercise.id ?? exercise.exerciseId ?? exercise.exercise_id ?? ''
  const normalizedId = normalizeGeneratedExerciseId(id)
  if (normalizedId) return normalizedId
  return canonicalIdFromName(exercise.name ?? exercise.exerciseName ?? exercise.exercise_name ?? '')
}

/**
 * Alias kept for client-side callers (src/) that historically used the
 * `getCanonicalExerciseId` name. Same implementation as canonicalExerciseId.
 */
export const getCanonicalExerciseId = canonicalExerciseId

/**
 * Collapse generated ids to a canonical exercise id.
 *
 * A single `-alternative-` marker is intentionally collapsed to the BASE id:
 * the repeat-penalty planner relies on that (issues #221/#286). A nested chain
 * (two or more `-alternative-` markers) instead resolves to the LAST segment —
 * the exercise actually performed (issue #459).
 */
function normalizeGeneratedExerciseId(id: string): string {
  const value = String(id ?? '')
  const marker = '-alternative-'
  const tail = value.split(marker).length - 1 >= 2
    ? value.slice(value.lastIndexOf(marker) + marker.length)
    : value.replace(/-alternative-.+$/u, '')
  return tail
    .replace(/-(extra|replacement)-\d+$/u, '')
    .replace(/-(light|very_light|heavy)$/u, '')
}

function canonicalIdFromName(name: string): string {
  const normalized = String(name ?? '').toLowerCase()
  if (normalized.includes('планк') || normalized.includes('планка') || normalized.includes('plank')) return 'plank'
  if (normalized.includes('dead bug') || normalized.includes('дед баг')) return 'dead-bug'
  return normalized.trim().replace(/\s+/gu, '-')
}
