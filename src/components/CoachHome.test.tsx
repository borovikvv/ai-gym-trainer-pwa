import { render, screen } from '@testing-library/react'
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

describe('MesocycleIndicator', () => {
  it('renders deload variant with "Разгрузка" text and trigger reason', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'deload',
        phaseDescription: 'Разгрузочная неделя — снижение объёма и интенсивности',
        weekInCycle: 5,
        isDeload: true,
        deloadScheduled: false,
        triggerReason: 'Запланированная разгрузка по календарю мезоцикла.',
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Разгрузка')).toBeInTheDocument()
    expect(screen.getByText('Запланированная разгрузка по календарю мезоцикла.')).toBeInTheDocument()
  })

  it('renders loading variant on week 1 of 4', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'loading',
        weekInCycle: 1,
        loadingWeeks: 4,
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Нед 1/5')).toBeInTheDocument()
  })

  it('renders intensification variant on the last loading week', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'intensification',
        weekInCycle: 4,
        loadingWeeks: 4,
        phaseDescription: 'Интенсификация — пик нагрузки мезоцикла',
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Нед 4/5')).toBeInTheDocument()
    expect(screen.getByText('Интенсификация — пик нагрузки мезоцикла')).toBeInTheDocument()
  })

  it('renders scheduled variant when deloadScheduled is true (last loading week, not yet deload)', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'intensification',
        weekInCycle: 4,
        loadingWeeks: 4,
        isDeload: false,
        deloadScheduled: true,
        phaseDescription: 'Интенсификация — пик нагрузки мезоцикла',
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.getByText('Нед 4/5')).toBeInTheDocument()
  })

  it('hides indicator when mesocycle is null', () => {
    const coachState = makeCoachState({ mesocycle: null })
    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.queryByText(/Нед \d\/\d/)).not.toBeInTheDocument()
    expect(screen.queryByText('Разгрузка')).not.toBeInTheDocument()
  })

  it('hides indicator when phase is "idle" (new user, no history)', () => {
    const coachState = makeCoachState({
      mesocycle: makeMesocycleState({
        phase: 'idle',
        phaseDescription: 'Ожидание первой тренировки',
        weekInCycle: 0,
      }),
    })

    render(<CoachHome {...baseProps} coachState={coachState} />)

    expect(screen.queryByText(/Нед \d\/\d/)).not.toBeInTheDocument()
    expect(screen.queryByText('Ожидание первой тренировки')).not.toBeInTheDocument()
  })
})
