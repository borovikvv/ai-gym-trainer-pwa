// Issue #171: подростковые ограничения. Все гарантии собраны в одном файле —
// они пересекают модули (справочник → правила → кламп LLM → планировщик →
// оценка силы), и читать их порознь бессмысленно.
import { describe, expect, it } from 'vitest'
import { isAxialFreeWeight, isTeenAge, teenLimitsApply, TEEN_MIN_REPS } from '../shared/teenLimits.ts'
import { recommendNextSet } from './coachEngine.ts'
import { clampNextSetDecision, getUserTrainingPolicy } from './userTrainingPolicies.ts'
import { clampRefinedPlannedExercises } from './services/plannedWorkoutAdvisor.ts'
import { buildGeneratedPlannedWorkout } from './plannedWorkoutGenerator.ts'
import { buildAllExerciseE1RMHistories, e1rmOptionsForProfile } from '../src/domain/estimatedOneRepMax.ts'

const TEEN = { userId: 'teen-user', age: 15 }
const ADULT = { userId: 'adult-user', age: 43 }

// Метаданные — как в справочнике (миграции 2026-06-23 / 2026-07-16).
const BENCH = { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', equipment: 'barbell', exerciseType: 'compound', movementPattern: 'push' }
const DEADLIFT = { id: 'conventional-deadlift', name: 'Становая тяга', muscleGroup: 'Ягодицы/задняя цепь', equipment: 'barbell', exerciseType: 'compound', movementPattern: 'hinge' }
const CURL = { id: 'barbell-curl', name: 'Сгибание рук со штангой', muscleGroup: 'Руки', equipment: 'barbell', exerciseType: 'isolation', movementPattern: 'isolation' }
const LEG_PRESS = { id: 'leg-press', name: 'Жим ногами', muscleGroup: 'Ноги', equipment: 'machine', exerciseType: 'compound', movementPattern: 'squat' }

describe('#171 признак осевого свободновесного движения', () => {
  it('относит к осевым жим со штангой, присед, становую и жим над головой', () => {
    expect(isAxialFreeWeight(BENCH)).toBe(true)
    expect(isAxialFreeWeight(DEADLIFT)).toBe(true)
    expect(isAxialFreeWeight({ equipment: 'barbell', exerciseType: 'compound', movementPattern: 'squat' })).toBe(true)
    expect(isAxialFreeWeight({ equipment: 'dumbbell', exerciseType: 'compound', movementPattern: 'push' })).toBe(true)
  })

  it('не относит к осевым изоляцию, тренажёры, блоки и вес тела', () => {
    expect(isAxialFreeWeight(CURL)).toBe(false)
    expect(isAxialFreeWeight(LEG_PRESS)).toBe(false)
    expect(isAxialFreeWeight({ equipment: 'cable', exerciseType: 'compound', movementPattern: 'pull' })).toBe(false)
    expect(isAxialFreeWeight({ equipment: 'bodyweight', exerciseType: 'compound', movementPattern: 'push' })).toBe(false)
    // Тяга гантели — свободный вес и многосуставное, но не осевой паттерн.
    expect(isAxialFreeWeight({ equipment: 'dumbbell', exerciseType: 'compound', movementPattern: 'pull' })).toBe(false)
  })

  it('без метаданных считает упражнение неосевым и не падает на пустом входе', () => {
    expect(isAxialFreeWeight({ id: 'unknown' })).toBe(false)
    expect(isAxialFreeWeight(null)).toBe(false)
    expect(isAxialFreeWeight(undefined)).toBe(false)
  })

  it('включает ограничения по возрасту из профиля, а не по имени пользователя', () => {
    expect(isTeenAge(15)).toBe(true)
    expect(isTeenAge(17)).toBe(true)
    expect(isTeenAge(18)).toBe(false)
    expect(isTeenAge(43)).toBe(false)
    expect(isTeenAge(null)).toBe(false)
    expect(isTeenAge(undefined)).toBe(false)

    // Обе части обязательны: возраст И осевое движение.
    expect(teenLimitsApply(15, BENCH)).toBe(true)
    expect(teenLimitsApply(43, BENCH)).toBe(false)
    expect(teenLimitsApply(15, CURL)).toBe(false)
  })
})

describe('#171 правило 1: назначения подростку не ведут к отказу', () => {
  const exercise = { ...BENCH, repMin: 6, repMax: 8, targetWeight: 40, weightStep: 2.5, restSeconds: 150 }

  it('после подхода на RPE 9 снижает вес сразу, без ветки «держим вес»', () => {
    const result = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(TEEN),
      exercise,
      completedSets: [{ weight: 40, reps: 6, rpe: 9, completed: true }],
      remainingSets: 2,
    })

    expect(result.action).toBe('reduce_load')
    expect(result.recommendedWeight).toBe(37.5)
    // Правило 5: причина ограничения названа явно.
    expect(result.reason).toContain('без отказа')
    expect(result.reason).toContain('техники')
  })

  it('прибавляет вес раньше взрослого порога и называет причину (правило 4)', () => {
    // Запас всего +1 повтор сверх верха диапазона: взрослому это ещё не повод
    // прибавлять, подростку — уже повод, но ровно на один шаг.
    const light = [{ weight: 40, reps: 9, rpe: 6, completed: true }]

    const teen = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(TEEN),
      exercise,
      completedSets: light,
      remainingSets: 2,
    })
    expect(teen.recommendedWeight).toBe(42.5)
    expect(teen.reason).toContain('мелкими шагами')

    const adult = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(ADULT),
      exercise,
      completedSets: light,
      remainingSets: 2,
    })
    expect(adult.recommendedWeight).toBe(40)
  })

  it('взрослому на том же подходе вес не режет — это подростковое ограничение', () => {
    const result = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(ADULT),
      exercise,
      completedSets: [{ weight: 40, reps: 6, rpe: 9, completed: true }],
      remainingSets: 2,
    })

    expect(result.action).toBe('hold_load')
  })
})

