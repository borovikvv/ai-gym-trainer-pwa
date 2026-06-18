import type { ExercisePlan, WorkoutDay } from '../data/mockProgram'
import { formatWeight } from '../hooks/useWorkoutSession'
import type { ReadinessCheckIn } from './readinessCheckIn'

export type ReadinessMode = 'normal' | 'light' | 'very_light' | 'heavy'

export type ReadinessOption = {
  mode: ReadinessMode
  label: string
  summary: string
  multiplier: number
}

export const readinessOptions: ReadinessOption[] = [
  { mode: 'normal', label: 'Обычно', summary: 'работаем по плану', multiplier: 1 },
  { mode: 'light', label: 'Полегче', summary: 'снизим нагрузку примерно на один шаг', multiplier: 0.95 },
  { mode: 'very_light', label: 'Очень легко', summary: 'сильно снизим объём и вес', multiplier: 0.9 },
  { mode: 'heavy', label: 'Готов тяжело', summary: 'оставим план и сохраним фокус на технике', multiplier: 1 },
]

export function roundToStep(weight: number, step: number) {
  if (!step) return Number(weight.toFixed(1))
  return Number((Math.round(weight / step) * step).toFixed(1))
}

export function adaptExerciseForReadiness(exercise: ExercisePlan, mode: ReadinessMode, checkIn?: ReadinessCheckIn): ExercisePlan {
  const option = readinessOptions.find((item) => item.mode === mode) ?? readinessOptions[0]
  const targetedState = targetedReadinessState(exercise, checkIn)
  const step = exercise.weightStep || 2.5
  const nextWeight = mode === 'normal' || mode === 'heavy'
    ? exercise.targetWeight
    : Math.max(0, roundToStep(exercise.targetWeight * option.multiplier, step))
  const baseSetsCount = mode === 'very_light'
    ? Math.max(1, exercise.setsCount - 1)
    : exercise.setsCount
  const nextSetsCount = targetedState === 'pain'
    ? 1
    : targetedState === 'sore'
      ? Math.max(1, baseSetsCount - 1)
      : baseSetsCount
  const targetedWeight = targetedState === 'pain'
    ? Math.max(0, roundToStep(nextWeight * 0.85, step))
    : targetedState === 'sore'
      ? Math.max(0, roundToStep(nextWeight * 0.95, step))
      : nextWeight
  const nextRestSeconds = mode === 'heavy'
    ? Math.min(240, exercise.restSeconds + 30)
    : mode === 'very_light'
      ? Math.max(45, exercise.restSeconds - 15)
      : exercise.restSeconds
  const targetedFocus = targetedState === 'pain'
    ? 'Есть боль в связанной зоне: убираем риск, держим безопасную амплитуду.'
    : targetedState === 'sore'
      ? 'Отмечена забитость этой группы: режем объём и не гонимся за весом.'
      : ''
  return {
    ...exercise,
    setsCount: nextSetsCount,
    targetWeight: targetedWeight,
    prescription: `${nextSetsCount}×${exercise.repMin}–${exercise.repMax} · рекомендовано ${formatWeight(targetedWeight)} кг · отдых ${nextRestSeconds} сек`,
    todayGoal: mode === 'normal'
      ? exercise.todayGoal
      : mode === 'heavy'
        ? `тяжело, но без развала техники · ${exercise.repMin}–${exercise.repMax}`
        : `${option.summary} · ${exercise.repMin}–${exercise.repMax}`,
    coachFocus: mode === 'normal'
      ? `${targetedFocus ? `${targetedFocus} ` : ''}${exercise.coachFocus}`
      : `${targetedFocus ? `${targetedFocus} ` : ''}${option.summary}. ${exercise.coachFocus}`,
    restSeconds: nextRestSeconds,
  }
}

export function adaptWorkoutDayForReadiness(day: WorkoutDay, mode: ReadinessMode, checkIn?: ReadinessCheckIn): WorkoutDay {
  const option = readinessOptions.find((item) => item.mode === mode) ?? readinessOptions[0]
  const exercises = day.exercises.map((exercise) => adaptExerciseForReadiness(exercise, mode, checkIn))
  return {
    ...day,
    id: mode === 'normal' ? day.id : `${day.id}-${mode}`,
    name: day.name,
    description: mode === 'normal' ? day.description : `${day.description} ${option.summary}.`,
    exercises,
  }
}

function targetedReadinessState(exercise: ExercisePlan, checkIn?: ReadinessCheckIn) {
  if (!checkIn) return 'none'
  const exerciseText = normalizeText(`${exercise.name} ${exercise.muscleGroup}`)
  if ((checkIn.painAreas ?? []).some((area) => matchesArea(exerciseText, area))) return 'pain'
  if ((checkIn.soreMuscleGroups ?? []).some((group) => matchesArea(exerciseText, group))) return 'sore'
  return 'none'
}

function matchesArea(exerciseText: string, area: string) {
  const normalizedArea = normalizeText(area)
  if (normalizedArea.includes('груд')) return exerciseText.includes('груд') || exerciseText.includes('bench') || exerciseText.includes('жим')
  if (normalizedArea.includes('спин')) return exerciseText.includes('спин') || exerciseText.includes('тяга') || exerciseText.includes('row') || exerciseText.includes('pulldown')
  if (normalizedArea.includes('ног') || normalizedArea.includes('колен')) return exerciseText.includes('ног') || exerciseText.includes('бедр') || exerciseText.includes('ягод') || exerciseText.includes('присед') || exerciseText.includes('leg')
  if (normalizedArea.includes('плеч')) return exerciseText.includes('плеч') || exerciseText.includes('дельт') || exerciseText.includes('shoulder') || exerciseText.includes('жим')
  if (normalizedArea.includes('рук') || normalizedArea.includes('локт')) return exerciseText.includes('рук') || exerciseText.includes('бицеп') || exerciseText.includes('трицеп') || exerciseText.includes('curl')
  if (normalizedArea.includes('кор')) return exerciseText.includes('кор') || exerciseText.includes('пресс') || exerciseText.includes('планк') || exerciseText.includes('core')
  return false
}

function normalizeText(value: string) {
  return value.toLowerCase()
}

export function estimateWorkoutMinutes(day: WorkoutDay) {
  const workMinutes = day.exercises.reduce((sum, exercise) => sum + exercise.setsCount * 2.2 + (exercise.setsCount * exercise.restSeconds) / 60, 0)
  return Math.max(20, Math.round(workMinutes))
}
