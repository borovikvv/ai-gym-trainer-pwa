/**
 * Unified muscle-group normalizer.
 *
 * Superset of all patterns previously scattered across
 * coachDecision, coachPlanner, coachEngine, coachMemory,
 * coachState, coachToday, and plannedWorkoutGenerator.
 *
 * Returns a canonical key: shoulders | chest | back | legs | arms | core | other
 *
 * Order matters: more specific groups must be checked before broader ones.
 * For example, 'Жим Арнольда' contains both 'жим' (chest alias) and
 * 'арнольд' (shoulders alias). We want it to land in 'shoulders', so
 * the shoulders group is checked first.
 */

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

/**
 * Lowercase Russian label for use mid-sentence (e.g. 'грудь ещё не восстановилась').
 * Replaces the previously duplicated local 'muscleLabel' helper in coachPlanner.
 */
export function labelForLower(muscleKey) {
  return labelFor(muscleKey).toLowerCase()
}

export const CANONICAL_MUSCLE_KEYS = ['back', 'chest', 'legs', 'shoulders', 'arms', 'core']