import { describe, it, expect } from 'vitest'
import { computeWorkoutReminder } from './services/reminderSchedule.ts'

// Даты — фиксированные ISO-литералы, без привязки к дням недели и без
// хардкода реальной даты (правило CLAUDE.md о тестах).
const TODAY = new Date('2026-07-10T12:00:00.000Z')

describe('computeWorkoutReminder (issue #347)', () => {
  it('напоминает о тренировке, запланированной на сегодня', () => {
    expect(computeWorkoutReminder({ status: 'planned', scheduledDate: '2026-07-10' }, TODAY)).toBe('train-today')
  })

  it('не напоминает, если тренировка уже выполнена', () => {
    expect(computeWorkoutReminder({ status: 'completed', scheduledDate: '2026-07-10' }, TODAY)).toBe('none')
  })

  it('предлагает перенос пропущенной тренировки без упрёка', () => {
    expect(computeWorkoutReminder({ status: 'missed', scheduledDate: '2026-07-09' }, TODAY)).toBe('missed-reschedule')
  })

  it('не напоминает о тренировке, которая ещё впереди', () => {
    expect(computeWorkoutReminder({ status: 'planned', scheduledDate: '2026-07-11' }, TODAY)).toBe('none')
  })

  it('не напоминает об отменённой тренировке на сегодня', () => {
    expect(computeWorkoutReminder({ status: 'cancelled', scheduledDate: '2026-07-10' }, TODAY)).toBe('none')
  })

  it('напоминает сегодня, если тренировка была перенесена на сегодня', () => {
    expect(computeWorkoutReminder({ status: 'moved', scheduledDate: '2026-07-10' }, TODAY)).toBe('train-today')
  })

  it('не напоминает о пропущенной, но уже закрытой статусом skipped тренировке', () => {
    expect(computeWorkoutReminder({ status: 'skipped', scheduledDate: '2026-07-09' }, TODAY)).toBe('none')
  })
})
