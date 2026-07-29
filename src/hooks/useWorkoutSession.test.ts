import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSets, useWorkoutSetActions } from './useWorkoutSession'
import type { ExercisePlan } from '../../shared/types'

const bench: ExercisePlan = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  setsCount: 3,
  repMin: 6,
  repMax: 8,
  targetWeight: 50,
  weightStep: 2.5,
  restSeconds: 120,
} as unknown as ExercisePlan

function makeOptions(setLogs: ReturnType<typeof vi.fn>) {
  const activeLog = { exerciseId: bench.id, pain: false, sets: createSets(bench) }
  return {
    activeExercise: bench,
    activeLog,
    activeSetIndex: 0,
    logs: { [bench.id]: activeLog },
    setLogs,
    nextTargets: {},
    setRestRemainingSeconds: vi.fn(),
    setCoachNextSetHint: vi.fn(),
    getLocalNextSetRecommendation: () => null,
    requestServerNextSet: vi.fn().mockResolvedValue(null),
    persistWorkoutDraft: vi.fn(),
    notify: vi.fn(),
  } as unknown as Parameters<typeof useWorkoutSetActions>[0]
}

// Issue #165: момент завершения снимается на клиенте — при пакетном
// сохранении колонка в БД зафиксировала бы время сохранения, а не подхода.
describe('markSetDone — таймстемп подхода (#165)', () => {
  it('записывает performedAt в завершённый подход', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:34:56.000Z'))
    const setLogs = vi.fn()
    const { result } = renderHook(() => useWorkoutSetActions(makeOptions(setLogs)))

    await act(async () => { result.current.markSetDone(0, { rpe: 8 }) })

    const nextLogs = setLogs.mock.calls[0][0]
    expect(nextLogs[bench.id].sets[0]).toMatchObject({
      completed: true,
      rpe: 8,
      performedAt: '2026-07-29T12:34:56.000Z',
    })
    vi.useRealTimers()
  })

  it('не проставляет performedAt незавершённым подходам', async () => {
    const setLogs = vi.fn()
    const { result } = renderHook(() => useWorkoutSetActions(makeOptions(setLogs)))

    await act(async () => { result.current.markSetDone(0) })

    const nextLogs = setLogs.mock.calls[0][0]
    expect(nextLogs[bench.id].sets[1].performedAt).toBeUndefined()
  })
})
