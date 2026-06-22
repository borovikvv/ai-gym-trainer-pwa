import { describe, expect, it } from 'vitest'
import { buildCoachPrompt, buildSafeCoachPlan, clampCoachPlanToNextWorkout } from './coachPlanner.js'

const profile = {
  userId: 'vyacheslav',
  goal: 'сила и мышечная масса',
  workoutsPerWeek: 2,
  trainingDays: ['Четверг', 'Воскресенье'],
}

const workoutDays = [
  {
    id: 'vyacheslav-main-day-a',
    name: 'День A',
    label: 'Full Body A',
    sortOrder: 1,
    exercises: [
      { programExerciseId: 'pe-bench', exerciseId: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150 },
    ],
  },
  {
    id: 'vyacheslav-main-day-b',
    name: 'День B',
    label: 'Full Body B',
    sortOrder: 2,
    exercises: [
      { programExerciseId: 'pe-rdl', exerciseId: 'romanian-deadlift', name: 'Румынская тяга', muscleGroup: 'Задняя поверхность бедра', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 47.5, weightStep: 2.5, restSeconds: 150 },
      { programExerciseId: 'pe-incline', exerciseId: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90 },
    ],
  },
]

const completedWorkout = {
  id: 'session-1',
  userId: 'vyacheslav',
  workoutDayId: 'vyacheslav-main-day-a',
  workoutDayName: 'День A',
  completedAt: '2026-06-05T20:00:00.000Z',
  exercises: [
    {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      pain: false,
      progressionType: 'deload',
      progressionReason: 'первый подход был на пределе, следующий раз осторожнее',
      nextRecommendedWeight: 47.5,
      sets: [
        { weight: 50, reps: 6, rpe: 10, completed: true },
        { weight: 47.5, reps: 6, rpe: 9, completed: true },
      ],
    },
  ],
}

const exerciseLibrary = [
  { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 40, weightStep: 2.5, restSeconds: 150 },
  { id: 'incline-db-press', name: 'Жим гантелей на наклонной', muscleGroup: 'Грудь', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 14, weightStep: 2, restSeconds: 90 },
  { id: 'hammer-curl', name: 'Молотковые сгибания', muscleGroup: 'Руки', setsCount: 2, repMin: 10, repMax: 12, targetWeight: 10, weightStep: 1, restSeconds: 75 },
  { id: 'lateral-raise', name: 'Разведения гантелей в стороны', muscleGroup: 'Плечи', setsCount: 2, repMin: 12, repMax: 15, targetWeight: 6, weightStep: 1, restSeconds: 75 },
]

