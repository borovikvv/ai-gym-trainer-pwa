// Issue #176: ряд измерений веса тела и тренд по скользящему среднему.
//
// Лежит в shared, потому что нужен обоим концам: клиент рисует тренд в
// прогрессе и решает, показывать ли карточку ввода, сервер отдаёт ряд и будет
// строить на нём диагноз энергетического дефицита (#175).
//
// Назначение узкое: вес ОБЪЯСНЯЕТ, но ничего не ограничивает. Он нужен ровно
// для одного — отличить тренировочную причину стагнации от энергетической.
// Здесь нет и не должно быть целевого веса, калорий и рекомендаций по питанию.

export interface BodyWeightMeasurement {
  /** Дата замера, YYYY-MM-DD. */
  measuredOn: string
  weightKg: number
}

/** Карточка ввода появляется, когда с последнего замера прошло столько дней. */
export const BODY_WEIGHT_PROMPT_DAYS = 7

/**
 * Окно скользящего среднего. Суточные колебания воды (0.5–1.5 кг) больше
 * недельной динамики (0.2–0.5 кг), поэтому отдельные замеры не показываем —
 * только среднее за 3–4 недели.
 */
export const BODY_WEIGHT_TREND_WINDOW_DAYS = 24

/** Меньше этого сдвига направление тренда не называем — это шум. */
export const BODY_WEIGHT_TREND_DEADBAND_KG = 0.5

export type BodyWeightTrendDirection = 'up' | 'down' | 'flat' | 'insufficient_data'

export interface BodyWeightTrend {
  /** Скользящее среднее на каждую дату замера, по возрастанию даты. */
  points: Array<{ measuredOn: string; averageKg: number }>
  /** Последний фактический замер. */
  latestKg: number
  /** Последнее скользящее среднее — то, что показываем как «вес сейчас». */
  averageKg: number
  /**
   * Сдвиг среднего за окно тренда, а НЕ за всю историю: «−8 кг» от первого
   * замера годовой давности ничего не говорит о том, что происходит сейчас.
   */
  deltaKg: number
  /** Сколько дней реально прошло между сравниваемыми точками. */
  spanDays: number
  direction: BodyWeightTrendDirection
}

function toDateOnly(value: unknown): string {
  return String(value ?? '').slice(0, 10)
}

function daysBetweenDateOnly(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`)
  const toTime = Date.parse(`${to}T00:00:00.000Z`)
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) return Number.NaN
  return Math.round((toTime - fromTime) / 86_400_000)
}

function normalize(measurements: BodyWeightMeasurement[] | null | undefined): BodyWeightMeasurement[] {
  return (measurements ?? [])
    .map((item) => ({ measuredOn: toDateOnly(item?.measuredOn), weightKg: Number(item?.weightKg) }))
    .filter((item) => item.measuredOn.length === 10 && Number.isFinite(item.weightKg) && item.weightKg > 0)
    .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn))
}

/**
 * Сколько дней прошло с последнего замера. `null` — замеров нет вообще
 * (тогда спрашивать тоже пора, но это другой случай для вызывающего).
 */
export function daysSinceLastMeasurement(
  measurements: BodyWeightMeasurement[] | null | undefined,
  today: string,
): number | null {
  const sorted = normalize(measurements)
  const last = sorted[sorted.length - 1]
  if (!last) return null
  const days = daysBetweenDateOnly(last.measuredOn, toDateOnly(today))
  return Number.isFinite(days) ? days : null
}

/** Пора ли спрашивать вес: замеров нет или последний старше порога. */
export function shouldAskForBodyWeight(
  measurements: BodyWeightMeasurement[] | null | undefined,
  today: string,
): boolean {
  const days = daysSinceLastMeasurement(measurements, today)
  return days === null || days >= BODY_WEIGHT_PROMPT_DAYS
}

/**
 * Тренд по скользящему среднему. Окно задано в ДНЯХ, а не в числе замеров:
 * пропуск недели тогда просто уменьшает число точек в окне и ничего не ломает —
 * ни интерполяции, ни предположения о регулярности замеров здесь нет.
 */
export function bodyWeightTrend(measurements: BodyWeightMeasurement[] | null | undefined): BodyWeightTrend | null {
  const sorted = normalize(measurements)
  if (sorted.length === 0) return null

  const points = sorted.map((point, index) => {
    const window = sorted
      .slice(0, index + 1)
      .filter((item) => daysBetweenDateOnly(item.measuredOn, point.measuredOn) < BODY_WEIGHT_TREND_WINDOW_DAYS)
    const sum = window.reduce((total, item) => total + item.weightKg, 0)
    return { measuredOn: point.measuredOn, averageKg: round1(sum / window.length) }
  })

  const latest = points[points.length - 1]
  const averageKg = latest.averageKg
  // Точка сравнения — последняя, отстоящая от текущей хотя бы на окно тренда.
  // Если ряд короче окна, сравниваем с самым первым замером.
  const reference = [...points].reverse().find(
    (point) => daysBetweenDateOnly(point.measuredOn, latest.measuredOn) >= BODY_WEIGHT_TREND_WINDOW_DAYS,
  ) ?? points[0]
  const deltaKg = round1(averageKg - reference.averageKg)
  return {
    points,
    latestKg: sorted[sorted.length - 1].weightKg,
    averageKg,
    deltaKg,
    spanDays: daysBetweenDateOnly(reference.measuredOn, latest.measuredOn),
    direction: points.length < 2
      ? 'insufficient_data'
      : deltaKg >= BODY_WEIGHT_TREND_DEADBAND_KG
        ? 'up'
        : deltaKg <= -BODY_WEIGHT_TREND_DEADBAND_KG
          ? 'down'
          : 'flat',
  }
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}
