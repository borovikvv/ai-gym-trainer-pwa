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

/**
 * Issue #420: снимок числа подходов (adjust_volume / change_focus).
 * Issue #442: снимок слота упражнения (swap_exercise) — отличается наличием
 * exerciseName; по нему и выбираем формат строки.
 */
export type AppliedActionSnapshot = {
  setsCount?: number
  exerciseId?: string
  exerciseName?: string
  /** Issue #444: add_deload не меняет подходы — хранит назначенную неделю. */
  weekStart?: string
}

/** Issue #420: что недельный агент сделал с планом (запись из program_change_actions). */
export type AppliedActionLike = {
  id: string
  status: string
  before?: AppliedActionSnapshot | null
  after?: AppliedActionSnapshot | null
  safetyNote?: string | null
}

function hasExerciseSnapshot(action?: AppliedActionLike | null): boolean {
  return Boolean(action?.before?.exerciseName ?? action?.after?.exerciseName)
}

/** Строка о применении; пусто — изменение осталось предложением. */
export function appliedActionLabel(action?: AppliedActionLike | null): string {
  if (!action) return ''
  // Issue #444: назначение разгрузки агентом показывает неделю, а не подходы.
  if (action.status === 'applied' && action.after && 'weekStart' in action.after) {
    return `применено: неделя с ${action.after.weekStart} — разгрузка`
  }
  const before = action.before?.setsCount
  const after = action.after?.setsCount
  const beforeName = (action.before?.exerciseName ?? '').trim()
  const afterName = (action.after?.exerciseName ?? '').trim()
  // Issue #442: замена — показываем оба имени упражнения.
  const detail = beforeName && afterName
    ? `: ${beforeName} → ${afterName}`
    : Number.isFinite(before) && Number.isFinite(after)
      ? `: подходов ${before} → ${after}`
      : ''
  switch (action.status) {
    case 'applied': return `применено${detail}`
    case 'clamped': return isNoOp(action)
      ? 'оставлено без изменений: объём уже на границе безопасного'
      : `применено с поправкой на безопасный объём${detail}`
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

/**
 * Гейт оставил прежнее число подходов: действие записано, но план не изменился.
 * Замена упражнения никогда не no-op — она всегда меняет слот.
 */
function isNoOp(action?: AppliedActionLike | null): boolean {
  if (hasExerciseSnapshot(action)) return false
  const before = action?.before?.setsCount
  const after = action?.after && 'setsCount' in action.after ? action.after.setsCount : undefined
  return Number.isFinite(before) && before === after
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
