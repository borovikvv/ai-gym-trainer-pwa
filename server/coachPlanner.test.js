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

// ---------------------------------------------------------------------------
// Volume landmark clamping (Phase 1)
// ---------------------------------------------------------------------------

describe('buildSafeCoachPlan — volume landmark clamping', () => {
  // Helper: build a history entry with N completed sets of bench press on a
  // given date, all at rpe=7 to avoid triggering the "hard recent" branch.
  function makeHistoryWithChestVolume(totalChestSets, daysAgo = 3) {
    const completedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
    // Split sets across up to 8 exercises in the same session to keep array
    // sizes reasonable (each session has one bench-press entry with N sets).
    return [{
      id: 'session-volume-test',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt,
      totalVolume: 60 * 8 * totalChestSets,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        muscleGroup: 'Грудь',
        pain: false,
        sets: Array.from({ length: totalChestSets }, () => ({
          weight: 60, reps: 8, rpe: 7, completed: true,
        })),
        volume: 60 * 8 * totalChestSets,
        nextRecommendedWeight: 62.5,
        progressionType: 'hold',
        progressionReason: 'удержание',
      }],
    }]
  }

  const profileAdult = {
    userId: 'vyacheslav',
    goal: 'сила',
    workoutsPerWeek: 3,
    trainingDays: ['Вторник', 'Четверг', 'Суббота'],
    age: 30,
  }

  const workoutDayWithBench = {
    id: 'day-volume-test',
    name: 'День A',
    label: 'Грудь',
    sortOrder: 1,
    exercises: [
      {
        programExerciseId: 'pe-bench-vol',
        exerciseId: 'bench-press',
        name: 'Жим лёжа',
        muscleGroup: 'Грудь',
        setsCount: 4,
        repMin: 6,
        repMax: 8,
        targetWeight: 60,
        weightStep: 2.5,
        restSeconds: 120,
      },
    ],
  }

  it('clamps setsCount to 2 when weekly chest volume is at MRV (16 sets, adult)', () => {
    // chest adult MRV = 16. With 16 sets in last 7 days, status is 'at_mrv'.
    const history = makeHistoryWithChestVolume(16)
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history,
      coachState: null,
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    expect(change.setsCount).toBeLessThanOrEqual(2)
    // coachFocus should mention volume reduction (priority >= 3 means
    // at_mrv or above_mrv).
    expect(change.coachFocus).toMatch(/объём/i)
  })

  it('clamps setsCount to 3 when weekly chest volume is above MAV (12-15 sets)', () => {
    // chest adult MAV = 12, MRV = 16. With 14 sets, status is 'above_mav'.
    const history = makeHistoryWithChestVolume(14)
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history,
      coachState: null,
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    expect(change.setsCount).toBeLessThanOrEqual(3)
  })

  it('does not clamp when weekly chest volume is in MEV-MAV range (6-11 sets)', () => {
    // chest adult MEV = 6, MAV = 12. With 8 sets, status is 'in_mev_mav'.
    const history = makeHistoryWithChestVolume(8)
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history,
      coachState: null,
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    // Original setsCount from the program is 4; should not be clamped down.
    expect(change.setsCount).toBe(4)
  })

  it('does not clamp when history is empty (no volume data)', () => {
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history: [],
      coachState: null,
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    expect(plan.changes[0].setsCount).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Mesocycle deload integration (Phase 2)
// ---------------------------------------------------------------------------

describe('buildSafeCoachPlan — mesocycle deload integration', () => {
  const profileAdult = {
    userId: 'vyacheslav',
    goal: 'сила',
    workoutsPerWeek: 3,
    trainingDays: ['Вторник', 'Четверг', 'Суббота'],
    age: 30,
  }

  const workoutDayWithBench = {
    id: 'day-deload-test',
    name: 'День A',
    label: 'Грудь',
    sortOrder: 1,
    exercises: [
      {
        programExerciseId: 'pe-bench-deload',
        exerciseId: 'bench-press',
        name: 'Жим лёжа',
        muscleGroup: 'Грудь',
        setsCount: 4,
        repMin: 8,
        repMax: 10,
        targetWeight: 60,
        weightStep: 2.5,
        restSeconds: 120,
      },
    ],
  }

  function makeMesocycleDeload() {
    return {
      phase: 'deload',
      phaseDescription: 'Разгрузочная неделя',
      weekInCycle: 5,
      cycleLength: 5,
      loadingWeeks: 4,
      deloadWeeks: 1,
      isDeload: true,
      deloadScheduled: false,
      triggerReason: 'Запланированная разгрузка',
      completionRatio: 1,
      workoutsThisCycle: 12,
      plannedWorkoutsThisCycle: 12,
    }
  }

  it('applies deload reduction when coachState.mesocycle.isDeload is true', () => {
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history: [],
      coachState: { mesocycle: makeMesocycleDeload() },
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    // applyDeloadReduction: setsCount = max(2, round(4 * 0.6)) = max(2, 2) = 2
    expect(change.setsCount).toBe(2)
    // targetWeight = 60 - 2.5 = 57.5
    expect(change.targetWeight).toBe(57.5)
    // repMin = max(6, 8) = 8 ; repMax = max(8+2, 10) = 10
    expect(change.repMin).toBe(8)
    expect(change.repMax).toBe(10)
    // intensityTarget should be 'easy'
    expect(change.intensityTarget).toBe('easy')
    // coachFocus should mention 'разгрузка'
    expect(change.coachFocus).toMatch(/разгруз/i)
  })

  it('does not apply deload when mesocycle.isDeload is false', () => {
    const mesocycle = { ...makeMesocycleDeload(), isDeload: false, phase: 'loading', weekInCycle: 1 }
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history: [],
      coachState: { mesocycle },
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    expect(change.setsCount).toBe(4) // original, not reduced
    expect(change.targetWeight).toBe(60) // original
    expect(change.intensityTarget).toBeUndefined()
  })

  it('handles null mesocycle gracefully (no deload)', () => {
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history: [],
      coachState: { mesocycle: null },
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    const change = plan.changes[0]
    expect(change.setsCount).toBe(4)
    expect(change.targetWeight).toBe(60)
    expect(change.intensityTarget).toBeUndefined()
  })

  it('handles null coachState gracefully (no deload, no crash)', () => {
    const plan = buildSafeCoachPlan({
      profile: profileAdult,
      workoutDays: [workoutDayWithBench],
      completedWorkout: null,
      history: [],
      coachState: null,
      exerciseLibrary: [],
      workoutQualityScore: 80,
      now: new Date(),
    })

    expect(plan.changes[0].setsCount).toBe(4)
  })
})
