import { describe, expect, it } from 'vitest'
import type { WorkoutDay } from '../data/mockProgram'
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
