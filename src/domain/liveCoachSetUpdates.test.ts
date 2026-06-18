import { describe, expect, it } from 'vitest'
import { applyLiveCoachSetUpdates } from './liveCoachSetUpdates'

describe('live coach set updates', () => {
  it('applies trainer updates to every unfinished set while preserving completed sets', () => {
    const result = applyLiveCoachSetUpdates({
      sets: [
        { weight: 40, weightInput: '40', reps: 5, repsInput: '5', rpe: 10, completed: true },
        { weight: 40, weightInput: '40', reps: 0, repsInput: '', rpe: 7, completed: false },
        { weight: 40, weightInput: '40', reps: 0, repsInput: '', rpe: 7, completed: false },
      ],
      recommendation: {
        weight: 37.5,
        reps: 6,
        restSeconds: 180,
        reason: 'снижаем',
        action: 'reduce_load',
        remainingSetUpdates: [
          { setOffset: 0, recommendedWeight: 37.5, recommendedReps: 6, recommendedRestSeconds: 180 },
          { setOffset: 1, recommendedWeight: 37.5, recommendedReps: 6, recommendedRestSeconds: 180 },
        ],
      },
      formatWeight: (weight) => String(weight).replace('.', ','),
    })

    expect(result).toEqual([
      { weight: 40, weightInput: '40', reps: 5, repsInput: '5', rpe: 10, completed: true },
      { weight: 37.5, weightInput: '37,5', reps: 6, repsInput: '6', rpe: 7, completed: false },
      { weight: 37.5, weightInput: '37,5', reps: 6, repsInput: '6', rpe: 7, completed: false },
    ])
  })
})
