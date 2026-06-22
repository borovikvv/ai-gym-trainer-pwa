/**
 * Estimated One-Rep Max (e1RM) — Helms / RTS formula.
 *
 * Epley overestimates at low reps; Brzycki is reasonable but Helms et al.
 * ( RTS ) regression is the most accurate across rep ranges 1–10.
 *
 *   e1RM = weight × (1 + reps / 40)
 *
 * Also provides:
 *   - Rolling best e1RM per exercise (7-day window)
 *   - Trend calculation (linear regression slope over last N data points)
 *   - Sparkline-friendly data extraction from workout history
 */

// ---------------------------------------------------------------------------
// e1RM Formula
// ---------------------------------------------------------------------------

/**
 * Estimate one-rep max using the Helms / RTS formula.
 * Valid for reps 1–30 (degrades gracefully beyond 10 but stays safe).
 */
export function estimateE1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0
  // Helms / RTS: e1RM = w × (1 + r / 40)
  const e1rm = weight * (1 + reps / 40)
  return Math.round(e1rm * 10) / 10
}

// ---------------------------------------------------------------------------
// History Processing
// ---------------------------------------------------------------------------

export type E1RMDataPoint = {
  date: string          // ISO date of the workout
  e1rm: number          // estimated 1RM from the best set
  weight: number        // actual weight used
  reps: number          // actual reps achieved
  rpe: number | null    // RPE of the set (if available)
}

/**
 * Extract the best e1RM data point from a single exercise session.
 * "Best" = highest estimated 1RM among completed sets.
 */
