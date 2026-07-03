import { describe, expect, it } from 'vitest'
import { dropUnfinishedSets } from './liveCoachDecisionActions'

describe('live coach decision actions', () => {
  it('drops unfinished sets before moving away from an exercise', () => {
    expect(dropUnfinishedSets([
      { weight: 40, reps: 6, rpe: 8, completed: true },
      { weight: 40, reps: 0, rpe: 7, completed: false },
      { weight: 40, reps: 0, rpe: 7, completed: false },
    ])).toEqual([
      { weight: 40, reps: 6, rpe: 8, completed: true },
    ])
  })
})
