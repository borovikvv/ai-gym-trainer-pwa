import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExercisePlan, UserProfile, WorkoutDay  } from '../../shared/types'
import type { CoachState, PlannedWorkout } from '../data/programApi'
import { CoachHome } from './CoachHome'

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

function workoutDay(id: string, label: string): WorkoutDay {
  return {
    id,
    name: label,
    label,
    description: 'Плановая тренировка',
    exercises: [exercise],
  }
}

function planned(id: string, scheduledDate: string, label: string): PlannedWorkout {
  const day = workoutDay(id, label)
  return {
    id,
    userId: 'vyacheslav',
    scheduledDate,
    status: 'generated',
    source: 'coach',
    workoutDayId: day.id,
    workoutDayName: day.name,
    goal: day.label,
    coachReason: 'план',
    workoutDay: day,
  }
}

const user: UserProfile = {
  id: 'vyacheslav',
  name: 'Вячеслав',
  initials: 'В',
  goal: 'сила',
  streak: '4',
}

const secondUser: UserProfile = {
  id: 'anna',
  name: 'Анна',
  initials: 'А',
  goal: 'масса',
  streak: '2',
}

// Default props for tests — override only what each test cares about.
const baseProps = {
  users: [user],
  activeUser: user,
  activeUserId: user.id,
  activeWorkoutDay: workoutDay('day-a', 'День A'),
  manualWorkoutDaySelected: false,
  workoutDays: [workoutDay('day-a', 'День A')],
  plannedWorkouts: [] as PlannedWorkout[],
  scheduledWorkoutDays: [workoutDay('day-a', 'День A')],
  allUserWorkoutDays: [workoutDay('day-a', 'День A')],
  extraExercisesByDay: {},
  extraDayPickerOpen: false,
  coachTodaySummary: '',
  userHistory: [],
  nextTargets: {},
  coachMemory: null,
  coachState: null as CoachState | null,
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

function makeMesocycleState(overrides: Partial<CoachState['mesocycle']> = {}): NonNullable<CoachState['mesocycle']> {
  return {
    phase: 'loading',
    phaseDescription: 'Загрузка — первую неделю мезоцикла, умеренный объём',
    weekInCycle: 1,
    cycleLength: 5,
    loadingWeeks: 4,
    deloadWeeks: 1,
    isDeload: false,
    deloadScheduled: false,
    triggerReason: null,
    completionRatio: 1,
    workoutsThisCycle: 1,
    plannedWorkoutsThisCycle: 3,
    ...overrides,
  }
}

function makeCoachState(overrides: Partial<CoachState> = {}): CoachState {
  return {
    userId: 'vyacheslav',
    generatedAt: '2026-07-03T12:00:00Z',
    recoveryStatus: 'normal',
    readinessScore: 75,
    weeklyLoadStatus: 'on_plan',
    daysSinceLastWorkout: 1,
    mesocycle: null,
    warnings: [],
    ...overrides,
  }
}

describe('CoachHome', () => {
  it('shows the first actionable planned workout even when another workout day is active', () => {
    const nextWorkout = planned('planned-vyacheslav-2026-06-09', '2026-06-09', 'Тренировка 09.06')
    const laterWorkout = planned('planned-vyacheslav-2026-06-11', '2026-06-11', 'Тренировка 11.06')

    render(
      <CoachHome
        {...baseProps}
        activeWorkoutDay={laterWorkout.workoutDay}
        workoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
        plannedWorkouts={[nextWorkout, laterWorkout]}
        scheduledWorkoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
        allUserWorkoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
      />,
    )

    expect(screen.getByText('2026-06-09')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Тренировка 09.06' })).toBeInTheDocument()
  })
})

describe('CoachHome — profile avatar dropdown (#116)', () => {
  it('renders a single avatar button and no raw <select>', () => {
    render(<CoachHome {...baseProps} users={[user]} />)
    expect(screen.getByRole('button', { name: 'Профиль Вячеслав' })).toBeInTheDocument()
    // The old native select is gone.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Пользователь')).not.toBeInTheDocument()
  })

  it('opens the user menu on tap and lists users with the active one checked', async () => {
    const userEv = userEvent.setup()
    render(<CoachHome {...baseProps} users={[user, secondUser]} activeUserId="vyacheslav" />)

    const avatar = screen.getByRole('button', { name: 'Профиль Вячеслав' })
    expect(avatar).toHaveAttribute('aria-expanded', 'false')

    await userEv.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')

    const menu = screen.getByRole('menu', { name: 'Профиль' })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Анна/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Вячеслав/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches profile and closes the menu when a different user is chosen', async () => {
    const userEv = userEvent.setup()
    const onSelectUser = vi.fn()
    render(<CoachHome {...baseProps} users={[user, secondUser]} activeUserId="vyacheslav" onSelectUser={onSelectUser} />)

    await userEv.click(screen.getByRole('button', { name: 'Профиль Вячеслав' }))
    await userEv.click(screen.getByRole('menuitemradio', { name: /Анна/ }))

    expect(onSelectUser).toHaveBeenCalledTimes(1)
    expect(onSelectUser).toHaveBeenLastCalledWith('anna')
    // Menu closed and focus returned to the avatar.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and restores focus to the avatar', async () => {
    const userEv = userEvent.setup()
    render(<CoachHome {...baseProps} users={[user, secondUser]} />)

    const avatar = screen.getByRole('button', { name: 'Профиль Вячеслав' })
    await userEv.click(avatar)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEv.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(avatar).toHaveFocus()
  })

  it('closes on outside click', async () => {
    const userEv = userEvent.setup()
    render(
      <div>
        <button>outside</button>
        <CoachHome {...baseProps} users={[user, secondUser]} />
      </div>,
    )

    await userEv.click(screen.getByRole('button', { name: 'Профиль Вячеслав' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEv.click(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a localized «Сегодня · DD месяц» eyebrow', () => {
    render(<CoachHome {...baseProps} />)
    // Today's date in ru genitive, e.g. «Сегодня · 13 июля». We match the
    // prefix + a day number + a month name from the known set.
    const eyebrow = screen.getByText(/^Сегодня · \d{1,2} /)
    expect(eyebrow).toBeInTheDocument()
    expect(eyebrow.textContent).toMatch(/января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря/)
  })
})

describe('MesocycleCard', () => {
  it('renders deload variant with "разгрузка" text', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'deload',
        phaseDescription: 'Разгрузочная неделя — снижение объёма и интенсивности',
        weekInCycle: 5,
        cycleLength: 5,
        isDeload: true,
        deloadScheduled: false,
        triggerReason: 'Запланированная разгрузка по календарю мезоцикла.',
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Мезоцикл · разгрузка')).toBeInTheDocument()
    expect(screen.getByText('неделя 5 / 5')).toBeInTheDocument()
  })

  it('renders loading variant on week 1 of 5', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'loading',
        weekInCycle: 1,
        cycleLength: 5,
        phaseDescription: 'Накопление — первая неделя',
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Мезоцикл · Накопление — первая неделя')).toBeInTheDocument()
    expect(screen.getByText('неделя 1 / 5')).toBeInTheDocument()
  })

  it('hides card when mesocycle is null', () => {
    const coachState = makeCoachState({ mesocycle: null })
    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.queryByText(/неделя \d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Мезоцикл/)).not.toBeInTheDocument()
  })

  it('hides card when phase is "idle" (new user, no history)', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'idle',
        phaseDescription: 'Ожидание первой тренировки',
        weekInCycle: 0,
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.queryByText(/неделя \d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ожидание/)).not.toBeInTheDocument()
  })
})
