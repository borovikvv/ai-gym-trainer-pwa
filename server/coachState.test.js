import { describe, expect, it } from 'vitest'
import { computeCoachState } from './coachState.js'
import { resolveSessionAnchor } from './utils.js'

const profile = {
  userId: 'vyacheslav',
  workoutsPerWeek: 2,
  trainingDays: ['Четверг', 'Воскресенье'],
}

const workoutDays = [
  {
    id: 'vyacheslav-program-day-a',
    dayKey: 'day-a',
    name: 'Full Body A',
    exercises: [
      { id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'грудь', targetWeight: 40, repMin: 6, repMax: 8 },
      { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'спина', targetWeight: 22.5, repMin: 8, repMax: 10 },
      { id: 'plank', name: 'Планка', muscleGroup: 'кор', targetWeight: 0, repMin: 40, repMax: 60 },
    ],
  },
]

const history = [
  {
    id: 'session-yesterday',
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    workoutDayName: 'Full Body A',
    completedAt: '2026-06-04T18:00:00.000Z',
    totalVolume: 1500,
    exercises: [
      {
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [
          { weight: 40, reps: 6, rpe: 10, completed: true },
          { weight: 37.5, reps: 6, rpe: 9, completed: true },
        ],
      },
      {
        exerciseId: 'lat-pulldown',
        exerciseName: 'Тяга верхнего блока',
        pain: false,
        sets: [
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
          { weight: 22.5, reps: 10, rpe: 7, completed: true },
        ],
      },
    ],
  },
]

describe('Coach State', () => {
  it('summarizes recovery, weekly load, muscle fatigue and exercise readiness from recent workouts', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state).toMatchObject({
      userId: 'vyacheslav',
      daysSinceLastWorkout: 1,
      actualWorkoutsLast7Days: 1,
      plannedWorkoutsPerWeek: 2,
      weeklyLoadStatus: 'below_plan',
      recoveryStatus: 'partial',
    })

    expect(state.muscleGroups).toMatchObject({
      chest: { fatigue: 'high', recentHardSets: 2, lastTrainedDaysAgo: 1 },
      back: { fatigue: 'medium', recentHardSets: 0, lastTrainedDaysAgo: 1 },
    })

    expect(state.exercises['bench-press']).toMatchObject({
      status: 'consolidate',
      lastWeight: 40,
      maxEffortSets: 1,
      target: 'закрепить вес без отказа',
    })

    expect(state.exercises['lat-pulldown']).toMatchObject({
      status: 'progress_possible',
      lastWeight: 22.5,
      target: 'можно повышать нагрузку',
    })
  })

  it('marks recovery as low after a very recent high-intensity workout', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-06-04T22:00:00.000Z'),
    })

    expect(state.daysSinceLastWorkout).toBe(0)
    expect(state.recoveryStatus).toBe('low')
    expect(state.readinessScore).toBeLessThan(60)
  })

  it('uses age as a recovery prior while early personal statistics are sparse', () => {
    const easyHistory = [{
      id: 'session-two-days-ago',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'Full Body A',
      completedAt: '2026-06-03T18:00:00.000Z',
      totalVolume: 900,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [{ weight: 35, reps: 8, rpe: 7, completed: true }],
      }],
    }]

    const vyacheslav = computeCoachState({
      profile: { ...profile, age: 43 },
      workoutDays,
      history: easyHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })
    const oleg = computeCoachState({
      profile: { ...profile, userId: 'oleg', age: 15 },
      workoutDays,
      history: easyHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(vyacheslav.recoveryStatus).toBe('partial')
    expect(oleg.recoveryStatus).toBe('ready')
    expect(vyacheslav.readinessScore).toBeLessThan(oleg.readinessScore)
  })

  it('lets accumulated clean training history outweigh the age prior', () => {
    const cleanHistory = Array.from({ length: 8 }, (_, index) => ({
      id: `clean-session-${index}`,
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'Full Body A',
      completedAt: new Date(Date.UTC(2026, 5, 3 - index, 18, 0, 0)).toISOString(),
      totalVolume: 900,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: false,
        sets: [{ weight: 35, reps: 8, rpe: 7, completed: true }],
      }],
    }))

    const state = computeCoachState({
      profile: { ...profile, age: 43 },
      workoutDays,
      history: cleanHistory,
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state.recoveryStatus).toBe('ready')
    expect(state.personalization.trainingDataConfidence).toBe(1)
  })

  it('uses canonical exercise ids for generated extra exercises', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history: [{
        id: 'session-extra-plank',
        userId: 'vyacheslav',
        workoutDayId: 'planned-day',
        workoutDayName: 'Персональная',
        completedAt: '2026-06-04T18:00:00.000Z',
        totalVolume: 0,
        exercises: [{
          exerciseId: 'plank-extra-1780844823365',
          exerciseName: 'Планка',
          pain: false,
          sets: [{ weight: 0, reps: 60, rpe: 7, completed: true }],
        }],
      }],
      now: new Date('2026-06-05T18:00:00.000Z'),
    })

    expect(state.exercises.plank).toMatchObject({
      status: 'progress_possible',
      lastWeight: 0,
      lastReps: 60,
    })
    expect(state.exercises['plank-extra-1780844823365']).toBeUndefined()
    expect(state.muscleGroups.core).toMatchObject({ lastTrainedDaysAgo: 1 })
  })
})

