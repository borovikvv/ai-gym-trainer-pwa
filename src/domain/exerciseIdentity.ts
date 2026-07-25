/**
 * Client-side exercise-identity helpers.
 *
 * Issue #147: the implementation lives in shared/exerciseIdentity.ts so
 * server and client share one source of truth. Re-exported here for the
 * existing `../domain/exerciseIdentity` import sites in src/.
 */

export { canonicalExerciseId, getCanonicalExerciseId } from '../../shared/exerciseIdentity'
