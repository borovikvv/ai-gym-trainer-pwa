import { formatWeight, pluralRu } from './lib/format.js'

export function computeWorkoutQualityScore(entry: any = {}) {
  const exercises = entry.exercises ?? []
  if (exercises.length === 0) return 0

  let score = 75

  for (const exercise of exercises) {
    if (exercise.pain) {
      score -= 15
      continue
    }

    if (exercise.progressionType === 'increase') {
      score += 5
    } else if (['deload', 'pain', 'skip'].includes(exercise.progressionType)) {
      score -= 5
    }

    const completedSets = (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
    if (completedSets.length === 0) continue

    let exerciseUnderControl = false
    for (const set of completedSets) {
      const rpe = Number(set.rpe)
      if (rpe >= 7 && rpe <= 8) {
        score += 2
        exerciseUnderControl = true
      } else if (rpe === 9) {
        score -= 2
      } else if (rpe >= 10) {
        score -= 5
      }
    }

    if (exerciseUnderControl) score += 3

    if (completedSets.every((set) => Number(set.rpe) >= 1 && Number(set.rpe) <= 6)) {
      score += 3
    }
  }

  const totalVolume = Number(entry.totalVolume ?? 0)
  if (totalVolume <= 0) score -= 20

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function buildWorkoutDebrief(entry: any = {}) {
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

export async function saveWorkoutDebriefRecommendation(client: any, entry, debrief = buildWorkoutDebrief(entry)) {
  await client.query(
    `insert into public.recommendations (user_id, session_id, recommendation_type, title, body, source)
     values ($1,$2,'post_workout_debrief','Итог тренера',$3,$4)`,
    [entry.userId, entry.id, formatDebrief(debrief), 'rules'],
  )
}

export function formatDebrief(debrief: any) {
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

function buildWhy(entry: any) {
  const checkIn = entry.readinessCheckIn
  const reasons = []
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