describe('#171 правило 2: подходы на 1–4 повтора подростку не назначаются', () => {
  // Ветка, где назначается ровно нижняя граница диапазона: без ограничения
  // подростку выписали бы справочные 4 повтора становой.
  const heavySet = [{ weight: 60, reps: 5, rpe: 9, completed: true }]

  it('поднимает нижнюю границу повторов на осевом движении со справочных 4 до 5', () => {
    const result = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(TEEN),
      // Становая в справочнике: 4–6 повторов.
      exercise: { ...DEADLIFT, repMin: 4, repMax: 6, targetWeight: 60, weightStep: 5, restSeconds: 150 },
      completedSets: heavySet,
      remainingSets: 2,
    })

    expect(result.recommendedReps).toBe(TEEN_MIN_REPS)
  })

  it('на изоляции ограничение не действует — короткий диапазон остаётся как есть', () => {
    const result = recommendNextSet({
      userTrainingPolicy: getUserTrainingPolicy(TEEN),
      exercise: { ...CURL, repMin: 4, repMax: 6, targetWeight: 60, weightStep: 2.5, restSeconds: 90 },
      completedSets: heavySet,
      remainingSets: 2,
    })

    expect(result.recommendedReps).toBe(4)
  })

  it('LLM не может предложить подростку проходку — кламп поднимает повторы до пяти', () => {
    const clamped = clampNextSetDecision(
      { nextSet: { weight: 60, reps: 2, restSeconds: 180, targetRpe: 10 }, strategyAction: { type: 'hold' }, reason: 'проходка!' },
      {
        userId: TEEN.userId,
        policy: getUserTrainingPolicy(TEEN),
        axialFreeWeight: true,
        lastSet: { weight: 60, reps: 5, rpe: 8 },
        weightStep: 5,
      },
    )

    expect(clamped.nextSet.reps).toBe(TEEN_MIN_REPS)
    // Отказ тоже не проходит: потолок RPE для профиля без отказных подходов — 8.
    expect(clamped.nextSet.targetRpe).toBeLessThanOrEqual(8)
  })

  it('взрослому кламп короткий подход разрешает', () => {
    const clamped = clampNextSetDecision(
      { nextSet: { weight: 60, reps: 3, restSeconds: 180, targetRpe: 9 }, strategyAction: { type: 'hold' } },
      {
        userId: ADULT.userId,
        policy: getUserTrainingPolicy(ADULT),
        axialFreeWeight: true,
        lastSet: { weight: 60, reps: 5, rpe: 7 },
        weightStep: 5,
      },
    )

    expect(clamped.nextSet.reps).toBe(3)
  })

  it('LLM-советник плана не опускает нижнюю границу ниже пяти на ограниченном упражнении', () => {
    const baseline = [{
      exerciseId: 'conventional-deadlift',
      exerciseName: 'Становая тяга',
      muscleGroup: 'Ягодицы/задняя цепь',
      muscleKey: 'glutes',
      setsCount: 3,
      repMin: 5,
      repMax: 8,
      targetWeight: 60,
      weightStep: 5,
      coachFocus: 'Становая тяга: работаем без отказа — так надо.',
      teenLimited: true,
    }]

    const { exercises } = clampRefinedPlannedExercises(
      baseline,
      [{ exerciseId: 'conventional-deadlift', repMin: 2, repMax: 4, coachFocus: 'идём на максимум' }],
      { isDeload: false, maxWeightJumpSteps: 1 },
    )

    expect(exercises[0].repMin).toBeGreaterThanOrEqual(TEEN_MIN_REPS)
    // Правило 5: текст с причиной LLM не переписывает.
    expect(exercises[0].coachFocus).toBe(baseline[0].coachFocus)
  })
})

