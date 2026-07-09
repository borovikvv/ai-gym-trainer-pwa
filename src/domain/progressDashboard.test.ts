import { describe, expect, it } from 'vitest'
import type { WorkoutDay  } from '../../shared/types'
import type { WorkoutHistoryEntry } from './workoutHistory'
import { buildProgressDashboard } from './progressDashboard'

const workoutDays: WorkoutDay[] = [
  {
    id: 'day-a',
    name: 'День A',
    label: 'Full Body A',
    description: '',
    exercises: [
      {
        id: 'bench-press',
        name: 'Жим лёжа',
        muscleGroup: 'Грудь',
        prescription: '3×6–8 · рекомендовано 40 кг',
        setsCount: 3,
        repMin: 6,
        repMax: 8,
        targetWeight: 40,
        weightStep: 2.5,
        restSeconds: 150,
        previous: '',
        todayGoal: '40×6/6/6',
        coachFocus: 'закрепить технику',
        alternatives: [],
        instruction: '',
        commonMistakes: [],
      },
      {
        id: 'lat-pulldown',
        name: 'Тяга верхнего блока',
        muscleGroup: 'Спина',
        prescription: '3×10–12 · рекомендовано 35 кг',
        setsCount: 3,
        repMin: 10,
        repMax: 12,
        targetWeight: 35,
        weightStep: 2.5,
        restSeconds: 90,
        previous: '',
        todayGoal: '35×12/12/12',
        coachFocus: 'тянуть локтями',
        alternatives: [],
        instruction: '',
        commonMistakes: [],
      },
      {
        id: 'plank',
        name: 'Планка',
        muscleGroup: 'Кор',
        prescription: '2×40–60 сек',
        setsCount: 2,
        repMin: 40,
        repMax: 60,
        targetWeight: 0,
        weightStep: 0,
        restSeconds: 60,
        previous: '',
        todayGoal: '40–60 сек',
        coachFocus: 'держать корпус',
        alternatives: [],
        instruction: '',
        commonMistakes: [],
      },
    ],
  },
]

const history: WorkoutHistoryEntry[] = [
  {
    id: 'recent',
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    workoutDayName: 'День A',
    completedAt: '2026-06-04T19:30:00.000Z',
    totalVolume: 2220,
    exercises: [
      {
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        volume: 240,
        nextRecommendedWeight: 40,
        progressionType: 'hold',
        progressionReason: 'Жим лёжа: RPE высокий, вес оставляем и добираем качество повторений.',
        sets: [{ weight: 40, reps: 6, rpe: 10, completed: true }],
      },
      {
        exerciseId: 'lat-pulldown',
        exerciseName: 'Тяга верхнего блока',
        pain: false,
        volume: 1260,
        nextRecommendedWeight: 37.5,
        progressionType: 'increase',
        progressionReason: 'Тяга верхнего блока: все подходы на верхней границе — следующий раз +2.5 кг.',
        sets: [
          { weight: 35, reps: 12, rpe: 7, completed: true },
          { weight: 35, reps: 12, rpe: 7, completed: true },
          { weight: 35, reps: 12, rpe: 8, completed: true },
        ],
      },
      {
        exerciseId: 'plank-extra-1780844823365',
        exerciseName: 'Планка',
        pain: false,
        volume: 0,
        nextRecommendedWeight: 0,
        progressionType: 'hold',
        progressionReason: 'Планка: закрепляем время.',
        sets: [
          { weight: 0, reps: 60, rpe: 7, completed: true },
        ],
      },
    ],
  },
  {
    id: 'old',
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    workoutDayName: 'День A',
    completedAt: '2026-05-20T19:30:00.000Z',
    totalVolume: 1000,
    exercises: [],
  },
]

