import { describe, expect, it } from 'vitest'
import {
  buildMuscleVolumeSnapshot,
  buildAllMuscleVolumeSnapshots,
} from './buildVolumeSnapshot.js'

const NOW = new Date('2026-06-22T12:00:00.000Z')

// Helper: build a session N days ago with a single chest exercise.
function sessionDaysAgo(daysAgo, exercises) {
  const d = new Date(NOW.getTime() - daysAgo * 86_400_000)
  return {
    id: `s-${daysAgo}`,
    completedAt: d.toISOString(),
    exercises,
  }
}

function chestExercise(sets) {
  return {
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    muscleGroup: 'Грудь',
    pain: false,
    sets,
    volume: 0,
    nextRecommendedWeight: 60,
    progressionType: 'hold',
    progressionReason: '',
  }
}

function completedSet(weight = 60, reps = 8) {
  return { weight, reps, rpe: 7, completed: true }
}

describe('buildMuscleVolumeSnapshot', () => {
  it('returns zeros for empty history', () => {
    const snap = buildMuscleVolumeSnapshot('chest', [], [], 'adult', NOW, null)
    expect(snap.weeklySets).toBe(0)
    expect(snap.weeksAtOrAboveMrv).toBe(0)
    expect(snap.weeksBelowMev).toBe(0)
    expect(snap.e1rmTrend).toBe('insufficient_data')
    expect(snap.lastAdjustmentIso).toBeNull()
  })

  it('counts completed sets in the last 7 days', () => {
    // chest adult MEV=6, MAV=12, MRV=16
    const history = [
      sessionDaysAgo(2, [chestExercise([completedSet(), completedSet(), completedSet()])]),
      sessionDaysAgo(4, [chestExercise([completedSet(), completedSet()])]),
    ]
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeklySets).toBe(5)
  })

  it('ignores sessions older than 7 days for weeklySets', () => {
    const history = [
      sessionDaysAgo(3, [chestExercise([completedSet(), completedSet()])]),
      sessionDaysAgo(10, [chestExercise([completedSet(), completedSet(), completedSet()])]), // ignored
    ]
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeklySets).toBe(2)
  })

  it('ignores incomplete sets (reps=0 or completed=false)', () => {
    const history = [
      sessionDaysAgo(2, [chestExercise([
        completedSet(),
        { weight: 60, reps: 0, rpe: 7, completed: true },
        { weight: 60, reps: 8, rpe: 7, completed: false },
      ])]),
    ]
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeklySets).toBe(1)
  })

  it('counts weeksAtOrAboveMrv when 4 consecutive weeks at MRV', () => {
    // chest adult MRV = 16. 4 weeks at 17 sets each.
    const history = []
    for (let w = 0; w < 4; w++) {
      const daysAgo = w * 7 + 3 // mid-week
      const sets = Array.from({ length: 17 }, () => completedSet())
      history.push(sessionDaysAgo(daysAgo, [chestExercise(sets)]))
    }
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeksAtOrAboveMrv).toBe(4)
  })

  it('stops counting weeksAtOrAboveMrv when a week falls below MRV', () => {
    // Week 0: 17 sets (>= MRV=16) → count
    // Week 1: 17 sets → count
    // Week 2: 10 sets (< MRV) → stop
    // Week 3: 17 sets → ignored (broken streak)
    const history = [
      sessionDaysAgo(3, [chestExercise(Array.from({ length: 17 }, () => completedSet()))]),
      sessionDaysAgo(10, [chestExercise(Array.from({ length: 17 }, () => completedSet()))]),
      sessionDaysAgo(17, [chestExercise(Array.from({ length: 10 }, () => completedSet()))]),
      sessionDaysAgo(24, [chestExercise(Array.from({ length: 17 }, () => completedSet()))]),
    ]
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeksAtOrAboveMrv).toBe(2)
  })

  it('counts weeksBelowMev when 4 consecutive weeks below MEV', () => {
    // chest adult MEV = 6. 4 weeks at 3 sets each.
    const history = []
    for (let w = 0; w < 4; w++) {
      const daysAgo = w * 7 + 3
      const sets = Array.from({ length: 3 }, () => completedSet())
      history.push(sessionDaysAgo(daysAgo, [chestExercise(sets)]))
    }
    const snap = buildMuscleVolumeSnapshot('chest', history, [], 'adult', NOW, null)
    expect(snap.weeksBelowMev).toBe(4)
  })

  it('handles unknown muscle key gracefully', () => {
    const snap = buildMuscleVolumeSnapshot('unknown', [
      sessionDaysAgo(2, [chestExercise([completedSet()])]),
    ], [], 'adult', NOW, null)
    // No landmarks → weeksAtOrAboveMrv and weeksBelowMev stay 0.
    expect(snap.weeksAtOrAboveMrv).toBe(0)
    expect(snap.weeksBelowMev).toBe(0)
    // weeklySets still counts (muscleKey 'unknown' won't match 'chest').
    expect(snap.weeklySets).toBe(0)
  })

  it('passes through lastAdjustmentIso', () => {
    const snap = buildMuscleVolumeSnapshot('chest', [], [], 'adult', NOW, '2026-06-01T12:00:00.000Z')
    expect(snap.lastAdjustmentIso).toBe('2026-06-01T12:00:00.000Z')
  })

  it('picks e1rmTrend from the exercise with most data points', () => {
    const e1rmHistories = [
      { exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', dataPoints: [{}, {}], trend: { direction: 'flat' } },
      { exerciseName: 'Жим гантелей', muscleGroup: 'Грудь', dataPoints: [{}, {}, {}, {}], trend: { direction: 'up' } },
    ]
    const snap = buildMuscleVolumeSnapshot('chest', [], e1rmHistories, 'adult', NOW, null)
    // 'Жим гантелей' has 4 data points (more than 'Жим лёжа' 2) → trend 'up'.
    expect(snap.e1rmTrend).toBe('up')
  })

  it('returns insufficient_data when no e1RM history has data points', () => {
    const e1rmHistories = [
      { exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', dataPoints: [], trend: { direction: 'up' } },
    ]
    const snap = buildMuscleVolumeSnapshot('chest', [], e1rmHistories, 'adult', NOW, null)
    expect(snap.e1rmTrend).toBe('insufficient_data')
  })
})

