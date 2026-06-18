import { useState } from 'react'
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
}: UseExtraWorkoutTodayOptions) {
  const [extraWorkoutDayIds, setExtraWorkoutDayIds] = useState<string[]>([])
  const [coachTodayWorkoutDay, setCoachTodayWorkoutDay] = useState<WorkoutDay | null>(null)
  const [coachTodaySummary, setCoachTodaySummary] = useState('')
  const [extraDayPickerOpen, setExtraDayPickerOpen] = useState(false)

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
    coachTodayWorkoutDay,
    coachTodaySummary,
    extraDayPickerOpen,
    setExtraDayPickerOpen,
    addExtraWorkoutDay,
    requestWorkoutToday,
    resetCoachTodayWorkout,
  }
}
