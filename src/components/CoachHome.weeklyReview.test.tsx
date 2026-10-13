import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePlan, UserProfile, WorkoutDay } from '../../shared/types'

vi.mock('../data/programApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/programApi')>()),
  isProgramApiConfigured: true,
}))
vi.mock('../data/apiAuth', () => ({ apiFetch: vi.fn() }))
vi.mock('./GoalsCard', () => ({ GoalsCard: () => null }))

const { CoachHome } = await import('./CoachHome')
const { apiFetch } = await import('../data/apiAuth')

const exercise: ExercisePlan = {
  id: 'bench-press',
  name: 'Жим лежа',
  muscleGroup: 'Грудь',
  prescription: '3x8',
  setsCount: 3,
  repMin: 8,
  repMax: 10,
  targetWeight: 60,
  weightStep: 2.5,
  restSeconds: 90,
  previous: 'нет данных',
  todayGoal: 'контроль',
  coachFocus: 'ровная техника',
  alternatives: [],
  instruction: 'техника',
  commonMistakes: [],
}
const day: WorkoutDay = { id: 'day-a', name: 'День A', label: 'День A', description: '', exercises: [exercise] }
const user: UserProfile = { id: 'vyacheslav', name: 'Вячеслав', initials: 'В', goal: 'сила', streak: '4' }

const props = {
  users: [user],
  activeUser: user,
  activeUserId: user.id,
  activeWorkoutDay: day,
  manualWorkoutDaySelected: false,
  workoutDays: [day],
  plannedWorkouts: [],
  scheduledWorkoutDays: [day],
  allUserWorkoutDays: [day],
  extraExercisesByDay: {},
  extraDayPickerOpen: false,
  coachTodaySummary: '',
  userHistory: [],
  nextTargets: {},
  coachMemory: null,
  coachState: null,
  onSelectUser: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenLibrary: vi.fn(),
  onStartWorkout: vi.fn(),
  onSelectWorkoutDay: vi.fn(),
  onRequestWorkoutToday: vi.fn(),
  onAddExtraWorkoutDay: vi.fn(),
  formatWeight: String,
  formatDateOnly: (date: string) => date,
  formatDateTime: (date: string) => date,
  addDays: (date: string) => date,
  todayDateInputValue: () => '2026-06-08',
}

const review = {
  summary: 'неделя ровная',
  rating: 'good',
  nextWeekFocus: '',
  changes: [{
    type: 'adjust_volume',
    description: 'Добавить подход',
    rationale: 'грудь недобирает объём',
    exerciseName: 'Жим лежа',
    priority: 'medium',
    appliedAction: { id: 'action-1', status: 'applied', before: { setsCount: 3 }, after: { setsCount: 4 }, safetyNote: 'в пределах нормы' },
  }],
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(apiFetch).mockReset()
})

// Issue #420: агент применяет изменения плана сам, атлет видит их и может отменить.
describe('CoachHome — применённые изменения недельного разбора (#420)', () => {
  it('показывает применённое изменение и отменяет его', async () => {
    const userEv = userEvent.setup()
    vi.mocked(apiFetch).mockImplementation((url, init) => {
      if (String(url).includes('/program-review/')) return jsonResponse({ ok: true, review })
      if (String(url).endsWith('/program-change/action-1/revert') && init?.method === 'POST') {
        return jsonResponse({ ok: true, action: { ...review.changes[0].appliedAction, status: 'reverted' } })
      }
      return jsonResponse(null, false)
    })

    render(<CoachHome {...props} />)

    expect(await screen.findByTestId('weekly-review-change-status')).toHaveAttribute('data-status', 'applied')
    await userEv.click(screen.getByTestId('weekly-review-change'))
    await userEv.click(screen.getByRole('button', { name: 'Отменить изменение плана' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить изменение плана' })).not.toBeInTheDocument())
    const revertCall = vi.mocked(apiFetch).mock.calls.find(([url]) => String(url).includes('/revert'))
    expect(JSON.parse(String(revertCall?.[1]?.body))).toEqual({ userId: 'vyacheslav' })
    expect(screen.getByTestId('review-sheet-action-status')).toHaveAttribute('data-status', 'reverted')
  })

  it('сбой отмены оставляет кнопку и показывает ошибку', async () => {
    const userEv = userEvent.setup()
    vi.mocked(apiFetch).mockImplementation((url) => {
      if (String(url).includes('/program-review/')) return jsonResponse({ ok: true, review })
      return jsonResponse(null, false)
    })

    render(<CoachHome {...props} />)

    await userEv.click(await screen.findByTestId('weekly-review-change'))
    await userEv.click(screen.getByRole('button', { name: 'Отменить изменение плана' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отменить изменение плана' })).toBeEnabled()
  })

  it('гейт оставил прежний объём — статус «без изменений», без кнопки отмены', async () => {
    const userEv = userEvent.setup()
    const unchanged = {
      ...review,
      changes: [{ ...review.changes[0], appliedAction: { id: 'action-2', status: 'clamped', before: { setsCount: 3 }, after: { setsCount: 3 } } }],
    }
    vi.mocked(apiFetch).mockImplementation((url) => (
      String(url).includes('/program-review/') ? jsonResponse({ ok: true, review: unchanged }) : jsonResponse(null, false)
    ))

    render(<CoachHome {...props} />)

    expect(await screen.findByTestId('weekly-review-change-status')).toHaveAttribute('data-status', 'unchanged')
    await userEv.click(screen.getByTestId('weekly-review-change'))
    expect(screen.queryByRole('button', { name: 'Отменить изменение плана' })).not.toBeInTheDocument()
  })

  it('предложение без применения не показывает кнопку отмены', async () => {
    const userEv = userEvent.setup()
    const suggestionOnly = { ...review, changes: [{ ...review.changes[0], type: 'swap_exercise', appliedAction: undefined }] }
    vi.mocked(apiFetch).mockImplementation((url) => (
      String(url).includes('/program-review/') ? jsonResponse({ ok: true, review: suggestionOnly }) : jsonResponse(null, false)
    ))

    render(<CoachHome {...props} />)

    await userEv.click(await screen.findByTestId('weekly-review-change'))
    expect(screen.queryByRole('button', { name: 'Отменить изменение плана' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('weekly-review-change-status')).not.toBeInTheDocument()
  })
})