// ---------------------------------------------------------------------------
// Issue #137: окно RECENTLY_TRAINED_DAYS. Группа, тренированная позавчера, уже
// не 'low' (иначе планировщик считает её свежей и даёт +30), но и не 'high' —
// 'high' работает как хард-фильтр и остаётся окном в 1 день.
// ---------------------------------------------------------------------------

describe('Issue #137: muscle fatigue window', () => {
  const now = new Date('2026-07-29T12:00:00.000Z')
  const pushDay = [{
    id: 'day-push',
    dayKey: 'day-push',
    name: 'Push',
    exercises: [{ id: 'bench-press', name: 'Жим лёжа', muscleGroup: 'грудь', targetWeight: 60, repMin: 8, repMax: 12 }],
  }]

  const stateAfterSession = ({ daysAgo, rpe }) => computeCoachState({
    profile,
    workoutDays: pushDay,
    history: [{
      id: `session-${daysAgo}d`,
      userId: 'vyacheslav',
      workoutDayId: 'day-push',
      workoutDayName: 'Push',
      completedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        muscleGroup: 'грудь',
        pain: false,
        sets: [
          { weight: 60, reps: 10, rpe, completed: true },
          { weight: 60, reps: 9, rpe, completed: true },
        ],
      }],
    }],
    now,
  })

  it('группа, тренированная позавчера, получает medium, а не low', () => {
    const state = stateAfterSession({ daysAgo: 2, rpe: 7 })
    expect(state.muscleGroups.chest).toMatchObject({ lastTrainedDaysAgo: 2, fatigue: 'medium' })
  })

  it('тяжёлая сессия позавчера не даёт high — хард-фильтр остаётся окном в 1 день', () => {
    const state = stateAfterSession({ daysAgo: 2, rpe: 9 })
    expect(state.muscleGroups.chest).toMatchObject({ lastTrainedDaysAgo: 2, fatigue: 'medium' })
    expect(state.recoveryStatus).toBe('ready')
    expect(state.readinessScore).toBeGreaterThanOrEqual(55)
  })

  it('тяжёлая сессия вчера по-прежнему даёт high', () => {
    const state = stateAfterSession({ daysAgo: 1, rpe: 9 })
    expect(state.muscleGroups.chest).toMatchObject({ lastTrainedDaysAgo: 1, fatigue: 'high' })
  })

  it('через 3 дня без тяжёлых подходов группа снова low', () => {
    const state = stateAfterSession({ daysAgo: 3, rpe: 7 })
    expect(state.muscleGroups.chest).toMatchObject({ lastTrainedDaysAgo: 3, fatigue: 'low' })
  })
})

// ---------------------------------------------------------------------------
// Issue #173: lastWeight для упражнений с помощью (гравитрон).
// «Лучший» подход = MIN помощи, а не MAX.
// ---------------------------------------------------------------------------