describe('#171 правило 2: e1RM игнорирует короткие подходы у подростка', () => {
  const history = [{
    completedAt: '2026-07-20T10:00:00.000Z',
    exercises: [{
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      muscleGroup: 'Грудь',
      sets: [
        { weight: 50, reps: 8, completed: true },
        // Проходка: даёт более высокий e1RM, но в расчёт идти не должна.
        { weight: 70, reps: 2, completed: true },
      ],
    }],
  }]

  it('берёт подход на 8 повторов и отбрасывает подход на 2', () => {
    const [teenHistory] = buildAllExerciseE1RMHistories(history, e1rmOptionsForProfile({ age: 15, weightKg: 60 }))
    expect(teenHistory.dataPoints[0].reps).toBe(8)
    expect(teenHistory.currentBest).toBe(60)
  })

  it('взрослому короткий подход по-прежнему считается', () => {
    const [adultHistory] = buildAllExerciseE1RMHistories(history, e1rmOptionsForProfile({ age: 43, weightKg: 80 }))
    expect(adultHistory.dataPoints[0].reps).toBe(2)
    expect(adultHistory.currentBest).toBe(73.5)
  })
})

describe('#171 правило 5: причина ограничения доходит до пользователя', () => {
  const exerciseLibrary = [
    { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150, instruction: 'жим', equipment: 'barbell', exercise_type: 'compound', movement_pattern: 'push' },
    { id: 'conventional-deadlift', name: 'Становая тяга', muscleGroup: 'Ягодицы/задняя цепь', setsCount: 3, repMin: 4, repMax: 6, targetWeight: 60, weightStep: 5, restSeconds: 150, instruction: 'тяга', equipment: 'barbell', exercise_type: 'compound', movement_pattern: 'hinge' },
    { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 90, instruction: 'тяга', equipment: 'cable', exercise_type: 'compound', movement_pattern: 'pull' },
    { id: 'barbell-curl', name: 'Сгибание рук со штангой', muscleGroup: 'Руки', setsCount: 2, repMin: 4, repMax: 6, targetWeight: 20, weightStep: 2.5, restSeconds: 75, instruction: 'руки', equipment: 'barbell', exercise_type: 'isolation', movement_pattern: 'isolation' },
    { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60, instruction: 'кор', equipment: 'bodyweight', exercise_type: 'compound', movement_pattern: 'rotation' },
  ]

  const teenProfile = {
    userId: 'teen-user',
    age: 15,
    goal: 'сила и мышечная масса',
    level: 'intermediate',
    workoutsPerWeek: 2,
    targetWorkoutMinutes: 60,
    preferences: { focusAreas: ['грудь', 'ноги'], intensityTolerance: 'aggressive' },
  }

  it('в плане подростка ни одно упражнение не выписано короче пяти повторов, а причина приложена', async () => {
    const plan = await buildGeneratedPlannedWorkout({
      profile: teenProfile,
      scheduledDate: '2026-07-15',
      coachState: { recoveryStatus: 'ready', readinessScore: 80, muscleGroups: {} },
      exerciseLibrary,
      history: [],
    })

    const limited = plan.exercises.filter((exercise) => exercise.teenLimited)
    expect(limited.length).toBeGreaterThan(0)
    for (const exercise of limited) {
      expect(exercise.repMin).toBeGreaterThanOrEqual(TEEN_MIN_REPS)
      expect(exercise.repMax).toBeGreaterThanOrEqual(exercise.repMin)
      expect(exercise.coachFocus).toContain('без отказа')
    }
  })

  it('взрослому тот же справочник оставляет короткий диапазон становой', async () => {
    const plan = await buildGeneratedPlannedWorkout({
      profile: { ...teenProfile, userId: 'adult-user', age: 43 },
      scheduledDate: '2026-07-15',
      coachState: { recoveryStatus: 'ready', readinessScore: 80, muscleGroups: {} },
      exerciseLibrary,
      history: [],
    })

    expect(plan.exercises.every((exercise) => exercise.teenLimited !== true)).toBe(true)
  })
})
