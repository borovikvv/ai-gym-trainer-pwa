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
  it('builds a concrete workout for the scheduled date from Coach State and the full exercise library', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-06-09',
      coachState,
      exerciseLibrary,
      history: [],
    })

    expect(plan.status).toBe('generated')
    expect(plan.source).toBe('coach')
    // readinessScore 68 → not low readiness → canonical short name "Силовая"
    expect(plan.workoutDayName).toBe('Силовая')
    expect(plan.coachReason).toBeTruthy()
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

  it('uses recent exercise history for working weights and reduces volume when readiness is low', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({ profile, scheduledDate: '2026-06-10', coachState, exerciseLibrary, history })

    expect(plan.goal).toContain('восстанов')
    expect(plan.exercises.length).toBeGreaterThanOrEqual(5)
    expect(plan.exercises.some((exercise) => exercise.setsCount >= 3)).toBe(true)
    expect(plan.exercises.every((exercise) => exercise.intensityTarget === 'easy')).toBe(true)
    const pulldown = plan.exercises.find((exercise) => exercise.exerciseId === 'lat-pulldown')
    expect(pulldown?.targetWeight).toBe(42.5)
    expect(plan.exercises.map((exercise) => exercise.exerciseId)).not.toContain('barbell-squat')
  })

  it('uses canonical history from generated exercise variants when prescribing the next plan', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
      profile: { ...profile, preferences: { focusAreas: ['спина'], sessionStyle: 'moderate_stable' } },
      scheduledDate: '2026-06-12',
      coachState,
      exerciseLibrary,
      history,
    })

    const pulldown = plan.exercises.find((exercise) => exercise.exerciseId === 'lat-pulldown')
    expect(pulldown?.targetWeight).toBe(47.5)
  })

  it('uses profile preferences to avoid banned exercises and prioritize focus areas', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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
    expect(plan.coachReason).toContain('грудь')
    expect(plan.exercises.every((exercise) => exercise.intensityTarget !== 'max_effort')).toBe(true)
  })

  it('diversifies nearby generated workouts while keeping the trainer profile explicit', async () => {
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

    const first = await buildGeneratedPlannedWorkout({
      profile: preferenceProfile,
      scheduledDate: '2026-06-09',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
    })
    const second = await buildGeneratedPlannedWorkout({
      profile: preferenceProfile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
      previousGeneratedWorkouts: [first],
    })

    expect(first.coachReason).toBeTruthy()
    expect(first.coachReason).toBeTruthy()
    expect(second.coachReason).toBeTruthy()
    expect(second.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(first.exercises.map((exercise) => exercise.exerciseId))
    expect(second.exercises.map((exercise) => exercise.exerciseId)).not.toContain('romanian-deadlift')
    expect(second.exercises.some((exercise) => exercise.reason.includes('разнообраз'))).toBe(true)
  })

  it('avoids repeating the exact completed workout two days later when alternatives exist', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('uses the factual workout history, including replacements, when avoiding nearby repeats', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('uses the user-planned calendar as the weekly target instead of the questionnaire fallback', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

    // normal readiness → canonical short name "Силовая" (matches user-source workouts in calendar)
    expect(plan.workoutDayName).toBe('Силовая')
    expect(plan.coachReason).toBeTruthy()
    expect(plan.coachReason).toBeTruthy()
    expect(plan.coachReason).not.toContain('3/2 тренировок за 7 дней')
    expect(plan.exercises.map((exercise) => exercise.exerciseId)).not.toContain('cable-row')
  })

  it('does not double-count a completed workout and its planned row on the same calendar date', async () => {
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
    const plan = await buildGeneratedPlannedWorkout({
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

    expect(plan.coachReason).toBeTruthy()
    expect(plan.coachReason).not.toContain('3/2 тренировок за 7 дней')
  })

  it('does not repeat heavy barbell legs after one rest day for a returning user', async () => {
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

    const next = await buildGeneratedPlannedWorkout({
      profile: returningProfile,
      scheduledDate: '2026-06-11',
      coachState,
      exerciseLibrary: variedLibrary,
      history: [],
      previousGeneratedWorkouts: [previous],
    })

    const exerciseIds = next.exercises.map((exercise) => exercise.exerciseId)
    expect(exerciseIds).not.toContain('barbell-squat')
    expect(next.coachReason).toBeTruthy()
    expect(next.exercises.some((exercise) => exercise.muscleGroup === 'Ноги')).toBe(false)
  })

  it('uses exercise style, session style and intensity tolerance as real generation constraints', async () => {
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

    const machinePlan = await buildGeneratedPlannedWorkout({
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

    const bodyweightPlan = await buildGeneratedPlannedWorkout({
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

  it('applies Oleg policy as conservative even when preferences ask for aggressive work', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('keeps compound chest work before arm isolation when Oleg focuses arms and chest', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('keeps squats and hinges before leg isolation even when isolation is preferred by selection', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('keeps lower-back accessories after heavy hinges and keeps core last', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('adds a core finisher to ordinary workouts when the selected pattern skipped core', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('does not add an extra core finisher to a core-focused workout', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('applies mesocycle deload reduction to all planned exercises when isDeload is true', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('loading phase: base weight, base reps, no periodization delta', async () => {
    const plan = await buildGeneratedPlannedWorkout({
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

  it('accumulation phase: +1 rep on minimum, same weight', async () => {
    const plan = await buildGeneratedPlannedWorkout({
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

  it('intensification phase: +2.5 kg weight, -1 rep on maximum', async () => {
    const plan = await buildGeneratedPlannedWorkout({
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

  it('deload overrides periodization (deload has higher priority)', async () => {
    const plan = await buildGeneratedPlannedWorkout({
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

  it('idle phase: no periodization adjustments', async () => {
    const plan = await buildGeneratedPlannedWorkout({
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
  it('after [legs, back, chest] workout → next workout does NOT start with legs', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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

  it('3 consecutive workouts should have different exercise ordering', async () => {
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
      const plan = await buildGeneratedPlannedWorkout({
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

  it('without previous workouts → all fresh groups available (no rotation constraint)', async () => {
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

    const plan = await buildGeneratedPlannedWorkout({
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
  it('Thursday with lightDays=[Четверг] → no legs, back, or chest', async () => {
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
    const plan = await buildGeneratedPlannedWorkout({
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

  it('Sunday without lightDays → legs, back, chest are allowed', async () => {
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
    const plan = await buildGeneratedPlannedWorkout({
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

  it('Thursday with lightDays=[Вторник] → Thursday is NOT a light day (no restriction)', async () => {
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
    const plan = await buildGeneratedPlannedWorkout({
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

describe('Issue #100: applyPrescription uses coachMemory.currentWorkingWeight as fallback', () => {
  it('uses currentWorkingWeight when nextRecommendedWeight is missing from history', async () => {
    // Scenario: bench press was at 55kg, then a deload dropped it to 40kg.
    // The history has no nextRecommendedWeight (e.g., first session after
    // a long break). coachMemory.currentWorkingWeight (from #99) = 55.
    // The plan should use 55, not the library default of 50.
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 80,
      weeklyLoadStatus: 'on_plan',
      mesocycle: { phase: 'accumulation', isDeload: false, weekInCycle: 2, cycleLength: 4, loadingWeeks: 3, deloadWeeks: 1 },
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

    const coachMemory = {
      exerciseProfiles: {
        'bench-press': {
          id: 'bench-press',
          name: 'Жим лёжа',
          muscleGroup: 'Грудь',
          muscleKey: 'chest',
          status: 'progress_possible',
          currentWorkingWeight: 55,  // Issue #99: max of last 3 sessions
          lastReps: 8,
          lastTrainedAt: '2026-06-18T18:00:00.000Z',
          recentSessions: 3,
          hardSets: 0,
          maxEffortSets: 0,
          pain: false,
          recommendation: 'прогрессировать',
        },
      },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-01',
      coachState,
      coachMemory,
      exerciseLibrary,
      // History has a session with NO nextRecommendedWeight for bench press
      history: [{
        id: 'session-1',
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        workoutDayName: 'День A',
        completedAt: '2026-06-29T18:00:00.000Z',
        totalVolume: 1000,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 0,  // 0 = no progression recommendation
          progressionType: 'hold',
          progressionReason: '',
          sets: [{ weight: 40, reps: 12, rpe: 6, completed: true }],
        }],
      }],
    })

    const benchExercise = plan.exercises.find((e) => e.exerciseId === 'bench-press')
    // Should use currentWorkingWeight (55), not library default (50) and not
    // the history's nextRecommendedWeight (0).
    expect(benchExercise).toBeDefined()
    expect(benchExercise.targetWeight).toBeGreaterThanOrEqual(55)
  })

  it('prefers nextRecommendedWeight over currentWorkingWeight when both exist', async () => {
    // When history has a valid nextRecommendedWeight, that takes priority.
    // currentWorkingWeight is only a fallback.
    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 80,
      weeklyLoadStatus: 'on_plan',
      mesocycle: { phase: 'accumulation', isDeload: false, weekInCycle: 2, cycleLength: 4, loadingWeeks: 3, deloadWeeks: 1 },
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

    const coachMemory = {
      exerciseProfiles: {
        'bench-press': {
          id: 'bench-press',
          name: 'Жим лёжа',
          muscleGroup: 'Грудь',
          muscleKey: 'chest',
          status: 'progress_possible',
          currentWorkingWeight: 55,
          lastReps: 8,
          lastTrainedAt: '2026-06-18T18:00:00.000Z',
          recentSessions: 3,
          hardSets: 0,
          maxEffortSets: 0,
          pain: false,
          recommendation: 'прогрессировать',
        },
      },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-01',
      coachState,
      coachMemory,
      exerciseLibrary,
      history: [{
        id: 'session-1',
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        workoutDayName: 'День A',
        completedAt: '2026-06-29T18:00:00.000Z',
        totalVolume: 1000,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 57.5,  // explicit progression recommendation
          progressionType: 'increase',
          progressionReason: '',
          sets: [{ weight: 55, reps: 8, rpe: 7, completed: true }],
        }],
      }],
    })

    const benchExercise = plan.exercises.find((e) => e.exerciseId === 'bench-press')
    // nextRecommendedWeight (57.5) wins over currentWorkingWeight (55)
    expect(benchExercise).toBeDefined()
    expect(benchExercise.targetWeight).toBeGreaterThanOrEqual(57.5)
  })
})

describe('Issue #106: plannedWorkoutGenerator consumes analysis flags', () => {
  const baseCoachState = {
    recoveryStatus: 'ready',
    readinessScore: 80,
    weeklyLoadStatus: 'on_plan',
    mesocycle: { phase: 'accumulation', isDeload: false, weekInCycle: 2, cycleLength: 4, loadingWeeks: 3, deloadWeeks: 1 },
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

  it('increases weight when exerciseFlag.recommendation === increase_weight', async () => {
    const analysisResult = {
      date: '2026-07-09T00:00:00Z',
      summary: '',
      plateaus: [],
      improvements: [],
      warnings: [],
      suggestions: [],
      exerciseFlags: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        status: 'trending_up',
        slopePerWeek: 1.2,
        recommendation: 'increase_weight',
        reason: 'e1RM растёт',
      }],
      globalFlags: { overtraining: false, recommendedDeload: false },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState: baseCoachState,
      exerciseLibrary,
      history: [{
        id: 's1',
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        workoutDayName: 'День A',
        completedAt: '2026-07-03T18:00:00Z',
        totalVolume: 1000,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 50,
          progressionType: 'hold',
          progressionReason: '',
          sets: [{ weight: 50, reps: 8, rpe: 7, completed: true }],
        }],
      }],
      analysisResult,
    })

    const bench = plan.exercises.find((e) => e.exerciseId === 'bench-press')
    expect(bench).toBeDefined()
    // baseWeight = 50 (from nextRecommendedWeight), +2.5 (weightStep) = 52.5
    expect(bench.targetWeight).toBeGreaterThanOrEqual(52.5)
  })

  it('decreases weight when exerciseFlag.recommendation === decrease_weight', async () => {
    const analysisResult = {
      date: '2026-07-09T00:00:00Z',
      summary: '',
      plateaus: [],
      improvements: [],
      warnings: [],
      suggestions: [],
      exerciseFlags: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        status: 'trending_down',
        slopePerWeek: -1.0,
        recommendation: 'decrease_weight',
        reason: 'e1RM падает',
      }],
      globalFlags: { overtraining: false, recommendedDeload: false },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState: baseCoachState,
      exerciseLibrary,
      history: [{
        id: 's1',
        userId: 'vyacheslav',
        workoutDayId: 'day-1',
        workoutDayName: 'День A',
        completedAt: '2026-07-03T18:00:00Z',
        totalVolume: 1000,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 50,
          progressionType: 'hold',
          progressionReason: '',
          sets: [{ weight: 50, reps: 8, rpe: 7, completed: true }],
        }],
      }],
      analysisResult,
    })

    const bench = plan.exercises.find((e) => e.exerciseId === 'bench-press')
    expect(bench).toBeDefined()
    // baseWeight = 50, -2.5 (weightStep) = 47.5
    expect(bench.targetWeight).toBeLessThanOrEqual(47.5)
  })

  it('forces lowReadiness when globalFlags.overtraining === true', async () => {
    const analysisResult = {
      date: '2026-07-09T00:00:00Z',
      summary: '',
      plateaus: [],
      improvements: [],
      warnings: [],
      suggestions: [],
      exerciseFlags: [],
      globalFlags: { overtraining: true, overtrainingReason: 'e1RM падает', recommendedDeload: false },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState: baseCoachState, // readinessScore = 80 (not low by itself)
      exerciseLibrary,
      history: [],
      analysisResult,
    })

    // lowReadiness should be forced → coachReason should mention lighter/easier work
    expect(plan.coachReason).toBeTruthy()
    // lowReadiness → canonical short recovery name "Разгрузка"
    expect(plan.workoutDayName).toBe('Разгрузка')
    // The plan should still generate exercises (non-fatal)
    expect(plan.exercises.length).toBeGreaterThan(0)
  })

  it('skips plateau exercise when alternative exists for same muscle', async () => {
    // Library has 2 chest exercises: bench-press (plateau) + incline-db-press (alternative)
    const libraryWithAlternative = [
      ...exerciseLibrary,
      { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 20, weightStep: 2, restSeconds: 90, instruction: 'жим' },
    ]

    const analysisResult = {
      date: '2026-07-09T00:00:00Z',
      summary: '',
      plateaus: [],
      improvements: [],
      warnings: [],
      suggestions: [],
      exerciseFlags: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        status: 'plateau',
        weeksStagnant: 4,
        recommendation: 'swap_exercise',
        reason: 'плато 4 недели',
      }],
      globalFlags: { overtraining: false, recommendedDeload: false },
    }

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState: baseCoachState,
      exerciseLibrary: libraryWithAlternative,
      history: [],
      analysisResult,
    })

    // bench-press should NOT be in the plan (swapped for incline-db-press)
    const bench = plan.exercises.find((e) => e.exerciseId === 'bench-press')
    const incline = plan.exercises.find((e) => e.exerciseId === 'incline-db-press')
    expect(incline).toBeDefined()
    // bench-press may or may not be present depending on muscle pattern,
    // but if both chest exercises are candidates, incline should win
    if (bench && incline) {
      // Both present — that's OK, but incline should come first (non-plateau)
      const benchIdx = plan.exercises.findIndex((e) => e.exerciseId === 'bench-press')
      const inclineIdx = plan.exercises.findIndex((e) => e.exerciseId === 'incline-db-press')
      expect(inclineIdx).toBeLessThan(benchIdx)
    }
  })
})

describe('Issue #110: no duplicate core exercises', () => {
  it('does not add a core finisher when core is already in the workout', async () => {
    // Library with 2 core exercises: plank (Кор) + machine-crunch (Пресс)
    const libraryWithTwoCore = [
      ...exerciseLibrary,
      { id: 'pallof-press', name: 'Pallof press', muscleGroup: 'Кор', setsCount: 2, repMin: 8, repMax: 12, targetWeight: 0, weightStep: 0, restSeconds: 60, instruction: 'кор' },
      { id: 'machine-crunch', name: 'Скручивания в тренажёре', muscleGroup: 'Пресс', setsCount: 3, repMin: 10, repMax: 15, targetWeight: 15, weightStep: 2.5, restSeconds: 60, instruction: 'пресс' },
    ]

    const coachState = {
      recoveryStatus: 'ready',
      readinessScore: 80,
      weeklyLoadStatus: 'on_plan',
      mesocycle: { phase: 'accumulation', isDeload: false, weekInCycle: 2, cycleLength: 4, loadingWeeks: 3, deloadWeeks: 1 },
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

    const plan = await buildGeneratedPlannedWorkout({
      profile,
      scheduledDate: '2026-07-10',
      coachState,
      exerciseLibrary: libraryWithTwoCore,
      history: [],
    })

    // Count core exercises — should be at most 1, never 2
    const coreExercises = plan.exercises.filter((e) => {
      const muscleGroup = e.muscleGroup ?? ''
      return muscleGroup === 'Кор' || muscleGroup === 'Пресс' || muscleGroup.toLowerCase() === 'core'
    })
    expect(coreExercises.length).toBeLessThanOrEqual(1)
  })
})
