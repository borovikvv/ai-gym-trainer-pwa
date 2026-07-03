import { describe, expect, it } from 'vitest'
import {
  estimateE1RM,
  bestE1RMFromExercise,
  buildExerciseE1RMHistory,
  buildAllExerciseE1RMHistories,
  sparklineData,
  trendDescription,
  type E1RMDataPoint,
  type ExerciseE1RMHistory,
} from './estimatedOneRepMax'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  date: string,
  exercises: Array<{
    exerciseId: string
    exerciseName: string
    muscleGroup?: string
    sets: Array<{ weight: number; reps: number; rpe?: number; completed?: boolean }>
  }>,
) {
  return { completedAt: date, exercises }
}

// ---------------------------------------------------------------------------
// estimateE1RM
// ---------------------------------------------------------------------------

describe('estimateE1RM', () => {
  it('calculates e1RM for a single rep (slight Helms correction)', () => {
    // Helms formula adds a small correction even at 1 rep: 100 × (1 + 1/40) = 102.5
    expect(estimateE1RM(100, 1)).toBe(102.5)
  })

  it('calculates e1RM for classic moderate-rep set', () => {
    // 80 kg × 5 reps → 80 × (1 + 5/40) = 80 × 1.125 = 90
    expect(estimateE1RM(80, 5)).toBe(90)
  })

  it('calculates e1RM for 10 reps', () => {
    // 60 × 10 → 60 × (1 + 10/40) = 60 × 1.25 = 75
    expect(estimateE1RM(60, 10)).toBe(75)
  })

  it('returns 0 for zero weight', () => {
    expect(estimateE1RM(0, 8)).toBe(0)
  })

  it('returns 0 for negative weight', () => {
    expect(estimateE1RM(-50, 8)).toBe(0)
  })

  it('returns 0 for zero reps', () => {
    expect(estimateE1RM(80, 0)).toBe(0)
  })

  it('returns 0 for negative reps', () => {
    expect(estimateE1RM(80, -3)).toBe(0)
  })

  it('rounds to one decimal place', () => {
    // 55 × 7 = 55 × (1 + 0.175) = 55 × 1.175 = 64.625 → 64.6
    expect(estimateE1RM(55, 7)).toBe(64.6)
  })

  it('handles high rep counts gracefully (e.g. 20 reps)', () => {
    // 40 × 20 → 40 × (1 + 0.5) = 60
    expect(estimateE1RM(40, 20)).toBe(60)
  })

  it('handles decimal weight', () => {
    // 7.5 × 12 → 7.5 × (1 + 0.3) = 7.5 × 1.3 = 9.75 → 9.8 (rounded)
    expect(estimateE1RM(7.5, 12)).toBe(9.8)
  })
})

// ---------------------------------------------------------------------------
// bestE1RMFromExercise
// ---------------------------------------------------------------------------

