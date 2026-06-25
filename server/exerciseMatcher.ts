/**
 * Exercise Matcher — metadata-aware exercise selection
 *
 * Phase 3 issue #13: uses target_muscles, movement_pattern, equipment,
 * exercise_type, and difficulty_level to make focused exercise
 * recommendations instead of relying only on muscle group.
 *
 * Two main use cases:
 *   1. findReplacementForFatigue — replace a fatigued exercise with one
 *      that targets DIFFERENT muscles but same movement pattern
 *   2. findComplementaryExercise — suggest an additional exercise that
 *      targets muscles NOT yet trained in this session
 *
 * Both use a scoring system that rewards:
 *   - Low fatigue on target muscle group (+20)
 *   - Target muscle overlap with what we want (+15 per shared muscle)
 *   - Different movement pattern from current exercises (+10 for variety)
 *   - Equipment variety (+8 if different equipment used so far)
 *   - Compound for main lifts, isolation for accessories (+5)
 *   - Difficulty matching user level (+5)
 *   - Not already used in this workout (+50, hard filter)
 */

import { normalizeMuscleGroup } from './lib/muscleGroups.js'

/** Library exercise with normalized metadata fields used by the matcher. */
interface LibraryExercise {
  id: string
  name: string
  muscleGroup?: string | null
  muscleKey?: string
  targetMuscles?: string[] | null
  movementPattern?: string | null
  equipment?: string | null
  exerciseType?: string | null
  setsCount?: number
  // Issue #66: additional fields used by coachPlanner.findReplacementForFatigue
  targetWeight?: number
  repMin?: number
  repMax?: number
  weightStep?: number
  restSeconds?: number
}

/** Minimal exercise shape for the "current" exercise being replaced. */
interface CurrentExercise {
  id?: string
  name?: string
  muscleGroup?: string | null
  targetMuscles?: string[] | null
  movementPattern?: string | null
  equipment?: string | null
  exerciseType?: string | null
}

interface ScoreReplacementContext {
  currentTargets: Set<string>
  currentPattern: string | null
  currentEquipment: string | null
  coachState: CoachStateForMatcher | null
}

interface ScoreComplementaryContext {
  currentMuscle: string
  nextMuscle: string | null
  trainedTargets: Set<string>
  usedPatterns: Set<string>
  usedEquipment: Set<string>
}

/**
 * Minimal coach state shape consumed by the matcher. The full CoachState
 * interface (shared/types.ts) is a superset; this minimal shape lets the
 * matcher access muscleGroups/exercises/recoveryStatus without depending
 * on issue #65 (coach core) being merged.
 */
interface CoachStateForMatcher {
  recoveryStatus?: string
  muscleGroups?: Record<string, { fatigue?: 'low' | 'medium' | 'high' | 'unknown' } | undefined>
  exercises?: Record<string, { status?: string } | undefined>
}

interface FindComplementaryParams {
  currentExercise: CurrentExercise
  nextExercise?: CurrentExercise | null
  workoutExercises?: CurrentExercise[]
  library: LibraryExercise[]
  limit?: number
}

/**
 * Find the best replacement exercise when the current one's muscle group
 * is highly fatigued.
 */
