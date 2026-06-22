/**
 * Unified muscle-group normalizer.
 *
 * Superset of all patterns previously scattered across
 * coachDecision, coachPlanner, coachEngine, coachMemory,
 * coachState, coachToday, and plannedWorkoutGenerator.
 *
 * Returns a canonical key: chest | back | legs | shoulders | arms | core | other
 */

const MUSCLE_ALIASES = [
  {
    key: 'chest',
    match: ['груд', 'жим лёжа', 'bench', 'chest'],
  },
  {
    key: 'back',
    match: ['спин', 'тяга верх', 'row', 'back'],
  },
  {
    key: 'legs',
    match: ['ног', 'квадриц', 'бедр', 'ягод', 'икр', 'присед', 'выпад', 'deadlift', 'leg'],
  },
  {
    key: 'shoulders',
    match: ['плеч', 'дельт', 'shoulder'],
  },
  {
    key: 'arms',
    match: ['бицеп', 'трицеп', 'рук', 'curl', 'arm'],
  },
  {
    key: 'core',
    match: ['кор', 'пресс', 'планк', 'core'],
  },
]

export function normalizeMuscleGroup(text) {
  const normalized = String(text ?? '').toLowerCase()
  for (const alias of MUSCLE_ALIASES) {
    if (alias.match.some((part) => normalized.includes(part))) return alias.key
  }
  return 'other'
}

export const MUSCLE_LABELS = {
  chest: 'Грудь',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  arms: 'Руки',
  core: 'Кор',
  other: 'Другое',
}

export function labelFor(muscleKey) {
  return MUSCLE_LABELS[muscleKey] ?? muscleKey
}

export const CANONICAL_MUSCLE_KEYS = ['back', 'chest', 'legs', 'shoulders', 'arms', 'core']