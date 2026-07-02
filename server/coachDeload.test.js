import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeProgress } from './coachProgressAnalysis.js'
import { reviewProgram } from './coachProgramReview.js'
import { generateCoachNarration } from './coachNarrator.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const deloadCoachState = {
  userId: 'vyacheslav',
  generatedAt: '2026-07-03T08:00:00Z',
  readinessScore: 65,
  recoveryStatus: 'partial',
  weeklyLoadStatus: 'deload',
  mesocycle: {
    phase: 'deload',
    phaseDescription: 'разгрузка',
    weekInCycle: 4,
    cycleLength: 4,
    loadingWeeks: 3,
    deloadWeeks: 1,
    isDeload: true,
    deloadScheduled: true,
    triggerReason: 'planned',
    completionRatio: 1,
    workoutsThisCycle: 9,
    plannedWorkoutsThisCycle: 9,
  },
}

const loadingCoachState = {
  userId: 'vyacheslav',
  generatedAt: '2026-07-03T08:00:00Z',
  readinessScore: 75,
  recoveryStatus: 'ready',
  weeklyLoadStatus: 'on_plan',
  mesocycle: {
    phase: 'loading',
    phaseDescription: 'нагрузка',
    weekInCycle: 2,
    cycleLength: 4,
    loadingWeeks: 3,
    deloadWeeks: 1,
    isDeload: false,
    deloadScheduled: false,
    triggerReason: null,
    completionRatio: 0.5,
    workoutsThisCycle: 4,
    plannedWorkoutsThisCycle: 9,
  },
}

const e1rmDown = [
  {
    exerciseId: 'barbell-squat',
    exerciseName: 'Присед со штангой',
    muscleGroup: 'Ноги',
    currentBest: 90,
    trendDirection: 'down',
    slopePerWeek: -0.9,
    dataPointCount: 4,
  },
  {
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    muscleGroup: 'Грудь',
    currentBest: 60,
    trendDirection: 'down',
    slopePerWeek: -1.1,
    dataPointCount: 4,
  },
]

const emptyHistory = []
const now = new Date('2026-07-03T08:00:00Z')

describe('coachProgressAnalysis — issue #90 deload-aware e1RM', () => {
  it('does NOT flag e1RM drop as overtraining warning during deload phase', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: emptyHistory,
      e1rmHistories: e1rmDown,
      coachState: deloadCoachState,
      coachMemory: null,
      now,
    })

    // Warnings should be empty — the downward trend is expected during deload
    expect(result.warnings).toEqual([])
    // Suggestions should contain the informational note instead
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.some((s) => s.includes('разгрузочная неделя'))).toBe(true)
    expect(result.suggestions.some((s) => s.includes('Присед'))).toBe(true)
  })

  it('DOES flag e1RM drop as overtraining warning during loading phase', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await analyzeProgress({
      userId: 'vyacheslav',
      history: emptyHistory,
      e1rmHistories: e1rmDown,
      coachState: loadingCoachState,
      coachMemory: null,
      now,
    })

    // Warnings should contain the overtraining flag
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('перетренированность'))).toBe(true)
    // Suggestions should NOT contain the deload informational note
    expect(result.suggestions.some((s) => s.includes('разгрузочная неделя'))).toBe(false)
  })
})

describe('coachProgramReview — issue #90 deload-aware add_deload suggestion', () => {
  const recentHistoryWithHighRpe = [
    {
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      workoutDayName: 'День A',
      completedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      totalVolume: 5000,
      exercises: [
        {
          exerciseId: 'barbell-squat',
          exerciseName: 'Присед со штангой',
          muscleGroup: 'Ноги',
          pain: false,
          sets: [
            { weight: 80, reps: 8, rpe: 9, completed: true },
            { weight: 80, reps: 8, rpe: 9, completed: true },
            { weight: 80, reps: 8, rpe: 10, completed: true },
          ],
          volume: 1920,
          nextRecommendedWeight: 80,
          progressionType: 'hold',
          progressionReason: '',
        },
      ],
    },
  ]

  const programDays = [
    { name: 'День A', exercises: [{ name: 'Присед со штангой', muscleGroup: 'Ноги', setsCount: 3 }] },
  ]

  const profile = { goal: 'сила', level: 'intermediate', age: 43, workoutsPerWeek: 3 }

  it('does NOT suggest add_deload when already in deload phase', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await reviewProgram({
      userId: 'vyacheslav',
      history: recentHistoryWithHighRpe,
      programDays,
      coachState: deloadCoachState,
      coachMemory: null,
      profile,
      now,
    })

    const addDeloadChanges = result.changes.filter((c) => c.type === 'add_deload')
    expect(addDeloadChanges).toEqual([])
  })

  it('DOES suggest add_deload during loading phase with high RPE', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    const result = await reviewProgram({
      userId: 'vyacheslav',
      history: recentHistoryWithHighRpe,
      programDays,
      coachState: loadingCoachState,
      coachMemory: null,
      profile,
      now,
    })

    const addDeloadChanges = result.changes.filter((c) => c.type === 'add_deload')
    expect(addDeloadChanges.length).toBe(1)
  })
})

describe('coachNarrator — issue #90 deload context in LLM prompt', () => {
  it('passes deload hint to LLM when in deload phase', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Разгрузочная неделя — работаем легко.' } }],
      }),
    }))

    await generateCoachNarration({
      scheduledDate: '2026-07-03',
      coachState: deloadCoachState,
      coachMemory: null,
      decision: { summary: 'deload', reasons: [], priorityMuscleGroups: [], avoidMuscleGroups: [], loadPolicy: 'deload' },
      lowReadiness: false,
      weeklyContext: {
        daysSincePreviousWorkout: 3,
        calendarWorkoutCountLast7: 2,
        effectiveWorkoutsPerWeek: 3,
        previousExerciseIds: new Set(),
        recoveryRestrictedMuscleKeys: new Set(),
      },
      selectedExercises: [
        { exerciseName: 'Присед', muscleGroup: 'Ноги', targetWeight: 60, setsCount: 2, repMin: 8, repMax: 10 },
      ],
      profile: { goal: 'сила', level: 'intermediate', age: 43, workoutsPerWeek: 3 },
      preferences: {},
    })

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    const userPrompt = body.messages.find((m) => m.role === 'user').content
    expect(userPrompt).toContain('разгрузочная неделя')
    expect(userPrompt).toContain('deload')
  })

  it('does NOT pass deload hint when not in deload phase', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Хорошая тренировка сегодня.' } }],
      }),
    }))

    await generateCoachNarration({
      scheduledDate: '2026-07-03',
      coachState: loadingCoachState,
      coachMemory: null,
      decision: { summary: 'normal', reasons: [], priorityMuscleGroups: [], avoidMuscleGroups: [], loadPolicy: 'normal' },
      lowReadiness: false,
      weeklyContext: {
        daysSincePreviousWorkout: 3,
        calendarWorkoutCountLast7: 2,
        effectiveWorkoutsPerWeek: 3,
        previousExerciseIds: new Set(),
        recoveryRestrictedMuscleKeys: new Set(),
      },
      selectedExercises: [
        { exerciseName: 'Присед', muscleGroup: 'Ноги', targetWeight: 80, setsCount: 3, repMin: 6, repMax: 8 },
      ],
      profile: { goal: 'сила', level: 'intermediate', age: 43, workoutsPerWeek: 3 },
      preferences: {},
    })

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    const userPrompt = body.messages.find((m) => m.role === 'user').content
    expect(userPrompt).not.toContain('разгрузочная неделя (deload) — объём')
  })
})
