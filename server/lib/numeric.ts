/**
 * Shared numeric / time helpers used by coachMemory and coachState.
 * Extracted to eliminate byte-identical copies (issue #150).
 */

export function completedSetsOf(exercise: { sets?: Array<{ completed?: boolean; reps?: number }> }): Array<{ completed?: boolean; reps?: number; weight?: number; rpe?: number }> {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0) as Array<{ completed?: boolean; reps?: number; weight?: number; rpe?: number }>
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

export function roundNumber(value: unknown): number {
  return Number(Number(value).toFixed(1))
}