describe('Issue #173: lastWeight for assisted exercises', () => {
  const gravitronDays = [
    {
      id: 'day-g',
      dayKey: 'day-g',
      name: 'Full Body G',
      exercises: [
        { id: 'assisted-pull-up', name: 'Подтягивания в гравитроне', muscleGroup: 'спина', targetWeight: 35, repMin: 6, repMax: 10, weightDirection: 'assistance' },
      ],
    },
  ]
  const gravitronHistory = [
    {
      id: 'session-g',
      userId: 'vyacheslav',
      workoutDayId: 'day-g',
      workoutDayName: 'Full Body G',
      completedAt: '2026-07-27T18:00:00.000Z',
      totalVolume: 500,
      exercises: [
        {
          exerciseId: 'assisted-pull-up',
          exerciseName: 'Подтягивания в гравитроне',
          pain: false,
          sets: [
            { weight: 30, reps: 8, rpe: 7, completed: true },
            { weight: 16.5, reps: 8, rpe: 7, completed: true },
          ],
        },
      ],
    },
  ]

  it('lastWeight = MIN помощи в подходах (сильнейший), а не MAX', () => {
    const state = computeCoachState({
      profile,
      workoutDays: gravitronDays,
      history: gravitronHistory,
      now: new Date('2026-07-28T18:00:00.000Z'),
    })

    expect(state.exercises['assisted-pull-up'].lastWeight).toBe(16.5)
  })

  it('работает по названию, если поле weightDirection не передано', () => {
    const daysWithoutField = gravitronDays.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => {
        const copy = { ...exercise }
        delete copy.weightDirection
        return copy
      }),
    }))
    const state = computeCoachState({
      profile,
      workoutDays: daysWithoutField,
      history: gravitronHistory,
      now: new Date('2026-07-28T18:00:00.000Z'),
    })

    expect(state.exercises['assisted-pull-up'].lastWeight).toBe(16.5)
  })
})

// Issue #223: тренировки по вечерам, а плановая сессия считалась на полдень —
// пятница 20:00 → воскресенье 12:00 = 40 часов, то есть «один день» вместо
// двух. Отсюда падала готовность и обычный день расписания уезжал в «Разгрузку».
describe('daysSinceLastWorkout — якорь времени сессии (#223)', () => {
  const eveningHistory = [
    {
      id: 'session-friday-evening',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      completedAt: '2026-08-07T19:00:00.000Z',
      totalVolume: 1500,
      exercises: [
        {
          exerciseId: 'lat-pulldown',
          exerciseName: 'Тяга верхнего блока',
          pain: false,
          sets: [{ weight: 40, reps: 10, rpe: 8, completed: true }],
        },
      ],
    },
  ]

  it('на якоре реального времени тренировки разрыв считается как двое суток', () => {
    const state = computeCoachState({
      profile,
      workoutDays,
      history: eveningHistory,
      now: resolveSessionAnchor('2026-08-09', eveningHistory),
    })

    expect(state.daysSinceLastWorkout).toBe(2)
  })
})

// Issue #225: два подхода на RPE 10 держали recoveryStatus 'low' трое суток —
// при расписании 3x/нед следующая тренировка попадала в окно гарантированно, и
// обычный день уезжал в «Разгрузку». Два предельных подхода в одной сессии это
// норма тяжёлого дня, а не сигнал перетренированности: окно сужено до 2 суток.
describe('recoveryStatus — окно предельных подходов (#225)', () => {
  const maxEffortSession = (completedAt) => [{
    id: 'session-max-effort',
    userId: 'vyacheslav',
    workoutDayId: 'day-a',
    completedAt,
    totalVolume: 1200,
    exercises: [{
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      pain: false,
      sets: [
        { weight: 50, reps: 5, rpe: 10, completed: true },
        { weight: 50, reps: 4, rpe: 10, completed: true },
      ],
    }],
  }]
  const now = new Date('2026-08-09T19:00:00.000Z')

  it('через двое суток предельные подходы больше не держат восстановление низким', () => {
    // Ровно 48 часов: после якоря #224 плановая сессия попадает на то же время
    // суток, поэтому целые сутки — обычный случай, а не редкая граница.
    const state = computeCoachState({ profile, workoutDays, history: maxEffortSession('2026-08-07T19:00:00.000Z'), now })

    expect(state.recoveryStatus).not.toBe('low')
  })

  it('через сутки — всё ещё низкое', () => {
    const state = computeCoachState({ profile, workoutDays, history: maxEffortSession('2026-08-08T19:00:00.000Z'), now })

    expect(state.recoveryStatus).toBe('low')
  })
})

