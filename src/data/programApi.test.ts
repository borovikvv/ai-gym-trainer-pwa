import { describe, expect, it, vi } from 'vitest'
import { generatePlannedWorkoutInApi, mapApiProgramData, planTrainingWeekInApi, requestCoachLiveStrategyFromApi, requestCoachWorkoutTodayFromApi, saveProgramExerciseToApi, saveUserQuestionnaireToApi, type ApiProgramData } from './programApi'

describe('program API mapping', () => {
  it('maps Postgres API users, active programs, days and exercise library into the app program model', () => {
    const apiData: ApiProgramData = {
      users: [
        { id: 'vyacheslav', name: 'Вячеслав', initials: 'В', goal: 'сила', streak: '4 недели' },
        { id: 'oleg', name: 'Олег', initials: 'О', goal: 'техника', streak: '0 недель' },
      ],
      profiles: [
        {
          userId: 'vyacheslav',
          age: 40,
          sex: 'male',
          heightCm: 180,
          weightKg: 88,
          goal: 'сила',
          level: 'intermediate',
          workoutsPerWeek: 3,
          targetWorkoutMinutes: 60,
          injuries: ['плечо'],
          limitations: [],
          bannedExercises: [],
          preferredExercises: ['жим лёжа'],
          equipment: ['зал', 'штанга'],
          trainingDays: ['Понедельник', 'Среда', 'Пятница'],
          preferences: { style: 'mixed' },
          notes: 'Тестовая анкета',
        },
      ],
      exerciseLibrary: [
        {
          id: 'barbell-curl',
          name: 'Сгибание рук со штангой',
          muscleGroup: 'Руки · бицепс',
          instruction: 'Локти рядом с корпусом.',
          commonMistakes: [],
          alternatives: [],
          setsCount: 3,
          repMin: 8,
          repMax: 12,
          targetWeight: 20,
          weightStep: 2.5,
          restSeconds: 75,
          previous: 'добавлено сегодня',
          todayGoal: '8–12',
          coachFocus: 'без раскачки',
        },
      ],
      workoutDays: [
        {
          id: 'vyacheslav-abc-v1-day-a',
          dayKey: 'day-a',
          name: 'День A',
          label: 'Грудь/спина',
          description: 'API день',
          userId: 'vyacheslav',
          exercises: [
            {
              id: 'bench-press',
              name: 'Жим лёжа',
              muscleGroup: 'Грудь',
              instruction: 'Контролируй штангу.',
              commonMistakes: ['рывок'],
              alternatives: [{ name: 'Жим гантелей', reason: 'мягче плечу', badge: 'лучше' }],
              setsCount: 3,
              repMin: 8,
              repMax: 10,
              targetWeight: 60,
              weightStep: 2.5,
              restSeconds: 120,
              previous: '60×10/9/8',
              todayGoal: '60×10/9/9',
              coachFocus: 'работаем из базы',
            },
          ],
        },
      ],
    }

    const mapped = mapApiProgramData(apiData)

    expect(mapped.users).toEqual(apiData.users)
    expect(mapped.workoutDays).toHaveLength(1)
    expect(mapped.workoutDays[0].id).toBe('day-a')
    expect(mapped.workoutDays[0].exercises[0].prescription).toBe('3×8–10 · рекомендовано 60 кг · отдых 120 сек')
    expect(mapped.workoutDaysByUser.vyacheslav[0].exercises[0].coachFocus).toBe('работаем из базы')
    expect(mapped.exerciseLibrary.some((exercise) => exercise.name === 'Сгибание рук со штангой')).toBe(true)
    expect(mapped.profilesByUser.vyacheslav.workoutsPerWeek).toBe(3)
    expect(mapped.profilesByUser.vyacheslav.injuries).toEqual(['плечо'])
  })

  it('keeps the editable program exercise id and sends only editable fields to the API', async () => {
    const apiData: ApiProgramData = {
      users: [{ id: 'vyacheslav', name: 'Вячеслав', initials: 'В', goal: 'сила', streak: '4 недели' }],
      profiles: [],
      workoutDays: [
        {
          id: 'vyacheslav-abc-v1-day-a',
          dayKey: 'day-a',
          name: 'День A',
          label: 'Грудь/спина',
          description: 'API день',
          userId: 'vyacheslav',
          exercises: [
            {
              programExerciseId: 'vyacheslav-day-a-bench',
              id: 'bench-press',
              name: 'Жим лёжа',
              muscleGroup: 'Грудь',
              instruction: 'Контролируй штангу.',
              commonMistakes: [],
              alternatives: [],
              setsCount: 3,
              repMin: 8,
              repMax: 10,
              targetWeight: 60,
              weightStep: 2.5,
              restSeconds: 120,
              previous: '60×10/9/8',
              todayGoal: '60×10/9/9',
              coachFocus: 'работаем из базы',
            },
          ],
        },
      ],
    }
    const mapped = mapApiProgramData(apiData)
    expect(mapped.workoutDays[0].exercises[0].programExerciseId).toBe('vyacheslav-day-a-bench')

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await saveProgramExerciseToApi('vyacheslav-day-a-bench', {
      setsCount: 4,
      repMin: 6,
      repMax: 8,
      targetWeight: 62.5,
      weightStep: 2.5,
      restSeconds: 150,
      coachFocus: 'обновлено вручную',
    }, fetchMock, 'http://api.test')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/program-exercises/vyacheslav-day-a-bench', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setsCount: 4,
        repMin: 6,
        repMax: 8,
        targetWeight: 62.5,
        weightStep: 2.5,
        restSeconds: 150,
        coachFocus: 'обновлено вручную',
      }),
    })
  })

  it('saves questionnaire fields including workouts per week to the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await saveUserQuestionnaireToApi('vyacheslav', {
      age: 41,
      heightCm: 181,
      weightKg: 89,
      goal: 'сила и масса',
      level: 'intermediate',
      workoutsPerWeek: 4,
      targetWorkoutMinutes: 75,
      injuriesText: 'плечо\nколено',
      equipmentText: 'зал\nштанга\nгантели',
      trainingDaysText: 'Пн\nСр\nПт\nВс',
      notes: 'обновить программу позже',
    }, fetchMock, 'http://api.test')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/user-profiles/vyacheslav', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        age: 41,
        heightCm: 181,
        weightKg: 89,
        goal: 'сила и масса',
        level: 'intermediate',
        workoutsPerWeek: 4,
        targetWorkoutMinutes: 75,
        injuriesText: 'плечо\nколено',
        equipmentText: 'зал\nштанга\nгантели',
        trainingDaysText: 'Пн\nСр\nПт\nВс',
        notes: 'обновить программу позже',
      }),
    })
  })

  it('saves trainer preference fields so Coach Engine can personalize exercise selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await saveUserQuestionnaireToApi('vyacheslav', {
      age: 43,
      heightCm: 175,
      weightKg: 69,
      goal: 'сила и мышечная масса',
      level: 'intermediate',
      workoutsPerWeek: 2,
      targetWorkoutMinutes: 60,
      injuriesText: '',
      equipmentText: 'зал\nштанга\nгантели',
      trainingDaysText: 'Четверг\nВоскресенье',
      focusAreasText: 'грудь\nспина',
      preferredExercisesText: 'жим лёжа',
      bannedExercisesText: 'становая тяга',
      exerciseStyle: 'mixed',
      intensityTolerance: 'rare_max',
      sessionStyle: 'moderate_stable',
      notes: 'без хаотичного выбора упражнений',
    }, fetchMock, 'http://api.test')

    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(request.body as string)).toMatchObject({
      focusAreasText: 'грудь\nспина',
      preferredExercisesText: 'жим лёжа',
      bannedExercisesText: 'становая тяга',
      exerciseStyle: 'mixed',
      intensityTolerance: 'rare_max',
      sessionStyle: 'moderate_stable',
    })
  })

  it('requests a Coach State workout for today and maps it into a workout day', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        plan: {
          mode: 'recovery_accessory',
          summary: 'лёгкая дополнительная',
          reason: 'низкое восстановление',
          workoutDay: {
            id: 'coach-today',
            name: 'Сегодня',
            label: 'лёгкая тренировка от тренера',
            description: 'без привязки к A/B',
            exercises: [
              {
                id: 'hammer-curl',
                name: 'Молотковые сгибания',
                muscleGroup: 'Руки',
                instruction: 'Локти близко.',
                commonMistakes: [],
                alternatives: [],
                setsCount: 2,
                repMin: 10,
                repMax: 12,
                targetWeight: 10,
                weightStep: 1,
                restSeconds: 75,
                previous: 'подобрано тренером на сегодня',
                todayGoal: '10×10',
                coachFocus: 'без отказа',
              },
            ],
          },
        },
      }),
    })

    const plan = await requestCoachWorkoutTodayFromApi('vyacheslav', fetchMock, 'http://api.test')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/coach/workout-today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'vyacheslav' }),
    })
    expect(plan?.workoutDay.id).toBe('coach-today')
    expect(plan?.workoutDay.exercises[0].prescription).toBe('2×10–12 · рекомендовано 10 кг · отдых 75 сек')
  })

  it('requests live coach strategy from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        decision: {
          source: 'rules',
          decisionType: 'live_strategy',
          summary: 'Снизить объём.',
          actions: [{ type: 'reduce_remaining_volume', reason: 'RPE высокий.' }],
          constraints: { maxRpe: 8, allowFailure: false, maxAdditionalExercises: 0 },
          warnings: [],
        },
      }),
    })

    const result = await requestCoachLiveStrategyFromApi({
      userId: 'oleg',
      exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
      completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
      context: { session: {} },
    }, fetchMock, 'http://api.test')

    expect(result?.actions[0].type).toBe('reduce_remaining_volume')
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/coach/live-strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'oleg',
        exercise: { id: 'bench', name: 'Жим лёжа', muscleGroup: 'Грудь' },
        completedSets: [{ weight: 40, reps: 8, rpe: 9, completed: true }],
        context: { session: {} },
      }),
    })
  })

  it('requests planned workout regeneration from the Coach Engine', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, plannedWorkouts: [] }) })

    await generatePlannedWorkoutInApi('planned-1', fetchMock, 'http://api.test')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/planned-workouts/planned-1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('bulk-generates a training week for selected dates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, plannedWorkouts: [] }) })

    await planTrainingWeekInApi('vyacheslav', ['2026-06-09', '2026-06-13'], fetchMock, 'http://api.test')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/planned-workouts/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'vyacheslav', dates: ['2026-06-09', '2026-06-13'], rangeStart: undefined, rangeEnd: undefined }),
    })
  })

  it('sends the visible planning range when syncing two-week calendar dates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, plannedWorkouts: [] }) })

    await planTrainingWeekInApi('vyacheslav', ['2026-06-07', '2026-06-13'], fetchMock, 'http://api.test', { rangeStart: '2026-06-05', rangeEnd: '2026-06-18' })

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/planned-workouts/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'vyacheslav', dates: ['2026-06-07', '2026-06-13'], rangeStart: '2026-06-05', rangeEnd: '2026-06-18' }),
    })
  })
})
