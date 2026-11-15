import { describe, expect, it } from 'vitest'
import { applyPrescription } from './workoutLoadPrescription.js'
import { emptyPreferences, emptyWeeklyContext } from './workoutExerciseEligibility.js'

// Issue #482 (Дополнение 1): программный таргет (program_exercises.target_weight)
// может отставать от факта в обе стороны — ручные сборки и замены в зале не
// всегда доезжают до программы. Предписание якорного слота берётся из
// канонизованной истории; таргет программы — стартовая точка только для слотов
// без единой записи.

const exercise = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  muscleKey: 'chest',
  setsCount: 3,
  repMin: 6,
  repMax: 8,
  targetWeight: 65,
  weightStep: 2.5,
  restSeconds: 150,
  weightDirection: null,
  equipment: null,
  exerciseType: null,
  movementPattern: null,
  subMuscleKeys: [],
}

const coachState = {
  userId: 'u',
  generatedAt: '2026-11-12T00:00:00Z',
  recoveryStatus: 'ready',
  readinessScore: 80,
  weeklyLoadStatus: 'on_plan',
  daysSinceLastWorkout: 2,
  mesocycle: null,
  warnings: [],
  muscleGroups: {},
  exercises: {},
}

const history = [
  {
    completedAt: '2026-11-10T20:00:00Z',
    workoutDayName: 'Силовая',
    exercises: [
      { exerciseId: 'bench-press-replacement-1793727753875', nextRecommendedWeight: 60, sets: [{ completed: true, weight: 60, reps: 8, rpe: 8 }] },
    ],
  },
]

const coachMemory = { exerciseProfiles: { 'bench-press': { id: 'bench-press', currentWorkingWeight: 60 } } }

const prescribe = (overrides = {}) => applyPrescription({
  exercise,
  coachState,
  history,
  lowReadiness: false,
  coachMemory,
  preferences: emptyPreferences(),
  weeklyContext: emptyWeeklyContext(),
  ...overrides,
})

describe('applyPrescription: вес из канонизованной истории, не из устаревшего таргета (issue #482)', () => {
  it('таргет программы 65 при истории 60 (под суффиксным id замены) не завышает предписание', () => {
    // Канонизация: bench-press-replacement-N → bench-press — история видна.
    const plan = prescribe()
    expect(plan.targetWeight).toBe(60)
  })

  it('инвариант #136 сохраняется: план не ниже рабочего веса', () => {
    const plan = prescribe()
    expect(plan.targetWeight).toBeGreaterThanOrEqual(60)
  })

  it('без единой записи таргет программы — стартовая точка', () => {
    const plan = prescribe({ history: [], coachMemory: null })
    expect(plan.targetWeight).toBe(65)
  })
})
