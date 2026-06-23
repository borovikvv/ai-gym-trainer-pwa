import type { WorkoutDay } from '../data/mockProgram'
import type { CompletedExerciseHistory, WorkoutHistoryEntry } from './workoutHistory'
import { getCanonicalExerciseId } from './exerciseIdentity'
import { buildAllExerciseE1RMHistories, sparklineData, trendDescription, type ExerciseE1RMHistory } from './estimatedOneRepMax'

export type ExerciseProgressStatus = 'растёт' | 'можно повысить' | 'закрепляем' | 'застой' | 'перегрузка' | 'была боль' | 'нет данных'

export type ProgressDashboard = {
  overview: {
    workouts14d: number
    totalVolume14d: number
    exercisesGrowing: number
    stalledExercises: number
    overloadSets: number
    painMarks: number
  }
  summary: string
  focus: Array<{
    exerciseId: string
    exerciseName: string
    status: ExerciseProgressStatus
    text: string
  }>
  exerciseStatuses: Array<{
    exerciseId: string
    exerciseName: string
    muscleGroup: string
    status: ExerciseProgressStatus
    lastResult: string
    nextTarget: string
    note: string
  }>
  recentWorkouts: Array<{
    id: string
    title: string
    volume: number
    note: string
  }>
  coachDecisions: Array<{
    title: string
    body: string
    source: string
  }>
  e1RMHistories: Array<{
    exerciseId: string
    exerciseName: string
    muscleGroup: string
    currentBest: number
    trendDirection: string
    trendText: string
    sparkline: Array<{ x: number; y: number }>
    dataPointCount: number
  }>
}

export function buildProgressDashboard(input: {
  history: WorkoutHistoryEntry[]
  workoutDays: WorkoutDay[]
  now?: Date
}): ProgressDashboard {
  const now = input.now ?? new Date()
  const recentCutoffMs = now.getTime() - 14 * 24 * 60 * 60 * 1000
  const sortedHistory = [...input.history].sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  const recentHistory = sortedHistory.filter((workout) => new Date(workout.completedAt).getTime() >= recentCutoffMs)
  const programExercises = uniqueProgramExercises(input.workoutDays)
  const latestByExercise = latestExercisesById(sortedHistory)
  const exerciseStatuses = programExercises.map((exercise) => {
    const latest = latestByExercise.get(getCanonicalExerciseId(exercise))
    const status = exerciseStatus(latest)
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      muscleGroup: exercise.muscleGroup,
      status,
      lastResult: latest ? completedSetsSummary(latest) : 'нет данных',
      nextTarget: latest ? weightLabel(latest.nextRecommendedWeight) : weightLabel(exercise.targetWeight),
      note: latest?.progressionReason ?? `Стартовая цель: ${exercise.todayGoal || exercise.prescription}`,
    }
  })

  const overview = {
    workouts14d: recentHistory.length,
    totalVolume14d: recentHistory.reduce((sum, workout) => sum + workout.totalVolume, 0),
    exercisesGrowing: exerciseStatuses.filter((item) => item.status === 'можно повысить' || item.status === 'растёт').length,
    stalledExercises: exerciseStatuses.filter((item) => item.status === 'застой' || item.status === 'закрепляем').length,
    overloadSets: recentHistory.flatMap((workout) => workout.exercises).flatMap((exercise) => exercise.sets).filter((set) => set.completed && set.rpe >= 9).length,
    painMarks: recentHistory.flatMap((workout) => workout.exercises).filter((exercise) => exercise.pain).length,
  }

  const focus = exerciseStatuses
    .filter((item) => item.status !== 'нет данных')
    .slice(0, 3)
    .map((item) => ({
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      status: item.status,
      text: focusText(item),
    }))

  const recentWorkouts = sortedHistory.slice(0, 5).map((workout) => ({
    id: workout.id,
    title: `${formatShortDate(workout.completedAt)} · ${workout.workoutDayName}`,
    volume: workout.totalVolume,
    note: workoutNote(workout),
  }))

  const coachDecisions = sortedHistory
    .flatMap((workout) => workout.exercises.map((exercise) => ({ workout, exercise })))
    .filter(({ exercise }) => exercise.progressionReason)
    .slice(0, 5)
    .map(({ exercise }) => ({
      title: exercise.exerciseName,
      body: exercise.progressionReason,
      source: 'правила прогрессии',
    }))

  const e1RMHistories = buildAllExerciseE1RMHistories(input.history)
    .slice(0, 8)
    .map((h: ExerciseE1RMHistory) => ({
      exerciseId: h.exerciseId,
      exerciseName: h.exerciseName,
      muscleGroup: h.muscleGroup,
      currentBest: h.currentBest,
      trendDirection: h.trend.direction,
      trendText: trendDescription(h.trend),
      sparkline: sparklineData(h, 12),
      dataPointCount: h.dataPoints.length,
    }))

  return {
    overview,
    summary: summaryText({ overview, exerciseStatuses }),
    focus,
    exerciseStatuses,
    recentWorkouts,
    coachDecisions,
    e1RMHistories,
  }
}

