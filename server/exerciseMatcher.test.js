import { describe, expect, it } from 'vitest'
import { findReplacementForFatigue, findComplementaryExercises } from './exerciseMatcher.js'
import { normalizeMuscleGroup } from './lib/muscleGroups.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeExercise(id, name, muscleGroup, metadata = {}) {
  const muscleKey = normalizeMuscleGroup(`${muscleGroup} ${name}`)
  return {
    id,
    name,
    muscleGroup,
    muscleKey,
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    targetWeight: 40,
    weightStep: 2.5,
    restSeconds: 90,
    targetMuscles: metadata.targetMuscles ?? [],
    movementPattern: metadata.movementPattern ?? null,
    equipment: metadata.equipment ?? null,
    exerciseType: metadata.exerciseType ?? null,
    difficultyLevel: metadata.difficultyLevel ?? null,
  }
}

function makeCoachState(fatigueMap = {}) {
  const muscleGroups = {}
  for (const [key, fatigue] of Object.entries(fatigueMap)) {
    // key is a canonical muscle key like 'chest', 'back', etc.
    muscleGroups[key] = { fatigue, recentMaxEffortSets: 0, lastTrainedDaysAgo: null }
  }
  return {
    recoveryStatus: 'low',
    muscleGroups,
    exercises: {},
  }
}

// ---------------------------------------------------------------------------
// findReplacementForFatigue
// ---------------------------------------------------------------------------

describe('findReplacementForFatigue', () => {
  const benchPress = makeExercise('bench-press', 'Жим лёжа', 'Грудь', {
    targetMuscles: ['средняя груди', 'передняя дельта', 'трицепс'],
    movementPattern: 'push',
    equipment: 'barbell',
    exerciseType: 'compound',
  })

  const latPulldown = makeExercise('lat-pulldown', 'Тяга верхнего блока', 'Спина', {
    targetMuscles: ['широчайшие', 'бицепс'],
    movementPattern: 'pull',
    equipment: 'cable',
    exerciseType: 'compound',
  })

  const plank = makeExercise('plank', 'Планка', 'Кор', {
    targetMuscles: ['прямая мышца живота'],
    movementPattern: 'isolation',
    equipment: 'bodyweight',
    exerciseType: 'isolation',
  })

  const cableCurl = makeExercise('cable-curl', 'Сгибание на блоке', 'Руки', {
    targetMuscles: ['бицепс'],
    movementPattern: 'isolation',
    equipment: 'cable',
    exerciseType: 'isolation',
  })

  it('returns null when current muscle is not fatigued', () => {
    const coachState = makeCoachState({ chest: 'low' })
    const result = findReplacementForFatigue(benchPress, [latPulldown, plank], new Set(), coachState)
    expect(result).toBeNull()
  })

  it('returns null when recovery is not low/partial', () => {
    const coachState = makeCoachState({ chest: 'high' })
    coachState.recoveryStatus = 'normal'
    const result = findReplacementForFatigue(benchPress, [latPulldown, plank], new Set(), coachState)
    expect(result).toBeNull()
  })

  it('prefers exercise with shared target muscles (передняя дельта)', () => {
    const coachState = makeCoachState({ chest: 'high', back: 'low', core: 'low', arms: 'low' })
    const library = [latPulldown, plank, cableCurl]
    const result = findReplacementForFatigue(benchPress, library, new Set(), coachState)
    expect(result).not.toBeNull()
    expect(result.id).toBe('lat-pulldown')
  })

  it('skips exercises already used in the workout', () => {
    const coachState = makeCoachState({ chest: 'high', back: 'low', core: 'low' })
    const usedIds = new Set(['lat-pulldown'])
    const library = [latPulldown, plank]
    const result = findReplacementForFatigue(benchPress, library, usedIds, coachState)
    expect(result.id).toBe('plank')
  })

  it('skips exercises on highly fatigued muscle groups', () => {
    const coachState = makeCoachState({ chest: 'high', back: 'high', core: 'high' })
    const library = [latPulldown, plank]
    const result = findReplacementForFatigue(benchPress, library, new Set(), coachState)
    expect(result).toBeNull()
  })

  it('prefers same movement pattern (push replaces push)', () => {
    const overheadPress = makeExercise('db-shoulder-press', 'Жим гантелей сидя', 'Плечи', {
      targetMuscles: ['передняя дельта', 'средняя дельта', 'трицепс'],
      movementPattern: 'push',
      equipment: 'dumbbell',
      exerciseType: 'compound',
    })

    const coachState = makeCoachState({ chest: 'high', shoulders: 'low', back: 'low' })
    const library = [overheadPress, latPulldown]
    const result = findReplacementForFatigue(benchPress, library, new Set(), coachState)
    expect(result.id).toBe('db-shoulder-press')
  })

  it('works without metadata (backward compat)', () => {
    const noMetadataExercise = makeExercise('unknown-ex', 'Неизвестное', 'Спина', {})
    const coachState = makeCoachState({ chest: 'high', back: 'low' })
    const library = [noMetadataExercise]
    const result = findReplacementForFatigue(benchPress, library, new Set(), coachState)
    expect(result).not.toBeNull()
    expect(result.id).toBe('unknown-ex')
  })
})

