import { describe, expect, it } from 'vitest'
import { computeMesocycleState, isDeloadWeek, applyDeloadReduction } from './mesocycle.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a completed workout session on a specific date.
 */
function session(date, extras = {}) {
  return { id: `s-${date}`, completedAt: date, exercises: [], ...extras }
}

/**
 * Create a batch of sessions, one per ISO week, going backwards from baseDate.
 * Each week gets `perWeek` sessions spaced 2 days apart within that week.
 * @param {string} baseDate ISO date for the most recent workout
 * @param {number} totalWeeks how many ISO weeks to fill
 * @param {number} perWeek sessions per week (default 1)
 */
function generateWeeklySessions(baseDate, totalWeeks, perWeek = 1) {
  const sessions = []
  const base = new Date(baseDate)
  // Start from Monday of the base date's ISO week
  const day = base.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const weekMonday = new Date(base)
  weekMonday.setDate(base.getDate() + mondayOffset)

  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = new Date(weekMonday.getTime() - w * 7 * 86_400_000)
    for (let s = 0; s < perWeek; s++) {
      const d = new Date(weekStart.getTime() + s * 2 * 86_400_000)
      sessions.push(session(d.toISOString()))
    }
  }
  return sessions
}

// ---------------------------------------------------------------------------
// computeMesocycleState — basic cycle structure
// ---------------------------------------------------------------------------

describe('computeMesocycleState', () => {
  it('returns adult config (4+1 cycle) with weekInCycle 0 for empty history', () => {
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3 },
      history: [],
      now: '2026-06-15T12:00:00Z',
    })

    // No history → weekInCycle stays 0
    expect(result.weekInCycle).toBe(0)
    expect(result.cycleLength).toBe(5)  // 4 loading + 1 deload
    expect(result.loadingWeeks).toBe(4)
    expect(result.deloadWeeks).toBe(1)
    // weekInCycle 0 → loadingPhaseName(0, 4) → 'idle' (no history yet)
    expect(result.phase).toBe('idle')
    expect(result.isDeload).toBe(false)
    expect(result.deloadScheduled).toBe(false)
    expect(result.workoutsThisCycle).toBe(0)
    expect(result.plannedWorkoutsThisCycle).toBe(0)
  })

  it('uses teen config (3+1 cycle) for users under 18', () => {
    const result = computeMesocycleState({
      profile: { age: 16, workoutsPerWeek: 3 },
      history: [],
      now: '2026-06-15T12:00:00Z',
    })

    expect(result.cycleLength).toBe(4)  // 3 loading + 1 deload
    expect(result.loadingWeeks).toBe(3)
    expect(result.deloadWeeks).toBe(1)
  })

  it('uses mature_adult config (3+1 cycle) for users 40+', () => {
    const result = computeMesocycleState({
      profile: { age: 45, workoutsPerWeek: 3 },
      history: [],
      now: '2026-06-15T12:00:00Z',
    })

    expect(result.cycleLength).toBe(4)
    expect(result.loadingWeeks).toBe(3)
  })

  it('uses adult config (4+1 cycle) for users 18–39', () => {
    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history: [],
      now: '2026-06-15T12:00:00Z',
    })

    expect(result.cycleLength).toBe(5)
    expect(result.loadingWeeks).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Phase names
// ---------------------------------------------------------------------------

describe('computeMesocycleState — phase names', () => {
  it('returns "loading" for week 1 of cycle', () => {
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3 },
      history: [session('2026-06-15T12:00:00Z')],
      now: '2026-06-15T18:00:00Z',
    })
    // 1 week of data → weekInCycle = 1 → "loading"
    expect(result.phase).toBe('loading')
    expect(result.phaseDescription).toContain('Загрузка')
  })

  it('returns "accumulation" for week 2 of a 4-week loading cycle (adult)', () => {
    const history = [
      session('2026-06-15T12:00:00Z'),
      session('2026-06-08T12:00:00Z'),
    ]
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })
    // weekInCycle = 2, loadingWeeks = 4 → accumulation
    expect(result.phase).toBe('accumulation')
    expect(result.phaseDescription).toContain('Накопление')
  })

  it('returns "intensification" for the last loading week (adult week 4)', () => {
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 4, 3)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })
    expect(result.phase).toBe('intensification')
    expect(result.phaseDescription).toContain('Интенсификация')
  })

  it('returns "deload" when weekInCycle exceeds loadingWeeks', () => {
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 5, 3)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })
    // 5 weeks of data for a 5-week cycle → deload
    expect(result.isDeload).toBe(true)
    expect(result.phase).toBe('deload')
    expect(result.phaseDescription).toContain('Разгрузочная')
  })
})

