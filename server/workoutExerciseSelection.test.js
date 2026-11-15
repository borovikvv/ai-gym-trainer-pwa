import { describe, expect, it } from 'vitest'
import { buildBlockUsageWeeks, chooseBestExerciseForMuscle, exerciseScore } from './workoutExerciseSelection.js'
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

// ---------------------------------------------------------------------------
// exerciseScore: якорная механика блока (issue #482)
// ---------------------------------------------------------------------------

describe('exerciseScore: якоря и фаза блока (issue #482)', () => {
  const coachState = { muscleGroups: { back: { fatigue: 'low' } }, exercises: {} }
  // Планируемая неделя: пн 2026-10-19; фаза accumulation началась пн 2026-10-12.
  const blockContext = (overrides = {}) => ({
    ...emptyWeeklyContext(),
    cycleStartedOn: '2026-10-05',
    phaseStartedOn: '2026-10-12',
    blockUsageWeeks: new Map(),
    previousMuscleCounts: new Map(),
    recentMuscleCounts: new Map(),
    ...overrides,
  })

  const anchor = libraryExercise({ id: 'exercise-anchor', name: 'Тяга блока', targetWeight: 20 })
  const fresh = libraryExercise({ id: 'exercise-fresh', name: 'Тяга гантели', targetWeight: 20 })
  // Якорь поднимался в двух неделях блока, последний раз 4 дня назад (≤7, >3).
  const anchorHistory = [
    workout('2026-10-07T12:00:00Z', ['exercise-anchor']),
    workout('2026-10-15T12:00:00Z', ['exercise-anchor']),
  ]
  const anchorUsedTwoWeeks = new Map([['exercise-anchor', new Set(['2026-10-05', '2026-10-12'])]])

  it('якорь (≥2 недели в блоке) держит слот: обходит свежего кандидата', () => {
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: anchorUsedTwoWeeks,
    })
    const anchorScore = exerciseScore(anchor, coachState, anchorHistory, false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(anchorScore).toBeGreaterThan(freshScore)
  })

  it('без блочного контекста — прежнее поведение: свежий кандидат выигрывает', () => {
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      cycleStartedOn: null,
      phaseStartedOn: null,
    })
    const anchorScore = exerciseScore(anchor, coachState, anchorHistory, false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(freshScore).toBeGreaterThan(anchorScore)
  })

  it('свежий повтор ≤3 дней не ослабляется даже якорю', () => {
    const weeklyContext = blockContext({
      recentExerciseIds: new Set(['exercise-anchor']),
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: anchorUsedTwoWeeks,
    })
    const anchorScore = exerciseScore(anchor, coachState, anchorHistory, false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(freshScore).toBeGreaterThan(anchorScore)
  })

  it('второй эшелон из текущей фазы удерживает слот', () => {
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: new Map([['exercise-anchor', new Set(['2026-10-12'])]]),
    })
    const anchorScore = exerciseScore(anchor, coachState, [workout('2026-10-15T12:00:00Z', ['exercise-anchor'])], false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(anchorScore).toBeGreaterThan(freshScore)
  })

  it('второй эшелон из предыдущей фазы (граница) ротируется', () => {
    // Граница фазы: сессия в неделю 12.10, occupant — из недели 05.10 (loading).
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: new Map([['exercise-anchor', new Set(['2026-10-05'])]]),
    })
    const anchorScore = exerciseScore(anchor, coachState, [workout('2026-10-08T12:00:00Z', ['exercise-anchor'])], false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(freshScore).toBeGreaterThan(anchorScore)
  })

  it('progress_possible — якорь и с одной неделей в блоке', () => {
    const stateWithProgress = { ...coachState, exercises: { 'exercise-anchor': { status: 'progress_possible' } } }
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: new Map([['exercise-anchor', new Set(['2026-10-12'])]]),
    })
    const anchorScore = exerciseScore(anchor, stateWithProgress, [workout('2026-10-15T12:00:00Z', ['exercise-anchor'])], false, emptyPreferences(), weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(anchorScore).toBeGreaterThan(freshScore)
  })

  it('preferred — якорь и с одной неделей в блоке', () => {
    const preferences = { ...emptyPreferences(), preferredExerciseNames: ['тяга блока'] }
    const weeklyContext = blockContext({
      previousExerciseIds: new Set(['exercise-anchor']),
      blockUsageWeeks: new Map([['exercise-anchor', new Set(['2026-10-12'])]]),
    })
    const anchorScore = exerciseScore(anchor, coachState, [workout('2026-10-15T12:00:00Z', ['exercise-anchor'])], false, preferences, weeklyContext)
    const freshScore = exerciseScore(fresh, coachState, [], false, emptyPreferences(), weeklyContext)
    expect(anchorScore).toBeGreaterThan(freshScore)
  })
})