describe('bestE1RMFromExercise', () => {
  it('returns the best e1RM from multiple sets', () => {
    const exercise = {
      sets: [
        { weight: 60, reps: 8, completed: true },   // e1RM = 72
        { weight: 65, reps: 6, completed: true },   // e1RM = 74.75
        { weight: 70, reps: 4, completed: true },   // e1RM = 77
      ],
    }
    const result = bestE1RMFromExercise(exercise)
    expect(result).not.toBeNull()
    expect(result!.e1rm).toBe(77)
    expect(result!.weight).toBe(70)
    expect(result!.reps).toBe(4)
  })

  it('returns null for empty sets array', () => {
    const result = bestE1RMFromExercise({ sets: [] })
    expect(result).toBeNull()
  })

  it('returns null for sets with zero or negative reps', () => {
    const result = bestE1RMFromExercise({
      sets: [
        { weight: 80, reps: 0 },
        { weight: 80, reps: -2 },
      ],
    })
    expect(result).toBeNull()
  })

  it('skips sets with zero reps even when completed flag is truthy', () => {
    const result = bestE1RMFromExercise({
      sets: [
        { weight: 80, reps: 0, completed: true },
      ],
    })
    expect(result).toBeNull()
  })

  it('includes RPE when present', () => {
    const exercise = {
      sets: [
        { weight: 80, reps: 5, rpe: 8 },
      ],
    }
    const result = bestE1RMFromExercise(exercise)
    expect(result!.rpe).toBe(8)
  })

  it('sets RPE to null when absent', () => {
    const exercise = {
      sets: [
        { weight: 80, reps: 5 },
      ],
    }
    const result = bestE1RMFromExercise(exercise)
    expect(result!.rpe).toBeNull()
  })

  it('returns date as empty string (caller must fill)', () => {
    const result = bestE1RMFromExercise({
      sets: [{ weight: 80, reps: 5 }],
    })
    expect(result!.date).toBe('')
  })

  it('handles undefined sets gracefully', () => {
    // @ts-expect-error — testing defensive behavior
    const result = bestE1RMFromExercise({})
    expect(result).toBeNull()
  })

  it('picks set with higher e1RM even if weight is lower', () => {
    // 50 kg × 10 reps → e1RM = 62.5
    // 60 kg × 5 reps → e1RM = 67.5
    const exercise = {
      sets: [
        { weight: 50, reps: 10 },
        { weight: 60, reps: 5 },
      ],
    }
    const result = bestE1RMFromExercise(exercise)
    expect(result!.e1rm).toBe(67.5)
    expect(result!.weight).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// buildExerciseE1RMHistory
// ---------------------------------------------------------------------------

describe('buildExerciseE1RMHistory', () => {
  it('builds history with sorted data points', () => {
    const history = [
      makeSession('2025-06-15', [
        { exerciseId: 'squat', exerciseName: 'Присед', muscleGroup: 'Ноги', sets: [{ weight: 80, reps: 5 }] },
      ]),
      makeSession('2025-06-01', [
        { exerciseId: 'squat', exerciseName: 'Присед', muscleGroup: 'Ноги', sets: [{ weight: 70, reps: 5 }] },
      ]),
    ]

    const result = buildExerciseE1RMHistory('squat', 'Присед', 'Ноги', history)

    expect(result.exerciseId).toBe('squat')
    expect(result.exerciseName).toBe('Присед')
    expect(result.muscleGroup).toBe('Ноги')
    expect(result.dataPoints).toHaveLength(2)
    // Oldest first
    expect(result.dataPoints[0].date).toBe('2025-06-01')
    expect(result.dataPoints[1].date).toBe('2025-06-15')
  })

  it('computes currentBest as max e1RM across all data points', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'bp', exerciseName: 'Жим лёжа', sets: [{ weight: 60, reps: 5 }] },
      ]),
      makeSession('2025-06-15', [
        { exerciseId: 'bp', exerciseName: 'Жим лёжа', sets: [{ weight: 65, reps: 5 }] },
      ]),
    ]

    const result = buildExerciseE1RMHistory('bp', 'Жим лёжа', 'Грудь', history)

    // 60×5 → 67.5, 65×5 → 73.125 → 73.1
    expect(result.currentBest).toBe(73.1)
  })

  it('returns 0 currentBest and empty dataPoints when exercise never performed', () => {
    const result = buildExerciseE1RMHistory('unknown', '?', '?', [])
    expect(result.dataPoints).toHaveLength(0)
    expect(result.currentBest).toBe(0)
  })

  it('skips sessions without completedAt', () => {
    const history = [
      { completedAt: '', exercises: [{ exerciseId: 'squat', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] }] },
    ]
    const result = buildExerciseE1RMHistory('squat', 'Присед', 'Ноги', history)
    expect(result.dataPoints).toHaveLength(0)
  })

  it('computes trend with insufficient_data for < 3 points', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'squat', exerciseName: 'Присед', sets: [{ weight: 70, reps: 5 }] },
      ]),
    ]
    const result = buildExerciseE1RMHistory('squat', 'Присед', 'Ноги', history)
    expect(result.trend.direction).toBe('insufficient_data')
    expect(result.trend.dataPointCount).toBe(1)
  })

  it('computes an upward trend when e1RM increases over time', () => {
    const history = [
      makeSession('2025-06-01', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 60, reps: 5 }] }]),
      makeSession('2025-06-08', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 65, reps: 5 }] }]),
      makeSession('2025-06-15', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 70, reps: 5 }] }]),
    ]
    const result = buildExerciseE1RMHistory('sq', 'Присед', 'Ноги', history)
    expect(result.trend.direction).toBe('up')
    expect(result.trend.slopePerWeek).toBeGreaterThan(0)
  })

  it('computes a downward trend when e1RM decreases', () => {
    const history = [
      makeSession('2025-06-01', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] }]),
      makeSession('2025-06-08', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 75, reps: 5 }] }]),
      makeSession('2025-06-15', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 70, reps: 5 }] }]),
    ]
    const result = buildExerciseE1RMHistory('sq', 'Присед', 'Ноги', history)
    expect(result.trend.direction).toBe('down')
    expect(result.trend.slopePerWeek).toBeLessThan(0)
  })

  it('computes a flat trend when e1RM is stable', () => {
    const history = [
      makeSession('2025-06-01', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] }]),
      makeSession('2025-06-08', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] }]),
      makeSession('2025-06-15', [{ exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] }]),
    ]
    const result = buildExerciseE1RMHistory('sq', 'Присед', 'Ноги', history)
    expect(result.trend.direction).toBe('flat')
    expect(result.trend.slopePerWeek).toBe(0)
  })

  it('uses the best set per session (not the last set)', () => {
    const history = [
      makeSession('2025-06-01', [
        {
          exerciseId: 'bp', exerciseName: 'Жим',
          sets: [
            { weight: 50, reps: 8 },  // e1RM = 60
            { weight: 60, reps: 5 },  // e1RM = 67.5 ← best
            { weight: 55, reps: 6 },  // e1RM = 63.25
          ],
        },
      ]),
    ]
    const result = buildExerciseE1RMHistory('bp', 'Жим', 'Грудь', history)
    expect(result.dataPoints).toHaveLength(1)
    expect(result.dataPoints[0].e1rm).toBe(67.5)
  })
})