// Issue #232: каталог для классификации усталости должен включать упражнения из
// exercise_library, а не только из дней активной программы. Слот-филлер вне
// программы (skull-crusher) не должен «перекрашиваться» в группу по названию:
// «Французский жим лёжа» содержит алиас 'жим' (грудь) — без справочника грудь
// получала чужую усталость и штрафы готовности.
describe('Issue #232: упражнения вне программы классифицируются по exerciseLibrary', () => {
  const noChestWorkoutDays = [
    {
      id: 'vyacheslav-program-day-a',
      dayKey: 'day-a',
      name: 'Full Body A',
      exercises: [
        { id: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'спина', targetWeight: 22.5, repMin: 8, repMax: 10 },
        { id: 'plank', name: 'Планка', muscleGroup: 'кор', targetWeight: 0, repMin: 40, repMax: 60 },
      ],
    },
  ]
  const exerciseLibrary = [
    { id: 'skull-crusher', name: 'Французский жим лёжа', muscleGroup: 'Руки · трицепс', targetWeight: 20, repMin: 8, repMax: 12 },
  ]
  const skullCrusherHistory = [
    {
      id: 'session-skull-crusher',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'Full Body A',
      completedAt: '2026-08-08T18:00:00.000Z',
      totalVolume: 400,
      exercises: [{
        exerciseId: 'skull-crusher',
        exerciseName: 'Французский жим лёжа',
        pain: false,
        sets: [
          { weight: 20, reps: 8, rpe: 10, completed: true },
          { weight: 20, reps: 8, rpe: 10, completed: true },
        ],
      }],
    },
  ]

  it('skull-crusher из справочника даёт усталость arms, а не chest', () => {
    const state = computeCoachState({
      profile,
      workoutDays: noChestWorkoutDays,
      exerciseLibrary,
      history: skullCrusherHistory,
      now: new Date('2026-08-09T18:00:00.000Z'),
    })

    expect(state.muscleGroups.chest).toBeUndefined()
    expect(state.muscleGroups.arms).toMatchObject({ fatigue: 'high', recentMaxEffortSets: 2 })
  })
})

