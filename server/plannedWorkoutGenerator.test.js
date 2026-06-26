import { describe, expect, it } from 'vitest'
import { buildGeneratedPlannedWorkout } from './plannedWorkoutGenerator.js'

const profile = {
  userId: 'vyacheslav',
  goal: 'сила и мышечная масса',
  level: 'intermediate',
  workoutsPerWeek: 2,
  targetWorkoutMinutes: 60,
}

const exerciseLibrary = [
  { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150, instruction: 'жим' },
  { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 90, instruction: 'тяга' },
  { id: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'Ноги', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 60, weightStep: 2.5, restSeconds: 150, instruction: 'присед' },
  { id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150, instruction: 'тяга' },
  { id: 'db-shoulder-press', name: 'Жим гантелей сидя', muscleGroup: 'Плечи', setsCount: 2, repMin: 8, repMax: 10, targetWeight: 12, weightStep: 2, restSeconds: 90, instruction: 'плечи' },
  { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 10, weightStep: 1, restSeconds: 75, instruction: 'руки' },
  { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60, instruction: 'кор' },
]

describe('planned workout generator', () => {
  it('builds a concrete workout for the scheduled date from Coach State and the full exercise library', () => {
    const coachState = {
      recoveryStatus: 'partial',
      readinessScore: 68,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'high' },
        back: { fatigue: 'high' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-09',
      coachState,
      exerciseLibrary,
      history: [],
    })

    expect(plan.status).toBe('generated')
    expect(plan.source).toBe('coach')
    expect(plan.workoutDayName).toContain('персональная')
    expect(plan.coachReason).toContain('Coach State')
    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).toEqual(expect.arrayContaining([
      'barbell-squat',
      'romanian-deadlift',
      'db-shoulder-press',
      'hammer-curl',
      'plank',
    ]))
    expect(exerciseIds).toHaveLength(5)
    expect(exerciseIds).not.toContain('bench-press')
    expect(exerciseIds).not.toContain('lat-pulldown')
    expect(plan.exercises.every((exercise) => exercise.reason.length > 0)).toBe(true)
  })

  it('uses recent exercise history for working weights and reduces volume when readiness is low', () => {
    const coachState = {
      recoveryStatus: 'low',
      readinessScore: 42,
      weeklyLoadStatus: 'above_plan',
      muscleGroups: {
        chest: { fatigue: 'medium' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'high' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const history = [
      {
        completedAt: '2026-06-05T20:00:00.000Z',
        exercises: [
          { exerciseId: 'bench-press', nextRecommendedWeight: 47.5, sets: [{ completed: true, weight: 50, reps: 6, rpe: 10 }] },
          { exerciseId: 'lat-pulldown', nextRecommendedWeight: 42.5, sets: [{ completed: true, weight: 40, reps: 10, rpe: 7 }] },
        ],
      },
    ]

    const plan = buildGeneratedPlannedWorkout({ profile, scheduledDate: '2026-06-10', coachState, exerciseLibrary, history })

    expect(plan.goal).toContain('восстанов')
    expect(plan.exercises.length).toBeGreaterThanOrEqual(5)
    expect(plan.exercises.some((exercise) => exercise.setsCount >= 3)).toBe(true)
    expect(plan.exercises.every((exercise) => exercise.intensityTarget === 'easy')).toBe(true)
    const pulldown = plan.exercises.find((exercise) => exercise.exerciseId === 'lat-pulldown')
    expect(pulldown?.targetWeight).toBe(42.5)
    expect(plan.exercises.map((exercise) => exercise.exerciseId)).not.toContain('barbell-squat')
  })

  it('uses canonical history from generated exercise variants when prescribing the next plan', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 82,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'medium' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'medium' },
        shoulders: { fatigue: 'medium' },
        arms: { fatigue: 'medium' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const history = [
      {
        completedAt: '2026-06-05T20:00:00.000Z',
        exercises: [
          { exerciseId: 'lat-pulldown-extra-1780844823365', nextRecommendedWeight: 47.5, sets: [{ completed: true, weight: 45, reps: 12, rpe: 7 }] },
        ],
      },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, preferences: { focusAreas: ['спина'], sessionStyle: 'moderate_stable' } },
      scheduledDate: '2026-06-12',
      coachState,
      exerciseLibrary,
      history,
    })

    const pulldown = plan.exercises.find((exercise) => exercise.exerciseId === 'lat-pulldown')
    expect(pulldown?.targetWeight).toBe(47.5)
  })

  it('uses profile preferences to avoid banned exercises and prioritize focus areas', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 82,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildGeneratedPlannedWorkout({
      profile: {
        ...profile,
        bannedExercises: ['Присед со штангой'],
        preferredExercises: ['Жим лёжа'],
        preferences: {
          focusAreas: ['грудь', 'спина'],
          exerciseStyle: 'machines',
          intensityTolerance: 'rare_max',
          sessionStyle: 'moderate_stable',
        },
      },
      scheduledDate: '2026-06-12',
      coachState,
      exerciseLibrary,
      history: [],
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).toContain('bench-press')
    expect(exerciseIds).toContain('lat-pulldown')
    expect(exerciseIds).not.toContain('barbell-squat')
    expect(plan.coachReason).toContain('фокус: грудь, спина')
    expect(plan.exercises.every((exercise) => exercise.intensityTarget !== 'max_effort')).toBe(true)
  })

  it('diversifies nearby generated workouts while keeping the trainer profile explicit', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const variedLibrary = [
      ...exerciseLibrary,
      { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90 },
      { id: 'seated-row', name: 'Тяга в тренажёре', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 90 },
      { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 75 },
      { id: 'leg-curl', name: 'Сгибание ног лёжа', muscleGroup: 'Ноги', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 25, weightStep: 2.5, restSeconds: 90 },
      { id: 'face-pull', name: 'Face pull', muscleGroup: 'Плечи', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
    ]
    const preferenceProfile = {
      ...profile,
      bannedExercises: ['Румынская тяга'],
      preferredExercises: ['Жим лёжа'],
      preferences: {
        focusAreas: ['грудь', 'спина', 'руки'],
        exerciseStyle: 'mixed',
        intensityTolerance: 'normal',
        sessionStyle: 'moderate_stable',
      },
    }

    const first = buildGeneratedPlannedWorkout({
      profile: preferenceProfile,
      scheduledDate: '2026-06-09',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
    })
    const second = buildGeneratedPlannedWorkout({
      profile: preferenceProfile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
      previousGeneratedWorkouts: [first],
    })

    expect(first.coachReason).toContain('Профиль тренера')
    expect(first.coachReason).toContain('персональный силовой тренер')
    expect(second.coachReason).toContain('разнообразие недели')
    expect(second.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(first.exercises.map((exercise) => exercise.exerciseId))
    expect(second.exercises.map((exercise) => exercise.exerciseId)).not.toContain('romanian-deadlift')
    expect(second.exercises.some((exercise) => exercise.reason.includes('разнообраз'))).toBe(true)
  })

  it('avoids repeating the exact completed workout two days later when alternatives exist', () => {
    const coachState = {
      recoveryStatus: 'partial',
      readinessScore: 58,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'medium' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'high' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'medium' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const variedLibrary = [
      ...exerciseLibrary,
      { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90 },
      { id: 'cable-row', name: 'Горизонтальная тяга', muscleGroup: 'Спина', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 42.5, weightStep: 2.5, restSeconds: 90 },
      { id: 'arnold-press', name: 'Жим Арнольда', muscleGroup: 'Плечи', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 12, weightStep: 2, restSeconds: 90 },
      { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки · бицепс', setsCount: 2, repMin: 10, repMax: 15, targetWeight: 12.5, weightStep: 2.5, restSeconds: 75 },
      { id: 'side-plank', name: 'Боковая планка', muscleGroup: 'Кор', setsCount: 3, repMin: 20, repMax: 45, targetWeight: 0, weightStep: 0, restSeconds: 45 },
    ]
    const preferenceProfile = {
      ...profile,
      preferences: {
        focusAreas: ['грудь', 'спина', 'руки'],
        exerciseStyle: 'mixed',
        intensityTolerance: 'rare_max',
        sessionStyle: 'moderate_stable',
      },
    }

    const plan = buildGeneratedPlannedWorkout({
      profile: preferenceProfile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
      previousGeneratedWorkouts: [{
        scheduledDate: '2026-06-09',
        exercises: [
          { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь' },
          { exerciseId: 'lat-pulldown', exerciseName: 'Тяга верхнего блока', muscleGroup: 'Спина' },
          { exerciseId: 'db-shoulder-press', exerciseName: 'Жим гантелей сидя', muscleGroup: 'Плечи' },
          { exerciseId: 'hammer-curl', exerciseName: 'Молотковые сгибания', muscleGroup: 'Руки' },
        ],
      }],
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).not.toContain('bench-press')
    expect(exerciseIds).not.toContain('lat-pulldown')
    expect(exerciseIds).not.toContain('db-shoulder-press')
    expect(exerciseIds).not.toContain('hammer-curl')
    expect(exerciseIds).toEqual(expect.arrayContaining(['incline-db-press', 'cable-row', 'arnold-press', 'cable-curl']))
  })

  it('uses the factual workout history, including replacements, when avoiding nearby repeats', () => {
    const coachState = {
      recoveryStatus: 'partial',
      readinessScore: 58,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'medium' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'high' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'medium' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const variedLibrary = [
      ...exerciseLibrary,
      { id: 'assisted-pull-up', name: 'Подтягивания в гравитроне', muscleGroup: 'Спина', setsCount: 3, repMin: 6, repMax: 10, targetWeight: 35, weightStep: 5, restSeconds: 90 },
      { id: 'cable-row', name: 'Горизонтальная тяга', muscleGroup: 'Спина', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 42.5, weightStep: 2.5, restSeconds: 90 },
      { id: 'rear-delt-machine', name: 'Обратная бабочка', muscleGroup: 'Плечи · задняя дельта', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
      { id: 'dumbbell-curl', name: 'Сгибание рук с гантелями', muscleGroup: 'Руки · бицепс', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 9, weightStep: 1, restSeconds: 75 },
      { id: 'skull-crusher', name: 'Французский жим лёжа', muscleGroup: 'Руки · трицепс', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
    ]
    const history = [{
      completedAt: '2026-06-09T17:35:00.000Z',
      exercises: [
        { exerciseId: 'assisted-pull-up-replacement-1781024381728', exerciseName: 'Подтягивания в гравитроне', muscleGroup: 'Спина', nextRecommendedWeight: 38 },
        { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', nextRecommendedWeight: 40 },
        { exerciseId: 'db-shoulder-press', exerciseName: 'Жим гантелей сидя', muscleGroup: 'Плечи', nextRecommendedWeight: 12 },
        { exerciseId: 'preacher-curl', exerciseName: 'Сгибание рук на скамье Скотта', muscleGroup: 'Руки', nextRecommendedWeight: 17.5 },
      ],
    }]

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history,
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).not.toContain('assisted-pull-up')
    expect(exerciseIds).not.toContain('bench-press')
    expect(exerciseIds).not.toContain('db-shoulder-press')
    expect(exerciseIds).not.toContain('preacher-curl')
    expect(exerciseIds.length).toBeGreaterThanOrEqual(3)
  })

  it('uses the user-planned calendar as the weekly target instead of the questionnaire fallback', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 78,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const history = [{
      completedAt: '2026-06-09T17:35:00.000Z',
      exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', nextRecommendedWeight: 40 }],
    }]
    const previousGeneratedWorkouts = [
      {
        scheduledDate: '2026-06-11',
        exercises: [
          { exerciseId: 'skull-crusher', exerciseName: 'Французский жим лёжа', muscleGroup: 'Руки · трицепс' },
          { exerciseId: 'deadlift-machine-row', exerciseName: 'Тяга в тренажёре', muscleGroup: 'Спина' },
          { exerciseId: 'rear-delt-machine', exerciseName: 'Обратная бабочка', muscleGroup: 'Плечи · задняя дельта' },
          { exerciseId: 'dumbbell-curl', exerciseName: 'Сгибание рук с гантелями', muscleGroup: 'Руки · бицепс' },
        ],
      },
      {
        scheduledDate: '2026-06-14',
        exercises: [
          { exerciseId: 'dumbbell-fly', exerciseName: 'Разведения гантелей лёжа', muscleGroup: 'Грудь' },
          { exerciseId: 'cable-row', exerciseName: 'Горизонтальная тяга', muscleGroup: 'Спина' },
          { exerciseId: 'barbell-curl', exerciseName: 'Сгибание рук со штангой', muscleGroup: 'Руки · бицепс' },
        ],
      },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, workoutsPerWeek: 2 },
      scheduledDate: '2026-06-16',
      coachState,
      exerciseLibrary: [
        ...exerciseLibrary,
        { id: 'cable-row', name: 'Горизонтальная тяга', muscleGroup: 'Спина', setsCount: 3, repMin: 10, repMax: 12, targetWeight: 42.5, weightStep: 2.5, restSeconds: 90 },
        { id: 'rear-delt-machine', name: 'Обратная бабочка', muscleGroup: 'Плечи · задняя дельта', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
        { id: 'dumbbell-curl', name: 'Сгибание рук с гантелями', muscleGroup: 'Руки · бицепс', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 9, weightStep: 1, restSeconds: 75 },
      ],
      history,
      previousGeneratedWorkouts,
    })

    expect(plan.workoutDayName).toBe('персональная тренировка')
    expect(plan.coachReason).toContain('Прогноз календаря')
    expect(plan.coachReason).toContain('3/3 тренировок за 7 дней')
    expect(plan.coachReason).not.toContain('3/2 тренировок за 7 дней')
    expect(plan.exercises.map((exercise) => exercise.exerciseId)).not.toContain('cable-row')
  })

  it('does not double-count a completed workout and its planned row on the same calendar date', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 78,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, workoutsPerWeek: 2 },
      scheduledDate: '2026-06-14',
      coachState,
      exerciseLibrary,
      history: [{
        completedAt: '2026-06-09T17:35:00.000Z',
        exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь', nextRecommendedWeight: 40 }],
      }],
      previousGeneratedWorkouts: [
        { scheduledDate: '2026-06-09', exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь' }] },
        { scheduledDate: '2026-06-11', exercises: [{ exerciseId: 'cable-row', exerciseName: 'Горизонтальная тяга', muscleGroup: 'Спина' }] },
      ],
    })

    expect(plan.coachReason).toContain('3/3 тренировок за 7 дней')
    expect(plan.coachReason).not.toContain('3/2 тренировок за 7 дней')
  })

  it('does not repeat heavy barbell legs after one rest day for a returning user', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 82,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const variedLibrary = [
      ...exerciseLibrary,
      { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90 },
      { id: 'seated-row', name: 'Тяга в тренажёре', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 90 },
      { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 75 },
      { id: 'leg-curl', name: 'Сгибание ног лёжа', muscleGroup: 'Ноги', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 25, weightStep: 2.5, restSeconds: 90 },
      { id: 'face-pull', name: 'Face pull', muscleGroup: 'Плечи', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
    ]
    const returningProfile = {
      ...profile,
      level: 'возвращаюсь после перерыва',
      preferences: {
        focusAreas: ['грудь', 'спина', 'руки'],
        exerciseStyle: 'mixed',
        intensityTolerance: 'normal',
        sessionStyle: 'moderate_stable',
      },
    }
    const previous = {
      scheduledDate: '2026-06-09',
      exercises: [
        { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', muscleGroup: 'Грудь' },
        { exerciseId: 'barbell-squat', exerciseName: 'Присед со штангой', muscleGroup: 'Ноги' },
        { exerciseId: 'leg-curl', exerciseName: 'Сгибание ног лёжа', muscleGroup: 'Ноги' },
      ],
    }

    const next = buildGeneratedPlannedWorkout({
      profile: returningProfile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
      previousGeneratedWorkouts: [previous],
    })

    const exerciseIds = next.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).not.toContain('barbell-squat')
    expect(next.coachReason).toContain('возвращение после перерыва')
    expect(next.exercises.some((exercise) => exercise.muscleGroup === 'Ноги')).toBe(false)
  })

  it('uses exercise style, session style and intensity tolerance as real generation constraints', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 88,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const extendedLibrary = [
      ...exerciseLibrary,
      { id: 'machine-chest-press', name: 'Жим в тренажёре', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 12, targetWeight: 45, weightStep: 2.5, restSeconds: 90 },
      { id: 'bodyweight-squat', name: 'Приседания с весом тела', muscleGroup: 'Ноги', setsCount: 3, repMin: 12, repMax: 15, targetWeight: 0, weightStep: 0, restSeconds: 60 },
    ]

    const machinePlan = buildGeneratedPlannedWorkout({
      profile: {
        ...profile,
        preferences: {
          focusAreas: ['грудь'],
          exerciseStyle: 'machines',
          intensityTolerance: 'aggressive',
          sessionStyle: 'heavy_short',
        },
      },
      scheduledDate: '2026-06-13',
      coachState,
      exerciseLibrary: extendedLibrary,
      history: [],
    })

    expect(machinePlan.exercises.map((exercise) => exercise.exerciseId)).toContain('machine-chest-press')
    expect(machinePlan.exercises.length).toBeLessThanOrEqual(5)
    expect(['plank', 'side-plank'].includes(machinePlan.exercises.at(-1)?.exerciseId)).toBe(true)
    expect(machinePlan.exercises.every((exercise) => exercise.setsCount <= 3)).toBe(true)
    expect(machinePlan.exercises.some((exercise) => exercise.intensityTarget === 'max_effort_allowed')).toBe(true)

    const bodyweightPlan = buildGeneratedPlannedWorkout({
      profile: {
        ...profile,
        preferences: {
          focusAreas: ['ноги'],
          exerciseStyle: 'bodyweight',
          intensityTolerance: 'avoid_max',
          sessionStyle: 'volume_light',
        },
      },
      scheduledDate: '2026-06-14',
      coachState,
      exerciseLibrary: extendedLibrary,
      history: [],
    })

    expect(bodyweightPlan.exercises.map((exercise) => exercise.exerciseId)).toContain('bodyweight-squat')
    expect(bodyweightPlan.exercises.some((exercise) => exercise.setsCount >= 3)).toBe(true)
    expect(bodyweightPlan.exercises.every((exercise) => exercise.intensityTarget === 'easy')).toBe(true)
  })

  it('applies Oleg policy as conservative even when preferences ask for aggressive work', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 90,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildGeneratedPlannedWorkout({
      profile: {
        ...profile,
        userId: 'oleg',
        preferences: {
          focusAreas: ['грудь', 'спина'],
          exerciseStyle: 'mixed',
          intensityTolerance: 'aggressive',
          sessionStyle: 'heavy_short',
        },
      },
      scheduledDate: '2026-06-15',
      coachState,
      exerciseLibrary,
      history: [],
    })

    expect(plan.readinessSnapshot.userTrainingPolicy).toMatchObject({ userId: 'oleg', allowFailureSets: false })
    expect(plan.exercises.every((exercise) => exercise.intensityTarget !== 'max_effort_allowed')).toBe(true)
    expect(plan.exercises.every((exercise) => exercise.coachFocus.includes('без отказа'))).toBe(true)
  })

  it('keeps compound chest work before arm isolation when Oleg focuses arms and chest', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 86,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'medium' },
        legs: { fatigue: 'medium' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const olegLibrary = [
      { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 75 },
      { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 42.5, weightStep: 2.5, restSeconds: 150 },
      { id: 'triceps-rope', name: 'Разгибание рук с канатом', muscleGroup: 'Руки', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 17.5, weightStep: 2.5, restSeconds: 75 },
      { id: 'db-shoulder-press', name: 'Жим гантелей сидя', muscleGroup: 'Плечи', setsCount: 2, repMin: 8, repMax: 10, targetWeight: 12, weightStep: 2, restSeconds: 90 },
      { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile: {
        ...profile,
        userId: 'oleg',
        preferences: {
          focusAreas: ['Руки', 'Грудь'],
          exerciseStyle: 'mixed',
          intensityTolerance: 'normal',
          sessionStyle: 'moderate_stable',
        },
      },
      scheduledDate: '2026-06-16',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['arms', 'chest'],
        avoidMuscleGroups: [],
        exercisePolicies: {},
      },
      exerciseLibrary: olegLibrary,
      history: [],
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).toContain('bench-press')
    expect(exerciseIds).toContain('cable-curl')
    expect(exerciseIds.indexOf('bench-press')).toBeLessThan(exerciseIds.indexOf('cable-curl'))
  })

  it('keeps squats and hinges before leg isolation even when isolation is preferred by selection', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 84,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'high' },
        back: { fatigue: 'high' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'high' },
        arms: { fatigue: 'high' },
        core: { fatigue: 'high' },
      },
      exercises: {},
    }
    const legLibrary = [
      { id: 'leg-curl', name: 'Сгибание ног лёжа', muscleGroup: 'Ноги', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 35, weightStep: 2.5, restSeconds: 90 },
      { id: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'Ноги', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 60, weightStep: 2.5, restSeconds: 150 },
      { id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150 },
      { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, targetWorkoutMinutes: 45 },
      scheduledDate: '2026-06-17',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['legs'],
        avoidMuscleGroups: ['chest', 'back', 'shoulders', 'arms', 'core'],
        exercisePolicies: {},
      },
      exerciseLibrary: legLibrary,
      history: [],
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds.indexOf('barbell-squat')).toBeLessThan(exerciseIds.indexOf('leg-curl'))
    expect(exerciseIds.indexOf('romanian-deadlift')).toBeLessThan(exerciseIds.indexOf('leg-curl'))
  })

  it('keeps lower-back accessories after heavy hinges and keeps core last', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 84,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'high' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'high' },
        arms: { fatigue: 'high' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const library = [
      { id: 'back-extension', name: 'Гиперэкстензия', muscleGroup: 'Спина', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 0, weightStep: 0, restSeconds: 75 },
      { id: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Ноги', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 45, weightStep: 2.5, restSeconds: 150 },
      { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
      { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 35, weightStep: 2.5, restSeconds: 90 },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-18',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['back', 'legs', 'core'],
        avoidMuscleGroups: ['chest', 'shoulders', 'arms'],
        exercisePolicies: {},
      },
      exerciseLibrary: library,
      history: [],
    })

    const exerciseIds = plan.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds.indexOf('romanian-deadlift')).toBeLessThan(exerciseIds.indexOf('back-extension'))
    expect(exerciseIds.at(-1)).toBe('plank')
  })

  it('adds a core finisher to ordinary workouts when the selected pattern skipped core', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 86,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'high' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const library = [
      { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 90 },
      { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 35, weightStep: 2.5, restSeconds: 90 },
      { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки · бицепс', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 60 },
      { id: 'decline-bench-crunch', name: 'Скручивания на наклонной скамье', muscleGroup: 'Пресс', setsCount: 3, repMin: 12, repMax: 20, targetWeight: 0, weightStep: 0, restSeconds: 45 },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-19',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['chest', 'back', 'arms'],
        avoidMuscleGroups: [],
        exercisePolicies: {},
      },
      exerciseLibrary: library,
      history: [],
    })

    expect(plan.exercises.at(-1)?.exerciseId).toBe('decline-bench-crunch')
  })

  it('does not add an extra core finisher to a core-focused workout', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 86,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: { core: { fatigue: 'low' } },
      exercises: {},
    }
    const library = [
      { id: 'plank', name: 'Планка', muscleGroup: 'Кор', setsCount: 2, repMin: 40, repMax: 60, targetWeight: 0, weightStep: 0, restSeconds: 60 },
      { id: 'decline-bench-crunch', name: 'Скручивания на наклонной скамье', muscleGroup: 'Пресс', setsCount: 3, repMin: 12, repMax: 20, targetWeight: 0, weightStep: 0, restSeconds: 45 },
      { id: 'cable-woodchop', name: 'Дровосек на блоке', muscleGroup: 'Кор', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 12.5, weightStep: 2.5, restSeconds: 60 },
    ]

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['core'],
        avoidMuscleGroups: ['chest', 'back', 'legs', 'shoulders', 'arms'],
        exercisePolicies: {},
      },
      exerciseLibrary: library,
      history: [],
    })

    expect(plan.exercises.every((exercise) => ['plank', 'decline-bench-crunch', 'cable-woodchop'].includes(exercise.exerciseId))).toBe(true)
    expect(new Set(plan.exercises.map((exercise) => exercise.exerciseId)).size).toBe(plan.exercises.length)
  })

  it('applies mesocycle deload reduction to all planned exercises when isDeload is true', () => {
    const coachState = {
      recoveryStatus: 'normal',
      readinessScore: 75,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {},
      exercises: {},
      mesocycle: {
        phase: 'deload',
        phaseDescription: 'Разгрузочная неделя — снижение объёма и интенсивности',
        weekInCycle: 5,
        cycleLength: 5,
        loadingWeeks: 4,
        deloadWeeks: 1,
        isDeload: true,
        deloadScheduled: false,
        triggerReason: 'Запланированная разгрузка по календарю мезоцикла.',
        completionRatio: 1,
        workoutsThisCycle: 12,
        plannedWorkoutsThisCycle: 12,
      },
    }

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState,
      coachDecision: {
        priorityMuscleGroups: ['chest'],
        avoidMuscleGroups: [],
        exercisePolicies: {},
      },
      exerciseLibrary,
      history: [],
    })

    // Every exercise should have 'easy' intensity and reduced sets/weight
    expect(plan.exercises.length).toBeGreaterThan(0)
    for (const exercise of plan.exercises) {
      expect(exercise.intensityTarget).toBe('easy')
      // setsCount should be reduced (max 2 for deload per applyDeloadReduction)
      expect(exercise.setsCount).toBeLessThanOrEqual(2)
      // coachFocus should mention deload
      expect(exercise.coachFocus).toMatch(/разгруз/i)
    }
  })
})

