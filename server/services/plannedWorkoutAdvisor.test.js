import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clampRefinedPlannedExercises, refinePlannedWorkoutPrescriptions, resolvePlannedSwaps } from './plannedWorkoutAdvisor.js'

const bench = {
  exerciseId: 'bench-press',
  exerciseName: 'Жим лёжа',
  muscleGroup: 'Грудь',
  muscleKey: 'chest',
  setsCount: 3,
  repMin: 6,
  repMax: 8,
  targetWeight: 60,
  weightStep: 2.5,
  coachFocus: 'base focus',
  currentWorkingWeight: 60,
}

describe('clampRefinedPlannedExercises', () => {
  it('keeps a reasonable LLM increase within the policy jump bound', () => {
    const { exercises, changed } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 62.5, coachFocus: 'жмём чуть тяжелее' }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(62.5)
    expect(exercises[0].coachFocus).toBe('жмём чуть тяжелее')
    expect(changed).toBe(true)
  })

  it('caps a wild weight jump at baseline + maxWeightJumpSteps*step', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 200 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(65) // 60 + 2*2.5
  })

  it('respects a smaller policy jump (maxWeightJumpSteps=1)', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 70 }],
      { isDeload: false, maxWeightJumpSteps: 1 },
    )
    expect(exercises[0].targetWeight).toBe(62.5) // 60 + 1*2.5
  })

  it('never drops below the working weight outside a deload (#136 invariant)', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 45 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(60) // floored at working weight
  })

  it('allows a bounded reduction during a deload week', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 40 }],
      { isDeload: true, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(55) // 60 - 2*2.5, clamped
  })

  it('rounds the weight onto the exercise step grid', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', targetWeight: 61 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(60) // 61 → nearest 2.5 grid
  })

  it('leaves bodyweight/timed exercises (targetWeight 0) at zero weight', () => {
    const plank = { ...bench, exerciseId: 'plank', exerciseName: 'Планка', targetWeight: 0, weightStep: 0, repMin: 40, repMax: 60, currentWorkingWeight: null }
    const { exercises } = clampRefinedPlannedExercises(
      [plank],
      [{ exerciseId: 'plank', targetWeight: 20 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].targetWeight).toBe(0)
  })

  it('clamps sets to ±1 of baseline', () => {
    const up = clampRefinedPlannedExercises([bench], [{ exerciseId: 'bench-press', setsCount: 6 }], { isDeload: false, maxWeightJumpSteps: 2 })
    expect(up.exercises[0].setsCount).toBe(4) // base 3 + 1
    const down = clampRefinedPlannedExercises([bench], [{ exerciseId: 'bench-press', setsCount: 1 }], { isDeload: false, maxWeightJumpSteps: 2 })
    expect(down.exercises[0].setsCount).toBe(2) // base 3 - 1
  })

  it('clamps reps near baseline and keeps repMax above repMin', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', repMin: 20, repMax: 20 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].repMin).toBe(11) // base 6 + 5 cap
    expect(exercises[0].repMax).toBeGreaterThan(exercises[0].repMin)
  })

  it('ignores proposals for exercises not in the baseline (no exercise add/swap)', () => {
    const { exercises, changed } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'deadlift', targetWeight: 100 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises).toHaveLength(1)
    expect(exercises[0]).toEqual(bench)
    expect(changed).toBe(false)
  })

  it('keeps the baseline coachFocus when the LLM sends an empty one', () => {
    const { exercises } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', coachFocus: '   ' }],
      { isDeload: false, maxWeightJumpSteps: 2 },
    )
    expect(exercises[0].coachFocus).toBe('base focus')
  })
})

