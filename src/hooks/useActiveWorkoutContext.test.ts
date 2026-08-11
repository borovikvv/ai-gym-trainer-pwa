import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ExercisePlan, WorkoutDay } from '../../shared/types'
import { fallbackProgramData } from '../data/programApi'
import { useActiveWorkoutContext } from './useActiveWorkoutContext'

function makeExercise(id: string, name: string): ExercisePlan {
  return {
    id,
    name,
    muscleGroup: 'Грудь',
    prescription: '3×8',
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    targetWeight: 40,
    weightStep: 2.5,
    restSeconds: 90,
    previous: '',
    todayGoal: '8–10',
    coachFocus: '',
    alternatives: [],
    instruction: '',
    commonMistakes: [],
  }
}

const planned = makeExercise('bench-press', 'Жим лёжа')
const extra = makeExercise('cable-fly-extra-1786000000000', 'Сведе́ния в кроссовере')
const userId = fallbackProgramData.users[0].id
const workoutDay: WorkoutDay = {
  id: 'day-1',
  name: 'День 1',
  label: 'A',
  description: '',
  exercises: [planned],
}

function renderContext(overrides: Partial<Parameters<typeof useActiveWorkoutContext>[0]> = {}) {
  return renderHook(() => useActiveWorkoutContext({
    programData: {
      ...fallbackProgramData,
      workoutDays: [workoutDay],
      workoutDaysByUser: { [userId]: [workoutDay] },
    },
    activeUserId: userId,
    activeWorkoutDayId: workoutDay.id,
    plannedWorkouts: [],
    history: [],
    extraWorkoutDays: [],
    coachTodayWorkoutDay: null,
    extraExercisesByDay: {},
    activeSessionWorkoutDay: null,
    draftSessionExercises: null,
    activeExerciseIndex: 0,
    logs: {},
    ...overrides,
  }))
}

// Issue #242: без состава дня из черновика восстановленная сессия
// возвращалась к плановому дню, добавленные упражнения исчезали, а логи на
// них становились сиротскими и терялись при сохранении.
describe('useActiveWorkoutContext — состав дня из черновика (#242)', () => {
  it('без черновика день остаётся плановым', () => {
    const { result } = renderContext()
    expect(result.current.activeWorkoutDay.exercises.map((item) => item.id)).toEqual([planned.id])
  })

  it('восстанавливает добавленное упражнение из черновика', () => {
    const { result } = renderContext({
      draftSessionExercises: { workoutDayId: workoutDay.id, exercises: [planned, extra] },
    })

    expect(result.current.activeWorkoutDay.exercises.map((item) => item.id)).toEqual([planned.id, extra.id])
    expect(result.current.activeWorkoutDay.id).toBe(workoutDay.id)
    expect(result.current.activeWorkoutDay.name).toBe(workoutDay.name)
  })

  it('игнорирует черновик от другого дня', () => {
    const { result } = renderContext({
      draftSessionExercises: { workoutDayId: 'day-99', exercises: [planned, extra] },
    })

    expect(result.current.activeWorkoutDay.exercises.map((item) => item.id)).toEqual([planned.id])
  })

  it('день сессии перевешивает черновик: правки пользователя не откатываются', () => {
    const replacement = makeExercise('incline-press-replacement-1', 'Жим на наклонной')
    const { result } = renderContext({
      draftSessionExercises: { workoutDayId: workoutDay.id, exercises: [planned, extra] },
      activeSessionWorkoutDay: { ...workoutDay, exercises: [replacement] },
    })

    expect(result.current.activeWorkoutDay.exercises.map((item) => item.id)).toEqual([replacement.id])
  })
})
