/**
 * Issue #370: переход с гравитрона на обычные подтягивания.
 *
 * Подход в гравитроне с 0 кг помощи — это и есть обычное подтягивание. Такой
 * подход считается историей `pull-up` (на чтении, без копий в БД: в объёме
 * группы он остаётся одним подходом), а гравитрон после него больше не
 * назначается. Подтягивания, наоборот, не назначаются, пока нуля в гравитроне
 * не было: без этого они попали бы в план тому, кто занимается с помощью 15 кг.
 */
import { canonicalExerciseId } from './exerciseIdentity.js'
import type { CompletedExerciseHistory, WorkoutHistoryEntry, WorkoutSet } from './types.js'

export const ASSISTED_PULL_UP_ID = 'assisted-pull-up'
export const PULL_UP_ID = 'pull-up'

const PULL_UP_NAME = 'Подтягивания'

function newestFirst(history: WorkoutHistoryEntry[] | undefined): WorkoutHistoryEntry[] {
  return [...(history ?? [])].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
}

/** Выполненный подход без помощи: вес ровно 0 (пустой вес — не «ноль»). */
export function unassistedSets(sets: WorkoutSet[] | undefined): WorkoutSet[] {
  return (sets ?? []).filter((set) => (
    set?.completed !== false
    && Number(set?.reps) > 0
    && set?.weight != null
    && Number(set.weight) === 0
  ))
}

/**
 * Последняя запись упражнения в истории. Для `pull-up` подходы гравитрона с
 * нулевой помощью считаются его записью — базой, от которой ведёт тренер.
 */
export function findLatestExerciseEntry(
  history: WorkoutHistoryEntry[] | undefined,
  exerciseId: string,
): CompletedExerciseHistory | null {
  const target = canonicalExerciseId(exerciseId)
  for (const workout of newestFirst(history)) {
    for (const exercise of workout.exercises ?? []) {
      const id = canonicalExerciseId(exercise)
      if (id === target) return exercise
      if (target === PULL_UP_ID && id === ASSISTED_PULL_UP_ID) {
        const sets = unassistedSets(exercise.sets)
        if (sets.length > 0) {
          return {
            ...exercise,
            exerciseId: PULL_UP_ID,
            exerciseName: PULL_UP_NAME,
            canonicalExerciseId: PULL_UP_ID,
            sets,
            nextRecommendedWeight: 0,
            // Решение прогрессии принималось для диапазона гравитрона — на
            // подтягивания оно не переносится.
            progressionType: 'hold',
            progressionReason: '',
          }
        }
      }
    }
  }
  return null
}

/** Есть база для подтягиваний: свои записи или подход в гравитроне без помощи. */
export function hasPullUpBaseline(history: WorkoutHistoryEntry[] | undefined): boolean {
  return findLatestExerciseEntry(history, PULL_UP_ID) !== null
}

/** В последней тренировке с гравитроном был подход без помощи. */
export function isAssistedGraduated(history: WorkoutHistoryEntry[] | undefined): boolean {
  for (const workout of newestFirst(history)) {
    const entry = (workout.exercises ?? []).find((exercise) => canonicalExerciseId(exercise) === ASSISTED_PULL_UP_ID)
    if (entry) return unassistedSets(entry.sets).length > 0
  }
  return false
}

/**
 * Можно ли назначать упражнение планом. Подтягивания — только с базой,
 * гравитрон — пока не пройден и, если подтягиваний нет в справочнике (миграция
 * не применена), всегда: вертикальная тяга не должна пропасть из плана.
 */
export function passesAssistedGraduation(
  exerciseId: string,
  history: WorkoutHistoryEntry[] | undefined,
  libraryExerciseIds: string[],
): boolean {
  const id = canonicalExerciseId(exerciseId)
  if (id === PULL_UP_ID) return hasPullUpBaseline(history)
  if (id === ASSISTED_PULL_UP_ID) {
    const pullUpInLibrary = libraryExerciseIds.some((libraryId) => canonicalExerciseId(libraryId) === PULL_UP_ID)
    return !(pullUpInLibrary && isAssistedGraduated(history))
  }
  return true
}
