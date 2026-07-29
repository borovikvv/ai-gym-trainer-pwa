// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
import type { CompletedExerciseHistory, ReadinessCheckIn } from '../shared/types.js'
import { formatWeight, pluralRu } from '../shared/format.js'
// Issue #162: единая нормированная шкала качества (была продублирована здесь
// и в src/domain/workoutDebrief.ts, обе упирались в кламп 100).
import { computeWorkoutQualityScore, type QualityPrescription } from '../shared/workoutQuality.js'

export { computeWorkoutQualityScore }

interface ExerciseEntry extends CompletedExerciseHistory {
  exerciseName: string
  nextRecommendedWeight: number
  progressionReason: string
  /** Предписание из плана — опора счёта качества (#162). */
  planned?: QualityPrescription | null
}

interface WorkoutEntry {
  userId?: string
  id?: string
  exercises?: ExerciseEntry[]
  totalVolume?: number
  readinessCheckIn?: ReadinessCheckIn | null
}

interface DbClient {
  query: (text: string, params: unknown[]) => Promise<unknown>
}

interface WorkoutDebrief {
  summary: string
  wentWell: string[]
  overload: string[]
  progressed: string[]
  nextChanges: string[]
  why: string
  qualityScore: number
}

export function buildWorkoutDebrief(entry: WorkoutEntry = {}): WorkoutDebrief {
  const exercises = entry.exercises ?? []
  const completedExercises = exercises.filter((exercise) => (exercise.sets ?? []).some((set) => set?.completed !== false && Number(set?.reps) > 0))
  const overload = exercises
    .filter((exercise) => Boolean(exercise.pain) || (exercise.sets ?? []).some((set) => set?.completed !== false && Number(set?.rpe) >= 9) || ['deload', 'pain', 'skip'].includes(exercise.progressionType))
    .map((exercise) => `${exercise.exerciseName}: ${exercise.pain ? 'была боль, прогрессию блокируем.' : exercise.progressionReason ?? 'был тяжёлый подход.'}`)
  const progressed = exercises
    .filter((exercise) => exercise.progressionType === 'increase')
    .map((exercise) => `${exercise.exerciseName}: можно осторожно повысить до ${formatWeight(exercise.nextRecommendedWeight)} кг.`)
  const wentWell = exercises
    .filter((exercise) => !exercise.pain && (exercise.sets ?? []).some((set) => set?.completed !== false && Number(set?.rpe) <= 8) && !overload.some((line) => line.startsWith(`${exercise.exerciseName}:`)))
    .slice(0, 3)
    .map((exercise) => `${exercise.exerciseName}: рабочие подходы прошли под контролем.`)
  const nextChanges = exercises
    .filter((exercise) => ['deload', 'pain', 'skip'].includes(exercise.progressionType))
    .map((exercise) => `${exercise.exerciseName}: следующая цель ${formatWeight(exercise.nextRecommendedWeight)} кг без добивания отказа.`)

  return {
    summary: `${completedExercises.length} ${pluralRu(completedExercises.length, 'упражнение', 'упражнения', 'упражнений')} · объём ${Math.round(Number(entry.totalVolume ?? 0)).toLocaleString('ru-RU')}.`,
    wentWell: wentWell.length ? wentWell : ['Главное: тренировка зафиксирована, теперь тренер может точнее адаптировать следующую.'],
    overload: overload.length ? overload : ['Перегруза и боли по записи нет.'],
    progressed: progressed.length ? progressed : ['Явной прогрессии по весу пока не добавляем, закрепляем качество.'],
    nextChanges: nextChanges.length ? nextChanges : ['Следующую тренировку строим от фактических подходов, без резкого скачка нагрузки.'],
    why: buildWhy(entry),
    qualityScore: computeWorkoutQualityScore(entry),
  }
}

export async function saveWorkoutDebriefRecommendation(
  client: DbClient,
  entry: WorkoutEntry,
  debrief: WorkoutDebrief,
): Promise<void> {
  await client.query(
    `insert into public.recommendations (user_id, session_id, recommendation_type, title, body, source)
     values ($1,$2,'post_workout_debrief','Итог тренера',$3,$4)`,
    [entry.userId, entry.id, formatDebrief(debrief), 'rules'],
  )
}

function formatDebrief(debrief: WorkoutDebrief): string {
  return [
    debrief.summary,
    '',
    'Что получилось:',
    ...(debrief.wentWell ?? []).map((line) => `• ${line}`),
    '',
    'Где был перегруз:',
    ...(debrief.overload ?? []).map((line) => `• ${line}`),
    '',
    'Прогресс:',
    ...(debrief.progressed ?? []).map((line) => `• ${line}`),
    '',
    'Что меняем дальше:',
    ...(debrief.nextChanges ?? []).map((line) => `• ${line}`),
    '',
    debrief.why,
  ].join('\n')
}

function buildWhy(entry: WorkoutEntry): string {
  const checkIn = entry.readinessCheckIn
  const reasons: string[] = []
  if (checkIn && (Number(checkIn.sleepQuality) <= 2 || Number(checkIn.energy) <= 2 || Number(checkIn.stress) >= 4 || Number(checkIn.availableMinutes) < 45)) {
    reasons.push('мало восстановления')
  }
  if ((entry.exercises ?? []).some((exercise) => (exercise.sets ?? []).some((set) => set?.completed !== false && Number(set?.rpe) >= 9))) {
    reasons.push('были тяжёлые подходы')
  }
  if ((entry.exercises ?? []).some((exercise) => exercise.pain)) {
    reasons.push('отмечена боль')
  }
  return reasons.length
    ? `Коррекция нужна потому что ${reasons.join(', ')}.`
    : 'Коррекция нужна по фактическим повторениям, весу и запасу в подходах.'
}