// ---------------------------------------------------------------------------
// Completion ratio and deload delay
// ---------------------------------------------------------------------------

describe('computeMesocycleState — deload delay', () => {
  it('delays deload when completion ratio is below 50%', () => {
    // 5 weeks, but only 1 session per week with 3/week planned = 33% → delay
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 5, 1)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // Completion ratio should be low (1/3 per week = 33%)
    expect(result.completionRatio).toBeLessThan(0.5)
    // weekInCycle = 5 > loadingWeeks 4 → deload position, but delay should kick in
    expect(result.weekInCycle).toBe(5)
    expect(result.isDeload).toBe(false)
    expect(result.triggerReason).toContain('продлена')
  })

  it('proceeds with deload when completion ratio is above 50%', () => {
    // 5 weeks × 3/week = 15 planned, 15 workouts done → 100% → no delay
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 5, 3)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // At week 5 with full completion → deload proceeds normally
    expect(result.isDeload).toBe(true)
    expect(result.triggerReason).not.toContain('продлена')
  })

  it('reports correct completionRatio for same-week workouts', () => {
    // All 3 sessions in the same ISO week (Jun 15 Mon – Jun 21 Sun)
    const history = [
      session('2026-06-15T12:00:00Z'),
      session('2026-06-16T12:00:00Z'),
      session('2026-06-17T12:00:00Z'),
    ]
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-17T18:00:00Z',
    })

    expect(result.plannedWorkoutsThisCycle).toBe(3)
    expect(result.workoutsThisCycle).toBe(3)
    expect(result.completionRatio).toBeCloseTo(1.0, 1)
  })

  it('reports correct completionRatio across multiple weeks', () => {
    // 3 workouts spread across 2 weeks, 3/week planned
    const history = [
      session('2026-06-15T12:00:00Z'),
      session('2026-06-08T12:00:00Z'),
      session('2026-06-05T12:00:00Z'),
    ]
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.plannedWorkoutsThisCycle).toBeGreaterThan(0)
    expect(result.workoutsThisCycle).toBe(3)
    expect(result.completionRatio).toBeCloseTo(3 / result.plannedWorkoutsThisCycle, 2)
  })
})

// ---------------------------------------------------------------------------
// deloadScheduled flag
// ---------------------------------------------------------------------------

