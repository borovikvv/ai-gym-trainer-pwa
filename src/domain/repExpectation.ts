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
//
// #190: требование ТОЧНОГО совпадения веса давало покрытие 8 % на боевых
// данных (5 подходов из 65). Причина структурная, а не в объёме истории: у
// прогрессирующего человека вес меняется, и совпадение «тот же вес × тот же
// номер подхода × две сессии» выпадает тем реже, чем лучше идёт прогрессия.
// Поэтому при нехватке точных совпадений берётся УЗКАЯ окрестность веса.
//
// Повторы при этом переносятся КАК ЕСТЬ, без приведения к целевому весу.
// Приведение через e1RM было написано и отвергнуто замером на боевых данных
// (30.07.2026, 173 пары подходов на одном упражнении и номере подхода в
// пределах окрестности): средняя ошибка приведения +3.97 повтора против +0.38
// у простого переноса. Инвертированная линейная оценка теряет примерно повтор
// на 2 % веса, реальность — на 2.5–3 %, и на высоких повторах расхождение
// растёт. На разрывах порядка 2 кг эффект веса меньше разброса между
// сессиями, поэтому поправка добавляет смещение, а не точность.
//
// Отсюда же ограничение на ширину: без поправки окрестность обязана быть
// узкой. Замер верен для окна ±5 %; шире — нужна поправка, а её сначала надо
// откалибровать на данных, а не взять из формулы для одноповторного максимума.

import { getCanonicalExerciseId } from './exerciseIdentity'

export type RepExpectationBasis = 'history_at_weight' | 'history_near_weight' | 'insufficient_data'

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

/**
 * Окрестность веса (#190). Доля от целевого веса, но не уже
 * NEAR_WEIGHT_MIN_KG: на лёгких упражнениях 5 % — это меньше блина, и
 * окрестность не добавила бы ни одного наблюдения.
 *
 * Отступление от текста #190: там предлагалось «±1 шаг веса упражнения или
 * ±5 %, что меньше». Шаг веса на этот вход не приходит (`buildRepExpectation`
 * знает только упражнение и вес), а взять меньшее из двух означало бы на
 * лёгких весах окрестность уже блина. Поэтому floor снизу, а не выбор
 * меньшего.
 */
const NEAR_WEIGHT_RATIO = 0.05
const NEAR_WEIGHT_MIN_KG = 2.5

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
  const observations = repsSeriesNearWeight(history, { exerciseId, weight, setIndex, before })

  // Точные совпадения — первый выбор: они не требуют допущения о том, что
  // соседний вес даёт те же повторы.
  const exact = observations.filter((point) => sameWeight(point.weight, weight)).map((point) => point.reps)
  if (exact.length >= MIN_SESSIONS_FOR_EXPECTATION) return fromSeries(exact, 'history_at_weight')

  const near = observations.map((point) => point.reps)
  if (near.length >= MIN_SESSIONS_FOR_EXPECTATION) return fromSeries(near, 'history_near_weight')

  return { expectedReps: null, basis: 'insufficient_data', sessionsUsed: near.length, slopePerSession: 0 }
}

function fromSeries(series: number[], basis: Exclude<RepExpectationBasis, 'insufficient_data'>): RepExpectation {
  const first = series[0]
  const last = series[series.length - 1]
  const rawSlope = (last - first) / (series.length - 1)
  const slopePerSession = clamp(round1(rawSlope), -MAX_SLOPE_PER_SESSION, MAX_SLOPE_PER_SESSION)
  // Отсчёт от последней сессии, а не от среднего: свежий результат ближе к
  // текущей форме, а наклон добавляет то, куда движется прогрессия.
  const expectedReps = Math.max(1, Math.round(last + slopePerSession))
  return { expectedReps, basis, sessionsUsed: series.length, slopePerSession }
}

/** Половина ширины окрестности вокруг целевого веса, кг. */
function nearWeightTolerance(weight: number): number {
  return Math.max(NEAR_WEIGHT_MIN_KG, Math.abs(Number(weight) || 0) * NEAR_WEIGHT_RATIO)
}

/**
 * Повторы на этом номере подхода по сессиям, от старых к новым, вместе с
 * весом, на котором они сделаны. В ряд попадают веса в узкой окрестности
 * целевого; сессии, где такого подхода не было, не попадают.
 */
function repsSeriesNearWeight(
  history: SessionLike[],
  { exerciseId, weight, setIndex, before }: ExpectationInput,
): Array<{ reps: number; weight: number }> {
  const canonicalId = getCanonicalExerciseId({ exerciseId })
  const tolerance = nearWeightTolerance(weight)
  const series: Array<{ completedAt: string; reps: number; weight: number }> = []
  for (const session of history ?? []) {
    if (!session?.completedAt) continue
    if (before && session.completedAt >= before) continue
    for (const exercise of session.exercises ?? []) {
      if (getCanonicalExerciseId(exercise) !== canonicalId) continue
      // Номер подхода считается среди подходов В ОКРЕСТНОСТИ, а не среди всех:
      // иначе разминочный или добивочный подход на другом весе сдвинул бы
      // нумерацию и третий подход сравнивался бы со вторым.
      const setsNearWeight = workingSets(exercise).filter((set) => Math.abs(set.weight - weight) <= tolerance)
      const set = setsNearWeight[setIndex - 1]
      if (set) series.push({ completedAt: session.completedAt, reps: set.reps, weight: set.weight })
    }
  }
  return series
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map(({ reps, weight: setWeight }) => ({ reps, weight: setWeight }))
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
