/**
 * Client-side formatting utilities.
 *
 * Re-exports the shared helpers (shared/format.ts) and adds DOM-locale
 * helpers (formatDateTime, formatDayMonth) that have no server use.
 * Issue #147: the shared implementations live in shared/format.ts so
 * server and client stay in sync.
 */

export { formatWeight, roundWeight, pluralRu } from '../../shared/format'

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

/**
 * Format an ISO date(-only) string as "DD.MM" — no weekday, no time.
 * Parses the date-only portion directly so the result is stable across
 * timezones (unlike `new Date('2026-07-19')`, which can shift a day in UTC-N).
 * Used for compact labels like the pre-workout hero.
 */
export function formatDayMonth(isoDate: string): string {
  if (!isoDate) return isoDate
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!match) return isoDate
  const [, , month, day] = match
  return `${day}.${month}`
}
