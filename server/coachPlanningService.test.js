import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./services/programService.js', () => ({
  loadExerciseLibrary: vi.fn(),
  loadRecentHistory: vi.fn(),
  loadUserProfile: vi.fn(),
  loadUserWorkoutDays: vi.fn(),
}))

const {
  loadExerciseLibrary,
  loadRecentHistory,
  loadUserProfile,
  loadUserWorkoutDays,
} = await import('./services/programService.js')
const { planAndApplyNextWorkout } = await import('./services/coachPlanningService.js')

describe('coach planning service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')

    loadUserProfile.mockResolvedValue({
      userId: 'vyacheslav',
      workoutsPerWeek: 2,
      trainingDays: ['Понедельник', 'Четверг'],
    })
    loadUserWorkoutDays.mockResolvedValue([
      {
        id: 'day-a',
        name: 'День A',
        label: 'A',
        sortOrder: 1,
        exercises: [
          { programExerciseId: 'pe-bench', exerciseId: 'bench-press', name: 'Жим лёжа', muscleGroup: 'Грудь', setsCount: 3, repMin: 6, repMax: 8, targetWeight: 50, weightStep: 2.5, restSeconds: 150 },
        ],
      },
      {
        id: 'day-b',
        name: 'День B',
        label: 'B',
        sortOrder: 2,
        exercises: [
          { programExerciseId: 'pe-row', exerciseId: 'row', name: 'Тяга', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 120 },
        ],
      },
    ])
    loadRecentHistory.mockResolvedValue([])
    loadExerciseLibrary.mockResolvedValue([
      { id: 'row', name: 'Тяга', muscleGroup: 'Спина', setsCount: 3, repMin: 8, repMax: 10, targetWeight: 40, weightStep: 2.5, restSeconds: 120 },
    ])
  })

  it('stores a coach decision log when applying a post-workout plan', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
    await planAndApplyNextWorkout(client, {
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: 'day-a',
      completedAt: '2026-06-08T12:00:00.000Z',
      exercises: [
        {
          exerciseId: 'bench-press',
          exerciseName: 'Жим лёжа',
          nextRecommendedWeight: 50,
          sets: [{ weight: 50, reps: 6, rpe: 8, completed: true }],
        },
      ],
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into public.recommendations'),
      expect.arrayContaining(['vyacheslav', 'session-1', 'coach_decision_log']),
    )
  })
})
