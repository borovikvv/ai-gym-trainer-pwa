/**
 * Weekly program review — formatting helpers.
 *
 * Issue #104 (rev. 2026-07-20): review rows show the recognisable exercise
 * name as the title (most scannable), with the type + a short "what to do"
 * phrase as a subtitle — no mid-word truncation.
 */

export type ProgramChangeLike = {
  type: string
  description?: string
  exerciseName?: string
}

/** Маппинг типов правок с английского на русский. */
const TYPE_RU: Record<string, string> = {
  adjust_volume: 'объём',
  change_focus: 'смена фокуса',
  swap_exercise: 'замена',
  add_deload: 'разгрузка',
}

export function reviewTypeLabel(type: string): string {
  return TYPE_RU[type] || type
}

/** Title for a review row: the exercise name when present, else the localised type. */
export function changeTitle(change: ProgramChangeLike): string {
  const exercise = (change.exerciseName ?? '').trim()
  if (exercise) return exercise
  const label = reviewTypeLabel(change.type)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Short "what to do" subtitle, truncated at a word boundary (never mid-word). */
export function changeAction(change: ProgramChangeLike): string {
  const text = (change.description ?? '').trim()
  if (!text) return ''
  if (text.length <= 60) return text
  const slice = text.slice(0, 60)
  const lastSpace = slice.lastIndexOf(' ')
  const kept = (lastSpace > 30 ? slice.slice(0, lastSpace) : slice).trimEnd()
  return `${kept}…`
}