export function findReplacementForFatigue(
  currentExercise: CurrentExercise,
  library: LibraryExercise[],
  usedExerciseIds: Set<string>,
  coachState: CoachStateForMatcher | null,
): LibraryExercise | null {
  const currentMuscle = normalizeMuscleGroup(`${currentExercise.muscleGroup ?? ''} ${currentExercise.name ?? ''}`)
  const currentGroup = coachState?.muscleGroups?.[currentMuscle]
  if (!currentGroup || currentGroup.fatigue !== 'high') return null
  if (!['low', 'partial'].includes(String(coachState?.recoveryStatus ?? ''))) return null

  const currentTargets = new Set((currentExercise.targetMuscles ?? []).map((t) => t.toLowerCase()))
  const currentPattern = currentExercise.movementPattern ?? null
  const currentEquipment = currentExercise.equipment ?? null

  const candidates = library
    .filter((c) => !usedExerciseIds.has(c.id))
    .filter((c) => c.muscleKey !== currentMuscle)
    .filter((c) => coachState?.muscleGroups?.[c.muscleKey ?? '']?.fatigue !== 'high')
    .map((c) => ({
      exercise: c,
      score: scoreReplacement(c, {
        currentTargets,
        currentPattern,
        currentEquipment,
        coachState,
      }),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)

  return candidates[0]?.exercise ?? null
}

/**
 * Find complementary exercises to suggest during a workout (when the
 * user is ahead of schedule and could add more volume).
 */
export function findComplementaryExercises({
  currentExercise,
  nextExercise = null,
  workoutExercises = [],
  library,
  limit = 3,
}: FindComplementaryParams): LibraryExercise[] {
  const usedIds = new Set(workoutExercises.map((e) => e.id).filter((id): id is string => Boolean(id)))
  const usedNames = new Set(workoutExercises.map((e) => e.name?.toLowerCase()).filter((n): n is string => Boolean(n)))

  const currentMuscle = normalizeMuscleGroup(`${currentExercise.muscleGroup ?? ''} ${currentExercise.name ?? ''}`)
  const nextMuscle = nextExercise ? normalizeMuscleGroup(`${nextExercise.muscleGroup ?? ''} ${nextExercise.name ?? ''}`) : null

  // Collect all target muscles already trained in this session
  const trainedTargets = new Set<string>()
  for (const ex of workoutExercises) {
    for (const t of ex.targetMuscles ?? []) trainedTargets.add(t.toLowerCase())
  }

  // Collect movement patterns and equipment already used
  const usedPatterns = new Set(workoutExercises.map((e) => e.movementPattern).filter((p): p is string => Boolean(p)))
  const usedEquipment = new Set(workoutExercises.map((e) => e.equipment).filter((e): e is string => Boolean(e)))

  return library
    .filter((c) => c?.id && c?.name)
    .filter((c) => !usedIds.has(c.id))
    .filter((c) => !usedNames.has(c.name.toLowerCase()))
    .map((c) => ({
      exercise: c,
      score: scoreComplementary(c, {
        currentMuscle,
        nextMuscle,
        trainedTargets,
        usedPatterns,
        usedEquipment,
      }),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.exercise)
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

function scoreReplacement(
  candidate: LibraryExercise,
  { currentTargets, currentPattern, currentEquipment, coachState }: ScoreReplacementContext,
): number {
  let score = 0

  // Fatigue of candidate's muscle group
  const fatigue = coachState?.muscleGroups?.[candidate.muscleKey ?? '']?.fatigue ?? 'low'
  if (fatigue === 'low') score += 20
  if (fatigue === 'medium') score += 5
  if (fatigue === 'high') return 0 // hard filter

  // Target muscle overlap
  const candidateTargets = new Set((candidate.targetMuscles ?? []).map((t) => t.toLowerCase()))
  let overlap = 0
  for (const t of currentTargets) {
    if (candidateTargets.has(t.toLowerCase())) overlap++
  }
  score += overlap * 10

  // Same movement pattern = better substitute
  if (currentPattern && candidate.movementPattern === currentPattern) {
    score += 12
  }

  // Different equipment = better variety
  if (currentEquipment && candidate.equipment && candidate.equipment !== currentEquipment) {
    score += 8
  }

  // Compound replaces compound
  if (currentExerciseType(candidate) === 'compound') score += 5

  // Accessory groups are good substitutes when main groups are fatigued
  if (['arms', 'shoulders', 'core'].includes(candidate.muscleKey ?? '')) score += 3

  // Fresh exercises get a small boost
  if (coachState?.exercises?.[candidate.id]?.status === 'no_data') score += 4

  // Lower sets count = faster recovery
  if ((candidate.setsCount ?? 0) <= 2) score += 2

  return score
}

function scoreComplementary(
  candidate: LibraryExercise,
  { currentMuscle, nextMuscle, trainedTargets, usedPatterns, usedEquipment }: ScoreComplementaryContext,
): number {
  let score = 0
  const muscle = candidate.muscleKey ?? ''

  // Prefer different muscle group from current AND next exercise
  if (muscle !== currentMuscle && muscle !== nextMuscle) score += 30
  if (muscle === currentMuscle) score -= 10

  // Prefer exercises targeting muscles NOT yet trained
  const candidateTargets = (candidate.targetMuscles ?? []).map((t) => t.toLowerCase())
  const novelTargets = candidateTargets.filter((t) => !trainedTargets.has(t)).length
  score += novelTargets * 8

  // Prefer different movement pattern for variety
  if (candidate.movementPattern && !usedPatterns.has(candidate.movementPattern)) {
    score += 10
  }

  // Prefer different equipment for variety
  if (candidate.equipment && !usedEquipment.has(candidate.equipment)) {
    score += 8
  }

  // Core exercises are good additions
  if (muscle === 'core') score += 8

  // Bodyweight exercises are quick to add
  if (candidate.equipment === 'bodyweight') score += 3

  // Isolation exercises are good complements
  if (candidate.exerciseType === 'isolation') score += 4

  return score
}

function currentExerciseType(exercise: CurrentExercise): string | null {
  return exercise.exerciseType ?? null
}

// Re-exported for callers that need the matcher's coach state shape.
// The full CoachState interface (shared/types.ts) is structurally compatible.
export type { CoachStateForMatcher, LibraryExercise }
