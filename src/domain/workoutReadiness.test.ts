import { describe, expect, it } from 'vitest'
import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import { defaultReadinessCheckIn, resolveReadinessMode } from './readinessCheckIn'
import {
  adaptWorkoutDayForReadiness,
  applyPreviewPainOverrides,
  estimateWorkoutMinutes,
  fitWorkoutDayToAvailableMinutes,
  suggestPainSafeAlternative,
} from './workoutReadiness'

const workoutDay: WorkoutDay = {
  id: 'day-a',
  name: 'День A',
  label: 'Грудь/спина',
  description: 'base',
  exercises: [
    {
      id: 'bench-press',
      name: 'Жим лёжа',
      muscleGroup: 'Грудь',
      targetMuscles: ['верх груди', 'средняя груди', 'передняя дельта', 'трицепс'],
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 60,
      weightStep: 2.5,
      restSeconds: 120,
      prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
    {
      id: 'lat-pulldown',
      name: 'Тяга верхнего блока',
      muscleGroup: 'Спина',
      targetMuscles: ['широчайшие', 'бицепс', 'задняя дельта'],
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 40,
      weightStep: 2.5,
      restSeconds: 90,
      prescription: '3×8–10 · рекомендовано 40 кг · отдых 90 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
    {
      id: 'barbell-squat',
      name: 'Присед со штангой',
      muscleGroup: 'Ноги',
      targetMuscles: ['квадрицепс', 'ягодицы', 'поясница', 'кор'],
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 6,
      repMax: 8,
      targetWeight: 70,
      weightStep: 2.5,
      restSeconds: 150,
      prescription: '3×6–8 · рекомендовано 70 кг · отдых 150 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
    {
      id: 'leg-press',
      name: 'Жим ногами',
      muscleGroup: 'Ноги',
      targetMuscles: ['квадрицепс', 'ягодицы'],
      instruction: '',
      commonMistakes: [],
      alternatives: [],
      setsCount: 3,
      repMin: 8,
      repMax: 10,
      targetWeight: 60,
      weightStep: 2.5,
      restSeconds: 120,
      prescription: '3×8–10 · рекомендовано 60 кг · отдых 120 сек',
      previous: '',
      todayGoal: '',
      coachFocus: 'контроль техники',
    },
  ],
}

describe('workout readiness adaptation', () => {
  it('adds targeted reduction for sore muscle groups without weakening unrelated exercises', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'light', {
      ...defaultReadinessCheckIn,
      soreness: 'medium',
      soreMuscleGroups: ['Грудь'],
    })

    const bench = adapted.exercises.find((exercise) => exercise.id === 'bench-press')
    const pulldown = adapted.exercises.find((exercise) => exercise.id === 'lat-pulldown')
    expect(bench?.setsCount).toBe(2)
    expect(bench?.coachFocus).toContain('Отмечена забитость')
    expect(pulldown?.setsCount).toBe(3)
  })

  it('treats pain areas as a stronger targeted safety constraint', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })

    const pulldown = adapted.exercises.find((exercise) => exercise.id === 'lat-pulldown')
    expect(pulldown?.setsCount).toBe(1)
    expect(pulldown?.coachFocus).toContain('Есть боль')
  })

  it('treats barbell squat as related to back pain via target muscles', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Спина'],
    })

    const squat = adapted.exercises.find((exercise) => exercise.id === 'barbell-squat')
    expect(squat?.setsCount).toBe(1)
    expect(squat?.coachFocus).toContain('Есть боль')
  })

  it('does not treat leg press as related to shoulder pain', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Плечо'],
    })

    const legPress = adapted.exercises.find((exercise) => exercise.id === 'leg-press')
    expect(legPress?.setsCount).toBe(2)
    expect(legPress?.coachFocus).not.toContain('Есть боль')
  })

  it('treats bench press as related to elbow/arm pain via triceps', () => {
    const adapted = adaptWorkoutDayForReadiness(workoutDay, 'very_light', {
      ...defaultReadinessCheckIn,
      painAreas: ['Локоть/рука'],
    })

    const bench = adapted.exercises.find((exercise) => exercise.id === 'bench-press')
    expect(bench?.setsCount).toBe(1)
    expect(bench?.coachFocus).toContain('Есть боль')
  })

  it('only eases exercises linked to the reported pain area, not the whole day', () => {
    const checkIn = { ...defaultReadinessCheckIn, painAreas: ['Локоть/рука'] }
    const mode = resolveReadinessMode(checkIn)
    const adapted = adaptWorkoutDayForReadiness(workoutDay, mode, checkIn)

    const legPress = adapted.exercises.find((exercise) => exercise.id === 'leg-press')
    expect(legPress?.setsCount).toBe(3)
    expect(legPress?.targetWeight).toBe(60)

    const bench = adapted.exercises.find((exercise) => exercise.id === 'bench-press')
    expect(bench?.setsCount).toBe(1)
    expect(bench?.coachFocus).toContain('Есть боль')
  })
})

