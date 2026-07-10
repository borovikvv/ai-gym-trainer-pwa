// ВНИМАНИЕ (Фаза 1 плана развития): клиентский recommendNextSet здесь — это
// ТОЛЬКО офлайн/мгновенный фолбэк. Авторитетное решение по следующему подходу
// принимает сервер (server/coachSetAdvisor.ts: LLM + кламп + полные правила
// server/coachEngine.ts). Не расширяйте логику тут — меняйте серверную.
import type { WorkoutDay  } from '../../shared/types'
import type { WorkoutSetInput } from './progression'
import { roundWeight } from '../lib/format'

const russianWeekdayOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

export type CompletedWorkoutForCalendar = {
  workoutDayId: string
  completedAt: string
}

export type TrainingCalendarInput = {
  trainingDays: string[]
  workoutDays: WorkoutDay[]
  now?: Date
  completedWorkouts?: CompletedWorkoutForCalendar[]
}

export type TrainingCalendarItem = {
  id: string
  label: 'Следующая тренировка' | 'Потом' | 'Дополнительно'
  weekday: string
  workoutDay: WorkoutDay
  daysUntil: number | null
}

export function buildTrainingCalendar(input: TrainingCalendarInput): TrainingCalendarItem[] {
  const workoutDays = input.workoutDays.filter((day) => day.exercises.length > 0 || day.name)
  if (workoutDays.length === 0) return []

  const now = input.now ?? new Date()
  const weekdays = normalizeTrainingDays(input.trainingDays, workoutDays.length).slice(0, workoutDays.length)
  const nextWorkoutIndex = nextWorkoutDayIndex(workoutDays, input.completedWorkouts ?? [], now)
  return nextTrainingSlots(now, weekdays, workoutDays.length).map((slot, index) => {
    const workoutDay = workoutDays[(nextWorkoutIndex + index) % workoutDays.length]
    return {
      id: `${slot.weekday}-${workoutDay.id}-${slot.daysUntil}`,
      label: index === 0 ? 'Следующая тренировка' : index === 1 ? 'Потом' : 'Дополнительно',
      weekday: slot.weekday,
      workoutDay,
      daysUntil: slot.daysUntil,
    }
  })
}

export type NextSetRecommendationInput = {
  completedSets: WorkoutSetInput[]
  repMin: number
  repMax: number
  weightStep: number
}

export type NextSetRecommendation = {
  weight: number
  reps: number
  reason: string
}

export function recommendNextSet(input: NextSetRecommendationInput): NextSetRecommendation | null {
  const lastSet = [...input.completedSets].reverse().find((set) => set.completed && set.reps > 0)
  if (!lastSet) return null

  const step = input.weightStep > 0 ? input.weightStep : 0
  if (lastSet.rpe >= 10) {
    return {
      weight: Math.max(0, roundWeight(lastSet.weight - step)),
      reps: input.repMin,
      reason: 'прошлый подход был на пределе — снижаем вес и держим нижнюю границу повторов',
    }
  }

  if (lastSet.rpe >= 9 || lastSet.reps < input.repMin) {
    return {
      weight: lastSet.weight,
      reps: input.repMin,
      reason: 'прошлый подход был тяжёлым — вес оставляем, цель минимальный качественный диапазон',
    }
  }

  if (lastSet.reps >= input.repMax && lastSet.rpe <= 7) {
    return {
      weight: lastSet.weight,
      reps: input.repMax,
      reason: 'подход был уверенным — повторяем вес и закрепляем верх диапазона',
    }
  }

  return {
    weight: lastSet.weight,
    reps: Math.min(input.repMax, Math.max(input.repMin, lastSet.reps)),
    reason: 'подход под контролем — повторяем рабочий вес и держим качество',
  }
}

function normalizeTrainingDays(trainingDays: string[], fallbackCount: number): string[] {
  const cleanDays = trainingDays.map((day) => day.trim()).filter(Boolean)
  if (cleanDays.length > 0) return cleanDays
  return russianWeekdayOrder.slice(0, Math.max(1, fallbackCount))
}

function nextTrainingSlots(now: Date, weekdays: string[], count: number): Array<{ weekday: string; daysUntil: number }> {
  const slots: Array<{ weekday: string; daysUntil: number }> = []
  for (let weekOffset = 0; slots.length < count && weekOffset < 8; weekOffset += 1) {
    for (const weekday of weekdays) {
      const baseDaysUntil = daysUntilWeekday(now, weekday)
      if (baseDaysUntil === null) continue
      slots.push({ weekday, daysUntil: baseDaysUntil + weekOffset * 7 })
    }
  }
  return slots
    .sort((a, b) => a.daysUntil - b.daysUntil || weekdayIndex(a.weekday) - weekdayIndex(b.weekday))
    .slice(0, count)
}

function nextWorkoutDayIndex(workoutDays: WorkoutDay[], completedWorkouts: CompletedWorkoutForCalendar[], now: Date): number {
  const recentWindowMs = 48 * 60 * 60 * 1000
  const latestCompleted = [...completedWorkouts]
    .filter((workout) => workoutDays.some((day) => day.id === workout.workoutDayId))
    .filter((workout) => {
      const completedAt = new Date(workout.completedAt)
      const ageMs = now.getTime() - completedAt.getTime()
      return Number.isFinite(completedAt.getTime()) && ageMs >= 0 && ageMs <= recentWindowMs
    })
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0]
  if (!latestCompleted) return 0
  const completedIndex = workoutDays.findIndex((day) => day.id === latestCompleted.workoutDayId)
  if (completedIndex < 0) return 0
  return (completedIndex + 1) % workoutDays.length
}

function daysUntilWeekday(now: Date, weekday: string): number | null {
  const targetIndexMondayZero = weekdayIndex(weekday)
  if (targetIndexMondayZero < 0) return null
  const currentIndexMondayZero = (now.getDay() + 6) % 7
  return (targetIndexMondayZero - currentIndexMondayZero + 7) % 7
}

function weekdayIndex(weekday: string): number {
  return russianWeekdayOrder.findIndex((day) => day.toLowerCase() === weekday.toLowerCase())
}