// ---------------------------------------------------------------------------
// Issue #35: intra-cycle periodization (loading/accumulation/intensification)
// ---------------------------------------------------------------------------

describe('buildGeneratedPlannedWorkout — intra-cycle periodization', () => {
  const profile = {
    userId: 'vyacheslav',
    goal: 'сила и мышечная масса',
    level: 'intermediate',
    workoutsPerWeek: 2,
    targetWorkoutMinutes: 60,
  }

  const exerciseLibrary = [
    { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 60, weightStep: 2.5, restSeconds: 150, instruction: 'жим' },
  ]

  function makeMesocycle(phase) {
    return {
      phase,
      phaseDescription: phase,
      weekInCycle: 1,
      cycleLength: 5,
      loadingWeeks: 4,
      deloadWeeks: 1,
      isDeload: phase === 'deload',
      deloadScheduled: false,
      triggerReason: null,
      completionRatio: 1,
      workoutsThisCycle: 3,
      plannedWorkoutsThisCycle: 3,
    }
  }

  function makeCoachState(phase) {
    return {
      recoveryStatus: 'normal',
      readinessScore: 75,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {},
      exercises: {},
      mesocycle: makeMesocycle(phase),
    }
  }

  it('loading phase: base weight, base reps, no periodization delta', () => {
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState: makeCoachState('loading'),
      coachDecision: { priorityMuscleGroups: ['chest'], avoidMuscleGroups: [], exercisePolicies: {} },
      exerciseLibrary,
      history: [],
    })

    const ex = plan.exercises[0]
    expect(ex.targetWeight).toBe(60) // base weight, no delta
    expect(ex.repMin).toBe(8)        // base repMin
    expect(ex.repMax).toBe(10)       // base repMax
    expect(ex.coachFocus).toContain('Загрузка')
  })

  it('accumulation phase: +1 rep on minimum, same weight', () => {
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState: makeCoachState('accumulation'),
      coachDecision: { priorityMuscleGroups: ['chest'], avoidMuscleGroups: [], exercisePolicies: {} },
      exerciseLibrary,
      history: [],
    })

    const ex = plan.exercises[0]
    expect(ex.targetWeight).toBe(60)  // same weight
    expect(ex.repMin).toBe(9)         // 8 + 1
    expect(ex.repMax).toBe(10)        // unchanged
    expect(ex.coachFocus).toContain('Накопление')
  })

  it('intensification phase: +2.5 kg weight, -1 rep on maximum', () => {
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState: makeCoachState('intensification'),
      coachDecision: { priorityMuscleGroups: ['chest'], avoidMuscleGroups: [], exercisePolicies: {} },
      exerciseLibrary,
      history: [],
    })

    const ex = plan.exercises[0]
    expect(ex.targetWeight).toBe(62.5) // 60 + 2.5
    expect(ex.repMin).toBe(8)          // unchanged
    expect(ex.repMax).toBe(9)          // 10 - 1
    expect(ex.coachFocus).toContain('Интенсификация')
  })

  it('deload overrides periodization (deload has higher priority)', () => {
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState: makeCoachState('deload'),
      coachDecision: { priorityMuscleGroups: ['chest'], avoidMuscleGroups: [], exercisePolicies: {} },
      exerciseLibrary,
      history: [],
    })

    const ex = plan.exercises[0]
    // Deload: sets reduced to ~60%, weight -1 step
    expect(ex.setsCount).toBeLessThanOrEqual(2)
    expect(ex.targetWeight).toBeLessThan(60)
    expect(ex.intensityTarget).toBe('easy')
    expect(ex.coachFocus).toContain('разгруз')
  })

  it('idle phase: no periodization adjustments', () => {
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-20',
      coachState: makeCoachState('idle'),
      coachDecision: { priorityMuscleGroups: ['chest'], avoidMuscleGroups: [], exercisePolicies: {} },
      exerciseLibrary,
      history: [],
    })

    const ex = plan.exercises[0]
    expect(ex.targetWeight).toBe(60) // base
    expect(ex.repMin).toBe(8)
    expect(ex.repMax).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Issue #75 regression: pattern rotation based on previous workouts
