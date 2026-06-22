import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExercisePlan, UserProfile, WorkoutDay } from '../data/mockProgram'
import type { PlannedWorkout } from '../data/programApi'
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

describe('CoachHome', () => {
  it('shows the first actionable planned workout even when another workout day is active', () => {
    const nextWorkout = planned('planned-vyacheslav-2026-06-09', '2026-06-09', 'Тренировка 09.06')
    const laterWorkout = planned('planned-vyacheslav-2026-06-11', '2026-06-11', 'Тренировка 11.06')

    render(
      <CoachHome
        users={[user]}
        activeUser={user}
        activeUserId={user.id}
        activeWorkoutDay={laterWorkout.workoutDay}
        manualWorkoutDaySelected={false}
        workoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
        plannedWorkouts={[nextWorkout, laterWorkout]}
        scheduledWorkoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
        allUserWorkoutDays={[nextWorkout.workoutDay, laterWorkout.workoutDay]}
        extraExercisesByDay={{}}
        extraDayPickerOpen={false}
        coachTodaySummary=""
        userHistory={[]}
        nextTargets={{}}
        coachMemory={null}
        coachState={null}
        onSelectUser={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenLibrary={vi.fn()}
        onStartWorkout={vi.fn()}
        onSelectWorkoutDay={vi.fn()}
        onRequestWorkoutToday={vi.fn()}
        onAddExtraWorkoutDay={vi.fn()}
        formatWeight={String}
        formatDateOnly={(date) => date}
        formatDateTime={(date) => date}
        addDays={(date) => date}
        todayDateInputValue={() => '2026-06-08'}
      />,
    )

    expect(screen.getByText('2026-06-09')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Тренировка 09.06' })).toBeInTheDocument()
  })
})
