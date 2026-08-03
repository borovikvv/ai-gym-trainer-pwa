/**
 * Unified muscle-group normalizer — single source of truth shared by the
 * server (server/) and the client (src/). Previously duplicated in
 * server/lib/muscleGroups.js and src/lib/muscleGroups.ts (issue #147).
 *
 * Returns a canonical key: shoulders | chest | back | legs | arms | core | other
 *
 * Order matters: more specific groups must be checked before broader ones.
 * For example, 'Жим Арнольда' contains both 'жим' (chest alias) and
 * 'арнольд' (shoulders alias). We want it to land in 'shoulders', so
 * the shoulders group is checked first.
 */

import type { MuscleKey } from './types.js'

export type { MuscleKey }

const MUSCLE_ALIASES = [
  {
    key: 'shoulders',
    // 'арнольд' must be matched before 'жим' (chest) — Arnold press is a
    // shoulders exercise, not chest. Order in this array solves it.
    // 'lateral' covers lateral raises. 'side' alone is too generic.
    match: ['плеч', 'дельт', 'shoulder', 'арнольд', 'lateral', 'overhead'],
  },
  {
    key: 'legs',
    // Must be checked BEFORE chest so 'Жим ногами' (which contains both
    // 'ног' and 'жим') lands here, not in chest. Note: 'deadlift' is NOT
    // here — it is in the back group (deadlift is traditionally a back
    // exercise). Romanian deadlift (RDL) would still match via 'бедр'/'ягод'.
    match: ['ног', 'квадриц', 'бедр', 'ягод', 'икр', 'присед', 'выпад', 'leg', 'squat', 'lunge'],
  },
  {
    key: 'chest',
    // 'жим' covers: жим лёжа, жим гантелей, жим штанги, жим Арнольда (но
    // арнольд уже отсечён предыдущей группой). 'жим лёжа' оставлен для
    // явности, хотя и избыточен.
    match: ['груд', 'жим', 'bench', 'chest', 'fly', 'разведения'],
  },
  {
    key: 'back',
    // 'тяга' covers: становая тяга, тяга верхнего блока, тяга штанги в
    // наклоне. 'становая' добавлена явно для русского названия deadlift.
    // 'тяга верх' оставлен для явности.
    match: ['спин', 'тяга', 'row', 'back', 'deadlift', 'становая'],
  },
  {
    key: 'arms',
    match: ['бицеп', 'трицеп', 'рук', 'curl', 'arm', 'bicep', 'tricep'],
  },
  {
    key: 'core',
    match: ['кор', 'пресс', 'планк', 'plank', 'core'],
  },
] as const

/**
 * Detect "assisted" exercises where the weight counter-intuitively
 * DECREASES as the user gets stronger.
 *
 * Examples: Gravitron pull-ups (counterweight), assisted dips.
 * On these machines the "weight" is the assistance — less assistance =
 * more body weight lifted = harder. So progression means subtracting
 * weightStep, not adding it.
 *
 * Used by progression logic and UI text generators to avoid saying
 * "повышать вес" for assisted exercises.
 */
export function isAssistedExercise(name: string | null | undefined): boolean {
  const normalized = String(name ?? '').toLowerCase()
  return normalized.includes('гравитрон') || normalized.includes('assisted')
}

/**
 * Alias for isAssistedExercise, kept for server-side callers that
 * historically used the `...Name` suffix.
 */
export const isAssistedExerciseName = isAssistedExercise

/**
 * Detect exercises measured in SECONDS, not repetitions (plank, dead bug).
 * Their `reps` field holds seconds, so any rep-based arithmetic — including
 * the bodyweight rep progression of #192 — has to use its own step and
 * ceiling for them.
 *
 * Issue #192: одна реализация вместо трёх копий регулярок (была в
 * src/domain/exerciseMetrics.ts и приватно в plannedWorkoutService.ts).
 * Принимает свободный текст: имя, id, группу мышц или их склейку.
 */
export function isTimedExerciseName(text: string | null | undefined): boolean {
  const normalized = String(text ?? '').toLowerCase().replace(/\s+/g, ' ')
  return ['планк', 'plank', 'дед баг', 'дедбаг', 'dead bug', 'deadbug'].some((part) => normalized.includes(part))
}

export function normalizeMuscleGroup(text: string | null | undefined): MuscleKey {
  const normalized = String(text ?? '').toLowerCase()
  for (const alias of MUSCLE_ALIASES) {
    if (alias.match.some((part) => normalized.includes(part))) {
      return alias.key
    }
  }
  return 'other'
}

// `other` is included so labelFor('other') resolves server-side (the client
// relies on the Record<string,string> fallback in labelFor instead).
export const MUSCLE_LABELS: Record<MuscleKey, string> = {
  chest: 'Грудь',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  arms: 'Руки',
  core: 'Кор',
  other: 'Другое',
}

export function labelFor(muscleKey: string): string {
  return (MUSCLE_LABELS as Record<string, string>)[muscleKey] ?? muscleKey
}

/**
 * Lowercase Russian label for use mid-sentence
 * (e.g. 'грудь ещё не восстановилась').
 */
export function labelForLower(muscleKey: string): string {
  return labelFor(muscleKey).toLowerCase()
}

export const CANONICAL_MUSCLE_KEYS = ['back', 'chest', 'legs', 'shoulders', 'arms', 'core'] as const
