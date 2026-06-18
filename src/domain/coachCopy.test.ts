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
})