describe('post-workout coach planner', () => {
  it('chooses the real next scheduled workout and creates bounded changes for its exercises', () => {
    const plan = buildSafeCoachPlan({
      profile,
      workoutDays,
      completedWorkout,
      history: [completedWorkout],
      now: new Date('2026-06-05T21:00:00.000Z'),
    })

    expect(plan.source).toBe('rules')
    expect(plan.nextWorkoutDayId).toBe('vyacheslav-main-day-b')
    expect(plan.summary).toContain('День B')
    expect(plan.changes.map((change) => change.programExerciseId)).toEqual(['pe-rdl', 'pe-incline'])
    expect(plan.changes[0]).toMatchObject({ setsCount: 3, repMin: 8, repMax: 10 })
    expect(plan.changes[0].coachFocus).toContain('после')
  })

  it('matches completed workout by day key when saved history stores day-a instead of database row id', () => {
    const plan = buildSafeCoachPlan({
      profile,
      workoutDays: workoutDays.map((day, index) => ({ ...day, dayKey: index === 0 ? 'day-a' : 'day-b' })),
      completedWorkout: { ...completedWorkout, workoutDayId: 'day-a' },
      history: [completedWorkout],
      now: new Date('2026-06-05T21:00:00.000Z'),
    })

    expect(plan.nextWorkoutDayId).toBe('vyacheslav-main-day-b')
    expect(plan.changes.map((change) => change.programExerciseId)).toEqual(['pe-rdl', 'pe-incline'])
  })

  it('rejects LLM changes outside the next workout and clamps unsafe jumps', () => {
    const llmPlan = {
      source: 'llm',
      summary: 'test',
      nextWorkoutDayId: 'vyacheslav-main-day-b',
      changes: [
        { programExerciseId: 'pe-rdl', targetWeight: 100, setsCount: 8, repMin: 1, repMax: 30, restSeconds: 10, coachFocus: '' },
        { programExerciseId: 'pe-bench', targetWeight: 999, setsCount: 3, repMin: 6, repMax: 8, restSeconds: 150, coachFocus: 'wrong day' },
      ],
      warnings: [],
    }

    const safe = clampCoachPlanToNextWorkout(llmPlan, workoutDays[1])

    expect(safe.changes).toHaveLength(1)
    expect(safe.changes[0].programExerciseId).toBe('pe-rdl')
    expect(safe.changes[0].targetWeight).toBeLessThanOrEqual(52.5)
    expect(safe.changes[0].setsCount).toBe(4)
    expect(safe.changes[0].repMin).toBe(6)
    expect(safe.changes[0].repMax).toBe(15)
    expect(safe.changes[0].restSeconds).toBe(45)
    expect(safe.warnings.join(' ')).toContain('отклонено')
  })

  it('uses Coach State and the full exercise library to replace highly fatigued muscle groups in the next workout', () => {
    const coachState = {
      recoveryStatus: 'low',
      readinessScore: 45,
      muscleGroups: {
        chest: { fatigue: 'high', recentMaxEffortSets: 2, lastTrainedDaysAgo: 1 },
        arms: { fatigue: 'low', recentMaxEffortSets: 0, lastTrainedDaysAgo: null },
        shoulders: { fatigue: 'low', recentMaxEffortSets: 0, lastTrainedDaysAgo: null },
      },
      exercises: {
        'incline-db-press': { status: 'consolidate' },
        'hammer-curl': { status: 'no_data' },
      },
    }

    const plan = buildSafeCoachPlan({
      profile,
      workoutDays,
      completedWorkout,
      history: [completedWorkout],
      now: new Date('2026-06-05T21:00:00.000Z'),
      coachState,
      exerciseLibrary,
    })

    const changedChestSlot = plan.changes.find((change) => change.programExerciseId === 'pe-incline')
    expect(changedChestSlot).toMatchObject({
      programExerciseId: 'pe-incline',
      exerciseId: 'hammer-curl',
      exerciseName: 'Молотковые сгибания',
      setsCount: 2,
      repMin: 10,
      repMax: 12,
    })
    expect(changedChestSlot.coachFocus).toContain('замена')
    expect(plan.summary).toContain('учётом восстановления')
  })

  it('puts the explicit personal-trainer profile into the LLM prompt', () => {
    const prompt = buildCoachPrompt({
      profile,
      workoutDays,
      completedWorkout,
      history: [completedWorkout],
      nextWorkoutDay: workoutDays[1],
      coachState: { recoveryStatus: 'ready', readinessScore: 80 },
      exerciseLibrary,
    })

    expect(prompt).toContain('Профиль тренера')
    expect(prompt).toContain('персональный силовой тренер')
    expect(prompt).toContain('не создавай две одинаковые ближайшие тренировки')
  })

  it('clamps LLM exercise replacements to the exercise library while still limiting changed rows to the next workout', () => {
    const llmPlan = {
      source: 'llm',
      summary: 'test',
      nextWorkoutDayId: 'vyacheslav-main-day-b',
      changes: [
        { programExerciseId: 'pe-incline', exerciseId: 'hammer-curl', targetWeight: 100, setsCount: 8, repMin: 1, repMax: 30, restSeconds: 10, coachFocus: 'replace chest' },
        { programExerciseId: 'pe-rdl', exerciseId: 'unknown-exercise', targetWeight: 10, setsCount: 2, repMin: 8, repMax: 12, restSeconds: 90, coachFocus: 'invalid library item' },
        { programExerciseId: 'pe-bench', exerciseId: 'hammer-curl', targetWeight: 10, setsCount: 2, repMin: 10, repMax: 12, restSeconds: 75, coachFocus: 'wrong day' },
      ],
      warnings: [],
    }

    const safe = clampCoachPlanToNextWorkout(llmPlan, workoutDays[1], exerciseLibrary)

    expect(safe.changes).toHaveLength(2)
    expect(safe.changes.find((change) => change.programExerciseId === 'pe-incline')).toMatchObject({
      exerciseId: 'hammer-curl',
      exerciseName: 'Молотковые сгибания',
      targetWeight: 18,
      setsCount: 4,
    })
    expect(safe.changes.find((change) => change.programExerciseId === 'pe-rdl')).not.toHaveProperty('exerciseId')
    expect(safe.warnings.join(' ')).toContain('не найдено в библиотеке')
    expect(safe.warnings.join(' ')).toContain('отклонено')
  })
})