// ---------------------------------------------------------------------------
// buildAllExerciseE1RMHistories
// ---------------------------------------------------------------------------

describe('buildAllExerciseE1RMHistories', () => {
  it('builds histories for multiple exercises', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'sq', exerciseName: 'Присед', muscleGroup: 'Ноги', sets: [{ weight: 80, reps: 5 }] },
        { exerciseId: 'bp', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', sets: [{ weight: 60, reps: 5 }] },
      ]),
    ]

    const results = buildAllExerciseE1RMHistories(history)
    expect(results).toHaveLength(2)

    const ids = results.map((r) => r.exerciseId).sort()
    expect(ids).toEqual(['bp', 'sq'])
  })

  it('sorts results by most recent data point first', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] },
      ]),
      makeSession('2025-06-15', [
        { exerciseId: 'bp', exerciseName: 'Жим лёжа', sets: [{ weight: 60, reps: 5 }] },
      ]),
    ]

    const results = buildAllExerciseE1RMHistories(history)
    // Жим (June 15) should come before Присед (June 01)
    expect(results[0].exerciseId).toBe('bp')
    expect(results[1].exerciseId).toBe('sq')
  })

  it('aggregates multiple sessions for the same exercise', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 70, reps: 5 }] },
      ]),
      makeSession('2025-06-15', [
        { exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] },
      ]),
    ]

    const results = buildAllExerciseE1RMHistories(history)
    expect(results).toHaveLength(1)
    expect(results[0].dataPoints).toHaveLength(2)
  })

  it('returns empty array for empty history', () => {
    expect(buildAllExerciseE1RMHistories([])).toEqual([])
  })

  it('skips exercises without exerciseId', () => {
    const history = [
      makeSession('2025-06-01', [
        // @ts-expect-error — testing missing exerciseId
        { exerciseName: 'Присед', sets: [{ weight: 80, reps: 5 }] },
      ]),
    ]
    const results = buildAllExerciseE1RMHistories(history)
    expect(results).toHaveLength(0)
  })

  it('preserves muscleGroup from the first occurrence', () => {
    const history = [
      makeSession('2025-06-01', [
        { exerciseId: 'sq', exerciseName: 'Присед', muscleGroup: 'Ноги', sets: [{ weight: 80, reps: 5 }] },
      ]),
      makeSession('2025-06-15', [
        { exerciseId: 'sq', exerciseName: 'Присед', sets: [{ weight: 85, reps: 5 }] },
      ]),
    ]
    const results = buildAllExerciseE1RMHistories(history)
    expect(results[0].muscleGroup).toBe('Ноги')
  })
})

