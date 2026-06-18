import { describe, expect, it } from 'vitest'
import { buildWorkoutTodayPlan } from './coachToday.js'

const profile = {
  userId: 'vyacheslav',
  goal: 'сила и мышечная масса',
  workoutsPerWeek: 2,
  targetWorkoutMinutes: 60,
  trainingDays: ['Четверг', 'Воскресенье'],
}

const workoutDays = [
  {
    id: 'vyacheslav-main-day-a',
    dayKey: 'day-a',
    name: 'День A',
    label: 'Full Body A',
    sortOrder: 1,
    exercises: [
      { programExerciseId: 'pe-bench', exerciseId: 'bench-press', id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150, coachFocus: 'жим' },
      { programExerciseId: 'pe-pulldown', exerciseId: 'lat-pulldown', id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 35, weightStep: 2.5, restSeconds: 90, coachFocus: 'тяга' },
    ],
  },
  {
    id: 'vyacheslav-main-day-b',
    dayKey: 'day-b',
    name: 'День B',
    label: 'Full Body B',
    sortOrder: 2,
    exercises: [
      { programExerciseId: 'pe-rdl', exerciseId: 'romanian-deadlift', id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150, coachFocus: 'тяга' },
      { programExerciseId: 'pe-incline', exerciseId: 'incline-db-press', id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь/плечи', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90, coachFocus: 'жим' },
    ],
  },
]

const exerciseLibrary = [
  { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150, instruction: 'Контроль.' },
  { id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150, instruction: 'Спина ровная.' },
  { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 10, weightStep: 1, restSeconds: 75, instruction: 'Локти близко.' },
  { id: 'lateral-raise', name: 'Разведения гантелей в стороны', muscleGroup: 'Плечи', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 6, weightStep: 1, restSeconds: 75, instruction: 'Без рывка.' },
  { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60, instruction: 'Кор жёсткий.' },
]

describe('workout today coach plan', () => {
  it('builds a light ad-hoc workout from fresh muscle groups when recovery is low or the user is above plan', () => {
    const coachState = {
      recoveryStatus: 'low',
      readinessScore: 42,
      weeklyLoadStatus: 'above_plan',
      muscleGroups: {
        chest: { fatigue: 'high' },
        back: { fatigue: 'high' },
        legs: { fatigue: 'medium' },
        arms: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildWorkoutTodayPlan({ profile, workoutDays, exerciseLibrary, coachState, now: new Date('2026-06-06T12:00:00.000Z') })

    expect(plan.mode).toBe('recovery_accessory')
    expect(plan.workoutDay.id).toBe('coach-today')
    expect(plan.workoutDay.name).toBe('Сегодня')
    expect(plan.workoutDay.exercises.map((exercise) => exercise.id)).toEqual(['hammer-curl', 'lateral-raise', 'plank'])
    expect(plan.workoutDay.exercises.every((exercise) => exercise.setsCount <= 2)).toBe(true)
    expect(plan.summary).toContain('восстановление')
  })

  it('uses the next scheduled workout when the user is recovered and not above plan', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 82,
      weeklyLoadStatus: 'on_plan',
      lastWorkoutDayId: 'day-a',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildWorkoutTodayPlan({ profile, workoutDays, exerciseLibrary, coachState, now: new Date('2026-06-07T12:00:00.000Z') })

    expect(plan.mode).toBe('scheduled')
    expect(plan.workoutDay.id).toBe('day-b')
    expect(plan.workoutDay.label).toContain('Full Body B')
    expect(plan.summary).toContain('можно провести следующую основную тренировку')
  })
})
