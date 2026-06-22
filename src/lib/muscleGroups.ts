/**
 * Client-side muscle group helpers.
 *
 * Mirrors server/lib/muscleGroups.js patterns and API so that muscle-group
 * classification is identical on both sides. Order matters: more specific
 * groups must be checked before broader ones (see comments in MUSCLE_ALIASES).
 */

const MUSCLE_ALIASES = [
  {
    key: 'shoulders',
    match: ['плеч', 'дельт', 'shoulder', 'арнольд', 'lateral', 'overhead'],
  },
  {
    key: 'legs',
    match: ['ног', 'квадриц', 'бедр', 'ягод', 'икр', 'присед', 'выпад', 'leg', 'squat', 'lunge'],
  },
  {
    key: 'chest',
    match: ['груд', 'жим', 'bench', 'chest', 'fly', 'разведения'],
  },
  {
    key: 'back',
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

export type MuscleKey = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'other'

export function normalizeMuscleGroup(text: string | null | undefined): MuscleKey {
  const normalized = String(text ?? '').toLowerCase()
  for (const alias of MUSCLE_ALIASES) {
    if (alias.match.some((part) => normalized.includes(part))) {
      return alias.key
    }
  }
  return 'other'
}

export const MUSCLE_LABELS: Record<Exclude<MuscleKey, 'other'>, string> = {
  chest: 'Грудь',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  arms: 'Руки',
  core: 'Кор',
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
