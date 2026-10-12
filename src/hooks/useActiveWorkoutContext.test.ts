import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ExercisePlan, WorkoutDay, WorkoutHistoryEntry } from '../../shared/types'
import { fallbackProgramData } from '../data/programApi'
import { createWorkoutHistoryEntry } from '../domain/workoutHistory'
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

// Issue #247: предпросмотр на экране обзора должен совпадать с тем, что
// реально сохранится, — отклонение повторов (#167) даёт hold в обоих местах.
describe('useActiveWorkoutContext — предпросмотр прогрессии и отклонение повторов (#247)', () => {
  const historyEntry = (completedAt: string, reps: number[]): WorkoutHistoryEntry =>
    createWorkoutHistoryEntry({
      userId,
      workoutDayId: workoutDay.id,
      workoutDayName: workoutDay.name,
      exercises: [planned],
      logs: {
        [planned.id]: {
          exerciseId: planned.id,
          pain: false,
          sets: reps.map((reps) => ({ weight: 60, reps, rpe: 7, completed: true })),
        },
      },
      completedAt,
    })

  it('показывает hold, когда повторы на верхней границе, но ниже личной нормы', () => {
    const history = [
      historyEntry('2026-06-01T15:00:00.000Z', [12, 12, 12]),
      historyEntry('2026-06-08T15:00:00.000Z', [12, 12, 12]),
    ]
    const logs = {
      [planned.id]: {
        exerciseId: planned.id,
        pain: false,
        sets: [
          { weight: 60, reps: 10, rpe: 8, completed: true },
          { weight: 60, reps: 10, rpe: 8, completed: true },
          { weight: 60, reps: 10, rpe: 8, completed: true },
        ],
      },
    }

    const { result } = renderContext({ history, logs })

    expect(result.current.progressionSummary[0].type).toBe('hold')
  })
})

// Issue #414: возраст профиля должен доезжать из useActiveWorkoutContext в
// progressionSummary, иначе превью обзора разойдётся с сохранением.
describe('useActiveWorkoutContext — возраст профиля в прогрессии (#414)', () => {
  const marginLogs = {
    [planned.id]: {
      exerciseId: planned.id,
      pain: false,
      sets: [
        { weight: 40, reps: 9, rpe: 7, completed: true },
        { weight: 40, reps: 9, rpe: 7, completed: true },
        { weight: 40, reps: 9, rpe: 7, completed: true },
      ],
    },
  }

  function programDataWithAge(age: number | null) {
    return {
      ...fallbackProgramData,
      workoutDays: [workoutDay],
      workoutDaysByUser: { [userId]: [workoutDay] },
      profilesByUser: {
        [userId]: { ...fallbackProgramData.profilesByUser[userId], age },
      },
    }
  }

  it('взрослый возраст: превью показывает increase при запасе в диапазоне', () => {
    const { result } = renderContext({ logs: marginLogs, programData: programDataWithAge(30) })

    expect(result.current.progressionSummary[0].type).toBe('increase')
    expect(result.current.progressionSummary[0].recommendedWeight).toBe(42.5)
    expect(result.current.progressionSummary[0].reason).toContain('не ждём потолка')
  })

  it('подростковый и неизвестный возраст: превью остаётся hold', () => {
    expect(renderContext({ logs: marginLogs, programData: programDataWithAge(15) }).result.current.progressionSummary[0].type).toBe('hold')
    expect(renderContext({ logs: marginLogs, programData: programDataWithAge(null) }).result.current.progressionSummary[0].type).toBe('hold')
  })

  it('смена возраста пересчитывает превью — возраст в зависимостях memo', () => {
    const { result, rerender } = renderHook(
      ({ age }: { age: number | null }) => useActiveWorkoutContext({
        programData: programDataWithAge(age),
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
        logs: marginLogs,
      }),
      { initialProps: { age: null as number | null } },
    )

    expect(result.current.progressionSummary[0].type).toBe('hold')

    rerender({ age: 30 })

    expect(result.current.progressionSummary[0].type).toBe('increase')
  })
})
