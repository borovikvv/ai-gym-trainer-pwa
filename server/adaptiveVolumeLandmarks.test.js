import { describe, expect, it } from 'vitest'
import {
  computeMuscleAdjustment,
  computeAllAdjustments,
  applyAdjustments,
} from './adaptiveVolumeLandmarks.js'

const NOW = new Date('2026-06-22T12:00:00.000Z')

describe('computeMuscleAdjustment', () => {
  describe('hold (no adjustment)', () => {
    it('holds when there is no signal (insufficient data)', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 8,
        weeksAtOrAboveMrv: 0,
        weeksBelowMev: 0,
        e1rmTrend: 'insufficient_data',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('hold')
      expect(result.delta).toBe(0)
    })

    it('holds when cooldown has not passed (less than 2 weeks since last)', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 18,
        weeksAtOrAboveMrv: 5,
        weeksBelowMev: 0,
        e1rmTrend: 'up',
        lastAdjustmentIso: '2026-06-15T12:00:00.000Z', // 7 days ago
      }, 'adult', NOW)

      expect(result.action).toBe('hold')
    })

    it('holds for unknown muscle key', () => {
      const result = computeMuscleAdjustment('unknown', {
        weeklySets: 10,
        weeksAtOrAboveMrv: 5,
        weeksBelowMev: 0,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('hold')
      expect(result.newMrv).toBe(0)
      expect(result.newMev).toBe(0)
    })
  })

  describe('increase_mrv', () => {
    it('increases MRV by 1 when 4+ weeks at MRV with upward e1RM trend', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 4,
        weeksBelowMev: 0,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      // chest adult MRV = 16
      expect(result.action).toBe('increase_mrv')
      expect(result.delta).toBe(1)
      expect(result.newMrv).toBe(17)
      expect(result.newMev).toBe(6) // unchanged
      expect(result.reason).toContain('повышаем MRV')
    })

    it('does not increase MRV if only 3 weeks at MRV', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 3,
        weeksBelowMev: 0,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('hold')
    })

    it('does not increase MRV if e1RM is flat (not progressing)', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 4,
        weeksBelowMev: 0,
        e1rmTrend: 'flat',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).not.toBe('increase_mrv')
    })
  })

  describe('decrease_mrv', () => {
    it('decreases MRV by 1 when 3+ weeks at MRV with downward trend', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 3,
        weeksBelowMev: 0,
        e1rmTrend: 'down',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      // chest adult MRV = 16 → 15
      expect(result.action).toBe('decrease_mrv')
      expect(result.delta).toBe(-1)
      expect(result.newMrv).toBe(15)
      expect(result.reason).toContain('снижаем MRV')
    })

    it('decreases MRV when 3+ weeks at MRV with flat trend (stagnation)', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 3,
        weeksBelowMev: 0,
        e1rmTrend: 'flat',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('decrease_mrv')
    })

    it('respects the MRV floor (MEV + 2)', () => {
      // shoulders adult: MEV=4, MRV=12. If we try to go below MEV+2=6, hold.
      // Decreasing MRV from 12 to 11 is fine.
      const result = computeMuscleAdjustment('shoulders', {
        weeklySets: 13,
        weeksAtOrAboveMrv: 5,
        weeksBelowMev: 0,
        e1rmTrend: 'down',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('decrease_mrv')
      expect(result.newMrv).toBe(11) // 12 - 1
    })
  })

  describe('decrease_mev', () => {
    it('decreases MEV when 4+ weeks below MEV with upward trend', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 3,
        weeksAtOrAboveMrv: 0,
        weeksBelowMev: 5,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      // chest adult MEV = 6 → 5
      expect(result.action).toBe('decrease_mev')
      expect(result.delta).toBe(-1)
      expect(result.newMev).toBe(5)
      expect(result.newMrv).toBe(16) // unchanged
      expect(result.reason).toContain('снижаем MEV')
    })

    it('does not decrease MEV if only 3 weeks below', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 3,
        weeksAtOrAboveMrv: 0,
        weeksBelowMev: 3,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      expect(result.action).toBe('hold')
    })

    it('respects the MEV floor of 2', () => {
      // core adult: MEV=3. Trying to go below 2 → hold.
      const result = computeMuscleAdjustment('core', {
        weeklySets: 1,
        weeksAtOrAboveMrv: 0,
        weeksBelowMev: 5,
        e1rmTrend: 'up',
        lastAdjustmentIso: null,
      }, 'adult', NOW)

      // MEV=3, floor=2, decrease to 2 is OK
      expect(result.action).toBe('decrease_mev')
      expect(result.newMev).toBe(2)
    })
  })

  describe('cooldown handling', () => {
    it('allows adjustment after 2+ weeks since last', () => {
      const result = computeMuscleAdjustment('chest', {
        weeklySets: 17,
        weeksAtOrAboveMrv: 4,
        weeksBelowMev: 0,
        e1rmTrend: 'up',
        lastAdjustmentIso: '2026-06-01T12:00:00.000Z', // 21 days ago
      }, 'adult', NOW)

      expect(result.action).toBe('increase_mrv')
    })
  })
})

describe('computeAllAdjustments', () => {
  it('returns 6 decisions for the 6 canonical muscle groups', () => {
    const snapshots = {}
    for (const key of ['chest', 'back', 'legs', 'shoulders', 'arms', 'core']) {
      snapshots[key] = {
        weeklySets: 8,
        weeksAtOrAboveMrv: 0,
        weeksBelowMev: 0,
        e1rmTrend: 'insufficient_data',
        lastAdjustmentIso: null,
      }
    }

    const results = computeAllAdjustments(snapshots, 'adult', NOW)
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.action === 'hold')).toBe(true)
  })

  it('handles missing snapshots gracefully (treats as empty)', () => {
    const results = computeAllAdjustments({}, 'adult', NOW)
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.action === 'hold')).toBe(true)
  })
})

describe('applyAdjustments', () => {
  it('returns updated landmark table for non-hold actions', () => {
    const adjustments = [
      { muscleKey: 'chest', action: 'increase_mrv', delta: 1, newMrv: 17, newMev: 6 },
      { muscleKey: 'back', action: 'hold', delta: 0, newMrv: 18, newMev: 8 },
      { muscleKey: 'shoulders', action: 'decrease_mev', delta: -1, newMrv: 12, newMev: 3 },
    ]

    const result = applyAdjustments(adjustments, 'adult')

    expect(result.chest).toEqual({ mev: 6, mav: 12, mrv: 17 })
    expect(result.back).toEqual({ mev: 8, mav: 14, mrv: 18 }) // hold keeps base
    expect(result.shoulders).toEqual({ mev: 3, mav: 8, mrv: 12 })
  })

  it('preserves MAV from base (MAV is not adjusted in this version)', () => {
    const adjustments = [
      { muscleKey: 'legs', action: 'decrease_mrv', delta: -1, newMrv: 19, newMev: 8 },
    ]

    const result = applyAdjustments(adjustments, 'adult')
    // legs adult: mev=8, mav=16, mrv=20
    expect(result.legs.mav).toBe(16) // unchanged
  })
})
