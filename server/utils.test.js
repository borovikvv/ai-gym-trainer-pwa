import { describe, expect, it } from 'vitest'
import { normalizeProgramExercise, normalizeLibraryExercise } from './utils.js'

// Issue #173: направление веса — свойство справочника. Оно должно доезжать до
// клиента через нормализацию, иначе клиентские подсказки вынуждены определять
// направление разбором названия, а поле справочника остаётся мёртвым.
describe('normalizeProgramExercise — weight direction (#173)', () => {
  const row = {
    program_day_id: 'day-a',
    sort_order: 1,
    id: 'assisted-pull-up',
    program_exercise_id: 'pe-1',
    name: 'Подтягивания в гравитроне',
    muscle_group: 'Спина',
    sets_count: 3,
    rep_min: 6,
    rep_max: 10,
    target_weight: 35,
    weight_step: 5,
    rest_seconds: 90,
  }

  it('carries weight_direction through to weightDirection', () => {
    expect(normalizeProgramExercise({ ...row, weight_direction: 'assistance' }).weightDirection).toBe('assistance')
    expect(normalizeProgramExercise({ ...row, weight_direction: 'load' }).weightDirection).toBe('load')
  })

  it('is null when the catalog column is absent — consumers fall back to the name', () => {
    expect(normalizeProgramExercise(row).weightDirection).toBeNull()
  })
})

describe('normalizeLibraryExercise — weight direction (#173)', () => {
  it('carries weight_direction through to weightDirection', () => {
    const exercise = normalizeLibraryExercise({
      id: 'assisted-pull-up',
      name: 'Подтягивания в гравитроне',
      muscle_group: 'Спина',
      sets_count: 3,
      rep_min: 6,
      rep_max: 10,
      target_weight: 35,
      weight_step: 5,
      rest_seconds: 90,
      weight_direction: 'assistance',
    })
    expect(exercise.weightDirection).toBe('assistance')
  })
})
