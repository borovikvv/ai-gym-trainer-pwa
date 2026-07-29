/**
 * Weight direction — single source of truth for weight arithmetic (issue #173).
 *
 * For most exercises weight is the LOAD: more weight = harder. For assisted
 * machines (gravitron, assisted dips) the "weight" is the counterweight
 * ASSISTANCE: more weight = easier. All progression arithmetic (plan,
 * memory, invariant #136, trend flags, intra-session decisions) must go
 * through these helpers so the direction is handled in exactly one place
 * instead of being re-derived (and lost) at every call site.
 *
 * The direction is a property of the exercise in the library catalog
 * (`exercise_library.weight_direction`). `resolveWeightDirection` prefers
 * the catalog field and falls back to the legacy name match for callers
 * that only have the exercise name.
 */

import { isAssistedExercise } from './muscleGroups.js'

export type WeightDirection = 'load' | 'assistance'

export interface WeightDirectionSource {
  name?: string | null
  weightDirection?: string | null
}

/**
 * Resolve the weight direction for an exercise.
 * Accepts either an object ({ name, weightDirection }) or a bare name string.
 * Catalog field wins; name match is the backward-compatible fallback.
 */
export function resolveWeightDirection(
  exercise: WeightDirectionSource | string | null | undefined,
): WeightDirection {
  if (typeof exercise === 'string') {
    return isAssistedExercise(exercise) ? 'assistance' : 'load'
  }
  const field = exercise?.weightDirection
  if (field === 'load' || field === 'assistance') return field
  return isAssistedExercise(exercise?.name) ? 'assistance' : 'load'
}

/**
 * Weight one step HARDER (progression).
 * load: +step. assistance: −step (less help), clamped at 0.
 */
export function harderWeight(weight: number, step: number, direction: WeightDirection): number {
  const w = Number(weight) || 0
  const s = Math.max(0, Number(step) || 0)
  return direction === 'assistance' ? Math.max(0, w - s) : w + s
}

/**
 * Weight one step EASIER (back-off / deload / low readiness).
 * load: −step, clamped at 0. assistance: +step (more help).
 */
export function easierWeight(weight: number, step: number, direction: WeightDirection): number {
  const w = Number(weight) || 0
  const s = Math.max(0, Number(step) || 0)
  return direction === 'assistance' ? w + s : Math.max(0, w - s)
}

/**
 * The STRONGER of two weights — the one representing more actual work.
 * Used for working-weight memory (#99) and the #136 floor.
 * load: max. assistance: min (less help = stronger).
 */
export function strongerOf(a: number, b: number, direction: WeightDirection): number {
  return direction === 'assistance' ? Math.min(a, b) : Math.max(a, b)
}

/**
 * The EASIER of two weights.
 * load: min. assistance: max (more help = easier).
 */
export function easierOf(a: number, b: number, direction: WeightDirection): number {
  return direction === 'assistance' ? Math.max(a, b) : Math.min(a, b)
}
