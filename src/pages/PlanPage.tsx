import type { WorkoutDay  } from '../../shared/types'
import type { UserQuestionnaire } from '../data/programApi'
import type { TrainingCalendarItem } from '../domain/coachPlanning'
import { useProgram } from '../contexts/ProgramContext'
import { PlanCalendar } from '../components/PlanCalendar'
import { formatWeight } from '../lib/format'
import { formatDateOnly, todayDateInputValue } from '../hooks/usePlannedWorkouts'

interface PlanPageProps {
  // Data not available in context
  activeProfile: UserQuestionnaire
  activeWorkoutDay: WorkoutDay
  trainingCalendar: TrainingCalendarItem[]
  // usePlannedWorkouts hook outputs (hook stays in App)
  selectedWeekDates: string[]
  weekDateOptions: Array<{ label: string; date: string; formatted: string }>
  editingPlannedWorkoutId: string | null
  editingPlannedDate: string
  onShiftPlanningWeek: (deltaWeeks: number) => void
  onResetPlanningStart: () => void
  onToggleWeekDate: (date: string) => void
  setEditingPlannedWorkoutId: (id: string | null) => void
  setEditingPlannedDate: (date: string) => void
  onSavePlannedWorkoutDate: (workoutId: string) => void
  onRegeneratePlannedWorkout: (workoutId: string) => void
  onCancelPlannedWorkout: (workoutId: string) => void
  // Navigation + workout actions
  onSelectWorkoutDay: (day: WorkoutDay) => void
  onStartWorkout: (day: WorkoutDay) => void
  onStartEditExercise: (exercise: import('../data/mockProgram').ExercisePlan) => void
}

/**
 * Issue #71 (#37 part 3): Page component for the 'plan' screen.
 *
 * Pulls plannedWorkouts, userHistory, activeUserId from ProgramContext.
 * Imports formatWeight, formatDateOnly, todayDateInputValue directly.
 * The usePlannedWorkouts hook stays in App.tsx (its outputs are shared
 * with useActiveWorkoutContext for scheduledWorkoutDays).
 */
export function PlanPage(props: PlanPageProps) {
  const program = useProgram()

  return (
    <PlanCalendar
      activeProfile={props.activeProfile}
      selectedWeekDates={props.selectedWeekDates}
      weekDateOptions={props.weekDateOptions}
      plannedWorkouts={program.plannedWorkouts}
      userHistory={program.userHistory}
      trainingCalendar={props.trainingCalendar}
      activeUserId={program.activeUserId}
      activeWorkoutDay={props.activeWorkoutDay}
      editingPlannedWorkoutId={props.editingPlannedWorkoutId}
      editingPlannedDate={props.editingPlannedDate}
      onShiftPlanningWeek={props.onShiftPlanningWeek}
      onResetPlanningStart={props.onResetPlanningStart}
      onToggleWeekDate={props.onToggleWeekDate}
      onSelectWorkoutDay={props.onSelectWorkoutDay}
      onStartWorkout={props.onStartWorkout}
      onBeginEditPlannedDate={(workoutId, date) => {
        props.setEditingPlannedWorkoutId(workoutId)
        props.setEditingPlannedDate(date)
      }}
      onSetEditingPlannedDate={props.setEditingPlannedDate}
      onCancelEditPlannedDate={() => props.setEditingPlannedWorkoutId(null)}
      onSavePlannedWorkoutDate={props.onSavePlannedWorkoutDate}
      onRegeneratePlannedWorkout={props.onRegeneratePlannedWorkout}
      onCancelPlannedWorkout={props.onCancelPlannedWorkout}
      onStartEditExercise={props.onStartEditExercise}
      formatDateOnly={formatDateOnly}
      formatWeight={formatWeight}
      todayDateInputValue={todayDateInputValue}
    />
  )
}
