import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkoutSave } from './useWorkoutSave'
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
    navigate: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  } as Parameters<typeof useWorkoutSave>[0]
}

describe('useWorkoutSave — issue #161 rating', () => {
  it('attaches the rating to the saved entry', async () => {
    const setHistory = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ setHistory, userRating: 4 })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    const [savedEntry] = setHistory.mock.calls[0][0]
    expect(savedEntry.userRating).toBe(4)
  })

  it('omits the rating when the workout was not rated', async () => {
    const setHistory = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ setHistory, userRating: 0 })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    const [savedEntry] = setHistory.mock.calls[0][0]
    expect(savedEntry.userRating).toBeUndefined()
  })

  // The rating lives in App state, which survives navigation between workouts.
  // Without an explicit reset the next workout silently inherits this rating.
  it('resets the rating after a successful save', async () => {
    const setUserRating = vi.fn()
    const { result } = renderHook(() =>
      useWorkoutSave(makeOptions({ userRating: 5, setUserRating })),
    )

    await act(async () => { await result.current.saveWorkoutAndExit() })

    expect(setUserRating).toHaveBeenCalledWith(0)
  })
})
