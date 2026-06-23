import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem('ai-gym-trainer:v0.1:onboarding-completed', '1')
  vi.resetModules()
})

describe('Coach Timeline database-backed program data', () => {
  it('loads users and the selected user program from the Postgres API layer', async () => {
    vi.doMock('./data/programApi', () => ({
      isProgramApiConfigured: true,
      fallbackProgramData: {
        users: [{ id: 'fallback', name: 'Fallback', initials: 'F', goal: 'mock', streak: '0' }],
        workoutDays: [{ id: 'day-a', name: 'День A', label: 'Mock', description: 'mock', exercises: [{
          id: 'fallback-exercise',
          name: 'Fallback exercise',
          muscleGroup: 'Mock',
          prescription: '1×1–1 · рекомендовано 1 кг · отдых 1 сек',
          setsCount: 1,
          repMin: 1,
          repMax: 1,
          targetWeight: 1,
          weightStep: 1,
          restSeconds: 1,
          previous: 'нет',
          todayGoal: '1×1',
          coachFocus: 'mock',
          alternatives: [],
          instruction: 'mock',
          commonMistakes: [],
        }] }],
        workoutDaysByUser: { fallback: [{ id: 'day-a', name: 'День A', label: 'Mock', description: 'mock', exercises: [{
          id: 'fallback-exercise',
          name: 'Fallback exercise',
          muscleGroup: 'Mock',
          prescription: '1×1–1 · рекомендовано 1 кг · отдых 1 сек',
          setsCount: 1,
          repMin: 1,
          repMax: 1,
          targetWeight: 1,
          weightStep: 1,
          restSeconds: 1,
          previous: 'нет',
          todayGoal: '1×1',
          coachFocus: 'mock',
          alternatives: [],
          instruction: 'mock',
          commonMistakes: [],
        }] }] },
        exerciseLibrary: [],
      },
      loadProgramDataFromApi: vi.fn().mockResolvedValue({
        users: [
          { id: 'vyacheslav', name: 'Вячеслав', initials: 'В', goal: 'сила', streak: '4 недели' },
          { id: 'oleg', name: 'Олег', initials: 'О', goal: 'техника', streak: '0 недель' },
        ],
        workoutDays: [
          {
            id: 'day-a',
            name: 'День A',
            label: 'API грудь',
            description: 'День из API',
            exercises: [
              {
                id: 'api-bench',
                name: 'Жим из Postgres',
                muscleGroup: 'Грудь',
                prescription: '3×8–10 · рекомендовано 61 кг · отдых 120 сек',
                setsCount: 3,
                repMin: 8,
                repMax: 10,
                targetWeight: 61,
                weightStep: 2.5,
                restSeconds: 120,
                previous: 'нет данных',
                todayGoal: '61×8/8/8',
                coachFocus: 'это пришло из базы',
                alternatives: [],
                instruction: 'инструкция из базы',
                commonMistakes: [],
              },
            ],
          },
        ],
        workoutDaysByUser: {
          vyacheslav: [
            {
              id: 'day-a',
              name: 'День A',
              label: 'API грудь',
              description: 'День из API',
              exercises: [
                {
                  id: 'api-bench',
                  name: 'Жим из Postgres',
                  muscleGroup: 'Грудь',
                  prescription: '3×8–10 · рекомендовано 61 кг · отдых 120 сек',
                  setsCount: 3,
                  repMin: 8,
                  repMax: 10,
                  targetWeight: 61,
                  weightStep: 2.5,
                  restSeconds: 120,
                  previous: 'нет данных',
                  todayGoal: '61×8/8/8',
                  coachFocus: 'это пришло из базы',
                  alternatives: [],
                  instruction: 'инструкция из базы',
                  commonMistakes: [],
                },
              ],
            },
          ],
        },
        exerciseLibrary: [],
      }),
      loadPlannedWorkoutsFromApi: vi.fn().mockResolvedValue([]),
      loadCoachMemoryFromApi: vi.fn().mockResolvedValue(null),
      loadCoachMemoryAndState: vi.fn().mockResolvedValue({ coachMemory: null, coachState: null }),
      createPlannedWorkoutInApi: vi.fn().mockResolvedValue(null),
      updatePlannedWorkoutInApi: vi.fn().mockResolvedValue([]),
      deletePlannedWorkoutFromApi: vi.fn().mockResolvedValue(undefined),
    }))

    const { default: App } = await import('./App')
    render(<App />)

    await waitFor(() => expect(screen.getByText(/Жим из Postgres: 61 кг/i)).toBeInTheDocument())
    expect(screen.getAllByText(/API грудь/i).length).toBeGreaterThan(0)
  })
})