// ---------------------------------------------------------------------------
// findComplementaryExercises
// ---------------------------------------------------------------------------

describe('findComplementaryExercises', () => {
  const benchPress = makeExercise('bench-press', 'Жим лёжа', 'Грудь', {
    targetMuscles: ['средняя груди', 'передняя дельта', 'трицепс'],
    movementPattern: 'push',
    equipment: 'barbell',
    exerciseType: 'compound',
  })

  const plank = makeExercise('plank', 'Планка', 'Кор', {
    targetMuscles: ['прямая мышца живота'],
    movementPattern: 'isolation',
    equipment: 'bodyweight',
    exerciseType: 'isolation',
  })

  const latPulldown = makeExercise('lat-pulldown', 'Тяга верхнего блока', 'Спина', {
    targetMuscles: ['широчайшие', 'бицепс'],
    movementPattern: 'pull',
    equipment: 'cable',
    exerciseType: 'compound',
  })

  const bodyweightSquat = makeExercise('bodyweight-squat', 'Приседания', 'Ноги', {
    targetMuscles: ['квадрицепс', 'ягодицы'],
    movementPattern: 'squat',
    equipment: 'bodyweight',
    exerciseType: 'compound',
  })

  it('returns exercises from different muscle groups first', () => {
    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [plank, latPulldown, bodyweightSquat],
      limit: 3,
    })

    expect(result).toHaveLength(3)
    // All should be different muscle groups from bench press (Грудь)
    expect(result.every((r) => r.muscleGroup !== 'Грудь')).toBe(true)
  })

  it('prefers exercises with novel target muscles', () => {
    // After bench press (chest/delts/triceps), an exercise targeting legs
    // has 100% novel targets → should score higher than one targeting triceps.
    const skullCrusher = makeExercise('skull-crusher', 'Французский жим', 'Руки', {
      targetMuscles: ['трицепс'], // already trained by bench press
      movementPattern: 'isolation',
      equipment: 'barbell',
      exerciseType: 'isolation',
    })

    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [skullCrusher, bodyweightSquat],
      limit: 2,
    })

    // bodyweightSquat should rank higher (novel muscles: квадрицепс, ягодицы)
    expect(result[0].id).toBe('bodyweight-squat')
  })

  it('prefers different movement pattern for variety', () => {
    // After bench press (push), a pull exercise should score higher than
    // another push exercise.
    const pushUp = makeExercise('push-up', 'Отжимания', 'Грудь', {
      targetMuscles: ['средняя груди', 'трицепс'],
      movementPattern: 'push',
      equipment: 'bodyweight',
      exerciseType: 'compound',
    })

    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [pushUp, latPulldown],
      limit: 2,
    })

    // latPulldown (pull) should rank higher than pushUp (push, same pattern)
    expect(result[0].id).toBe('lat-pulldown')
  })

  it('skips exercises already in the workout', () => {
    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress, plank],
      library: [benchPress, plank, latPulldown],
      limit: 3,
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('lat-pulldown')
  })

  it('respects limit parameter', () => {
    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [plank, latPulldown, bodyweightSquat],
      limit: 2,
    })

    expect(result).toHaveLength(2)
  })

  it('works without metadata (backward compat)', () => {
    const noMeta = makeExercise('no-meta', 'Без метаданных', 'Ноги', {})
    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [noMeta],
      limit: 3,
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('no-meta')
  })

  it('prefers different equipment for variety', () => {
    // After barbell bench press, a cable exercise should score higher than
    // another barbell exercise (equipment variety).
    const barbellRow = makeExercise('barbell-row', 'Тяга штанги', 'Спина', {
      targetMuscles: ['широчайшие'],
      movementPattern: 'pull',
      equipment: 'barbell', // same as bench press
      exerciseType: 'compound',
    })

    const result = findComplementaryExercises({
      currentExercise: benchPress,
      nextExercise: null,
      workoutExercises: [benchPress],
      library: [barbellRow, latPulldown], // latPulldown is cable
      limit: 2,
    })

    // latPulldown (cable, different equipment) should rank higher
    expect(result[0].id).toBe('lat-pulldown')
  })
})
