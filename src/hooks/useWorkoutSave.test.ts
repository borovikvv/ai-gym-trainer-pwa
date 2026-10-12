import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkoutSave } from './useWorkoutSave'
import { defaultReadinessCheckIn } from '../domain/readinessCheckIn'
import type { WorkoutDay } from '../../shared/types'

vi.mock('./useProgramData', () => ({ saveHistory: vi.fn() }))

const workoutDay: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  exercises: [
    {
      id: 'squat',
      name: 'Присед',
      sets: 3,
      reps: 10,
      weight: 50,
      restSeconds: 90,
    },
  ],
} as unknown as WorkoutDay

function makeOptions(overrides: Partial<Parameters<typeof useWorkoutSave>[0]> = {}) {
  return {
    activeUserId: 'vyacheslav',
    activeWorkoutDay: workoutDay,
    activeExerciseIndex: 0,
    readinessCheckIn: null,
    logs: {},
    history: [],
    setHistory: vi.fn(),
    setPlannedWorkouts: vi.fn(),
    clearActiveWorkoutDraft: vi.fn(),
    reloadProgramDataForUser: vi.fn().mockResolvedValue(undefined),
    setActiveExerciseIndex: vi.fn(),
    setLogs: vi.fn(),
    setReadinessCheckIn: vi.fn(),
    setReadinessTouched: vi.fn(),
    navigate: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  } as Parameters<typeof useWorkoutSave>[0]
}

describe('useWorkoutSave — issue #249: user rating removed', () => {
  it('saves an entry without userRating', async () => {
    const setHistory = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ setHistory })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    const [savedEntry] = setHistory.mock.calls[0][0]
    expect(savedEntry.userRating).toBeUndefined()
  })

  it('no longer accepts a userRating option', () => {
    // Issue #249: userRating удалён из UseWorkoutSaveOptions. Если поле вернут,
    // директива ниже перестанет находить ошибку и сломает сборку.
    // @ts-expect-error — userRating не входит в UseWorkoutSaveOptions
    const rejectedOptions = makeOptions({ userRating: 4 })
    expect(rejectedOptions).toBeDefined()
  })
})

describe('useWorkoutSave — issue #255: readiness check-in reset between workouts', () => {
  it('resets readinessCheckIn and readinessTouched after saving', async () => {
    const setReadinessCheckIn = vi.fn()
    const setReadinessTouched = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ setReadinessCheckIn, setReadinessTouched })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    expect(setReadinessCheckIn).toHaveBeenCalledWith(defaultReadinessCheckIn)
    expect(setReadinessTouched).toHaveBeenCalledWith(false)
  })
})

// Issue #414: age profile must reach progression through the save path —
// otherwise the entry would hold while the review preview increases.
const marginWorkoutDay = {
  id: 'day-margin',
  name: 'День M',
  exercises: [
    {
      id: 'bench',
      name: 'Жим лёжа',
      sets: 3,
      reps: 9,
      repMin: 8,
      repMax: 10,
      weight: 60,
      targetWeight: 60,
      weightStep: 2.5,
      restSeconds: 120,
    },
  ],
} as unknown as WorkoutDay

const marginLogs = {
  bench: {
    exerciseId: 'bench',
    pain: false,
    sets: [
      { weight: 60, reps: 9, rpe: 7, completed: true },
      { weight: 60, reps: 9, rpe: 7, completed: true },
      { weight: 60, reps: 9, rpe: 7, completed: true },
    ],
  },
}

describe('useWorkoutSave — issue #414: profileAge reaches progression', () => {
  async function savedExercise(profileAge?: number) {
    const setHistory = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ activeWorkoutDay: marginWorkoutDay, logs: marginLogs, setHistory, profileAge })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    return setHistory.mock.calls[0][0][0].exercises[0]
  }

  it('adult profile: saves increase when sets are in range with margin', async () => {
    const exercise = await savedExercise(30)

    expect(exercise.progressionType).toBe('increase')
    expect(exercise.nextRecommendedWeight).toBe(62.5)
    expect(exercise.progressionReason).toContain('не ждём потолка')
  })

  it('without age the saved behavior is unchanged: hold', async () => {
    const exercise = await savedExercise(undefined)

    expect(exercise.progressionType).toBe('hold')
    expect(exercise.nextRecommendedWeight).toBe(60)
  })
})