describe('computeMesocycleState — deloadScheduled', () => {
  it('sets deloadScheduled when on the last loading week', () => {
    // For teen (3 loading weeks): 3 weeks of data with good completion
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 3, 2)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 2, age: 16 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // weekInCycle = 3 = loadingWeeks for teen → deloadScheduled
    expect(result.weekInCycle).toBe(3)
    expect(result.deloadScheduled).toBe(true)
  })

  it('does not set deloadScheduled during deload week', () => {
    // 4-week teen cycle: week 4 = deload
    const history = generateWeeklySessions('2026-06-15T12:00:00Z', 4, 2)
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 2, age: 16 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.isDeload).toBe(true)
    expect(result.deloadScheduled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Early deload triggers
// ---------------------------------------------------------------------------

describe('computeMesocycleState — early deload triggers', () => {
  it('triggers early deload when 2+ muscle groups are at/above MRV', () => {
    // Set chest and back to MRV-level set counts (adult: chest MRV=16, back MRV=18)
    const coachMemory = {
      weeklyBalance: {
        muscleSetCounts: {
          chest: 17,   // above MRV (16)
          back: 18,    // at MRV (18, since < mrv+2 = 20)
          legs: 10,
          shoulders: 5,
          arms: 4,
          core: 2,
        },
      },
    }

    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history: [session('2026-06-15T12:00:00Z')],
      coachMemory,
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.isDeload).toBe(true)
    expect(result.triggerReason).toContain('Раннее начало разгрузки')
    expect(result.triggerReason).toContain('MRV')
  })

  it('triggers early deload when 2+ pain sessions in the current cycle', () => {
    const history = [
      session('2026-06-15T12:00:00Z', {
        exercises: [{ exerciseId: 'squat', exerciseName: 'Присед', pain: true, sets: [] }],
      }),
      session('2026-06-08T12:00:00Z', {
        exercises: [{ exerciseId: 'bp', exerciseName: 'Жим', pain: true, sets: [] }],
      }),
    ]

    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.isDeload).toBe(true)
    expect(result.triggerReason).toContain('болью')
  })

  it('does NOT trigger early deload with only 1 pain session', () => {
    const history = [
      session('2026-06-15T12:00:00Z', {
        exercises: [{ exerciseId: 'squat', exerciseName: 'Присед', pain: true, sets: [] }],
      }),
    ]

    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // Should not be deloaded — only 1 pain session (< 2 threshold)
    expect(result.isDeload).toBe(false)
  })

  it('does NOT trigger early deload when only 1 muscle group is at MRV', () => {
    const coachMemory = {
      weeklyBalance: {
        muscleSetCounts: {
          chest: 17,   // above MRV
          back: 10,
          legs: 10,
          shoulders: 5,
          arms: 4,
          core: 2,
        },
      },
    }

    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history: [session('2026-06-15T12:00:00Z')],
      coachMemory,
      now: '2026-06-15T18:00:00Z',
    })

    // Only 1 group at MRV → no early deload
    expect(result.isDeload).toBe(false)
    expect(result.triggerReason).toBeNull()
  })

  it('early deload overrides deload delay (force takes priority)', () => {
    // Both low completion AND MRV trigger → MRV should win (force = true)
    const coachMemory = {
      weeklyBalance: {
        muscleSetCounts: {
          chest: 17,
          back: 18,
          legs: 10,
          shoulders: 5,
          arms: 4,
          core: 2,
        },
      },
    }
    // Very few workouts → low completion ratio
    const history = [
      session('2026-06-15T12:00:00Z'),
    ]

    const result = computeMesocycleState({
      profile: { age: 25, workoutsPerWeek: 3 },
      history,
      coachMemory,
      now: '2026-06-15T18:00:00Z',
    })

    // Early deload forces deload despite low completion
    expect(result.isDeload).toBe(true)
    expect(result.triggerReason).toContain('Раннее начало разгрузки')
    expect(result.triggerReason).toContain('MRV')
  })
})

// ---------------------------------------------------------------------------
// Cycle reset after gap
// ---------------------------------------------------------------------------

