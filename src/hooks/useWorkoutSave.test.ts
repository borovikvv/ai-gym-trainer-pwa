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
