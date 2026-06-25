import { useState, type Dispatch, type SetStateAction } from 'react'
import type { WorkoutDay } from '../data/mockProgram'
import { isProgramApiConfigured, requestCoachWorkoutTodayFromApi } from '../data/programApi'
import { createInitialLogs } from './useWorkoutSession'
import type { ExerciseLog } from '../domain/workoutHistory'

interface UseExtraWorkoutTodayOptions {
  activeUserId: string
  allUserWorkoutDays: WorkoutDay[]
  scheduledWorkoutDays: WorkoutDay[]
  extraExercisesByDay: Record<string, WorkoutDay['exercises']>
  nextTargets: Record<string, number>
  setActiveWorkoutDayId: (workoutDayId: string) => void
  setActiveExerciseIndex: (index: number) => void
  setLogs: (logs: Record<string, ExerciseLog>) => void
  notify: (message: string) => void
  // Issue #69: lifted state — allows App to share coachTodayWorkoutDay
  // with useActiveWorkoutContext while the hook lives in CoachHomePage.
  coachTodayWorkoutDay?: WorkoutDay | null
  setCoachTodayWorkoutDay?: (day: WorkoutDay | null) => void
  coachTodaySummary?: string
  setCoachTodaySummary?: (summary: string) => void
  extraWorkoutDayIds?: string[]
  setExtraWorkoutDayIds?: Dispatch<SetStateAction<string[]>>
}

export function useExtraWorkoutToday({
  activeUserId,
  allUserWorkoutDays,
  scheduledWorkoutDays,
  extraExercisesByDay,
  nextTargets,
  setActiveWorkoutDayId,
  setActiveExerciseIndex,
  setLogs,
  notify,
  coachTodayWorkoutDay: liftedCoachTodayWorkoutDay,
  setCoachTodayWorkoutDay: liftedSetCoachTodayWorkoutDay,
  coachTodaySummary: liftedCoachTodaySummary,
  setCoachTodaySummary: liftedSetCoachTodaySummary,
  extraWorkoutDayIds: liftedExtraWorkoutDayIds,
  setExtraWorkoutDayIds: liftedSetExtraWorkoutDayIds,
}: UseExtraWorkoutTodayOptions) {
  const [internalExtraWorkoutDayIds, setInternalExtraWorkoutDayIds] = useState<string[]>([])
  const [internalCoachTodayWorkoutDay, setInternalCoachTodayWorkoutDay] = useState<WorkoutDay | null>(null)
  const [internalCoachTodaySummary, setInternalCoachTodaySummary] = useState('')
  const [extraDayPickerOpen, setExtraDayPickerOpen] = useState(false)

  // Use lifted state if provided, otherwise fall back to internal state.
  const coachTodayWorkoutDay = liftedCoachTodayWorkoutDay ?? internalCoachTodayWorkoutDay
  const setCoachTodayWorkoutDay = liftedSetCoachTodayWorkoutDay ?? setInternalCoachTodayWorkoutDay
  const coachTodaySummary = liftedCoachTodaySummary ?? internalCoachTodaySummary
  const setCoachTodaySummary = liftedSetCoachTodaySummary ?? setInternalCoachTodaySummary
  const extraWorkoutDayIds = liftedExtraWorkoutDayIds ?? internalExtraWorkoutDayIds
  const setExtraWorkoutDayIds = liftedSetExtraWorkoutDayIds ?? setInternalExtraWorkoutDayIds

  const extraWorkoutDays = extraWorkoutDayIds
    .map((dayId) => allUserWorkoutDays.find((day) => day.id === dayId))
    .filter((day): day is WorkoutDay => {
      if (!day) return false
      return !scheduledWorkoutDays.some((scheduledDay) => scheduledDay.id === day.id)
    })

  function addExtraWorkoutDay(day: WorkoutDay) {
    setExtraWorkoutDayIds((current) => current.includes(day.id) ? current : [...current, day.id])
    setActiveWorkoutDayId(day.id)
    setActiveExerciseIndex(0)
    setLogs(createInitialLogs({ ...day, exercises: [...day.exercises, ...(extraExercisesByDay[day.id] ?? [])] }, nextTargets))
    setExtraDayPickerOpen(false)
    notify(`Добавлена доп. тренировка: ${day.name}`)
  }

  async function requestWorkoutToday(selectWorkoutDay: (day: WorkoutDay) => void) {
    if (isProgramApiConfigured) {
      try {
        const plan = await requestCoachWorkoutTodayFromApi(activeUserId)
        if (plan?.workoutDay) {
          setCoachTodayWorkoutDay(plan.workoutDay)
          setCoachTodaySummary(plan.summary)
          setExtraDayPickerOpen(false)
          selectWorkoutDay(plan.workoutDay)
          notify('Тренер собрал тренировку на сегодня')
          return
        }
      } catch {
        notify('Тренер недоступен, выбери запасной день')
      }
    }
    setExtraDayPickerOpen((value) => !value)
  }

  function resetCoachTodayWorkout() {
    setCoachTodayWorkoutDay(null)
    setCoachTodaySummary('')
  }

  return {
    extraWorkoutDays,
    extraWorkoutDayIds: internalExtraWorkoutDayIds,
    coachTodayWorkoutDay,
    coachTodaySummary,
    extraDayPickerOpen,
    setExtraDayPickerOpen,
    addExtraWorkoutDay,
    requestWorkoutToday,
    resetCoachTodayWorkout,
  }
}