// ---------------------------------------------------------------------------

describe('issue #75: pattern rotation', () => {
  it('after [legs, back, chest] workout → next workout does NOT start with legs', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 80,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    const previousWorkouts = [{
      scheduledDate: '2026-06-22',
      exercises: [
        { exerciseName: 'Присед', muscleGroup: 'Ноги' },
        { exerciseName: 'Тяга', muscleGroup: 'Спина' },
        { exerciseName: 'Жим', muscleGroup: 'Грудь' },
      ],
    }]

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-26',
      coachState,
      exerciseLibrary,
      history: [],
      previousGeneratedWorkouts: previousWorkouts,
    })
    const exerciseIds = plan.exercises.map((e) => e.exerciseId)
    // Shoulders/arms should come before legs/back/chest (which were in previous workout)
    const shouldersIndex = exerciseIds.indexOf('db-shoulder-press')
    const legsIndex = exerciseIds.indexOf('barbell-squat')
    if (shouldersIndex >= 0 && legsIndex >= 0) {
      expect(shouldersIndex).toBeLessThan(legsIndex)
    }
    // At minimum, the workout should have different exercises than just legs+back+chest
    expect(plan.exercises.length).toBeGreaterThanOrEqual(4)
  })

  it('3 consecutive workouts should have different exercise ordering', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const workouts = []
    let previous = []
    const dates = ['2026-06-22', '2026-06-25', '2026-06-28']
    for (const date of dates) {
      const plan = buildGeneratedPlannedWorkout({
        profile,
        scheduledDate: date,
        coachState,
        exerciseLibrary,
        history: [],
        previousGeneratedWorkouts: previous,
      })
      // Track exercise ORDER (not just set) — rotation should change order
      workouts.push(plan.exercises.map((e) => e.exerciseId).join(','))
      previous = [...previous, {
        scheduledDate: date,
        exercises: plan.exercises.map((e) => ({ exerciseName: e.exerciseName, muscleGroup: e.muscleGroup })),
      }]
    }

    // At least 2 of the 3 workouts should have different exercise ordering
    const unique = new Set(workouts)
    expect(unique.size).toBeGreaterThanOrEqual(2)
  })

  it('without previous workouts → all fresh groups available (no rotation constraint)', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }

    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-26',
      coachState,
      exerciseLibrary,
      history: [],
      previousGeneratedWorkouts: [],
    })
    // Should have at least 4 exercises from different muscle groups
    expect(plan.exercises.length).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// Issue #78: light days — avoid large muscle groups on specific weekdays
