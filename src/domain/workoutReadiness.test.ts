import { describe, expect, it } from 'vitest'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import { defaultReadinessCheckIn } from './readinessCheckIn'
import { adaptWorkoutDayForReadiness, estimateWorkoutMinutes, fitWorkoutDayToAvailableMinutes } from './workoutReadiness'

const workoutDay: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  label: 'Грудь/спина',
  description: 'base',
  exercises: [
    {
      id: 'bench-press',
      name: 'Жим лёжа',
      muscleGroup: 'Грудь',
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 60,
      weightStep: 2.5,
      restSeconds: 120,
      prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
    {
      id: 'lat-pulldown',
      name: 'Тяга верхнего блока',
      muscleGroup: 'Спина',
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 40,
      weightStep: 2.5,
      restSeconds: 90,
      prescription: '3×8–10 · рекомендовано 40 кг · отдых 90 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
  ],
}

describe('workout readiness adaptation', () => {
  it('adds targeted reduction for sore muscle groups without weakening unrelated exercises', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'light', {
      ...defaultReadinessCheckIn,
      soreness: 'medium',
      soreMuscleGroups: ['Грудь'],
    })

    const bench = adapted.exercises.find((exercise) => exercise.id === 'bench-press')
    const pulldown = adapted.exercises.find((exercise) => exercise.id === 'lat-pulldown')
    expect(bench?.setsCount).toBe(2)
    expect(bench?.coachFocus).toContain('Отмечена забитость')
    expect(pulldown?.setsCount).toBe(3)
  })

  it('treats pain areas as a stronger targeted safety constraint', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })

    const pulldown = adapted.exercises.find((exercise) => exercise.id === 'lat-pulldown')
    expect(pulldown?.setsCount).toBe(1)
    expect(pulldown?.coachFocus).toContain('Есть боль')
  })
})

describe('fitWorkoutDayToAvailableMinutes', () => {
  const exercise = (overrides: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup' | 'targetWeight'>): ExercisePlan => ({
    instruction: '',
    commonMistakes: [],
    alternatives: [],
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    weightStep: 2.5,
    restSeconds: 180,
    prescription: '',
    previous: '',
    todayGoal: '',
    coachFocus: 'контроль техники',
    ...overrides,
  })

  const dayWithExercises = (id: string, exercises: ExercisePlan[]): WorkoutDay => ({
    id,
    name: 'День',
    label: 'label',
    description: 'base',
    exercises,
  })

  const tightDay = dayWithExercises('day-tight', [
    exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60 }),
    exercise({ id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', targetWeight: 40 }),
    exercise({ id: 'biceps-curl', name: 'Подъём гантелей на бицепс', muscleGroup: 'Руки', targetWeight: 10, repMax: 12, weightStep: 1, restSeconds: 90 }),
  ])

  it('returns the same day when the plan already fits', () => {
    const day = dayWithExercises('day-short', [
      exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60, restSeconds: 60 }),
    ])
    expect(estimateWorkoutMinutes(day)).toBeLessThanOrEqual(30)
    expect(fitWorkoutDayToAvailableMinutes(day, 30)).toBe(day)
  })

  it('cuts volume down to the time budget without touching targetWeight', () => {
    expect(estimateWorkoutMinutes(tightDay)).toBeGreaterThan(30)

    const result = fitWorkoutDayToAvailableMinutes(tightDay, 30)

    expect(estimateWorkoutMinutes(result)).toBeLessThanOrEqual(30)
    for (const remaining of result.exercises) {
      const original = tightDay.exercises.find((item) => item.id === remaining.id)
      expect(remaining.targetWeight).toBe(original?.targetWeight)
    }
  })

  it('rebuilds the prescription when a set is removed', () => {
    const result = fitWorkoutDayToAvailableMinutes(tightDay, 30)
    const pulldown = result.exercises.find((item) => item.id === 'lat-pulldown')
    expect(pulldown?.setsCount).toBe(2)
    expect(pulldown?.prescription).toBe('2×8–10 · рекомендовано 40 кг · отдых 180 сек')
  })

  it('cuts isolation exercises before touching the base ones', () => {
    const baseAndIsolation = dayWithExercises('day-base-isolation', [
      exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60, setsCount: 5 }),
      exercise({ id: 'biceps-curl', name: 'Подъём гантелей на бицепс', muscleGroup: 'Руки', targetWeight: 10, restSeconds: 90 }),
    ])
    expect(estimateWorkoutMinutes(baseAndIsolation)).toBeGreaterThan(30)

    const result = fitWorkoutDayToAvailableMinutes(baseAndIsolation, 30)

    expect(estimateWorkoutMinutes(result)).toBeLessThanOrEqual(30)
    const base = result.exercises.find((item) => item.id === 'bench-press')
    expect(base?.setsCount).toBe(5)
    expect(base?.targetWeight).toBe(60)
    expect(result.exercises.some((item) => item.id === 'biceps-curl')).toBe(false)
  })
})