describe('buildAllMuscleVolumeSnapshots', () => {
  it('returns snapshots for all 6 canonical muscle groups', () => {
    const snapshots = buildAllMuscleVolumeSnapshots([], [], 'adult', NOW, {})
    expect(Object.keys(snapshots).sort()).toEqual(
      ['arms', 'back', 'chest', 'core', 'legs', 'shoulders'],
    )
  })

  it('passes lastAdjustments per muscle group', () => {
    const lastAdjustments = {
      chest: '2026-06-01T12:00:00.000Z',
      back: null,
    }
    const snapshots = buildAllMuscleVolumeSnapshots([], [], 'adult', NOW, lastAdjustments)
    expect(snapshots.chest.lastAdjustmentIso).toBe('2026-06-01T12:00:00.000Z')
    expect(snapshots.back.lastAdjustmentIso).toBeNull()
    expect(snapshots.legs.lastAdjustmentIso).toBeNull()
  })

  it('filters e1RM histories by muscle group correctly', () => {
    const allE1rmHistories = [
      { exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', dataPoints: [{}, {}], trend: { direction: 'up' } },
      { exerciseName: 'Тяга верхнего блока', muscleGroup: 'Спина', dataPoints: [{}, {}, {}], trend: { direction: 'down' } },
    ]
    const snapshots = buildAllMuscleVolumeSnapshots([], allE1rmHistories, 'adult', NOW, {})
    expect(snapshots.chest.e1rmTrend).toBe('up')
    expect(snapshots.back.e1rmTrend).toBe('down')
    expect(snapshots.legs.e1rmTrend).toBe('insufficient_data')
  })
})
