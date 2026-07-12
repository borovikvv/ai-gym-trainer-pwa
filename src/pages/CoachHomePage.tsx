import type { Dispatch, SetStateAction } from 'react'
import type { WorkoutDay  } from '../../shared/types'
import type { Screen } from '../contexts/NavigationContext'
import { useProgram } from '../contexts/ProgramContext'
import { useCoach } from '../contexts/CoachContext'
import { CoachHome } from '../components/CoachHome'
import { useExtraWorkoutToday } from '../hooks/useExtraWorkoutToday'
import { formatWeight, formatDateTime } from '../lib/format'
import { addDays, formatDateOnly, todayDateInputValue } from '../hooks/usePlannedWorkouts'
import type { ExerciseLog } from '../domain/workoutHistory'

interface CoachHomePageProps {
  // Data not available in context
  activeWorkoutDay: WorkoutDay
  manualWorkoutDaySelected: boolean
  scheduledWorkoutDays: WorkoutDay[]
  allUserWorkoutDays: WorkoutDay[]
  extraExercisesByDay: Record<string, unknown[]>
  // Lifted state (shared with useActiveWorkoutContext in App)
  coachTodayWorkoutDay: WorkoutDay | null
  setCoachTodayWorkoutDay: (day: WorkoutDay | null) => void
  coachTodaySummary: string
  setCoachTodaySummary: (summary: string) => void
  extraWorkoutDayIds: string[]
  setExtraWorkoutDayIds: Dispatch<SetStateAction<string[]>>
  // Workout session actions (shared with other screens)
  setActiveWorkoutDayId: (workoutDayId: string) => void
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  // Callbacks
  onSelectUser: (userId: string) => void
  onNavigate: (screen: Screen) => void
  onStartWorkout: (day?: WorkoutDay) => void
  onSelectWorkoutDay: (day: WorkoutDay) => void
  // Toast
  notify: (message: string) => void
}

/**
 * Issue #69 (#37 part 1): Page component for the 'home' screen.
 *
 * Pulls program data from ProgramContext and coach state from CoachContext.
 * Calls useExtraWorkoutToday with lifted state so App can share
 * coachTodayWorkoutDay with useActiveWorkoutContext.
 */
export function CoachHomePage(props: CoachHomePageProps) {
  const program = useProgram()
  const coach = useCoach()

  const preliminaryNextTargets = program.nextTargets
  const preliminaryAllUserWorkoutDays = props.allUserWorkoutDays
  const preliminaryScheduledWorkoutDays = props.scheduledWorkoutDays

  const {
    extraDayPickerOpen,
    addExtraWorkoutDay,
    requestWorkoutToday,
    coachTodaySummary: hookCoachTodaySummary,
  } = useExtraWorkoutToday({
    activeUserId: program.activeUserId,
    allUserWorkoutDays: preliminaryAllUserWorkoutDays,
    scheduledWorkoutDays: preliminaryScheduledWorkoutDays,
    extraExercisesByDay: props.extraExercisesByDay as Record<string, WorkoutDay['exercises']>,
    nextTargets: preliminaryNextTargets,
    setActiveWorkoutDayId: props.setActiveWorkoutDayId,
    setActiveExerciseIndex: props.setActiveExerciseIndex,
    setLogs: props.setLogs,
    notify: props.notify,
    coachTodayWorkoutDay: props.coachTodayWorkoutDay,
    setCoachTodayWorkoutDay: props.setCoachTodayWorkoutDay,
    coachTodaySummary: props.coachTodaySummary,
    setCoachTodaySummary: props.setCoachTodaySummary,
    extraWorkoutDayIds: props.extraWorkoutDayIds,
    setExtraWorkoutDayIds: props.setExtraWorkoutDayIds,
  })

  return (
    <CoachHome
      users={program.users}
      activeUser={program.activeUser}
      activeUserId={program.activeUserId}
      activeWorkoutDay={props.activeWorkoutDay}
      manualWorkoutDaySelected={props.manualWorkoutDaySelected}
      workoutDays={program.workoutDays}
      plannedWorkouts={program.plannedWorkouts}
      scheduledWorkoutDays={props.scheduledWorkoutDays}
      allUserWorkoutDays={props.allUserWorkoutDays}
      extraExercisesByDay={props.extraExercisesByDay}
      extraDayPickerOpen={extraDayPickerOpen}
      coachTodaySummary={hookCoachTodaySummary}
      userHistory={program.userHistory}
      nextTargets={program.nextTargets}
      exerciseLibrary={program.exerciseLibrary}
      coachMemory={coach.coachMemory}
      coachState={coach.coachState}
      onSelectUser={props.onSelectUser}
      onOpenProfile={() => props.onNavigate('profile')}
      onOpenLibrary={() => props.onNavigate('library')}
      onStartWorkout={props.onStartWorkout}
      onSelectWorkoutDay={props.onSelectWorkoutDay}
      onRequestWorkoutToday={() => requestWorkoutToday(props.onSelectWorkoutDay)}
      onAddExtraWorkoutDay={addExtraWorkoutDay}
      formatWeight={formatWeight}
      formatDateOnly={formatDateOnly}
      formatDateTime={formatDateTime}
      addDays={addDays}
      todayDateInputValue={todayDateInputValue}
    />
  )
}
