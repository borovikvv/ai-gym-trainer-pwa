import { describe, expect, it } from 'vitest'
import { computeCoachMemory } from './coachMemory.js'

const profile = {
  userId: 'vyacheslav',
  goal: 'сила и мышечная масса',
  level: 'возвращаюсь после перерыва',
  workoutsPerWeek: 2,
  preferences: { focusAreas: ['Грудь', 'Спина', 'Руки'] },
  bannedExercises: ['Румынская тяга'],
}

const exerciseLibrary = [
  { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', targetWeight: 40, repMin: 6, repMax: 8 },
  { id: 'barbell-squat', name: 'Присед со штангой', muscleGroup: 'Ноги', targetWeight: 52.5, repMin: 6, repMax: 8 },
  { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'Спина', targetWeight: 22.5, repMin: 8, repMax: 10 },
  { id: 'cable-curl', name: 'Сгибание рук на нижнем блоке', muscleGroup: 'Руки', targetWeight: 15, repMin: 10, repMax: 15 },
  { id: 'plank', name: 'Планка', muscleGroup: 'Кор', targetWeight: 0, repMin: 40, repMax: 60 },
]

const history = [
  {
    id: 'session-legs',
    userId: 'vyacheslav',
    workoutDayId: 'generated-1',
    workoutDayName: 'персональная тренировка',
    completedAt: '2026-06-09T18:00:00.000Z',
    totalVolume: 2600,
    exercises: [
      {
        exerciseId: 'barbell-squat',
        exerciseName: 'Присед со штангой',
        pain: false,
        nextRecommendedWeight: 52.5,
        progressionType: 'hold',
        progressionReason: 'после перерыва закрепить вес',
        sets: [
          { weight: 52.5, reps: 6, rpe: 8, completed: true },
          { weight: 52.5, reps: 6, rpe: 9, completed: true },
          { weight: 52.5, reps: 6, rpe: 9, completed: true },
        ],
      },
      {
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 40,
        progressionType: 'hold',
        progressionReason: 'закрепить 3 подхода без отказа',
        sets: [
          { weight: 40, reps: 6, rpe: 8, completed: true },
          { weight: 40, reps: 6, rpe: 8, completed: true },
          { weight: 40, reps: 5, rpe: 9, completed: true },
        ],
      },
    ],
  },
  {
    id: 'session-upper',
    userId: 'vyacheslav',
    workoutDayId: 'generated-0',
    workoutDayName: 'персональная тренировка',
    completedAt: '2026-06-06T18:00:00.000Z',
    totalVolume: 1700,
    exercises: [
      {
        exerciseId: 'lat-pulldown',
        exerciseName: 'Тяга верхнего блока',
        pain: false,
        nextRecommendedWeight: 25,
        progressionType: 'increase',
        progressionReason: 'все подходы уверенно',
        sets: [
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 8, completed: true },
        ],
      },
    ],
  },
]

