import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkoutDay  } from '../../shared/types'
import type { PlannedWorkout, UserQuestionnaire } from '../data/programApi'
import type { WorkoutHistoryEntry } from '../domain/workoutHistory'
import { PlanCalendar } from './PlanCalendar'

const exercise = {
  id: 'bench-press',
  name: 'Жим лёжа',
  muscleGroup: 'Грудь',
  prescription: '3×8',
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

function workoutDay(id: string, name: string): WorkoutDay {
  return {
    id,
    name,
    label: name,
    description: 'Грудь/спина',
    exercises: [exercise],
  }
}

function planned(id: string, scheduledDate: string): PlannedWorkout {
  const day = workoutDay(id, `День ${scheduledDate}`)
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

const profile = {
  userId: 'vyacheslav',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  goal: 'сила',
  level: 'intermediate',
  workoutsPerWeek: 3,
  targetWorkoutMinutes: 60,
  injuries: [],
  limitations: [],
  bannedExercises: [],
  preferredExercises: [],
  equipment: ['Зал'],
  trainingDays: [],
  preferences: {},
  notes: '',
} satisfies UserQuestionnaire

describe('PlanCalendar', () => {
  function renderPlanCalendar(activeWorkoutDay: WorkoutDay, plannedWorkouts: PlannedWorkout[] = []) {
    render(
      <PlanCalendar
        activeProfile={profile}
        selectedWeekDates={[]}
        weekDateOptions={[]}
        plannedWorkouts={plannedWorkouts}
        userHistory={[]}
        trainingCalendar={[]}
        activeUserId="vyacheslav"
        activeWorkoutDay={activeWorkoutDay}
        editingPlannedWorkoutId={null}
        editingPlannedDate=""
        onShiftPlanningWeek={vi.fn()}
        onResetPlanningStart={vi.fn()}
        onToggleWeekDate={vi.fn()}
        onSelectWorkoutDay={vi.fn()}
        onStartWorkout={vi.fn()}
        onBeginEditPlannedDate={vi.fn()}
        onSetEditingPlannedDate={vi.fn()}
        onCancelEditPlannedDate={vi.fn()}
        onSavePlannedWorkoutDate={vi.fn()}
        onRegeneratePlannedWorkout={vi.fn()}
        onCancelPlannedWorkout={vi.fn()}
        onStartEditExercise={vi.fn()}
        formatDateOnly={(date) => date}
        formatWeight={String}
        todayDateInputValue={() => '2026-06-08'}
      />,
    )
  }

  it('uses the same actionable planned workout as the trainer tab', () => {
    const completed = planned('planned-vyacheslav-2026-06-07-123', '2026-06-07')
    const next = planned('planned-vyacheslav-2026-06-11-456', '2026-06-11')
    const history = [{
      id: 'session-1',
      userId: 'vyacheslav',
      workoutDayId: completed.id,
      workoutDayName: completed.workoutDayName,
      completedAt: '2026-06-07T15:16:57.645Z',
      totalVolume: 1500,
      exercises: [],
    }] as WorkoutHistoryEntry[]

    render(
      <PlanCalendar
        activeProfile={profile}
        selectedWeekDates={[]}
        weekDateOptions={[]}
        plannedWorkouts={[completed, next]}
        userHistory={history}
        trainingCalendar={[]}
        activeUserId="vyacheslav"
        activeWorkoutDay={next.workoutDay}
        editingPlannedWorkoutId={null}
        editingPlannedDate=""
        onShiftPlanningWeek={vi.fn()}
        onResetPlanningStart={vi.fn()}
        onToggleWeekDate={vi.fn()}
        onSelectWorkoutDay={vi.fn()}
        onStartWorkout={vi.fn()}
        onBeginEditPlannedDate={vi.fn()}
        onSetEditingPlannedDate={vi.fn()}
        onCancelEditPlannedDate={vi.fn()}
        onSavePlannedWorkoutDate={vi.fn()}
        onRegeneratePlannedWorkout={vi.fn()}
        onCancelPlannedWorkout={vi.fn()}
        onStartEditExercise={vi.fn()}
        formatDateOnly={(date) => date}
        formatWeight={String}
        todayDateInputValue={() => '2026-06-08'}
      />,
    )

    expect(screen.getByText('2026-06-11')).toBeInTheDocument()
    expect(screen.queryByText('2026-06-07')).not.toBeInTheDocument()
  })

  it('keeps internal coach state out of the composition focus card', () => {
    const day = workoutDay('coach-generated', 'Персональная тренировка')
    day.description = 'Профиль тренера: персональный силовой тренер с приоритетом безопасной прогрессии. Coach State на 2026-06-09: readiness 54, восстановление partial, недельная нагрузка on_plan, фокус: Грудь.'

    renderPlanCalendar(day)

    expect(screen.getByText('Сегодня восстановление снижено. Делаем умеренную тренировку без отказа.')).toBeInTheDocument()
    expect(screen.queryByText(/Профиль тренера/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Coach State/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/readiness/i)).not.toBeInTheDocument()
  })

  it('shows planned dates as toggleable calendar dots', () => {
    const onToggleWeekDate = vi.fn()
    const activeDay = workoutDay('active', 'Активная')

    render(
      <PlanCalendar
        activeProfile={profile}
        selectedWeekDates={['2026-06-11']}
        weekDateOptions={[
          { label: 'Чт', date: '2026-06-11', formatted: 'чт, 11.06' },
          { label: 'Пт', date: '2026-06-12', formatted: 'пт, 12.06' },
        ]}
        plannedWorkouts={[planned('planned-1', '2026-06-11')]}
        userHistory={[]}
        trainingCalendar={[]}
        activeUserId="vyacheslav"
        activeWorkoutDay={activeDay}
        editingPlannedWorkoutId={null}
        editingPlannedDate=""
        onShiftPlanningWeek={vi.fn()}
        onResetPlanningStart={vi.fn()}
        onToggleWeekDate={onToggleWeekDate}
        onSelectWorkoutDay={vi.fn()}
        onStartWorkout={vi.fn()}
        onBeginEditPlannedDate={vi.fn()}
        onSetEditingPlannedDate={vi.fn()}
        onCancelEditPlannedDate={vi.fn()}
        onSavePlannedWorkoutDate={vi.fn()}
        onRegeneratePlannedWorkout={vi.fn()}
        onCancelPlannedWorkout={vi.fn()}
        onStartEditExercise={vi.fn()}
        formatDateOnly={(date) => date}
        formatWeight={String}
        todayDateInputValue={() => '2026-06-08'}
      />,
    )

    expect(screen.getAllByText('1 в календаре').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Убрать тренировку чт, 11.06' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Запланировать тренировку пт, 12.06' })).toHaveAttribute('aria-pressed', 'false')
  })
})