describe('buildProgressDashboard', () => {
  it('summarizes recent volume, exercise statuses, next focus, and coach decisions without mock data', () => {
    const dashboard = buildProgressDashboard({ history, workoutDays, now: new Date('2026-06-05T10:00:00.000Z') })

    expect(dashboard.overview.workouts14d).toBe(1)
    expect(dashboard.overview.totalVolume14d).toBe(2220)
    expect(dashboard.overview.exercisesGrowing).toBe(1)
    expect(dashboard.overview.overloadSets).toBe(1)
    expect(dashboard.summary).toContain('Жим лёжа')
    expect(dashboard.summary).toContain('Тяга верхнего блока')

    expect(dashboard.focus[0]).toMatchObject({ exerciseName: 'Жим лёжа', status: 'закрепляем' })
    expect(dashboard.exerciseStatuses.map((item) => item.exerciseName)).toEqual(['Жим лёжа', 'Тяга верхнего блока', 'Планка'])
    expect(dashboard.exerciseStatuses[0]).toMatchObject({ status: 'закрепляем', lastResult: '40×6', nextTarget: '40 кг' })
    expect(dashboard.exerciseStatuses[1]).toMatchObject({ status: 'можно повысить', nextTarget: '37.5 кг' })
    expect(dashboard.exerciseStatuses[2]).toMatchObject({ status: 'застой', lastResult: '60 сек', nextTarget: 'вес тела' })

    expect(dashboard.coachDecisions[0]).toMatchObject({ title: 'Жим лёжа', source: 'правила прогрессии' })
    expect(dashboard.recentWorkouts[0].title).toBe('04.06 · День A')
  })

  it('uses "уменьшать помощь" wording for gravitron exercises in focus and summary', () => {
    // Gravitron pull-up: progressionType 'increase' means the counterweight
    // should DECREASE. The UI text must reflect this — saying "можно пробовать
    // 32.5 кг" without context would confuse (number went DOWN).
    const gravitronHistory = [
      {
        id: 'session-gravitron',
        userId: 'vyacheslav',
        workoutDayId: 'day-a',
        workoutDayName: 'День A',
        completedAt: '2026-06-04T19:30:00.000Z',
        totalVolume: 1500,
        exercises: [
          {
            exerciseId: 'assisted-pull-up',
            exerciseName: 'Подтягивания в гравитроне',
            pain: false,
            sets: [
              { weight: 35, reps: 10, rpe: 7, completed: true },
              { weight: 35, reps: 10, rpe: 8, completed: true },
            ],
            volume: 700,
            nextRecommendedWeight: 32.5,
            progressionType: 'increase' as const,
            progressionReason: 'все подходы на верхней границе — уменьшаем помощь',
          },
        ],
      },
    ]
    const gravitronWorkoutDays = [
      {
        id: 'day-a',
        name: 'День A',
        label: 'Спина',
        description: '',
        exercises: [
          {
            id: 'assisted-pull-up',
            name: 'Подтягивания в гравитроне',
            muscleGroup: 'Спина',
            prescription: '3x10',
            setsCount: 3,
            repMin: 8,
            repMax: 10,
            targetWeight: 35,
            weightStep: 2.5,
            restSeconds: 90,
            previous: 'нет данных',
            todayGoal: 'контроль',
            coachFocus: 'техника',
            alternatives: [],
            instruction: 'техника',
            commonMistakes: [],
          },
        ],
      },
    ]

    const dashboard = buildProgressDashboard({
      history: gravitronHistory,
      workoutDays: gravitronWorkoutDays,
      now: new Date('2026-06-05T10:00:00.000Z'),
    })

    // Focus text should say "уменьшать помощь до", not "можно пробовать"
    const gravitronFocus = dashboard.focus.find((f) => f.exerciseName === 'Подтягивания в гравитроне')
    expect(gravitronFocus).toBeDefined()
    expect(gravitronFocus!.text).toContain('уменьшать помощь')
    expect(gravitronFocus!.text).not.toContain('можно пробовать')

    // Summary should say "уменьшать помощь", not "повышать нагрузку"
    expect(dashboard.summary).toContain('уменьшать помощь')
    expect(dashboard.summary).not.toContain('повышать нагрузку')
  })
})