// ---------------------------------------------------------------------------
// sparklineData
// ---------------------------------------------------------------------------

describe('sparklineData', () => {
  const makeHistory = (points: E1RMDataPoint[]): ExerciseE1RMHistory => ({
    exerciseId: 'test',
    exerciseName: 'Test',
    muscleGroup: 'Test',
    dataPoints: points,
    currentBest: Math.max(...points.map((p) => p.e1rm), 0),
    trend: { direction: 'insufficient_data', slopePerWeek: 0, dataPointCount: points.length },
  })

  it('returns indexed { x, y } pairs', () => {
    const history = makeHistory([
      { date: '2025-06-01', e1rm: 60, weight: 50, reps: 5, rpe: null },
      { date: '2025-06-08', e1rm: 65, weight: 52, reps: 5, rpe: null },
      { date: '2025-06-15', e1rm: 70, weight: 55, reps: 5, rpe: null },
    ])

    const sparkline = sparklineData(history)
    expect(sparkline).toEqual([
      { x: 0, y: 60 },
      { x: 1, y: 65 },
      { x: 2, y: 70 },
    ])
  })

  it('limits to maxPoints (default 12)', () => {
    const points: E1RMDataPoint[] = Array.from({ length: 20 }, (_, i) => ({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      e1rm: 60 + i,
      weight: 50,
      reps: 5,
      rpe: null,
    }))
    const history = makeHistory(points)

    const sparkline = sparklineData(history)
    expect(sparkline).toHaveLength(12)
    // Should be the LAST 12 points
    expect(sparkline[0].y).toBe(68) // index 8 → 60+8
  })

  it('respects custom maxPoints', () => {
    const points: E1RMDataPoint[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      e1rm: 60 + i,
      weight: 50,
      reps: 5,
      rpe: null,
    }))
    const history = makeHistory(points)

    const sparkline = sparklineData(history, 5)
    expect(sparkline).toHaveLength(5)
    expect(sparkline[0].y).toBe(65) // last 5 → indices 5..9
  })

  it('returns empty array for empty dataPoints', () => {
    const history = makeHistory([])
    expect(sparklineData(history)).toEqual([])
  })

  it('returns single point when only one data point', () => {
    const history = makeHistory([
      { date: '2025-06-01', e1rm: 80, weight: 60, reps: 5, rpe: 7 },
    ])
    const sparkline = sparklineData(history)
    expect(sparkline).toEqual([{ x: 0, y: 80 }])
  })
})

// ---------------------------------------------------------------------------
// trendDescription
// ---------------------------------------------------------------------------

describe('trendDescription', () => {
  it('returns "мало данных" for insufficient_data', () => {
    expect(trendDescription({ direction: 'insufficient_data', slopePerWeek: 0, dataPointCount: 2 }))
      .toBe('мало данных')
  })

  it('returns positive slope for upward trend', () => {
    expect(trendDescription({ direction: 'up', slopePerWeek: 1.5, dataPointCount: 5 }))
      .toBe('+1.5 кг/нед')
  })

  it('returns negative slope for downward trend', () => {
    expect(trendDescription({ direction: 'down', slopePerWeek: -0.8, dataPointCount: 4 }))
      .toBe('-0.8 кг/нед')
  })

  it('returns "стабильно" for flat trend', () => {
    expect(trendDescription({ direction: 'flat', slopePerWeek: 0, dataPointCount: 6 }))
      .toBe('стабильно')
  })

  it('handles zero slope on flat even if direction is technically flat', () => {
    expect(trendDescription({ direction: 'flat', slopePerWeek: 0.05, dataPointCount: 3 }))
      .toBe('стабильно')
  })
})