describe('Coach Memory', () => {
  it('builds exercise profiles, muscle recovery and weekly balance from profile plus history', () => {
    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history,
      now: new Date('2026-06-11T12:00:00.000Z'),
    })

    expect(memory.userId).toBe('vyacheslav')
    expect(memory.trainerProfile).toContain('персональный силовой тренер')

    expect(memory.exerciseProfiles['bench-press']).toMatchObject({
      name: 'Жим лёжа',
      status: 'consolidate',
      currentWorkingWeight: 40,
      recommendation: 'закрепить вес без отказа',
    })
    expect(memory.exerciseProfiles['lat-pulldown']).toMatchObject({
      status: 'progress_possible',
      recommendation: 'можно осторожно повышать нагрузку',
    })

    expect(memory.muscleGroupProfiles.legs).toMatchObject({
      status: 'avoid',
      lastTrainedDaysAgo: 2,
    })
    expect(memory.weeklyBalance).toMatchObject({
      plannedWorkoutsPerWeek: 2,
      completedWorkoutsLast7Days: 2,
    })
    expect(memory.weeklyBalance.muscleSetCounts).toMatchObject({ legs: 3, chest: 3, back: 3 })
    expect(memory.recommendations).toContain('Ноги ещё восстанавливаются — не ставить тяжёлую нагрузку ног в ближайшую тренировку.')
    expect(memory.summary).toContain('Ноги')
  })

  it('uses canonical ids for added exercise variants in memory', () => {
    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history: [{
        id: 'session-extra-plank',
        userId: 'vyacheslav',
        workoutDayId: 'generated-2',
        workoutDayName: 'персональная тренировка',
        completedAt: '2026-06-10T18:00:00.000Z',
        totalVolume: 0,
        exercises: [{
          exerciseId: 'plank-extra-1780844823365',
          exerciseName: 'Планка',
          pain: false,
          nextRecommendedWeight: 0,
          progressionType: 'hold',
          progressionReason: 'закрепить время',
          sets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
        }],
      }],
      now: new Date('2026-06-11T12:00:00.000Z'),
    })

    expect(memory.exerciseProfiles.plank).toMatchObject({
      status: 'progress_possible',
      currentWorkingWeight: 0,
      lastReps: 60,
      recentSessions: 1,
    })
    expect(memory.weeklyBalance.muscleSetCounts).toMatchObject({ core: 1 })
  })

  it('includes recent coach decision logs in memory recommendations', () => {
    const memory = computeCoachMemory({
      profile: { userId: 'oleg', workoutsPerWeek: 3 },
      exerciseLibrary: [],
      history: [],
      coachState: { warnings: [] },
      coachDecisionLogs: [
        {
          decisionType: 'live_strategy',
          decisionSummary: 'Снизить объём после тяжёлого жима.',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    expect(memory.recommendations.join(' ')).toContain('Снизить объём после тяжёлого жима')
  })
})

describe('Issue #99: currentWorkingWeight after deload/recovery', () => {
  // Scenario from the bug report: bench press was at 55kg, then a deload/
  // recovery session dropped it to 40kg. The coach should remember the 55kg
  // potential and not force the user to climb back up step by step.
  const benchHistory = [
    // Most recent: light recovery session at 40kg (3 weeks after the 55kg session)
    {
      id: 'session-recovery',
      userId: 'vyacheslav',
      workoutDayId: 'generated-recovery',
      workoutDayName: 'разгрузка',
      completedAt: '2026-06-29T18:00:00.000Z',
      totalVolume: 1440,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 42.5,
        progressionType: 'hold',
        progressionReason: 'разгрузочная неделя',
        sets: [
          { weight: 40, reps: 12, rpe: 6, completed: true },
          { weight: 40, reps: 12, rpe: 6, completed: true },
          { weight: 40, reps: 12, rpe: 7, completed: true },
        ],
      }],
    },
    // Middle session (deload week): 52.5kg
    {
      id: 'session-deload',
      userId: 'vyacheslav',
      workoutDayId: 'generated-deload',
      workoutDayName: 'разгрузка',
      completedAt: '2026-06-22T18:00:00.000Z',
      totalVolume: 1575,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 52.5,
        progressionType: 'hold',
        progressionReason: 'deload',
        sets: [
          { weight: 52.5, reps: 8, rpe: 6, completed: true },
          { weight: 52.5, reps: 8, rpe: 7, completed: true },
        ],
      }],
    },
    // Oldest session: strong 55kg
    {
      id: 'session-strong',
      userId: 'vyacheslav',
      workoutDayId: 'generated-strong',
      workoutDayName: 'силовая',
      completedAt: '2026-06-18T18:00:00.000Z',
      totalVolume: 1900,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        nextRecommendedWeight: 57.5,
        progressionType: 'increase',
        progressionReason: 'все подходы уверенно',
        sets: [
          { weight: 40, reps: 12, rpe: 7, completed: true },
          { weight: 50, reps: 10, rpe: 7, completed: true },
          { weight: 55, reps: 8, rpe: 7, completed: true },
        ],
      }],
    },
  ]

  it('remembers the max working weight from last 3 sessions after a deload', () => {
    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history: benchHistory,
      now: new Date('2026-06-30T12:00:00.000Z'),
    })

    // max(40, 52.5, 55) = 55 — the coach remembers the 55kg potential
    expect(memory.exerciseProfiles['bench-press'].currentWorkingWeight).toBe(55)
  })

  it('does NOT use historical max when latest session had pain (safety)', () => {
    const historyWithPain = benchHistory.map((s, i) =>
      i === 0 // modify the most recent (recovery) session
        ? { ...s, exercises: s.exercises.map((e) => ({ ...e, pain: true })) }
        : s,
    )

    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history: historyWithPain,
      now: new Date('2026-06-30T12:00:00.000Z'),
    })

    // Pain in latest session → use latest session's weight (40), NOT the
    // historical max (55) — user may have backed off due to injury.
    expect(memory.exerciseProfiles['bench-press'].currentWorkingWeight).toBe(40)
    expect(memory.exerciseProfiles['bench-press'].pain).toBe(true)
  })

  it('uses max from available sessions when fewer than 3 exist', () => {
    // Only 2 sessions: 40kg (latest) and 55kg (older)
    const twoSessionHistory = benchHistory.slice(0, 1).concat(benchHistory.slice(2))

    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history: twoSessionHistory,
      now: new Date('2026-06-30T12:00:00.000Z'),
    })

    // max(40, 55) = 55
    expect(memory.exerciseProfiles['bench-press'].currentWorkingWeight).toBe(55)
  })

  it('normal progression still works (increasing weight across sessions)', () => {
    const progressionHistory = [
      // Latest: 57.5kg
      {
        id: 's3',
        userId: 'vyacheslav',
        workoutDayId: 'g3',
        workoutDayName: 'тренировка',
        completedAt: '2026-06-29T18:00:00.000Z',
        totalVolume: 1380,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 60,
          progressionType: 'increase',
          progressionReason: 'прогресс',
          sets: [
            { weight: 57.5, reps: 8, rpe: 7, completed: true },
            { weight: 57.5, reps: 8, rpe: 8, completed: true },
          ],
        }],
      },
      // Middle: 55kg
      {
        id: 's2',
        userId: 'vyacheslav',
        workoutDayId: 'g2',
        workoutDayName: 'тренировка',
        completedAt: '2026-06-22T18:00:00.000Z',
        totalVolume: 1320,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 57.5,
          progressionType: 'increase',
          progressionReason: 'прогресс',
          sets: [
            { weight: 55, reps: 8, rpe: 7, completed: true },
            { weight: 55, reps: 8, rpe: 8, completed: true },
          ],
        }],
      },
      // Oldest: 52.5kg
      {
        id: 's1',
        userId: 'vyacheslav',
        workoutDayId: 'g1',
        workoutDayName: 'тренировка',
        completedAt: '2026-06-15T18:00:00.000Z',
        totalVolume: 1260,
        exercises: [{
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          pain: false,
          nextRecommendedWeight: 55,
          progressionType: 'increase',
          progressionReason: 'прогресс',
          sets: [
            { weight: 52.5, reps: 8, rpe: 7, completed: true },
            { weight: 52.5, reps: 8, rpe: 8, completed: true },
          ],
        }],
      },
    ]

    const memory = computeCoachMemory({
      profile,
      exerciseLibrary,
      history: progressionHistory,
      now: new Date('2026-06-30T12:00:00.000Z'),
    })

    // max(57.5, 55, 52.5) = 57.5 — correct, latest is already the max
    expect(memory.exerciseProfiles['bench-press'].currentWorkingWeight).toBe(57.5)
  })
})