describe('resolvePlannedSwaps', () => {
  const inclineChest = { exerciseId: 'incline-press', exerciseName: 'Жим на наклонной', muscleKey: 'chest' }
  const backRow = { exerciseId: 'barbell-row', exerciseName: 'Тяга штанги', muscleKey: 'back' }

  it('accepts a same-muscle swap to an allowed alternative', () => {
    const swaps = resolvePlannedSwaps(
      [bench],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'incline-press' }],
      [inclineChest, backRow],
    )
    expect(swaps.get('bench-press')).toBe('incline-press')
  })

  it('rejects a swap to an exercise that is not in the safe whitelist', () => {
    const swaps = resolvePlannedSwaps(
      [bench],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'unknown-machine' }],
      [inclineChest],
    )
    expect(swaps.size).toBe(0)
  })

  it('rejects a swap that changes the muscle group', () => {
    const swaps = resolvePlannedSwaps(
      [bench],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'barbell-row' }],
      [inclineChest, backRow],
    )
    expect(swaps.size).toBe(0)
  })

  it('rejects a swap to an exercise already present in the plan', () => {
    const dips = { ...bench, exerciseId: 'dips', exerciseName: 'Отжимания на брусьях' }
    const swaps = resolvePlannedSwaps(
      [bench, dips],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'dips' }],
      [inclineChest, { exerciseId: 'dips', exerciseName: 'Отжимания на брусьях', muscleKey: 'chest' }],
    )
    expect(swaps.has('bench-press')).toBe(false)
  })

  it('does not let two slots claim the same replacement', () => {
    const dips = { ...bench, exerciseId: 'dips', exerciseName: 'Отжимания на брусьях' }
    const swaps = resolvePlannedSwaps(
      [bench, dips],
      [
        { exerciseId: 'bench-press', replaceWithExerciseId: 'incline-press' },
        { exerciseId: 'dips', replaceWithExerciseId: 'incline-press' },
      ],
      [inclineChest],
    )
    expect(swaps.get('bench-press')).toBe('incline-press')
    expect(swaps.has('dips')).toBe(false)
  })

  it('ignores a no-op swap to the same exercise', () => {
    const swaps = resolvePlannedSwaps(
      [bench],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'bench-press' }],
      [inclineChest],
    )
    expect(swaps.size).toBe(0)
  })

  it('skips prescription refinement for a swapped slot (generator re-prescribes it)', () => {
    const swaps = resolvePlannedSwaps([bench], [{ exerciseId: 'bench-press', replaceWithExerciseId: 'incline-press' }], [inclineChest])
    const { exercises, changed } = clampRefinedPlannedExercises(
      [bench],
      [{ exerciseId: 'bench-press', replaceWithExerciseId: 'incline-press', targetWeight: 200 }],
      { isDeload: false, maxWeightJumpSteps: 2 },
      swaps,
    )
    // Слот заменён → LLM-числа к нему не применяются, baseline не искажён.
    expect(exercises[0]).toEqual(bench)
    expect(changed).toBe(false)
  })
})

describe('refinePlannedWorkoutPrescriptions', () => {
  let savedOpenAi
  let savedLlm

  beforeEach(() => {
    savedOpenAi = process.env.OPENAI_API_KEY
    savedLlm = process.env.LLM_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.LLM_API_KEY
  })
  afterEach(() => {
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedOpenAi
    if (savedLlm === undefined) delete process.env.LLM_API_KEY
    else process.env.LLM_API_KEY = savedLlm
  })

  it('falls back to the deterministic baseline when the LLM is not configured', async () => {
    const result = await refinePlannedWorkoutPrescriptions({
      scheduledDate: '2026-07-23',
      baseline: [bench],
      options: { isDeload: false, maxWeightJumpSteps: 2 },
      context: { goal: 'сила', lowReadiness: false },
    })
    expect(result.source).toBe('rules')
    expect(result.exercises).toEqual([bench])
  })

  it('returns an empty rules result for an empty baseline', async () => {
    const result = await refinePlannedWorkoutPrescriptions({
      scheduledDate: '2026-07-23',
      baseline: [],
      options: { isDeload: false, maxWeightJumpSteps: 1 },
      context: { lowReadiness: false },
    })
    expect(result.source).toBe('rules')
    expect(result.exercises).toEqual([])
  })
})
