/**
 * Unified formatting utilities.
 *
 * Previously duplicated in coachPlanner, coachToday, coachDebrief,
 * and client-side workoutDebrief.ts.
 */

/**
 * Format a weight number for Russian locale display.
 * Server-side version uses toLocaleString('ru-RU').
 */
export function formatWeight(value) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

/**
 * Round a weight value to one decimal place (no trailing zeros in display).
 */
export function roundWeight(value) {
  return Number(Number(value).toFixed(1))
}

/**
 * Russian plural forms helper.
 * pluralRu(1, 'упражнение', 'упражнения', 'упражнений') → 'упражнение'
 * pluralRu(3, 'упражнение', 'упражнения', 'упражнений') → 'упражнения'
 * pluralRu(10, 'упражнение', 'упражнения', 'упражнений') → 'упражнений'
 */
export function pluralRu(count, one, few, many) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}