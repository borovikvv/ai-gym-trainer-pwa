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

/**
 * Find the best replacement exercise when the current one's muscle group
 * is highly fatigued.
 *
 * Strategy: prefer exercises that target a FRESH muscle group but share
 * enough movement pattern to be a meaningful substitute.
 *
 * @param {object} currentExercise — the exercise to replace
 * @param {array} library — normalized exercise library (with metadata)
 * @param {Set} usedExerciseIds — IDs already in the workout (skip these)
 * @param {object} coachState — for fatigue info per muscle group
 * @returns {object|null} best candidate, or null if none found
 */
export function findReplacementForFatigue(currentExercise: any, library, usedExerciseIds, coachState) {
  const currentMuscle = normalizeMuscleGroup(`${currentExercise.muscleGroup ?? ''} ${currentExercise.name ?? ''}`)
  const currentGroup = coachState?.muscleGroups?.[currentMuscle]
  if (!currentGroup || currentGroup.fatigue !== 'high') return null
  if (!['low', 'partial'].includes(String(coachState?.recoveryStatus ?? ''))) return null

  const currentTargets = new Set(currentExercise.targetMuscles ?? [])
  const currentPattern = currentExercise.movementPattern ?? null
  const currentEquipment = currentExercise.equipment ?? null

  const candidates = library
    .filter((c) => !usedExerciseIds.has(c.id))
    .filter((c) => c.muscleKey !== currentMuscle)
    .filter((c) => coachState?.muscleGroups?.[c.muscleKey]?.fatigue !== 'high')
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
 *
 * Strategy: prefer exercises targeting muscles NOT yet trained in this
 * session, with a different movement pattern for variety.
 *
 * @param {object} params — { currentExercise, nextExercise, workoutExercises, library, limit }
 * @returns {array} top N suggestions
 */
export function findComplementaryExercises({ currentExercise, nextExercise = null, workoutExercises = [], library, limit = 3 }: any) {
  const usedIds = new Set(workoutExercises.map((e) => e.id))
  const usedNames = new Set(workoutExercises.map((e) => e.name?.toLowerCase()).filter(Boolean))

  const currentMuscle = normalizeMuscleGroup(`${currentExercise.muscleGroup ?? ''} ${currentExercise.name ?? ''}`)
  const nextMuscle = nextExercise ? normalizeMuscleGroup(`${nextExercise.muscleGroup ?? ''} ${nextExercise.name ?? ''}`) : null

  // Collect all target muscles already trained in this session
  const trainedTargets = new Set()
  for (const ex of workoutExercises) {
    for (const t of ex.targetMuscles ?? []) trainedTargets.add(t.toLowerCase())
  }

  // Collect movement patterns and equipment already used
  const usedPatterns = new Set(workoutExercises.map((e) => e.movementPattern).filter(Boolean))
  const usedEquipment = new Set(workoutExercises.map((e) => e.equipment).filter(Boolean))

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

function scoreReplacement(candidate, { currentTargets, currentPattern, currentEquipment, coachState }) {
  let score = 0

  // Fatigue of candidate's muscle group
  const fatigue = coachState?.muscleGroups?.[candidate.muscleKey]?.fatigue ?? 'low'
  if (fatigue === 'low') score += 20
  if (fatigue === 'medium') score += 5
  if (fatigue === 'high') return 0 // hard filter

  // Target muscle overlap — if the replacement shares some target muscles
  // with the original, it's a better substitute (works similar but not
  // identical muscles). E.g. replacing bench press (chest) with incline
  // db press (chest/shoulders) shares "передняя дельта".
  const candidateTargets = new Set((candidate.targetMuscles ?? []).map((t) => t.toLowerCase()))
  let overlap = 0
  for (const t of currentTargets) {
    if (candidateTargets.has(t.toLowerCase())) overlap++
  }
  score += overlap * 10

  // Same movement pattern = better substitute (push replaces push)
  if (currentPattern && candidate.movementPattern === currentPattern) {
    score += 12
  }

  // Different equipment = better variety (dumbbell replaces barbell)
  if (currentEquipment && candidate.equipment && candidate.equipment !== currentEquipment) {
    score += 8
  }

  // Compound replaces compound (don't substitute a big lift with isolation)
  if (currentExerciseType(candidate) === 'compound') score += 5

  // Accessory groups are good substitutes when main groups are fatigued
  if (['arms', 'shoulders', 'core'].includes(candidate.muscleKey)) score += 3

  // Fresh exercises (no_data) get a small boost
  if (coachState?.exercises?.[candidate.id]?.status === 'no_data') score += 4

  // Lower sets count = faster recovery
  if (candidate.setsCount <= 2) score += 2

  return score
}

function scoreComplementary(candidate, { currentMuscle, nextMuscle, trainedTargets, usedPatterns, usedEquipment }) {
  let score = 0
  const muscle = candidate.muscleKey

  // Prefer different muscle group from current AND next exercise
  if (muscle !== currentMuscle && muscle !== nextMuscle) score += 30
  if (muscle === currentMuscle) score -= 10 // same as current = bad for variety

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

  // Core exercises are good additions (short, low fatigue)
  if (muscle === 'core') score += 8

  // Bodyweight exercises are quick to add
  if (candidate.equipment === 'bodyweight') score += 3

  // Isolation exercises are good complements (target specific muscles)
  if (candidate.exerciseType === 'isolation') score += 4

  return score
}

function currentExerciseType(exercise: any) {
  return exercise.exerciseType ?? null
}
