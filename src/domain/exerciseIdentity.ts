export type ExerciseIdentityInput = {
  id?: string
  exerciseId?: string
  canonicalExerciseId?: string
  name?: string
}

export function getCanonicalExerciseId(exercise: ExerciseIdentityInput | string): string {
  if (typeof exercise === 'string') return normalizeGeneratedExerciseId(exercise)
  if (exercise.canonicalExerciseId) return exercise.canonicalExerciseId
  const id = exercise.id ?? exercise.exerciseId ?? ''
  const normalizedId = normalizeGeneratedExerciseId(id)
  if (normalizedId) return normalizedId
  return canonicalIdFromName(exercise.name ?? '')
}

function normalizeGeneratedExerciseId(id: string) {
  return String(id)
    .replace(/-(extra|replacement)-\d+$/u, '')
    .replace(/-(light|very_light|heavy)$/u, '')
}

function canonicalIdFromName(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes('планк') || normalized.includes('планка') || normalized.includes('plank')) return 'plank'
  if (normalized.includes('dead bug') || normalized.includes('дед баг')) return 'dead-bug'
  return normalized.trim().replace(/\s+/gu, '-')
}
