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

  return source
    .replace(/^Память тренера:\s*/u, '')
    .replace(/Профиль тренера:[^.]*\.\s*/giu, '')
    .replace(/Coach State[^.]*\.\s*/giu, '')
    .replace(/Coach Engine/giu, 'тренер')
    .replace(/Coach Memory:?/giu, '')
    .replace(/LLM[-\s]?/giu, '')
    .replace(/\bbelow_plan\b/giu, '')
    .replace(/\babove_plan\b/giu, '')
    .replace(/\bready\b/giu, '')
    .replace(/\blow\b/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
}
