import type { WorkoutHistoryEntry } from './workoutHistory'

export type WorkoutDebrief = {
  summary: string
  wentWell: string[]
  overload: string[]
  progressed: string[]
  nextChanges: string[]
  why: string
  qualityScore: number
}

export function buildWorkoutDebrief(entry: WorkoutHistoryEntry, serverQualityScore?: number): WorkoutDebrief {
  const exercises = entry.exercises ?? []
  const completedExercises = exercises.filter((exercise) => exercise.sets.some((set) => set.completed))
  const progressed = exercises
    .filter((exercise) => exercise.progressionType === 'increase')
    .map((exercise) => `${exercise.exerciseName}: можно осторожно повысить до ${formatWeight(exercise.nextRecommendedWeight)} кг.`)
  const overload = exercises
    .filter((exercise) => exercise.pain || exercise.sets.some((set) => set.completed && set.rpe >= 9) || ['deload', 'pain', 'skip'].includes(exercise.progressionType))
    .map((exercise) => `${exercise.exerciseName}: ${exercise.pain ? 'была боль, прогрессию блокируем.' : exercise.progressionReason}`)
  const wentWell = exercises
    .filter((exercise) => !exercise.pain && exercise.sets.some((set) => set.completed && set.rpe <= 8) && !overload.some((line) => line.startsWith(`${exercise.exerciseName}:`)))
    .slice(0, 3)
    .map((exercise) => `${exercise.exerciseName}: рабочие подходы прошли под контролем.`)
  const nextChanges = exercises
    .filter((exercise) => ['deload', 'pain', 'skip'].includes(exercise.progressionType))
    .map((exercise) => `${exercise.exerciseName}: следующая цель ${formatWeight(exercise.nextRecommendedWeight)} кг без добивания отказа.`)

  return {
    summary: `${completedExercises.length} ${pluralRu(completedExercises.length, 'упражнение', 'упражнения', 'упражнений')} · объём ${Math.round(entry.totalVolume).toLocaleString('ru-RU')}.`,
    wentWell: wentWell.length ? wentWell : ['Главное: тренировка зафиксирована, теперь тренер может точнее адаптировать следующую.'],
    overload: overload.length ? overload : ['Перегруза и боли по записи нет.'],
    progressed: progressed.length ? progressed : ['Явной прогрессии по весу пока не добавляем, закрепляем качество.'],
    nextChanges: nextChanges.length ? nextChanges : ['Следующую тренировку строим от фактических подходов, без резкого скачка нагрузки.'],
    why: buildWhy(entry),
    qualityScore: serverQualityScore ?? 0,
  }
}

function buildWhy(entry: WorkoutHistoryEntry) {
  const checkIn = entry.readinessCheckIn
  const reasons: string[] = []
  if (checkIn && (checkIn.sleepQuality <= 2 || checkIn.energy <= 2 || checkIn.stress >= 4 || checkIn.availableMinutes < 45)) {
    reasons.push('мало восстановления')
  }
  if (entry.exercises.some((exercise) => exercise.sets.some((set) => set.completed && set.rpe >= 9))) {
    reasons.push('были тяжёлые подходы')
  }
  if (entry.exercises.some((exercise) => exercise.pain)) {
    reasons.push('отмечена боль')
  }
  return reasons.length
    ? `Коррекция нужна потому что ${reasons.join(', ')}.`
    : 'Коррекция нужна по фактическим повторениям, весу и запасу в подходах.'
}

function formatWeight(weight: number) {
  return Number.isInteger(weight) ? String(weight) : String(weight)
}

function pluralRu(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