describe('computeMesocycleState — cycle reset on extended break', () => {
  it('resets the cycle after a gap > 10 days between week buckets', () => {
    // Recent workout in W24, then a 3-week gap to W20 (older)
    // W24 end = Jun 21, W20 start = May 18 → gap = (Jun 15 - May 24) = 22 days
    const history = [
      session('2026-06-15T12:00:00Z'),   // W24
      session('2026-05-18T12:00:00Z'),   // W20 — gap > 10 days
      session('2026-05-11T12:00:00Z'),   // W19 — consecutive with W20
    ]

    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // W24 is week 1, gap resets at W20 → W20 is week 1, W19 is week 2
    // Final: weekInCycle = 2 (W19 and W20 are the current cycle)
    expect(result.weekInCycle).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// isDeloadWeek
// ---------------------------------------------------------------------------

describe('isDeloadWeek', () => {
  it('returns true when mesocycle state is deload', () => {
    expect(isDeloadWeek({ isDeload: true })).toBe(true)
  })

  it('returns false when not in deload', () => {
    expect(isDeloadWeek({ isDeload: false })).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isDeloadWeek(null)).toBe(false)
    expect(isDeloadWeek(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applyDeloadReduction
// ---------------------------------------------------------------------------

describe('applyDeloadReduction', () => {
  it('reduces sets to ~60% with minimum of 2', () => {
    const result = applyDeloadReduction({
      setsCount: 4,
      targetWeight: 80,
      repMin: 6,
      repMax: 10,
      weightStep: 2.5,
    })

    // 4 * 0.6 = 2.4 → round to 2
    expect(result.setsCount).toBe(2)
  })

  it('reduces weight by one step', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 8,
      repMax: 12,
      weightStep: 2.5,
    })

    expect(result.targetWeight).toBe(57.5)
  })

  it('does not go below zero weight', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 1.5,
      repMin: 8,
      repMax: 12,
      weightStep: 2.5,
    })

    expect(result.targetWeight).toBe(0)
  })

  it('ensures repMin has a floor of 6', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 4,
      repMax: 6,
      weightStep: 2.5,
    })

    expect(result.repMin).toBe(6)
  })

  it('ensures repMax is at least repMin + 2', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 6,
      repMax: 6,
      weightStep: 2.5,
    })

    expect(result.repMax).toBeGreaterThanOrEqual(result.repMin + 2)
  })

  it('sets intensityTarget to "easy"', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 8,
      repMax: 12,
      weightStep: 2.5,
    })

    expect(result.intensityTarget).toBe('easy')
  })

  it('includes a descriptive deloadNote in Russian', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 8,
      repMax: 12,
      weightStep: 2.5,
    })

    expect(result.deloadNote).toContain('Разгрузка')
    expect(result.deloadNote).toContain('RPE')
  })

  it('defaults weightStep to 2.5 when missing', () => {
    const result = applyDeloadReduction({
      setsCount: 3,
      targetWeight: 60,
      repMin: 8,
      repMax: 12,
    })

    expect(result.targetWeight).toBe(57.5) // 60 - 2.5
  })

  it('handles large set counts correctly', () => {
    const result = applyDeloadReduction({
      setsCount: 6,
      targetWeight: 100,
      repMin: 6,
      repMax: 10,
      weightStep: 5,
    })

    // 6 * 0.6 = 3.6 → round to 4
    expect(result.setsCount).toBe(4)
    expect(result.targetWeight).toBe(95)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeMesocycleState — edge cases', () => {
  it('ignores sessions without completedAt', () => {
    const history = [
      { id: 's1', exercises: [] },  // no completedAt
      session('2026-06-15T12:00:00Z'),
    ]
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.workoutsThisCycle).toBe(1)
  })

  it('defaults workoutsPerWeek to 3 when missing', () => {
    const result = computeMesocycleState({
      profile: {},
      history: [session('2026-06-15T12:00:00Z')],
      now: '2026-06-15T18:00:00Z',
    })

    expect(result.plannedWorkoutsThisCycle).toBe(3)
  })

  it('handles NaN workoutsPerWeek — clampNumber falls back but plannedWorkouts stays 0 without weeks', () => {
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 'abc' },
      history: [],
      now: '2026-06-15T18:00:00Z',
    })

    // With no history, there are no week buckets → plannedWorkoutsThisCycle = 0.
    // The clampNumber fallback for workoutsPerWeek itself works (defaults to 3),
    // but plannedWorkoutsThisCycle is computed inside findCyclePosition which
    // only increments when iterating actual week buckets.
    expect(result.plannedWorkoutsThisCycle).toBe(0)
    // With at least one session, the fallback kicks in:
    const resultWithHistory = computeMesocycleState({
      profile: { workoutsPerWeek: 'abc' },
      history: [session('2026-06-15T12:00:00Z')],
      now: '2026-06-15T18:00:00Z',
    })
    expect(resultWithHistory.plannedWorkoutsThisCycle).toBe(3)
  })

  it('returns phaseDescription matching the phase for empty history', () => {
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3 },
      history: [],
      now: '2026-06-15T12:00:00Z',
    })

    // Empty history → weekInCycle=0 → loadingPhaseName(0,4) → 'idle'
    expect(result.phaseDescription).toBe('Ожидание первой тренировки')
  })

  it('returns phaseDescription matching the phase with actual data', () => {
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3 },
      history: [session('2026-06-15T12:00:00Z')],
      now: '2026-06-15T18:00:00Z',
    })

    // 1 week → weekInCycle=1 → "loading"
    expect(result.phaseDescription).toBe('Загрузка — первую неделю мезоцикла, умеренный объём')
  })

  it('exercises outside 90-day window are ignored', () => {
    const veryOld = new Date('2026-01-01T12:00:00Z')
    const recent = new Date('2026-06-15T12:00:00Z')
    const history = [
      session(recent.toISOString()),
      session(veryOld.toISOString()),
    ]
    const result = computeMesocycleState({
      profile: { workoutsPerWeek: 3, age: 25 },
      history,
      now: '2026-06-15T18:00:00Z',
    })

    // Only the recent workout should count
    expect(result.workoutsThisCycle).toBe(1)
  })
})