describe('fitWorkoutDayToAvailableMinutes', () => {
  const exercise = (overrides: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup' | 'targetWeight'>): ExercisePlan => ({
    instruction: '',
    commonMistakes: [],
    alternatives: [],
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    weightStep: 2.5,
    restSeconds: 180,
    prescription: '',
    previous: '',
    todayGoal: '',
    coachFocus: 'контроль техники',
    ...overrides,
  })

  const dayWithExercises = (id: string, exercises: ExercisePlan[]): WorkoutDay => ({
    id,
    name: 'День',
    label: 'label',
    description: 'base',
    exercises,
  })

  const tightDay = dayWithExercises('day-tight', [
    exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60 }),
    exercise({ id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', targetWeight: 40 }),
    exercise({ id: 'biceps-curl', name: 'Подъём гантелей на бицепс', muscleGroup: 'Руки', targetWeight: 10, repMax: 12, weightStep: 1, restSeconds: 90 }),
  ])

  it('returns the same day when the plan already fits', () => {
    const day = dayWithExercises('day-short', [
      exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60, restSeconds: 60 }),
    ])
    expect(estimateWorkoutMinutes(day)).toBeLessThanOrEqual(30)
    expect(fitWorkoutDayToAvailableMinutes(day, 30)).toBe(day)
  })

  it('cuts volume down to the time budget without touching targetWeight', () => {
    expect(estimateWorkoutMinutes(tightDay)).toBeGreaterThan(36)

    const result = fitWorkoutDayToAvailableMinutes(tightDay, 36)

    expect(estimateWorkoutMinutes(result)).toBeLessThanOrEqual(36)
    for (const remaining of result.exercises) {
      const original = tightDay.exercises.find((item) => item.id === remaining.id)
      expect(remaining.targetWeight).toBe(original?.targetWeight)
    }
  })

  it('rebuilds the prescription when a set is removed', () => {
    const result = fitWorkoutDayToAvailableMinutes(tightDay, 36)
    const pulldown = result.exercises.find((item) => item.id === 'lat-pulldown')
    expect(pulldown?.setsCount).toBe(2)
    expect(pulldown?.prescription).toBe('2×8–10 · рекомендовано 40 кг · отдых 180 сек')
  })

  it('cuts isolation exercises before touching the base ones', () => {
    const baseAndIsolation = dayWithExercises('day-base-isolation', [
      exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60, setsCount: 5 }),
      exercise({ id: 'biceps-curl', name: 'Подъём гантелей на бицепс', muscleGroup: 'Руки', targetWeight: 10, restSeconds: 90 }),
    ])
    expect(estimateWorkoutMinutes(baseAndIsolation)).toBeGreaterThan(34)

    const result = fitWorkoutDayToAvailableMinutes(baseAndIsolation, 34)

    expect(estimateWorkoutMinutes(result)).toBeLessThanOrEqual(34)
    const base = result.exercises.find((item) => item.id === 'bench-press')
    expect(base?.setsCount).toBe(5)
    expect(base?.targetWeight).toBe(60)
    expect(result.exercises.some((item) => item.id === 'biceps-curl')).toBe(false)
  })
})