// ---------------------------------------------------------------------------

describe('issue #78: light days', () => {
  it('Thursday with lightDays=[Четверг] → no legs, back, or chest', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    // 2026-06-25 is Thursday
    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, preferences: { lightDays: ['Четверг'] } },
      scheduledDate: '2026-06-25',
      coachState,
      exerciseLibrary,
      history: [],
    })
    const muscleGroups = plan.exercises.map((e) => e.muscleGroup)
    expect(muscleGroups).not.toContain('Ноги')
    expect(muscleGroups).not.toContain('Спина')
    expect(muscleGroups).not.toContain('Грудь')
    // Should still have shoulders, arms, core
    expect(plan.exercises.length).toBeGreaterThanOrEqual(3)
  })

  it('Sunday without lightDays → legs, back, chest are allowed', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    // 2026-06-28 is Sunday — no lightDays restriction
    const plan = buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-28',
      coachState,
      exerciseLibrary,
      history: [],
    })
    const muscleGroups = plan.exercises.map((e) => e.muscleGroup)
    // At least one large muscle group should be present
    const hasLarge = muscleGroups.some((g) => ['Ноги', 'Спина', 'Грудь'].includes(g))
    expect(hasLarge).toBe(true)
  })

  it('Thursday with lightDays=[Вторник] → Thursday is NOT a light day (no restriction)', () => {
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 85,
      weeklyLoadStatus: 'on_plan',
      muscleGroups: {
        chest: { fatigue: 'low' },
        back: { fatigue: 'low' },
        legs: { fatigue: 'low' },
        shoulders: { fatigue: 'low' },
        arms: { fatigue: 'low' },
        core: { fatigue: 'low' },
      },
      exercises: {},
    }
    // 2026-06-25 is Thursday, but lightDays=[Вторник] — Thursday is not restricted
    const plan = buildGeneratedPlannedWorkout({
      profile: { ...profile, preferences: { lightDays: ['Вторник'] } },
      scheduledDate: '2026-06-25',
      coachState,
      exerciseLibrary,
      history: [],
    })
    const muscleGroups = plan.exercises.map((e) => e.muscleGroup)
    const hasLarge = muscleGroups.some((g) => ['Ноги', 'Спина', 'Грудь'].includes(g))
    expect(hasLarge).toBe(true)
  })
})