function uniqueProgramExercises(workoutDays: WorkoutDay[]) {
  const map = new Map<string, WorkoutDay['exercises'][number]>()
  for (const day of workoutDays) {
    for (const exercise of day.exercises) {
      const canonicalExerciseId = getCanonicalExerciseId(exercise)
      if (!map.has(canonicalExerciseId)) map.set(canonicalExerciseId, exercise)
    }
  }
  return Array.from(map.values())
}

function latestExercisesById(history: WorkoutHistoryEntry[]) {
  const map = new Map<string, CompletedExerciseHistory>()
  for (const workout of history) {
    for (const exercise of workout.exercises) {
      const canonicalExerciseId = getCanonicalExerciseId(exercise)
      if (!map.has(canonicalExerciseId)) map.set(canonicalExerciseId, exercise)
    }
  }
  return map
}

function exerciseStatus(exercise: CompletedExerciseHistory | undefined): ExerciseProgressStatus {
  if (!exercise) return 'нет данных'
  if (exercise.pain) return 'была боль'
  if (exercise.progressionType === 'increase') return 'можно повысить'
  if (exercise.progressionType === 'deload') return 'перегрузка'
  const completedSets = exercise.sets.filter((set) => set.completed)
  const maxEffortSets = completedSets.filter((set) => set.rpe >= 9).length
  if (maxEffortSets >= Math.max(1, Math.ceil(completedSets.length / 2))) return 'закрепляем'
  if (exercise.progressionType === 'hold') return 'застой'
  return 'растёт'
}

function completedSetsSummary(exercise: CompletedExerciseHistory) {
  const completedSets = exercise.sets.filter((set) => set.completed && set.reps > 0)
  if (completedSets.length === 0) return 'нет выполненных подходов'
  return completedSets.map((set) => set.weight > 0 ? `${formatNumber(set.weight)}×${set.reps}` : `${set.reps} сек`).join(' / ')
}

function weightLabel(weight: number) {
  return weight > 0 ? `${formatNumber(weight)} кг` : 'время/вес тела'
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value)
}

function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(isoDate))
}

function workoutNote(workout: WorkoutHistoryEntry) {
  const pain = workout.exercises.find((exercise) => exercise.pain)
  if (pain) return `${pain.exerciseName}: была боль, прогрессию блокируем`
  const overload = workout.exercises.find((exercise) => exercise.sets.some((set) => set.completed && set.rpe >= 9))
  if (overload) return `${overload.exerciseName}: был подход на пределе`
  const increase = workout.exercises.find((exercise) => exercise.progressionType === 'increase')
  if (increase) return `${increase.exerciseName}: можно аккуратно повысить вес`
  return 'тренировка сохранена, ждём динамику'
}

function focusText(item: ProgressDashboard['exerciseStatuses'][number]) {
  if (item.status === 'можно повысить') return `${item.exerciseName}: можно пробовать ${item.nextTarget}`
  if (item.status === 'закрепляем') return `${item.exerciseName}: закрепить ${item.lastResult} без отказа`
  if (item.status === 'была боль') return `${item.exerciseName}: не повышать, проверить технику или замену`
  if (item.status === 'перегрузка') return `${item.exerciseName}: разгрузить вес/объём`
  return `${item.exerciseName}: цель — стабильнее выполнить рабочие подходы`
}

function summaryText(input: { overview: ProgressDashboard['overview']; exerciseStatuses: ProgressDashboard['exerciseStatuses'] }) {
  if (input.overview.workouts14d === 0) return 'Пока нет сохранённых тренировок: после первой тренировки здесь появится динамика.'
  const firstHold = input.exerciseStatuses.find((item) => item.status === 'закрепляем' || item.status === 'перегрузка' || item.status === 'была боль')
  const firstIncrease = input.exerciseStatuses.find((item) => item.status === 'можно повысить')
  const parts = []
  if (firstHold) parts.push(`${firstHold.exerciseName}: ${firstHold.status}`)
  if (firstIncrease) parts.push(`${firstIncrease.exerciseName}: можно повышать нагрузку`)
  return parts.length > 0
    ? parts.join('. ') + '.'
    : 'Динамика спокойная: продолжаем копить историю и повышать нагрузку без рывков.'
}
