import type { ExercisePlan, WorkoutHistoryEntry } from '../../shared/types'
import type { ReadinessCheckIn } from './readinessCheckIn'
import { calculateProgression, countPreviousFailures, type WorkoutSetInput } from './progression'
import { computeSessionRepDeviation } from './repExpectation'
import { getCanonicalExerciseId } from './exerciseIdentity'
import { buildWorkoutDebrief } from './workoutDebrief'

// Issue #98 PR3: CompletedExerciseHistory and WorkoutHistoryEntry unified
// in shared/types.ts. Re-export for backward compatibility.
export type { CompletedExerciseHistory, WorkoutHistoryEntry, WorkoutSet, WorkoutDebrief } from '../../shared/types'

export type ExerciseLog = {
  exerciseId: string
  pain: boolean
  // Issue #163: pain location, intensity 0-10, and red flags
  painLocation?: string
  painIntensity?: number
  redFlags?: string[]
  sets: WorkoutSetInput[]
}

export type CreateWorkoutHistoryEntryInput = {
  userId: string
  workoutDayId: string
  workoutDayName: string
  exercises: ExercisePlan[]
  logs: Record<string, ExerciseLog>
  readinessCheckIn?: ReadinessCheckIn | null
  completedAt?: string
  // Issue #245/#247: предыдущие сессии — из них считаются previousFailureCount
  // (второй провал подряд ниже repMin → deload) и отклонение повторов.
  // Фильтруются по userId здесь, вызывающим этого делать не надо.
  history?: WorkoutHistoryEntry[]
}

export function createWorkoutHistoryEntry(input: CreateWorkoutHistoryEntryInput): WorkoutHistoryEntry {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const userHistory = (input.history ?? []).filter((workout) => workout.userId === input.userId)
  const exercises = input.exercises.map((exercise) => {
    const log = input.logs[exercise.id] ?? { exerciseId: exercise.id, pain: false, sets: [] }
    const volume = log.sets.reduce((sum, set) => sum + (set.completed ? set.weight * set.reps : 0), 0)
    const currentWeight = firstCompletedWeight(log.sets) ?? exercise.targetWeight
    // Issue #247: отклонение факта от личного ожидания на этом весе — стоп-фактор
    // решения о весе. Считается одним вызовом на объекте из одного упражнения.
    const avgRepDeviation = computeSessionRepDeviation(
      {
        completedAt,
        exercises: [{ exerciseId: exercise.id, canonicalExerciseId: getCanonicalExerciseId(exercise), sets: log.sets }],
      },
      userHistory,
    ).avgDeviation
    const progression = calculateProgression({
      exerciseName: exercise.name,
      currentWeight,
      repMin: exercise.repMin,
      repMax: exercise.repMax,
      weightStep: exercise.weightStep,
      sets: log.sets,
      pain: log.pain,
      avgRepDeviation,
      previousFailureCount: countPreviousFailures(userHistory, {
        canonicalExerciseId: getCanonicalExerciseId(exercise),
        repMin: exercise.repMin,
      }),
    })

    return {
      exerciseId: exercise.id,
      canonicalExerciseId: getCanonicalExerciseId(exercise),
      exerciseName: exercise.name,
      pain: log.pain,
      // Issue #163: детали боли идут дальше вместе с булевым признаком —
      // без них сервер соберёт pain_log из одного `pain`, а анкета
      // (локация, интенсивность, красные флаги) не доедет до базы.
      painLocation: log.painLocation,
      painIntensity: log.painIntensity,
      redFlags: log.redFlags,
      sets: log.sets,
      volume,
      nextRecommendedWeight: progression.recommendedWeight,
      progressionType: progression.type,
      progressionReason: progression.reason,
    }
  })

  const entryWithoutDebrief = {
    id: `${input.userId}-${input.workoutDayId}-${completedAt}`,
    userId: input.userId,
    workoutDayId: input.workoutDayId,
    workoutDayName: input.workoutDayName,
    completedAt,
    totalVolume: exercises.reduce((sum, exercise) => sum + exercise.volume, 0),
    readinessCheckIn: input.readinessCheckIn ?? null,
    exercises,
  }
  return {
    ...entryWithoutDebrief,
    debrief: buildWorkoutDebrief(entryWithoutDebrief),
  }
}

export function buildNextTargets(history: WorkoutHistoryEntry[]): Record<string, number> {
  return [...history]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .reduce<Record<string, number>>((targets, workout) => {
      for (const exercise of workout.exercises) {
        const canonicalExerciseId = getCanonicalExerciseId(exercise)
        if (targets[exercise.exerciseId] === undefined) {
          targets[exercise.exerciseId] = exercise.nextRecommendedWeight
        }
        if (targets[canonicalExerciseId] === undefined) {
          targets[canonicalExerciseId] = exercise.nextRecommendedWeight
        }
      }
      return targets
    }, {})
}

function firstCompletedWeight(sets: WorkoutSetInput[]): number | undefined {
  return sets.find((set) => set.completed)?.weight
}

// Issue #165: интервал между завершениями соседних подходов (секунды).
// Один элемент на пару соседей (n-1 значений на n подходов).
// Пары без performedAt пропускаем — старые данные, смешанная история.
//
// ponytail: это НЕ чистый отдых — внутрь входит и работа следующего подхода
// (~20–40 с на подход), поэтому значение систематически выше назначенного
// отдыха. Разделить можно только вторым таймстемпом — началом подхода;
// пока его нет, сравнивать с предписанным отдыхом напрямую нельзя.
export function computeSetIntervals(sets: Array<{ performedAt?: string | null }>): number[] {
  const intervals: number[] = []
  for (let i = 1; i < sets.length; i++) {
    const prev = sets[i - 1]?.performedAt
    const curr = sets[i]?.performedAt
    if (!prev || !curr) continue
    const ms = new Date(curr).getTime() - new Date(prev).getTime()
    if (Number.isFinite(ms)) intervals.push(Math.round(ms / 1000))
  }
  return intervals
}

// Issue #268: чистый отдых — «начало текущего подхода − конец предыдущего».
// В отличие от computeSetIntervals (завершение→завершение) тут не входит работа
// следующего подхода. Один элемент на пару соседних сетов; на месте пары, где
// у предыдущего нет performedAt или у текущего нет startedAt, кладём null, а
// не сокращаем массив и не подставляем 0 — отсутствие данных не измерение
// (как в #246/#248).
export function computeNetRestSeconds(sets: Array<{ performedAt?: string | null; startedAt?: string | null }>): Array<number | null> {
  const result: Array<number | null> = []
  for (let i = 1; i < sets.length; i++) {
    const prevPerformedAt = sets[i - 1]?.performedAt
    const currStartedAt = sets[i]?.startedAt
    if (!prevPerformedAt || !currStartedAt) {
      result.push(null)
      continue
    }
    const ms = new Date(currStartedAt).getTime() - new Date(prevPerformedAt).getTime()
    result.push(Number.isFinite(ms) ? Math.round(ms / 1000) : null)
  }
  return result
}
