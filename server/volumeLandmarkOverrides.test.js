import { describe, expect, it } from 'vitest'
import {
  loadVolumeLandmarkOverrides,
  saveVolumeLandmarkAdjustments,
  extractLastAdjustments,
  mergeLandmarkOverrides,
} from './volumeLandmarkOverrides.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'

// Helper: build a mock pg client that records queries and returns canned rows.
function mockClient(returnRows = []) {
  const queries = []
  const client = {
    async query(text, params) {
      queries.push({ text, params })
      return { rows: returnRows.shift() ?? [] }
    },
  }
  return { client, queries }
}

describe('loadVolumeLandmarkOverrides', () => {
  it('returns an empty object when no rows exist', async () => {
    const { client, queries } = mockClient([[]])
    const result = await loadVolumeLandmarkOverrides(client, 'vyacheslav')
    expect(result).toEqual({})
    expect(queries).toHaveLength(1)
    expect(queries[0].params).toEqual(['vyacheslav'])
  })

  it('maps rows by muscle_key', async () => {
    const rows = [
      {
        muscle_key: 'chest',
        mev_override: 5,
        mrv_override: 17,
        last_adjustment_iso: new Date('2024-06-21T00:00:00.000Z'),
        last_adjustment_reason: 'Рост e1RM',
      },
      {
        muscle_key: 'back',
        mev_override: null,
        mrv_override: null,
        last_adjustment_iso: null,
        last_adjustment_reason: null,
      },
    ]
    const { client } = mockClient([rows])
    const result = await loadVolumeLandmarkOverrides(client, 'vyacheslav')

    expect(result.chest).toEqual({
      muscleKey: 'chest',
      mevOverride: 5,
      mrvOverride: 17,
      lastAdjustmentIso: '2024-06-21T00:00:00.000Z',
      lastAdjustmentReason: 'Рост e1RM',
    })
    expect(result.back).toEqual({
      muscleKey: 'back',
      mevOverride: null,
      mrvOverride: null,
      lastAdjustmentIso: null,
      lastAdjustmentReason: null,
    })
    expect(result.legs).toBeUndefined()
  })
})

describe('saveVolumeLandmarkAdjustments', () => {
  it('upserts only non-hold adjustments', async () => {
    const { client, queries } = mockClient([])
    const adjustments = [
      { muscleKey: 'chest', action: 'increase_mrv', delta: 1, reason: 'рост', newMrv: 17, newMev: 6 },
      { muscleKey: 'back', action: 'hold', delta: 0, reason: 'нет сигнала', newMrv: 18, newMev: 8 },
      { muscleKey: 'shoulders', action: 'decrease_mev', delta: -1, reason: 'снижаем', newMrv: 12, newMev: 3 },
    ]

    const count = await saveVolumeLandmarkAdjustments(client, 'vyacheslav', adjustments, new Date('2026-06-22T12:00:00.000Z'))

    expect(count).toBe(2) // chest + shoulders, back was hold
    expect(queries).toHaveLength(2)
    expect(queries[0].params[0]).toBe('vyacheslav')
    expect(queries[0].params[1]).toBe('chest')
    expect(queries[0].params[2]).toBe(6) // mev
    expect(queries[0].params[3]).toBe(17) // mrv
    expect(queries[0].params[4]).toBe('2026-06-22T12:00:00.000Z')
    expect(queries[0].params[5]).toBe('рост')
  })

  it('returns 0 when all decisions are hold', async () => {
    const { client, queries } = mockClient([])
    const adjustments = [
      { muscleKey: 'chest', action: 'hold', delta: 0, reason: '', newMrv: 16, newMev: 6 },
      { muscleKey: 'back', action: 'hold', delta: 0, reason: '', newMrv: 18, newMev: 8 },
    ]
    const count = await saveVolumeLandmarkAdjustments(client, 'vyacheslav', adjustments)
    expect(count).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('skips unknown muscle keys', async () => {
    const { client, queries } = mockClient([])
    const adjustments = [
      { muscleKey: 'unknown', action: 'increase_mrv', delta: 1, reason: '', newMrv: 20, newMev: 6 },
      { muscleKey: 'other', action: 'decrease_mrv', delta: -1, reason: '', newMrv: 14, newMev: 6 },
    ]
    const count = await saveVolumeLandmarkAdjustments(client, 'vyacheslav', adjustments)
    expect(count).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('handles empty adjustments array', async () => {
    const { client, queries } = mockClient([])
    const count = await saveVolumeLandmarkAdjustments(client, 'vyacheslav', [])
    expect(count).toBe(0)
    expect(queries).toHaveLength(0)
  })
})

describe('extractLastAdjustments', () => {
  it('returns null for muscle groups with no override', () => {
    const result = extractLastAdjustments({})
    expect(Object.keys(result).sort()).toEqual(
      ['arms', 'back', 'chest', 'core', 'legs', 'shoulders'],
    )
    expect(result.chest).toBeNull()
    expect(result.back).toBeNull()
  })

  it('extracts lastAdjustmentIso for muscle groups that have one', () => {
    const overridesMap = {
      chest: { lastAdjustmentIso: '2026-06-01T12:00:00.000Z' },
      back: { lastAdjustmentIso: null },
    }
    const result = extractLastAdjustments(overridesMap)
    expect(result.chest).toBe('2026-06-01T12:00:00.000Z')
    expect(result.back).toBeNull()
    expect(result.legs).toBeNull()
  })
})

describe('mergeLandmarkOverrides', () => {
  it('returns base landmarks when no overrides exist', () => {
    const result = mergeLandmarkOverrides('adult', {}, getVolumeLandmarks)
    expect(result.chest).toEqual({ mev: 6, mav: 12, mrv: 16 }) // base adult
  })

  it('applies mevOverride when present', () => {
    const overrides = {
      chest: { mevOverride: 5, mrvOverride: null },
    }
    const result = mergeLandmarkOverrides('adult', overrides, getVolumeLandmarks)
    expect(result.chest.mev).toBe(5)
    expect(result.chest.mrv).toBe(16) // base
    expect(result.chest.mav).toBe(12) // base, not adjusted
  })

  it('applies mrvOverride when present', () => {
    const overrides = {
      chest: { mevOverride: null, mrvOverride: 18 },
    }
    const result = mergeLandmarkOverrides('adult', overrides, getVolumeLandmarks)
    expect(result.chest.mrv).toBe(18)
    expect(result.chest.mev).toBe(6) // base
  })

  it('falls back to base when override is null', () => {
    const overrides = {
      chest: { mevOverride: null, mrvOverride: null },
    }
    const result = mergeLandmarkOverrides('adult', overrides, getVolumeLandmarks)
    expect(result.chest).toEqual({ mev: 6, mav: 12, mrv: 16 })
  })

  it('never overrides MAV (not adjusted in this version)', () => {
    const overrides = {
      chest: { mevOverride: 99, mrvOverride: 99 },
    }
    const result = mergeLandmarkOverrides('adult', overrides, getVolumeLandmarks)
    expect(result.chest.mav).toBe(12) // base, always
  })
})