describe('estimateWorkoutMinutes', () => {
  const exercise = (overrides: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name' | 'muscleGroup' | 'targetWeight'>): ExercisePlan => ({
    instruction: '',
    commonMistakes: [],
    alternatives: [],
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    weightStep: 2.5,
    restSeconds: 180,
    prescription: '',
    previous: '',
    todayGoal: '',
    coachFocus: 'контроль техники',
    ...overrides,
  })

  const dayWithExercises = (id: string, exercises: ExercisePlan[]): WorkoutDay => ({
    id,
    name: 'День',
    label: 'label',
    description: 'base',
    exercises,
  })

  it('включает общую разминку и переход между упражнениями (issue #346)', () => {
    const solo = dayWithExercises('day-solo', [
      exercise({ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 60, setsCount: 3, restSeconds: 120 }),
    ])
    const pair = dayWithExercises('day-pair', [
      ...solo.exercises,
      exercise({ id: 'row', name: 'Тяга штанги в наклоне', muscleGroup: 'Спина', targetWeight: 40, setsCount: 3, restSeconds: 120 }),
    ])

    expect(estimateWorkoutMinutes(solo)).toBe(21)
    expect(estimateWorkoutMinutes(pair)).toBe(35)
  })
})

describe('suggestPainSafeAlternative', () => {
  const makePlan = (overrides: Partial<ExercisePlan> & Pick<ExercisePlan, 'id' | 'name' | 'targetMuscles'>): ExercisePlan => ({
    muscleGroup: 'Ноги',
    instruction: '',
    commonMistakes: [],
    alternatives: [],
    setsCount: 3,
    repMin: 8,
    repMax: 10,
    targetWeight: 50,
    weightStep: 2.5,
    restSeconds: 120,
    prescription: '',
    previous: '',
    todayGoal: '',
    coachFocus: 'контроль техники',
    ...overrides,
  })

  const painfulSquat = makePlan({
    id: 'barbell-squat',
    name: 'Присед со штангой',
    targetMuscles: ['квадрицепс', 'ягодицы'],
    alternatives: [
      { name: 'Замена A', reason: 'вариант' },
      { name: 'Замена B', reason: 'вариант' },
    ],
  })

  it('подбирает первую альтернативу, которая не нагружает зону боли', () => {
    const unsafe = makePlan({ id: 'alt-a', name: 'Замена A', targetMuscles: ['квадрицепс'] })
    const safe = makePlan({ id: 'alt-b', name: 'Замена B', targetMuscles: ['кор'] })

    expect(suggestPainSafeAlternative(painfulSquat, ['Колено/нога'], [unsafe, safe])).toEqual({
      type: 'replace',
      alternative: { name: 'Замена B', reason: 'вариант' },
      replacement: safe,
    })
  })

  it('предлагает пропустить, если все альтернативы нагружают зону боли', () => {
    const first = makePlan({ id: 'alt-a', name: 'Замена A', targetMuscles: ['квадрицепс'] })
    const second = makePlan({ id: 'alt-b', name: 'Замена B', targetMuscles: ['ягодицы'] })

    expect(suggestPainSafeAlternative(painfulSquat, ['Колено/нога'], [first, second])).toEqual({ type: 'skip' })
  })

  it('не считает безопасной альтернативу, которой нет в справочнике', () => {
    expect(suggestPainSafeAlternative(painfulSquat, ['Колено/нога'], [])).toEqual({ type: 'skip' })
  })

  it('возвращает null без боли в связанной зоне', () => {
    expect(suggestPainSafeAlternative(painfulSquat, [], [])).toBeNull()
    expect(suggestPainSafeAlternative(painfulSquat, ['Плечо'], [])).toBeNull()
  })
})

describe('applyPreviewPainOverrides', () => {
  const replacement: ExercisePlan = { ...workoutDay.exercises[3], name: 'Замена ног', coachFocus: 'замена' }

  it('убирает пропущенные упражнения и подставляет замену по id', () => {
    const result = applyPreviewPainOverrides(workoutDay, {
      'barbell-squat': 'skip',
      'leg-press': replacement,
    })

    expect(result.exercises.some((exercise) => exercise.id === 'barbell-squat')).toBe(false)
    expect(result.exercises.find((exercise) => exercise.id === 'leg-press')).toBe(replacement)
    expect(result.exercises.find((exercise) => exercise.id === 'bench-press')).toEqual(workoutDay.exercises[0])
    expect(result.exercises.find((exercise) => exercise.id === 'lat-pulldown')).toEqual(workoutDay.exercises[1])
  })

  it('возвращает исходный день без переопределений', () => {
    expect(applyPreviewPainOverrides(workoutDay, {})).toBe(workoutDay)
  })
})