// Issue #293: состояние по под-мышцам ног. Генератор планировал ноги как одну
// группу, и движение на те же под-мышцы (выпады → BSS, оба квадрицепс+ягодицы)
// занимало слот через день. subMuscleGroups агрегирует усталость по под-ключам.
describe('Issue #293: subMuscleGroups по под-мышцам ног', () => {
  const legSubLibrary = [
    { id: 'bulgarian-split-squat', name: 'Болгарский сплит-присед', muscleGroup: 'Ноги', targetMuscles: ['квадрицепс', 'ягодицы'], targetWeight: 40, repMin: 8, repMax: 10 },
    { id: 'leg-curl', name: 'Сгибание ног', muscleGroup: 'Ноги', targetMuscles: ['задняя поверхность бедра'], targetWeight: 30, repMin: 10, repMax: 12 },
    { id: 'lunge', name: 'Выпады с гантелями', muscleGroup: 'Ноги', targetMuscles: ['квадрицепс', 'ягодицы'], targetWeight: 20, repMin: 8, repMax: 10 },
  ]

  it('сессия 3 дня назад с выпадами даёт medium по quads и glutes, hamstrings не тронут', () => {
    const state = computeCoachState({
      profile,
      workoutDays: [],
      exerciseLibrary: legSubLibrary,
      history: [
        {
          id: 'session-lunges',
          userId: 'vyacheslav',
          workoutDayId: 'day-a',
          workoutDayName: 'Full Body A',
          completedAt: '2026-08-27T18:00:00.000Z',
          totalVolume: 600,
          exercises: [{
            exerciseId: 'lunge',
            exerciseName: 'Выпады с гантелями',
            pain: false,
            sets: [
              { weight: 20, reps: 10, rpe: 9, completed: true },
              { weight: 20, reps: 10, rpe: 8, completed: true },
            ],
          }],
        },
      ],
      now: new Date('2026-08-30T18:00:00.000Z'),
    })

    expect(state.muscleGroups.legs).toMatchObject({ lastTrainedDaysAgo: 3 })
    expect(state.subMuscleGroups.quads).toMatchObject({ fatigue: 'medium', lastTrainedDaysAgo: 3 })
    expect(state.subMuscleGroups.glutes).toMatchObject({ fatigue: 'medium', lastTrainedDaysAgo: 3 })
    expect(state.subMuscleGroups.hamstrings).toBeUndefined()
  })

  it('лёгкие подходы 3 дня назад дают low, а не medium — окно тяжёлых подходов', () => {
    const state = computeCoachState({
      profile,
      workoutDays: [],
      exerciseLibrary: legSubLibrary,
      history: [
        {
          id: 'session-lunges-easy',
          userId: 'vyacheslav',
          workoutDayId: 'day-a',
          workoutDayName: 'Full Body A',
          completedAt: '2026-08-27T18:00:00.000Z',
          totalVolume: 400,
          exercises: [{
            exerciseId: 'lunge',
            exerciseName: 'Выпады с гантелями',
            pain: false,
            sets: [
              { weight: 20, reps: 10, rpe: 7, completed: true },
            ],
          }],
        },
      ],
      now: new Date('2026-08-30T18:00:00.000Z'),
    })

    expect(state.subMuscleGroups.quads).toMatchObject({ fatigue: 'low' })
  })
})

// Issue #288: перерыв (>= 14 дней) в истории не должен давать ложный
// above_plan. Возвращение после перерыва по обычному расписанию — это
// on_plan, а не перегрузка: отпускное окно исключается из оценки частоты.
describe('Issue #288: возвращение после перерыва не даёт ложный above_plan', () => {
  it('две сессии после перерыва 15 дней — on_plan (planned 2, а не 1)', () => {
    const history = [
      { id: 'session-before-break', completedAt: '2026-08-10T18:00:00.000Z', exercises: [] },
      { id: 'session-return-1', completedAt: '2026-08-25T18:00:00.000Z', exercises: [] },
      { id: 'session-return-2', completedAt: '2026-08-27T18:00:00.000Z', exercises: [] },
    ]
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-08-30T18:00:00.000Z'),
    })

    expect(state.plannedWorkoutsPerWeek).toBe(2)
    expect(state.weeklyLoadStatus).toBe('on_plan')
    expect(state.weeklyLoadStatus).not.toBe('above_plan')
    expect(state.daysSinceLastWorkout).toBe(3)
  })

  it('реальный перегруз без перерыва остаётся above_plan (регрессия)', () => {
    // 2 сессии/нед (08-03, 06, 10, 13, 17, 20) + 3 сессии в последнюю неделю
    // (08-24, 27, 29) — реальный перегруз. Разрывов >= 14 дней нет.
    const dates = ['2026-08-03', '2026-08-06', '2026-08-10', '2026-08-13', '2026-08-17', '2026-08-20', '2026-08-24', '2026-08-27', '2026-08-29']
    const history = dates.map((d) => ({ id: `session-${d}`, completedAt: `${d}T18:00:00.000Z`, exercises: [] }))
    const state = computeCoachState({
      profile,
      workoutDays,
      history,
      now: new Date('2026-08-30T18:00:00.000Z'),
    })

    expect(state.plannedWorkoutsPerWeek).toBe(2)
    expect(state.actualWorkoutsLast7Days).toBe(3)
    expect(state.weeklyLoadStatus).toBe('above_plan')
  })
})
