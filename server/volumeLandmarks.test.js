import { describe, expect, it } from 'vitest'
import {
  getVolumeLandmarks,
  getAllVolumeLandmarks,
  classifyVolumeStatus,
  getVolumeRecommendation,
} from './volumeLandmarks.js'

// ---------------------------------------------------------------------------
// getVolumeLandmarks
// ---------------------------------------------------------------------------

describe('getVolumeLandmarks', () => {
  describe('adult phase', () => {
    it('returns adult landmarks for chest', () => {
      expect(getVolumeLandmarks('chest', 'adult')).toEqual({ mev: 6, mav: 12, mrv: 16 })
    })

    it('returns adult landmarks for back', () => {
      expect(getVolumeLandmarks('back', 'adult')).toEqual({ mev: 8, mav: 14, mrv: 18 })
    })

    it('returns adult landmarks for legs', () => {
      expect(getVolumeLandmarks('legs', 'adult')).toEqual({ mev: 8, mav: 16, mrv: 20 })
    })

    it('returns adult landmarks for shoulders', () => {
      expect(getVolumeLandmarks('shoulders', 'adult')).toEqual({ mev: 4, mav: 8, mrv: 12 })
    })

    it('returns adult landmarks for arms', () => {
      expect(getVolumeLandmarks('arms', 'adult')).toEqual({ mev: 4, mav: 8, mrv: 12 })
    })

    it('returns adult landmarks for core', () => {
      expect(getVolumeLandmarks('core', 'adult')).toEqual({ mev: 3, mav: 6, mrv: 10 })
    })
  })

  describe('teen phase (lower MAV/MRV)', () => {
    it('keeps MEV unchanged but reduces MAV and MRV for chest', () => {
      // chest adult: mev=6, mav=12, mrv=16
      // teen mult:   mav*0.85=10.2→10, mrv*0.80=12.8→13
      const lm = getVolumeLandmarks('chest', 'teen')
      expect(lm.mev).toBe(6)
      expect(lm.mav).toBe(10)
      expect(lm.mrv).toBe(13)
    })

    it('applies teen multipliers to back', () => {
      // back adult: mev=8, mav=14, mrv=18
      // teen:       mav*0.85=11.9→12, mrv*0.80=14.4→14
      const lm = getVolumeLandmarks('back', 'teen')
      expect(lm.mev).toBe(8)
      expect(lm.mav).toBe(12)
      expect(lm.mrv).toBe(14)
    })
  })

  describe('mature_adult phase', () => {
    it('applies mature_adult multipliers to legs', () => {
      // legs adult: mev=8, mav=16, mrv=20
      // mature:     mav*0.90=14.4→14, mrv*0.85=17
      const lm = getVolumeLandmarks('legs', 'mature_adult')
      expect(lm.mev).toBe(8)
      expect(lm.mav).toBe(14)
      expect(lm.mrv).toBe(17)
    })
  })

  it('defaults to adult for unknown phase', () => {
    expect(getVolumeLandmarks('chest', 'unknown_phase'))
      .toEqual(getVolumeLandmarks('chest', 'adult'))
  })

  it('returns null for unknown muscle key', () => {
    expect(getVolumeLandmarks('unknown_muscle', 'adult')).toBeNull()
    expect(getVolumeLandmarks('other', 'adult')).toBeNull()
    expect(getVolumeLandmarks('', 'adult')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getAllVolumeLandmarks
// ---------------------------------------------------------------------------

describe('getAllVolumeLandmarks', () => {
  it('returns all 6 canonical muscle groups for adult', () => {
    const all = getAllVolumeLandmarks('adult')
    expect(Object.keys(all).sort()).toEqual(
      ['arms', 'back', 'chest', 'core', 'legs', 'shoulders'],
    )
  })

  it('returns teen landmarks (reduced MAV/MRV)', () => {
    const all = getAllVolumeLandmarks('teen')
    expect(all.chest.mav).toBeLessThan(12)  // adult is 12
    expect(all.chest.mrv).toBeLessThan(16)  // adult is 16
  })
})

// ---------------------------------------------------------------------------
// classifyVolumeStatus
// ---------------------------------------------------------------------------

describe('classifyVolumeStatus', () => {
  const lm = { mev: 6, mav: 12, mrv: 16 }

  it('returns "below_mev" for volume < MEV', () => {
    expect(classifyVolumeStatus(0, lm)).toBe('below_mev')
    expect(classifyVolumeStatus(5, lm)).toBe('below_mev')
  })

  it('returns "in_mev_mav" for MEV <= volume < MAV', () => {
    expect(classifyVolumeStatus(6, lm)).toBe('in_mev_mav')
    expect(classifyVolumeStatus(8, lm)).toBe('in_mev_mav')
    expect(classifyVolumeStatus(11, lm)).toBe('in_mev_mav')
  })

  it('returns "above_mav" for MAV <= volume < MRV', () => {
    expect(classifyVolumeStatus(12, lm)).toBe('above_mav')
    expect(classifyVolumeStatus(14, lm)).toBe('above_mav')
    expect(classifyVolumeStatus(15, lm)).toBe('above_mav')
  })

  it('returns "at_mrv" for MRV <= volume < MRV+2', () => {
    expect(classifyVolumeStatus(16, lm)).toBe('at_mrv')
    expect(classifyVolumeStatus(17, lm)).toBe('at_mrv')
  })

  it('returns "above_mrv" for volume >= MRV+2', () => {
    expect(classifyVolumeStatus(18, lm)).toBe('above_mrv')
    expect(classifyVolumeStatus(25, lm)).toBe('above_mrv')
  })

  it('returns "below_mev" when landmarks is null (defensive)', () => {
    expect(classifyVolumeStatus(10, null)).toBe('below_mev')
  })
})

// ---------------------------------------------------------------------------
// getVolumeRecommendation
// ---------------------------------------------------------------------------

describe('getVolumeRecommendation', () => {
  it('recommends "increase" with priority 4 when below MEV', () => {
    const rec = getVolumeRecommendation('chest', 3, 'adult')
    expect(rec.action).toBe('increase')
    expect(rec.priority).toBe(4)
    expect(rec.reason).toContain('MEV')
    expect(rec.reason).toContain('3')
  })

  it('recommends "hold" with priority 1 when in MEV-MAV range', () => {
    const rec = getVolumeRecommendation('chest', 8, 'adult')
    expect(rec.action).toBe('hold')
    expect(rec.priority).toBe(1)
    expect(rec.reason).toContain('оптимальном')
  })

  it('recommends "caution" with priority 2 when above MAV', () => {
    const rec = getVolumeRecommendation('chest', 14, 'adult')
    expect(rec.action).toBe('caution')
    expect(rec.priority).toBe(2)
    expect(rec.reason).toContain('MAV')
  })

  it('recommends "reduce_or_deload" with priority 3 when at MRV', () => {
    const rec = getVolumeRecommendation('chest', 16, 'adult')
    expect(rec.action).toBe('reduce_or_deload')
    expect(rec.priority).toBe(3)
    expect(rec.reason).toContain('MRV')
  })

  it('recommends "deload" with priority 5 when above MRV', () => {
    const rec = getVolumeRecommendation('chest', 20, 'adult')
    expect(rec.action).toBe('deload')
    expect(rec.priority).toBe(5)
    expect(rec.reason).toContain('перетренированности')
  })

  it('returns null for unknown muscle', () => {
    expect(getVolumeRecommendation('unknown', 10, 'adult')).toBeNull()
  })

  it('includes Russian label in reason text', () => {
    const rec = getVolumeRecommendation('back', 25, 'adult')
    expect(rec.reason).toContain('Спина')
  })
})
