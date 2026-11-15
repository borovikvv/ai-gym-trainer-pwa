import { describe, expect, it } from 'vitest'
import { buildBlockUsageWeeks, chooseBestExerciseForMuscle, exerciseScore, normalizeExerciseLibrary } from './workoutExerciseSelection.js'
import { emptyPreferences, emptyWeeklyContext } from './workoutExerciseEligibility.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** История: выполненная тренировка с упражнениями (id — как лежит в БД). */
function workout(completedAt, exerciseIds) {
  return {
    completedAt,
    exercises: exerciseIds.map((exerciseId) => ({ exerciseId })),
  }
}

/** Кандидат библиотеки. */
function libraryExercise(overrides = {}) {
  return {
    id: 'exercise-x',
    name: 'Упражнение X',
    muscleGroup: 'Спина',
    muscleKey: 'back',
    setsCount: 3,
    repMin: 8,
    repMax: 12,
    targetWeight: 20,
    weightStep: 2.5,
    restSeconds: 90,
    weightDirection: null,
    equipment: null,
    exerciseType: null,
    movementPattern: null,
    subMuscleKeys: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildBlockUsageWeeks
// ---------------------------------------------------------------------------

describe('buildBlockUsageWeeks (issue #482)', () => {
  const history = [
    workout('2026-10-06T12:00:00Z', ['lat-pulldown']),
    workout('2026-10-08T12:00:00Z', ['lat-pulldown-replacement-1793727753875', 'cable-row']),
    workout('2026-10-14T12:00:00Z', ['lat-pulldown']),
    workout('2026-09-30T12:00:00Z', ['lat-pulldown']),
    workout(null, ['lat-pulldown']),
  ]

  it('считает недели использования внутри блока, канонизируя id замен', () => {
    const usage = buildBlockUsageWeeks(history, '2026-10-05')
    // 06.10 и 08.10 — одна ISO-неделя (пн 05.10), 14.10 — вторая (пн 12.10);
    // подход под суффиксным id замены канонизируется в lat-pulldown.
    expect(usage.get('lat-pulldown')).toEqual(new Set(['2026-10-05', '2026-10-12']))
    expect(usage.get('cable-row')).toEqual(new Set(['2026-10-05']))
  })

  it('использование до блока не учитывается', () => {
    const usage = buildBlockUsageWeeks(history, '2026-10-05')
    expect(usage.get('lat-pulldown')?.has('2026-09-28')).toBe(false)
  })

  it('без cycleStartedOn — пустая карта', () => {
    expect(buildBlockUsageWeeks(history, null).size).toBe(0)
  })
})