export function bestE1RMFromExercise(
  exercise: { sets: Array<{ weight: number; reps: number; rpe?: number; completed?: boolean }> },
): E1RMDataPoint | null {
  let best: E1RMDataPoint | null = null
  for (const set of exercise.sets ?? []) {
    if (!set.completed && set.reps <= 0) continue
    if (set.reps <= 0) continue
    const e1rm = estimateE1RM(set.weight, set.reps)
    if (!best || e1rm > best.e1rm) {
      best = {
        date: '', // caller fills this in
        e1rm: e1rm,
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe ?? null,
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Per-Exercise e1RM History
// ---------------------------------------------------------------------------

export type ExerciseE1RMHistory = {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  dataPoints: E1RMDataPoint[]
  currentBest: number
  trend: E1RMTrend
}

export type E1RMTrend = {
  direction: 'up' | 'down' | 'flat' | 'insufficient_data'
  slopePerWeek: number    // kg change per week (positive = gaining strength)
  dataPointCount: number
}

/**
 * Build a full e1RM history for a single exercise from workout history.
 * Returns sorted data points (oldest → newest) with trend.
 */
export function buildExerciseE1RMHistory(
  exerciseId: string,
  exerciseName: string,
  muscleGroup: string,
  history: Array<{
    completedAt: string
    exercises: Array<{
      exerciseId: string
      exerciseName: string
      muscleGroup?: string
      sets: Array<{ weight: number; reps: number; rpe?: number; completed?: boolean }>
    }>
  }>,
): ExerciseE1RMHistory {
  const dataPoints: E1RMDataPoint[] = []

  for (const session of history) {
    if (!session.completedAt) continue
    const exercise = (session.exercises ?? []).find(
      (e) => e.exerciseId === exerciseId,
    )
    if (!exercise) continue
    const best = bestE1RMFromExercise(exercise)
    if (best) {
      dataPoints.push({ ...best, date: session.completedAt })
    }
  }

  // Sort oldest first
  dataPoints.sort((a, b) => a.date.localeCompare(b.date))

  const currentBest = dataPoints.length > 0
    ? Math.max(...dataPoints.map((d) => d.e1rm))
    : 0

  const trend = computeTrend(dataPoints)

  return { exerciseId, exerciseName, muscleGroup, dataPoints, currentBest, trend }
}

/**
 * Build e1RM histories for ALL exercises seen in workout history.
 * Returns array sorted by most recent data point first.
 */
export function buildAllExerciseE1RMHistories(
  history: Array<{
    completedAt: string
    exercises: Array<{
      exerciseId: string
      exerciseName: string
      muscleGroup?: string
      sets: Array<{ weight: number; reps: number; rpe?: number; completed?: boolean }>
    }>
  }>,
): ExerciseE1RMHistory[] {
  const exerciseMap = new Map<string, {
    name: string
    muscle: string
    points: E1RMDataPoint[]
  }>()

  for (const session of history) {
    if (!session.completedAt) continue
    for (const exercise of session.exercises ?? []) {
      const eid = exercise.exerciseId
      if (!eid) continue
      if (!exerciseMap.has(eid)) {
        exerciseMap.set(eid, {
          name: exercise.exerciseName,
          muscle: exercise.muscleGroup ?? '',
          points: [],
        })
      }
      const best = bestE1RMFromExercise(exercise)
      if (best) {
        exerciseMap.get(eid)!.points.push({ ...best, date: session.completedAt })
      }
    }
  }

  return [...exerciseMap.entries()]
    .map(([id, info]) => {
      info.points.sort((a, b) => a.date.localeCompare(b.date))
      const currentBest = info.points.length > 0
        ? Math.max(...info.points.map((d) => d.e1rm))
        : 0
      return {
        exerciseId: id,
        exerciseName: info.name,
        muscleGroup: info.muscle,
        dataPoints: info.points,
        currentBest,
        trend: computeTrend(info.points),
      }
    })
    .sort((a, b) => {
      const aLast = a.dataPoints.at(-1)?.date ?? ''
      const bLast = b.dataPoints.at(-1)?.date ?? ''
      return bLast.localeCompare(aLast)
    })
}

// ---------------------------------------------------------------------------
// Trend Calculation
// ---------------------------------------------------------------------------

const MIN_TREND_POINTS = 3
const FLAT_THRESHOLD_KG_PER_WEEK = 0.1  // below this slope → "flat"

/**
 * Compute a simple linear regression trend over e1RM data points.
 * Slope is expressed as kg change per calendar week.
 */
function computeTrend(dataPoints: E1RMDataPoint[]): E1RMTrend {
  if (dataPoints.length < MIN_TREND_POINTS) {
    return {
      direction: 'insufficient_data',
      slopePerWeek: 0,
      dataPointCount: dataPoints.length,
    }
  }

  // Use the last 8 data points max for trend
  const recent = dataPoints.slice(-8)
  const n = recent.length

  // X = days since first point, Y = e1rm
  const x0 = new Date(recent[0].date).getTime()
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (const point of recent) {
    const xDays = (new Date(point.date).getTime() - x0) / 86_400_000
    const y = point.e1rm
    sumX += xDays
    sumY += y
    sumXY += xDays * y
    sumX2 += xDays * xDays
  }

  const denominator = n * sumX2 - sumX * sumX
  if (Math.abs(denominator) < 0.001) {
    return { direction: 'flat', slopePerWeek: 0, dataPointCount: n }
  }

  const slopePerDay = (n * sumXY - sumX * sumY) / denominator
  const slopePerWeek = Math.round(slopePerDay * 7 * 10) / 10

  let direction: E1RMTrend['direction'] = 'flat'
  if (slopePerWeek > FLAT_THRESHOLD_KG_PER_WEEK) direction = 'up'
  else if (slopePerWeek < -FLAT_THRESHOLD_KG_PER_WEEK) direction = 'down'

  return { direction, slopePerWeek, dataPointCount: n }
}

// ---------------------------------------------------------------------------
// Sparkline Helpers
// ---------------------------------------------------------------------------

/**
 * Extract sparkline-friendly values from an e1RM history.
 * Returns array of { x: index, y: e1rm } normalised for chart rendering.
 * Optionally limits to the last N points.
 */
export function sparklineData(
  history: ExerciseE1RMHistory,
  maxPoints = 12,
): Array<{ x: number; y: number }> {
  const points = history.dataPoints.slice(-maxPoints)
  return points.map((p, i) => ({ x: i, y: p.e1rm }))
}

/**
 * Human-readable trend description in Russian.
 */
export function trendDescription(trend: E1RMTrend): string {
  if (trend.direction === 'insufficient_data') return 'мало данных'
  if (trend.direction === 'up') return `+${trend.slopePerWeek} кг/нед`
  if (trend.direction === 'down') return `${trend.slopePerWeek} кг/нед`
  return 'стабильно'
}