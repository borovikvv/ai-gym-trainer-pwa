import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { WorkoutDay } from '../data/mockProgram'
import {
  createPlannedWorkoutInApi,
  deletePlannedWorkoutFromApi,
  generatePlannedWorkoutInApi,
  isProgramApiConfigured,
  loadPlannedWorkoutsFromApi,
  updatePlannedWorkoutInApi,
  type PlannedWorkout,
} from '../data/programApi'

function formatDateOnly(dateOnly: string) {
  const date = new Date(`${dateOnly}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateOnly
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)
}

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const weekdayShortLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function buildPlanningHorizonOptions(startDate: string, days = 14) {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index)
    const weekdayIndex = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
    return {
      label: weekdayShortLabels[weekdayIndex],
      date,
      formatted: formatDateOnly(date),
    }
  })
}

function createLocalPlannedWorkout(userId: string, scheduledDate: string, workoutDay: WorkoutDay): PlannedWorkout {
  return {
    id: `local-planned-${userId}-${scheduledDate}-${workoutDay.id}`,
    userId,
    scheduledDate,
    status: 'generated',
    source: 'user',
    workoutDayId: workoutDay.id,
    workoutDayName: workoutDay.name,
    goal: workoutDay.label,
    coachReason: 'Локальный план недели. При подключённом API тренер пересобирает тренировку через Coach State.',
    workoutDay,
  }
}

type UsePlannedWorkoutsParams = {
  activeUserId: string
  plannedWorkouts: PlannedWorkout[]
  setPlannedWorkouts: Dispatch<SetStateAction<PlannedWorkout[]>>
  scheduledWorkoutDays: WorkoutDay[]
  firstWorkoutDay: WorkoutDay
  selectWorkoutDay: (day: WorkoutDay, manual?: boolean) => void
  notify: (message: string) => void
}

export function usePlannedWorkouts({
  activeUserId,
  plannedWorkouts,
  setPlannedWorkouts,
  scheduledWorkoutDays,
  firstWorkoutDay,
  selectWorkoutDay,
  notify,
}: UsePlannedWorkoutsParams) {
  const [weekStartDate, setWeekStartDate] = useState(todayDateInputValue())
  const [editingPlannedWorkoutId, setEditingPlannedWorkoutId] = useState<string | null>(null)
  const [editingPlannedDate, setEditingPlannedDate] = useState('')

  const nextPlannedWorkout = plannedWorkouts.find((workout) => ['planned', 'generated'].includes(workout.status))
  const weekDateOptions = useMemo(() => buildPlanningHorizonOptions(weekStartDate, 14), [weekStartDate])
  const plannedByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkout>()
    for (const workout of plannedWorkouts) {
      if (!['planned', 'generated', 'moved'].includes(workout.status)) continue
      map.set(workout.scheduledDate, workout)
    }
    return map
  }, [plannedWorkouts])
  const plannedDateKeys = useMemo(() => [...plannedByDate.keys()].sort(), [plannedByDate])

  async function refreshPlannedWorkouts(userId = activeUserId) {
    if (!isProgramApiConfigured) return
    const items = await loadPlannedWorkoutsFromApi(userId)
    setPlannedWorkouts(items)
  }

  async function toggleWeekDate(date: string) {
    const existing = plannedByDate.get(date)
    try {
      if (existing) {
        if (isProgramApiConfigured) {
          await deletePlannedWorkoutFromApi(existing.id)
          await refreshPlannedWorkouts(activeUserId)
        } else {
          setPlannedWorkouts((current) => current.filter((workout) => workout.id !== existing.id))
        }
        notify('Тренировка убрана из календаря')
        return
      }

      if (isProgramApiConfigured) {
        await createPlannedWorkoutInApi(activeUserId, date)
        const items = await loadPlannedWorkoutsFromApi(activeUserId)
        setPlannedWorkouts(items)
        const created = items.find((workout) => workout.scheduledDate === date)
        if (created?.workoutDay) selectWorkoutDay(created.workoutDay, false)
      } else {
        const workoutDay = scheduledWorkoutDays[plannedDateKeys.length % scheduledWorkoutDays.length] ?? firstWorkoutDay
        const localItem = createLocalPlannedWorkout(activeUserId, date, workoutDay)
        setPlannedWorkouts((current) => [...current, localItem].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)))
        selectWorkoutDay(localItem.workoutDay, false)
      }
      notify('Тренировка добавлена в календарь')
    } catch {
      notify(existing ? 'Не удалось убрать тренировку' : 'Не удалось добавить тренировку')
    }
  }

  function shiftPlanningWeek(deltaWeeks: number) {
    const nextStart = addDays(weekStartDate, deltaWeeks * 7)
    setWeekStartDate(nextStart)
  }

  async function savePlannedWorkoutDate(workoutId: string) {
    if (!editingPlannedDate) return
    try {
      const items = await updatePlannedWorkoutInApi(workoutId, { scheduledDate: editingPlannedDate })
      setPlannedWorkouts(items)
      setEditingPlannedWorkoutId(null)
      setEditingPlannedDate('')
      notify('Дата тренировки изменена')
    } catch {
      notify('Не удалось перенести тренировку')
    }
  }

  async function regeneratePlannedWorkout(workoutId: string) {
    try {
      const items = await generatePlannedWorkoutInApi(workoutId)
      setPlannedWorkouts(items)
      const refreshed = items.find((workout) => workout.id === workoutId)
      if (refreshed?.workoutDay) selectWorkoutDay(refreshed.workoutDay, false)
      notify('Тренер пересобрал тренировку под дату')
    } catch {
      notify('Не удалось пересобрать тренировку')
    }
  }

  async function cancelPlannedWorkout(workoutId: string) {
    try {
      await deletePlannedWorkoutFromApi(workoutId)
      await refreshPlannedWorkouts(activeUserId)
      notify('Тренировка удалена из календаря')
    } catch {
      notify('Не удалось удалить тренировку')
    }
  }

  return {
    selectedWeekDates: plannedDateKeys,
    editingPlannedWorkoutId,
    editingPlannedDate,
    setEditingPlannedWorkoutId,
    setEditingPlannedDate,
    nextPlannedWorkout,
    weekDateOptions,
    toggleWeekDate,
    shiftPlanningWeek,
    savePlannedWorkoutDate,
    regeneratePlannedWorkout,
    cancelPlannedWorkout,
    refreshPlannedWorkouts,
    resetPlanningStart: () => setWeekStartDate(todayDateInputValue()),
  }
}

export { addDays, formatDateOnly, todayDateInputValue }
