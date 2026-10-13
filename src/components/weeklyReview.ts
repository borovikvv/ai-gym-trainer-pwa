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

/** Issue #420: что недельный агент сделал с планом (запись из program_change_actions). */
export type AppliedActionLike = {
  id: string
  status: string
  before?: { setsCount: number } | null
  after?: { setsCount: number } | null
  safetyNote?: string | null
}

/** Строка о применении; пусто — изменение осталось предложением. */
export function appliedActionLabel(action?: AppliedActionLike | null): string {
  if (!action) return ''
  const before = action.before?.setsCount
  const after = action.after?.setsCount
  const sets = Number.isFinite(before) && Number.isFinite(after) ? `: подходов ${before} → ${after}` : ''
  switch (action.status) {
    case 'applied': return `применено${sets}`
    case 'clamped': return isNoOp(action)
      ? 'оставлено без изменений: объём уже на границе безопасного'
      : `применено с поправкой на безопасный объём${sets}`
    case 'reverted': return 'отменено'
    case 'unmatched': return 'не применено: упражнения нет в программе'
    default: return ''
  }
}

/** Машинный статус для разметки (data-status): не зависит от формулировок. */
export function appliedActionStatus(action?: AppliedActionLike | null): string {
  if (!action) return ''
  return action.status === 'clamped' && isNoOp(action) ? 'unchanged' : action.status
}

/** Отменить можно только то, что реально изменило план. */
export function canRevertAction(action?: AppliedActionLike | null): boolean {
  return Boolean(action?.id) && (action?.status === 'applied' || action?.status === 'clamped') && !isNoOp(action)
}

/** Гейт оставил прежнее число подходов: действие записано, но план не изменился. */
function isNoOp(action?: AppliedActionLike | null): boolean {
  const before = action?.before?.setsCount
  return Number.isFinite(before) && before === action?.after?.setsCount
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
