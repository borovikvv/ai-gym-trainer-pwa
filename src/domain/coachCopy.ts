export function toHumanCoachText(text = '') {
  const source = String(text).trim()
  if (!source) return ''

  const lower = source.toLowerCase()
  if (lower.includes('recoverystatus":"low') || lower.includes('восстановление low') || /readiness\s+([0-4]\d|5[0-4])\b/i.test(source)) {
    return 'Сегодня восстановление снижено. Делаем умеренную тренировку без отказа.'
  }

  if (lower.includes('восстановление ready') || lower.includes('recoverystatus":"ready') || /readiness\s+([7-9]\d|100)\b/i.test(source)) {
    return 'Восстановление в норме. Работаем по плану с контролируемой прогрессией.'
  }

  // Issue #57 regression: server-sent coachReason reaches CoachHome metadata
  // (via programApi.ts: description = workout.coachReason || ...) and renders
  // raw system narration. Strip every known internal sentence pattern; if
  // nothing human-readable remains, return '' so callers can hide the field.
  const cleaned = source
    .replace(/^Память тренера:\s*/u, '')
    .replace(/Профиль тренера:[^.]*\.\s*/giu, '')
    .replace(/Coach State[^.]*\.\s*/giu, '')
    // Issue #57 regression: also strip the rest of the server narration that
    // was visible on screen — "Прогноз календаря: ...", "Решение тренера: ...",
    // "Собрана ...", "Учитывается ...". These are LLM-prompt sentences, not
    // user-facing copy. Patterns are matched either up to the next dot OR
    // to end-of-string (some server sentences like "Решение тренера: Следующая"
    // have no trailing dot).
    .replace(/Прогноз календаря:[^.]*\.?\s*/giu, '')
    .replace(/Решение тренера:[^.]*\.?\s*/giu, '')
    .replace(/Собрана[^.]*\.?\s*/giu, '')
    .replace(/Учитывается[^.]*\.?\s*/giu, '')
    .replace(/Coach Engine/giu, 'тренер')
    .replace(/Coach Memory:?/giu, '')
    .replace(/LLM[-\s]?/giu, '')
    .replace(/\bbelow_plan\b/giu, '')
    .replace(/\babove_plan\b/giu, '')
    .replace(/\bready\b/giu, '')
    .replace(/\blow\b/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()

  return cleaned
}
