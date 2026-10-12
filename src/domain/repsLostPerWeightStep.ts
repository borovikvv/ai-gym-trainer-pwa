// Этап 1 личной модели атлета (#418, часть #415): потеря повторов на шаг веса.
//
// Общая норма прогрессии утверждает одно и то же для всех: сколько повторов
// человек теряет, когда вес растёт. В #190 приведение повторов через общую
// формулу провалилось на боевых данных именно потому, что у каждого свой
// наклон, а формула была одна. Здесь эта величина оценивается по журналу
// самого атлета: линейная регрессия повторов на вес по тому же упражнению и
// тому же номеру рабочего подхода.
//
// Величина считается и показывается, но на решения не влияет (#418): сначала
// замер на истории должен показать, что личное предсказание лучше общего
// (scripts/analyze-reps-lost-per-step.ts), и только потом отдельная задача
// включит её в назначения. Пока личных данных не хватает — явный откат к общей
// норме (basis 'fallback_general_norm'), видимый в самоаудите.
//
// Хранилища нет: параметр пересчитывается из истории при каждом обращении, как
// coachMemory.ts и estimatedOneRepMax.ts. Таблица/колонка появится только если
// замер докажет ценность (ответ на открытый вопрос issue «таблица или на лету»).

import { getCanonicalExerciseId } from './exerciseIdentity'

export interface RepsLostPerStepEstimate {
  /** Потеря повторов на кг роста веса; null — личной оценки нет. */
  repsLostPerKg: number | null
  basis: 'personal' | 'fallback_general_norm'
  /** Различных весов в наблюдениях (с допуском 0.01 кг). */
  distinctWeights: number
  /** Всего наблюдений (сессий с этим номером подхода). */
  observations: number
  /** Средний вес наблюдений — центр предсказания. */
  anchorWeight: number | null
  /** Средние повторы наблюдений — центр предсказания. */
  anchorReps: number | null
}

export const MIN_DISTINCT_WEIGHTS_FOR_PERSONAL_MODEL = 3
export const MIN_OBSERVATIONS_FOR_PERSONAL_MODEL = 10
/** Больше повтора за кг — это шум, а не физика; оценка обрезается сверху. */
export const MAX_REPS_LOST_PER_KG = 1
/** Общая норма: эффекта веса в общей модели нет (используется при откате). */
export const GENERAL_NORM_REPS_LOST_PER_KG = 0

/** Допуск сравнения весов (кг): 60 и 60.0 — один и тот же вес (как в repExpectation.ts). */
const WEIGHT_EPSILON = 0.01

interface SetLike {
  weight: number
  reps: number
  completed?: boolean
  isWarmup?: boolean
}

interface ExerciseLike {
  exerciseId: string
  sets: SetLike[]
}

interface SessionLike {
  completedAt: string
  exercises: ExerciseLike[]
}

interface EstimateInput {
  exerciseId: string
  /** Номер рабочего подхода, с единицы. */
  setIndex: number
  /** Учитывать только сессии строго раньше этой даты. */
  before?: string
}

export function estimateRepsLostPerWeightStep(
  history: SessionLike[],
  { exerciseId, setIndex, before }: EstimateInput,
): RepsLostPerStepEstimate {
  const observations = collectObservations(history, { exerciseId, setIndex, before })
  const distinctWeights = countDistinctWeights(observations)

  if (
    distinctWeights < MIN_DISTINCT_WEIGHTS_FOR_PERSONAL_MODEL ||
    observations.length < MIN_OBSERVATIONS_FOR_PERSONAL_MODEL
  ) {
    return {
      repsLostPerKg: null,
      basis: 'fallback_general_norm',
      distinctWeights,
      observations: observations.length,
      anchorWeight: null,
      anchorReps: null,
    }
  }

  // Метод наименьших квадратов reps ~ weight — та же арифметика, что и в
  // computeTrend из estimatedOneRepMax.ts, только объясняющая переменная вес,
  // а не дни.
  const n = observations.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0
  for (const point of observations) {
    sumX += point.weight
    sumY += point.reps
    sumXY += point.weight * point.reps
    sumX2 += point.weight * point.weight
  }

  const denominator = n * sumX2 - sumX * sumX
  const slope = Math.abs(denominator) < 0.001 ? 0 : (n * sumXY - sumX * sumY) / denominator

  // Эффект берём только в сторону «тяжелее = меньше повторов». Положительный
  // наклон на шумной выборке — это «эффекта не видно», а не «с весом растут
  // повторы»: извлекать физически не обоснованную зависимость из шума нельзя.
  const repsLostPerKg = clamp(-slope, 0, MAX_REPS_LOST_PER_KG)

  return {
    repsLostPerKg,
    basis: 'personal',
    distinctWeights,
    observations: n,
    anchorWeight: sumX / n,
    anchorReps: sumY / n,
  }
}

/**
 * Предсказание повторов на целевом весе. Личного предсказания нет — null:
 * вызывающий код сам решает, что делать при откате к общей норме.
 */
export function predictReps(estimate: RepsLostPerStepEstimate, targetWeight: number): number | null {
  if (
    estimate.basis !== 'personal' ||
    estimate.anchorReps === null ||
    estimate.anchorWeight === null ||
    estimate.repsLostPerKg === null
  ) {
    return null
  }
  const predicted = estimate.anchorReps - estimate.repsLostPerKg * (targetWeight - estimate.anchorWeight)
  return Math.max(1, Math.round(predicted))
}

/**
 * Наблюдения {weight, reps} по тому же упражнению (canonical id) и тому же
 * номеру рабочего подхода. Разминочные подходы (#345), невыполненные и
 * подходы без веса/повторов не идут в ряд.
 */
function collectObservations(
  history: SessionLike[],
  { exerciseId, setIndex, before }: EstimateInput,
): Array<{ weight: number; reps: number }> {
  const canonicalId = getCanonicalExerciseId({ exerciseId })
  const observations: Array<{ weight: number; reps: number }> = []
  for (const session of history ?? []) {
    if (!session?.completedAt) continue
    if (before && session.completedAt >= before) continue
    for (const exercise of session.exercises ?? []) {
      if (getCanonicalExerciseId(exercise) !== canonicalId) continue
      // Номер подхода считается среди рабочих подходов упражнения — тот же
      // фильтр, что в workingSets из repExpectation.ts (issue #345).
      const set = workingSets(exercise)[setIndex - 1]
      if (set) observations.push({ weight: set.weight, reps: set.reps })
    }
  }
  return observations
}

/**
 * Число различных весов с допуском 0.01 кг. Точное сравнение ключей тут не
 * годится: 60 и 60.0 — один вес, и они не должны считаться двумя.
 */
function countDistinctWeights(observations: Array<{ weight: number }>): number {
  const distinct: number[] = []
  for (const point of observations) {
    if (!distinct.some((weight) => sameWeight(weight, point.weight))) distinct.push(point.weight)
  }
  return distinct.length
}

/**
 * Рабочие подходы упражнения: выполненные, с повторами и весом, без разминки
 * (та же логика, что в repExpectation.ts, issue #345).
 */
function workingSets(exercise: ExerciseLike): SetLike[] {
  return (exercise?.sets ?? []).filter(
    (set) => set?.completed !== false && Number(set?.reps) > 0 && Number(set?.weight) > 0 && set?.isWarmup !== true,
  )
}

function sameWeight(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < WEIGHT_EPSILON
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
