import { describe, expect, it } from 'vitest'
import { normalizeProgramExercise, normalizeLibraryExercise, resolveSessionAnchor } from './utils.js'

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

// Issue #223: coachState/coachMemory считаются «на момент» плановой сессии, и
// этот момент был прибит к полудню UTC. Разрыв между тренировками меряется в
// часах, поэтому для вечернего графика полдень систематически съедал полсуток
// отдыха и двое суток превращались в «один день».
describe('resolveSessionAnchor — время суток плановой сессии (#223)', () => {
  it('ставит сессию на реальное время тренировок пользователя, а не на полдень', () => {
    const history = [
      { completedAt: '2026-08-07T17:30:00.000Z' },
      { completedAt: '2026-08-04T17:10:00.000Z' },
    ]

    expect(resolveSessionAnchor('2026-08-09', history).toISOString()).toBe('2026-08-09T17:30:00.000Z')
  })

  it('сохраняет двухдневный разрыв между вечерними сессиями', () => {
    const previousSession = '2026-08-07T19:00:00.000Z'
    const anchor = resolveSessionAnchor('2026-08-09', [{ completedAt: previousSession }])

    const hours = (anchor.getTime() - new Date(previousSession).getTime()) / 3_600_000
    // Полдень давал бы 41 час → floor = 1 день, хотя между тренировками двое суток.
    expect(Math.floor(hours / 24)).toBe(2)
  })

  it('без пригодной истории остаётся полдень — прежнее поведение', () => {
    expect(resolveSessionAnchor('2026-08-09', []).toISOString()).toBe('2026-08-09T12:00:00.000Z')
    expect(resolveSessionAnchor('2026-08-09', [{ completedAt: 'не дата' }]).toISOString()).toBe('2026-08-09T12:00:00.000Z')
  })

  it('не учитывает сессии после планируемой даты', () => {
    const history = [
      { completedAt: '2026-08-11T22:00:00.000Z' },
      { completedAt: '2026-08-07T19:00:00.000Z' },
    ]

    expect(resolveSessionAnchor('2026-08-09', history).toISOString()).toBe('2026-08-09T19:00:00.000Z')
  })
})
