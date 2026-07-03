import { describe, expect, it } from 'vitest'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import { suggestExerciseToAdd } from './exerciseSuggestion'

const baseExercise = {
  prescription: '',
  setsCount: 2,
  repMin: 8,
  repMax: 12,
  targetWeight: 0,
  weightStep: 0,
  restSeconds: 60,
  previous: '',
  todayGoal: '',
  coachFocus: '',
  alternatives: [],
  instruction: '',
  commonMistakes: [],
}

function exercise(id: string, name: string, muscleGroup: string): ExercisePlan {
  return { ...baseExercise, id, name, muscleGroup }
}

describe('exercise add suggestion', () => {
  it('suggests an exercise that is not already in the current workout', () => {
    const workoutDay: WorkoutDay = {
      id: 'day-a',
      name: 'День A',
      label: 'Грудь/спина',
      description: '',
      exercises: [
        exercise('bench-press', 'Жим лёжа', 'Грудь'),
        exercise('lat-pulldown', 'Тяга верхнего блока', 'Спина'),
      ],
    }
    const suggestion = suggestExerciseToAdd({
      workoutDay,
      exerciseLibrary: [
        exercise('bench-press', 'Жим лёжа', 'Грудь'),
        exercise('plank', 'Планка', 'Кор'),
      ],
    })

    expect(suggestion?.exercise.name).toBe('Планка')
    expect(suggestion?.reason).toContain('добавить')
  })

  it('does not suggest more work when the session is already long enough', () => {
    const workoutDay: WorkoutDay = {
      id: 'day-a',
      name: 'День A',
      label: 'Большая',
      description: '',
      exercises: [
        exercise('a', 'A', 'Грудь'),
        exercise('b', 'B', 'Спина'),
        exercise('c', 'C', 'Ноги'),
        exercise('d', 'D', 'Плечи'),
        exercise('e', 'E', 'Руки'),
        exercise('f', 'F', 'Кор'),
      ],
    }

    expect(suggestExerciseToAdd({
      workoutDay,
      exerciseLibrary: [exercise('g', 'G', 'Кор')],
    })).toBeNull()
  })
})
