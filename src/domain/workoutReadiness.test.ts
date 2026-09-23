import { describe, expect, it } from 'vitest'
import type { WorkoutDay  } from '../../shared/types'
import { defaultReadinessCheckIn } from './readinessCheckIn'
import { adaptWorkoutDayForReadiness } from './workoutReadiness'

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
      targetMuscles: ['верх груди', 'средняя груди', 'передняя дельта', 'трицепс'],
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
      targetMuscles: ['широчайшие', 'бицепс', 'задняя дельта'],
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
    {
      id: 'barbell-squat',
      name: 'Присед со штангой',
      muscleGroup: 'Ноги',
      targetMuscles: ['квадрицепс', 'ягодицы', 'поясница', 'кор'],
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 6,
      repMax: 8,
      targetWeight: 70,
      weightStep: 2.5,
      restSeconds: 150,
      prescription: '3×6–8 · рекомендовано 70 кг · отдых 150 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
    {
      id: 'leg-press',
      name: 'Жим ногами',
      muscleGroup: 'Ноги',
      targetMuscles: ['квадрицепс', 'ягодицы'],
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

  it('treats barbell squat as related to back pain via target muscles', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })

    const squat = adapted.exercises.find((exercise) => exercise.id === 'barbell-squat')
    expect(squat?.setsCount).toBe(1)
    expect(squat?.coachFocus).toContain('Есть боль')
  })

  it('does not treat leg press as related to shoulder pain', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Плечо'],
    })

    const legPress = adapted.exercises.find((exercise) => exercise.id === 'leg-press')
    expect(legPress?.setsCount).toBe(2)
    expect(legPress?.coachFocus).not.toContain('Есть боль')
  })

  it('treats bench press as related to elbow/arm pain via triceps', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Локоть/рука'],
    })

    const bench = adapted.exercises.find((exercise) => exercise.id === 'bench-press')
    expect(bench?.setsCount).toBe(1)
    expect(bench?.coachFocus).toContain('Есть боль')
  })
})
