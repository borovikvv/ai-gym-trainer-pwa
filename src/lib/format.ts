/**
 * Unified client-side formatting utilities.
 *
 * Mirrors server/lib/format.js so that weights, plurals and rounding behave
 * identically on client and server. Use these instead of re-defining local
 * helpers in components, hooks, or domain modules.
 */

/**
 * Format a weight number for Russian locale display.
 * Uses Russian decimal comma: 40.5 → '40,5'.
 */
export function formatWeight(value: number): string {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

/**
 * Round a weight value to one decimal place (no trailing zeros in display).
 */
export function roundWeight(value: number): number {
  return Number(Number(value).toFixed(1))
}

/**
 * Russian plural forms helper.
 * pluralRu(1, 'упражнение', 'упражнения', 'упражнений') → 'упражнение'
 * pluralRu(3, 'упражнение', 'упражнения', 'упражнений') → 'упражнения'
 * pluralRu(10, 'упражнение', 'упражнения', 'упражнений') → 'упражнений'
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Format an ISO date string as "DD.MM, HH:MM" (Russian locale). */
export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return "дата неизвестна"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(" г.,", ",")
}

