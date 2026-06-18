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
