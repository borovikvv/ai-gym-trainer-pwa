/**
 * Weight direction — single source of truth for weight arithmetic (issue #173).
 *
 * For most exercises weight is the LOAD: more weight = harder. For assisted
 * machines (gravitron, assisted dips) the "weight" is the counterweight
 * ASSISTANCE: more weight = easier. All progression arithmetic (plan,
 * memory, invariant #136, trend flags, intra-session decisions) must go
 * through these helpers so the direction is handled in exactly one place
 * instead of being re-derived (and lost) at every call site.
 *
 * The direction is a property of the exercise in the library catalog
 * (`exercise_library.weight_direction`). `resolveWeightDirection` prefers
 * the catalog field and falls back to the legacy name match for callers
 * that only have the exercise name.
 */

import { isAssistedExercise } from './muscleGroups.js'

export type WeightDirection = 'load' | 'assistance'

export interface WeightDirectionSource {
  name?: string | null
  weightDirection?: string | null
}

/**
 * Resolve the weight direction for an exercise.
 * Accepts either an object ({ name, weightDirection }) or a bare name string.
 * Catalog field wins; name match is the backward-compatible fallback.
 */
export function resolveWeightDirection(
  exercise: WeightDirectionSource | string | null | undefined,
): WeightDirection {
  if (typeof exercise === 'string') {
    return isAssistedExercise(exercise) ? 'assistance' : 'load'
  }
  const field = exercise?.weightDirection
  if (field === 'load' || field === 'assistance') return field
  return isAssistedExercise(exercise?.name) ? 'assistance' : 'load'
}

/**
 * Weight one step HARDER (progression).
 * load: +step. assistance: −step (less help), clamped at 0.
 */
export function harderWeight(weight: number, step: number, direction: WeightDirection): number {
  const w = Number(weight) || 0
  const s = Math.max(0, Number(step) || 0)
  return direction === 'assistance' ? Math.max(0, w - s) : w + s
}

/**
 * Weight one step EASIER (back-off / deload / low readiness).
 * load: −step, clamped at 0. assistance: +step (more help).
 */
export function easierWeight(weight: number, step: number, direction: WeightDirection): number {
  const w = Number(weight) || 0
  const s = Math.max(0, Number(step) || 0)
  return direction === 'assistance' ? w + s : Math.max(0, w - s)
}

/**
 * The STRONGER of two weights — the one representing more actual work.
 * Used for working-weight memory (#99) and the #136 floor.
 * load: max. assistance: min (less help = stronger).
 */
export function strongerOf(a: number, b: number, direction: WeightDirection): number {
  return direction === 'assistance' ? Math.min(a, b) : Math.max(a, b)
}

/**
 * The EASIER of two weights.
 * load: min. assistance: max (more help = easier).
 */
export function easierOf(a: number, b: number, direction: WeightDirection): number {
  return direction === 'assistance' ? Math.max(a, b) : Math.min(a, b)
}

// ---------------------------------------------------------------------------
// Issue #192: прогрессия, когда веса нет
// ---------------------------------------------------------------------------

/**
 * Упражнение, у которого прогрессия НЕ про вес: ни веса, ни шага (отжимания,
 * планка, подтягивания без утяжеления). harderWeight(0, 0) честно возвращает
 * ноль, и дальше по всем текстам тренера расходится «+0 кг» / «вес тела» как
 * цель. Проверка живёт здесь одна — её читают и прогрессия, и планировщик, и
 * оба дебрифа.
 *
 * Оба нуля обязательны: вес 0 при ненулевом шаге — это штанга, с которой
 * прогрессия по весу возможна (0 → 2.5 кг), и она работает как раньше.
 *
 * Шаг необязателен: в дебрифах известен только рекомендованный вес, и там
 * «шага нет» — честное значение по умолчанию, а не подстановка ради вызова.
 */
export function isWeightlessProgression(weight: number, step = 0): boolean {
  return (Number(weight) || 0) <= 0 && (Number(step) || 0) <= 0
}

/**
 * Потолок диапазона повторов для упражнений с весом тела.
 * Выше него подход тренирует выносливость, а не силу, — вместо роста повторов
 * нужен более сложный вариант движения.
 *
 * Замер по боевым данным 03.08.2026 (`workout_sets where completed and weight = 0`):
 * отжимания — 14 подходов, p90 = 15, максимум = 20 (один подход); подъём
 * коленей в упоре — максимум 27 при среднем 22. Потолок поставлен по
 * продемонстрированному максимуму: справочные 8–15 дают пять сессий роста,
 * дальше повтор перестаёт быть силовой работой для этого атлета.
 *
 * Тот же замер показал упражнение, которое рычаг уже переросло: скручивания на
 * наклонной скамье идут в среднем по 33 повтора при максимуме 120, то есть
 * упираются в потолок сразу. Это не сбой правила, а его смысл — у них в
 * alternatives первым стоят скручивания в тренажёре, где вес есть.
 */
export const BODYWEIGHT_REP_CEILING = 20

/**
 * Потолок для упражнений на время (планка) — в секундах.
 * Тот же замер: планка — 29 подходов, p90 = 90, максимум = 90 при среднем 62.
 * Справочные 40–60 сек дают шесть сессий роста до продемонстрированного
 * максимума.
 */
export const TIMED_SECONDS_CEILING = 90

/** Шаг прогрессии на время: секунда к планке не измеряется, пять — да. */
export const TIMED_SECONDS_STEP = 5

export interface RepRange {
  repMin: number
  repMax: number
}

export interface NextRepRange extends RepRange {
  /** Диапазон упёрся в потолок — расти дальше некуда, нужен другой вариант. */
  atCeiling: boolean
}

/**
 * Следующий диапазон повторов, когда прогрессия не про вес (#192).
 * Сдвигает границы на шаг вверх; у потолка возвращает диапазон без изменений
 * и atCeiling — вызывающий предлагает более сложный вариант упражнения.
 */
export function nextRepRange({ repMin, repMax, timed = false }: RepRange & { timed?: boolean }): NextRepRange {
  const ceiling = timed ? TIMED_SECONDS_CEILING : BODYWEIGHT_REP_CEILING
  const step = timed ? TIMED_SECONDS_STEP : 1
  const min = Number(repMin) || 0
  const max = Math.max(min, Number(repMax) || 0)
  if (max >= ceiling) return { repMin: min, repMax: max, atCeiling: true }
  return {
    repMin: Math.min(min + step, ceiling),
    repMax: Math.min(max + step, ceiling),
    atCeiling: false,
  }
}
