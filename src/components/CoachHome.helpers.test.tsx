import { describe, expect, it } from 'vitest'
import { changeAction, changeTitle } from './weeklyReview'

describe('changeTitle', () => {
  it('uses exerciseName when present (most recognisable)', () => {
    expect(changeTitle({ exerciseName: 'Румынская тяга', type: 'adjust_volume' })).toBe('Румынская тяга')
  })

  it('trims whitespace from exerciseName', () => {
    expect(changeTitle({ exerciseName: '  Тяга в тренажёре  ', type: 'adjust_volume' })).toBe('Тяга в тренажёре')
  })

  it('falls back to the localised type with a capital letter when no exerciseName', () => {
    expect(changeTitle({ type: 'change_focus' })).toBe('Смена фокуса')
    expect(changeTitle({ type: 'add_deload' })).toBe('Разгрузка')
  })

  it('falls back gracefully for an unknown type', () => {
    expect(changeTitle({ type: 'something_new' })).toBe('Something_new')
  })
})

describe('changeAction', () => {
  it('returns the description unchanged when short enough', () => {
    const description = 'Снизить до 2 рабочих подходов'
    expect(changeAction({ description, type: 'adjust_volume' })).toBe(description)
  })

  it('truncates at a word boundary for long descriptions, never mid-word', () => {
    const description = 'Сократить румынскую тягу до двух рабочих подходов чтобы снизить утомляемость поясницы на третьей неделе мезоцикла'
    const result = changeAction({ description, type: 'adjust_volume' })
    expect(result.length).toBeLessThan(description.length)
    expect(result.endsWith('…')).toBe(true)
    // The char before '…' is the last letter of a kept word — never a partial word
    expect(result).toMatch(/[а-яёa-z]…$/iu)
    // And never a space before the ellipsis
    expect(result).not.toMatch(/\s…$/u)
  })

  it('returns empty string when description is missing or blank', () => {
    expect(changeAction({ type: 'adjust_volume' })).toBe('')
    expect(changeAction({ description: '   ', type: 'adjust_volume' })).toBe('')
  })
})
