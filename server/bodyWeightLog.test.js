import { describe, expect, it, vi } from 'vitest'
import { isValidBodyWeight, loadBodyWeightLog, recordBodyWeight } from './bodyWeightLog.ts'

const fakeClient = (rows = []) => ({
  queries: [],
  query: vi.fn(function (text, params) {
    this.queries.push({ text, params })
    return Promise.resolve({ rows, rowCount: rows.length })
  }),
})

describe('isValidBodyWeight (#176)', () => {
  it('отбивает опечатку в поле ввода, а не выносит медицинское суждение', () => {
    expect(isValidBodyWeight(80)).toBe(true)
    expect(isValidBodyWeight('80.5')).toBe(true)
    expect(isValidBodyWeight(19)).toBe(false)
    expect(isValidBodyWeight(301)).toBe(false)
    expect(isValidBodyWeight('восемьдесят')).toBe(false)
    expect(isValidBodyWeight(null)).toBe(false)
  })
})

describe('recordBodyWeight (#176)', () => {
  it('пишет замер и обновляет последнее известное значение профиля', async () => {
    const client = fakeClient()
    const saved = await recordBodyWeight(client, { userId: 'vyacheslav', weightKg: 80.5, measuredOn: '2026-07-30' })

    expect(saved).toBe(true)
    expect(client.queries).toHaveLength(2)
    expect(client.queries[0].text).toContain('insert into public.body_weight_log')
    // Один замер в день: второй за те же сутки — уточнение, а не новая точка.
    expect(client.queries[0].text).toContain('on conflict (user_id, measured_on) do update')
    expect(client.queries[0].params).toEqual(['vyacheslav', '2026-07-30', 80.5])
    expect(client.queries[1].text).toContain('update public.user_profiles')
    // Замер задним числом не перетирает профиль более старым значением.
    expect(client.queries[1].text).toContain('not exists')
  })

  it('без даты пишет замер на сегодня', async () => {
    const client = fakeClient()
    await recordBodyWeight(client, { userId: 'vyacheslav', weightKg: 80 })

    expect(client.queries[0].text).toContain('current_date')
    expect(client.queries[0].params[1]).toBeNull()
  })

  it('мусорную дату не подставляет в запрос, а откатывается на сегодня', async () => {
    const client = fakeClient()
    await recordBodyWeight(client, { userId: 'vyacheslav', weightKg: 80, measuredOn: '30.07.2026' })

    expect(client.queries[0].params[1]).toBeNull()
  })

  it('значение вне границ не пишется вообще', async () => {
    const client = fakeClient()
    const saved = await recordBodyWeight(client, { userId: 'vyacheslav', weightKg: 0 })

    expect(saved).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('loadBodyWeightLog (#176)', () => {
  it('отдаёт ряд по возрастанию даты — так его ждёт расчёт тренда', async () => {
    const client = fakeClient([
      { measured_on: new Date('2026-07-29T00:00:00Z'), weight_kg: '80.5' },
      { measured_on: new Date('2026-07-22T00:00:00Z'), weight_kg: '81' },
    ])

    expect(await loadBodyWeightLog(client, 'vyacheslav')).toEqual([
      { measuredOn: '2026-07-22', weightKg: 81 },
      { measuredOn: '2026-07-29', weightKg: 80.5 },
    ])
  })
})