// ---------------------------------------------------------------------------
// chooseBestExerciseForMuscle: ротация второго эшелона по под-ключам (issue #482)
// ---------------------------------------------------------------------------

describe('chooseBestExerciseForMuscle: смена региона стимула на границе фазы (issue #482)', () => {
  const coachState = { muscleGroups: { legs: { fatigue: 'low' } }, exercises: {} }
  const library = [
    libraryExercise({ id: 'hack-squat', name: 'Наклонный жим ногами', muscleKey: 'legs', muscleGroup: 'Ноги', subMuscleKeys: ['quads'] }),
    libraryExercise({ id: 'leg-curl', name: 'Сгибание ног', muscleKey: 'legs', muscleGroup: 'Ноги', subMuscleKeys: ['hamstrings'] }),
    libraryExercise({ id: 'leg-press', name: 'Жим ногами в тренажере', muscleKey: 'legs', muscleGroup: 'Ноги', subMuscleKeys: ['quads'] }),
  ]

  const choose = ({ weeklyContext, history = [] }) => chooseBestExerciseForMuscle({
    muscleKey: 'legs',
    library,
    coachState,
    coachMemory: null,
    coachDecision: null,
    history,
    usedExerciseIds: new Set(),
    usedSubMuscleKeys: new Set(),
    lowReadiness: false,
    preferences: emptyPreferences(),
    weeklyContext,
  })

  it('на границе фазы новый кандидат выбирается с другим под-ключом', () => {
    // occupant leg-press (quads) — из недели loading; на границе accumulation
    // слот отходит leg-curl (hamstrings), а не соседу по quadriceps.
    const weeklyContext = {
      ...emptyWeeklyContext(),
      cycleStartedOn: '2026-10-05',
      phaseStartedOn: '2026-10-12',
      blockUsageWeeks: new Map([['leg-press', new Set(['2026-10-05'])]]),
      previousExerciseIds: new Set(['leg-press']),
    }
    const history = [workout('2026-10-08T12:00:00Z', ['leg-press'])]
    expect(choose({ weeklyContext, history })?.id).toBe('leg-curl')
  })

  it('внутри фазы occupant удерживает слот', () => {
    const weeklyContext = {
      ...emptyWeeklyContext(),
      cycleStartedOn: '2026-10-05',
      phaseStartedOn: '2026-10-12',
      blockUsageWeeks: new Map([['leg-press', new Set(['2026-10-12'])]]),
      previousExerciseIds: new Set(['leg-press']),
    }
    const history = [workout('2026-10-15T12:00:00Z', ['leg-press'])]
    expect(choose({ weeklyContext, history })?.id).toBe('leg-press')
  })

  it('без кандидата с другим под-ключом — фолбэк на лучшего доступного', () => {
    const weeklyContext = {
      ...emptyWeeklyContext(),
      cycleStartedOn: '2026-10-05',
      phaseStartedOn: '2026-10-12',
      blockUsageWeeks: new Map([['leg-press', new Set(['2026-10-05'])]]),
      previousExerciseIds: new Set(['leg-press']),
    }
    const history = [workout('2026-10-08T12:00:00Z', ['leg-press'])]
    const result = chooseBestExerciseForMuscle({
      muscleKey: 'legs',
      library: [library.filter((e) => e.id !== 'leg-curl')[0], library.filter((e) => e.id !== 'leg-curl')[1]],
      coachState,
      coachMemory: null,
      coachDecision: null,
      history,
      usedExerciseIds: new Set(),
      usedSubMuscleKeys: new Set(),
      lowReadiness: false,
      preferences: emptyPreferences(),
      weeklyContext,
    })
    expect(result?.id).toBe('hack-squat')
  })
})
