import { describe, expect, it } from 'vitest'
import { toHumanCoachText } from './coachCopy'

describe('toHumanCoachText', () => {
  it('turns low readiness coach state into a short human recommendation', () => {
    expect(toHumanCoachText('Coach State на 2026-06-07: readiness 31, восстановление low, недельная нагрузка below_plan.')).toBe(
      'Сегодня восстановление снижено. Делаем умеренную тренировку без отказа.',
    )
  })

  it('turns ready recovery coach state into controlled progression language', () => {
    expect(toHumanCoachText('Профиль тренера: персональный силовой тренер. Coach State на 2026-06-09: readiness 85, восстановление ready.')).toBe(
      'Восстановление в норме. Работаем по плану с контролируемой прогрессией.',
    )
  })

  it('removes internal trainer markers while preserving useful exercise guidance', () => {
    expect(toHumanCoachText('Память тренера: Жим лёжа: закрепить текущий вес без отказа. LLM Coach Memory: below_plan')).toBe(
      'Жим лёжа: закрепить текущий вес без отказа.',
    )
  })

  // Issue #57 regression: real production coachReason captured from a user
  // screenshot (IMG_0849.png). The whole narration must be stripped — only
  // an empty string should remain so the UI can hide the metadata field.
  it('strips full server narration leaving no system text (issue #57 regression)', () => {
    const rawServerNarration = 'Профиль тренера: персональный силовой тренер с приоритетом безопасной прогрессии, восстановления и недельного баланса нагрузки. Coach State на 2026-06-28: readiness 85, восстановление ready, недельная нагрузка below_plan, фокус: Грудь, Спина, Руки. Собрана умеренная тренировка из наиболее свежих групп мышц. Учитывается разнообразие недели: соседние тренировки не должны быть одинаковыми. Прогноз календаря: пользовательский календарь даёт 2/2 тренировок за 7 дней, предыдущая за 6 дн. Решение тренера: Следующая'
    const result = toHumanCoachText(rawServerNarration)
    expect(result).not.toMatch(/Профиль тренера/i)
    expect(result).not.toMatch(/Coach State/i)
    expect(result).not.toMatch(/Прогноз календаря/i)
    expect(result).not.toMatch(/Решение тренера/i)
    expect(result).not.toMatch(/Собрана/i)
    expect(result).not.toMatch(/Учитывается/i)
    expect(result).not.toMatch(/below_plan/i)
    expect(result).not.toMatch(/readiness/i)
  })
})
