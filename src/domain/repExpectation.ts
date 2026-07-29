// Этап 1 (#167): отклонение фактических повторов от ожидаемых на назначенном весе.
//
// Основной внутрисессионный сигнал сейчас — RPE, то есть самоотчёт. Здесь
// появляется объективная величина: сколько повторов человек сделал против того,
// сколько он делал на этом же весе раньше. Разрешение — один повтор, ноль
// дополнительных вопросов пользователю, оба слагаемых уже лежат в данных.
//
// Ожидание строится ПО НОМЕРУ ПОДХОДА: внутри сессии повторы естественно
// падают от подхода к подходу, поэтому третий подход сравнивается с третьим, а
// не со средним по упражнению. Где истории на этом весе не хватает, ожидания
// нет — это помечается явно (basis 'insufficient_data'), а не подменяется
// догадкой.
//
// Величина считается и показывается, но на решения не влияет (#167): сначала
// смотрим на данные — в частности на то, сколько сессий нужно, чтобы ожидание
// стало надёжным.

import { getCanonicalExerciseId } from './exerciseIdentity'

export type RepExpectationBasis = 'history_at_weight' | 'insufficient_data'

export interface RepExpectation {
  /** Ожидаемые повторы; null — истории на этом весе не хватает. */
  expectedReps: number | null
  basis: RepExpectationBasis
  /** Сессий на этом весе с этим номером подхода, по которым построено ожидание. */
  sessionsUsed: number
  /** Наклон прогрессии: повторов за сессию на том же весе. */
  slopePerSession: number
}

export interface SetRepDeviation {
  /** Номер рабочего подхода, с единицы. */
  setIndex: number
  weight: number
  actualReps: number
  expectedReps: number | null
  /** Факт минус ожидание; null — ожидания нет. */
  deviation: number | null
}

export interface ExerciseRepDeviation {
  exerciseId: string
  exerciseName: string
  sets: SetRepDeviation[]
  avgDeviation: number | null
  setsWithExpectation: number
  setsWithoutExpectation: number
}

export interface SessionRepDeviation {
  exercises: ExerciseRepDeviation[]
  avgDeviation: number | null
  setsWithExpectation: number
  setsWithoutExpectation: number
}

/** Минимум сессий на этом весе, чтобы ожидание вообще имело смысл. */
export const MIN_SESSIONS_FOR_EXPECTATION = 2

/** Ограничение наклона: больше повтора за сессию — это не прогрессия, а шум. */
const MAX_SLOPE_PER_SESSION = 1

/** Допуск сравнения весов (кг): 60 и 60.0 — один и тот же вес. */
const WEIGHT_EPSILON = 0.01

interface SetLike {
  weight: number
  reps: number
  completed?: boolean
}

interface ExerciseLike {
  exerciseId: string
  exerciseName?: string
  canonicalExerciseId?: string
  sets: SetLike[]
}

interface SessionLike {
  completedAt: string
  exercises: ExerciseLike[]
}

// ---------------------------------------------------------------------------
// Ожидание
// ---------------------------------------------------------------------------

interface ExpectationInput {
  exerciseId: string
  weight: number
  /** Номер рабочего подхода, с единицы. */
  setIndex: number
  /** Учитывать только сессии строго раньше этой даты. */
  before?: string
}

/**
 * Ожидание повторов для упражнения на конкретном весе и номере подхода —
 * из истории на этом же весе и наклона прогрессии.
 */
export function buildRepExpectation(
  history: SessionLike[],
  { exerciseId, weight, setIndex, before }: ExpectationInput,
): RepExpectation {
  const series = repsSeriesAtWeight(history, { exerciseId, weight, setIndex, before })
  if (series.length < MIN_SESSIONS_FOR_EXPECTATION) {
    return { expectedReps: null, basis: 'insufficient_data', sessionsUsed: series.length, slopePerSession: 0 }
  }

  const first = series[0]
  const last = series[series.length - 1]
  const rawSlope = (last - first) / (series.length - 1)
  const slopePerSession = clamp(round1(rawSlope), -MAX_SLOPE_PER_SESSION, MAX_SLOPE_PER_SESSION)
  // Отсчёт от последней сессии, а не от среднего: свежий результат ближе к
  // текущей форме, а наклон добавляет то, куда движется прогрессия.
  const expectedReps = Math.max(1, Math.round(last + slopePerSession))
  return { expectedReps, basis: 'history_at_weight', sessionsUsed: series.length, slopePerSession }
}

/**
 * Повторы на этом весе и номере подхода по сессиям, от старых к новым.
 * Сессии, где такого подхода не было, в ряд не попадают.
 */
function repsSeriesAtWeight(
  history: SessionLike[],
  { exerciseId, weight, setIndex, before }: ExpectationInput,
): number[] {
  const canonicalId = getCanonicalExerciseId({ exerciseId })
  const series: Array<{ completedAt: string; reps: number }> = []
  for (const session of history ?? []) {
    if (!session?.completedAt) continue
    if (before && session.completedAt >= before) continue
    for (const exercise of session.exercises ?? []) {
      if (getCanonicalExerciseId(exercise) !== canonicalId) continue
      const setsAtWeight = workingSets(exercise).filter((set) => sameWeight(set.weight, weight))
      const set = setsAtWeight[setIndex - 1]
      if (set) series.push({ completedAt: session.completedAt, reps: set.reps })
    }
  }
  return series
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map((point) => point.reps)
}

// ---------------------------------------------------------------------------
// Отклонение
// ---------------------------------------------------------------------------

/**
 * Отклонение факта от ожидания по каждому рабочему подходу сессии,
 * с агрегатами по упражнению и по сессии.
 */
export function computeSessionRepDeviation(entry: SessionLike, history: SessionLike[]): SessionRepDeviation {
  const before = entry?.completedAt
  const exercises: ExerciseRepDeviation[] = []

  for (const exercise of entry?.exercises ?? []) {
    const sets: SetRepDeviation[] = workingSets(exercise).map((set, index) => {
      const expectation = buildRepExpectation(history, {
        exerciseId: exercise.exerciseId,
        weight: set.weight,
        setIndex: index + 1,
        before,
      })
      return {
        setIndex: index + 1,
        weight: set.weight,
        actualReps: set.reps,
        expectedReps: expectation.expectedReps,
        deviation: expectation.expectedReps === null ? null : set.reps - expectation.expectedReps,
      }
    })
    if (sets.length === 0) continue
    exercises.push({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName ?? exercise.exerciseId,
      sets,
      ...summarize(sets),
    })
  }

  return { exercises, ...summarize(exercises.flatMap((exercise) => exercise.sets)) }
}

function summarize(sets: SetRepDeviation[]): { avgDeviation: number | null; setsWithExpectation: number; setsWithoutExpectation: number } {
  const measured = sets.filter((set) => set.deviation !== null)
  return {
    avgDeviation: measured.length > 0
      ? round1(measured.reduce((sum, set) => sum + (set.deviation ?? 0), 0) / measured.length)
      : null,
    setsWithExpectation: measured.length,
    setsWithoutExpectation: sets.length - measured.length,
  }
}

// ---------------------------------------------------------------------------
// Внутреннее
// ---------------------------------------------------------------------------

/**
 * Рабочие подходы упражнения: выполненные, с повторами и весом.
 * Оговорка #166/#167: сейчас все залогированные подходы рабочие; когда тренер
 * начнёт назначать разминку (#172), её подходы надо отсекать здесь.
 */
function workingSets(exercise: ExerciseLike): SetLike[] {
  return (exercise?.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0 && Number(set?.weight) > 0)
}

function sameWeight(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < WEIGHT_EPSILON
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
