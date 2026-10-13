import { describe, expect, it, vi } from 'vitest'
import { loadUnavailableDates, markDateUnavailable } from './athleteAvailability.js'

describe('markDateUnavailable (#445)', () => {
  it('insert-ит дату с on conflict do nothing — повторная отметка не падает', async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }

    await markDateUnavailable(client, { userId: 'oleg', date: '2026-07-09' })

    const [text, params] = client.query.mock.calls[0]
    expect(text).toMatch(/insert into public\.athlete_unavailable_dates/i)
    expect(text).toMatch(/on conflict \(user_id, date\) do nothing/i)
    expect(params).toEqual(['oleg', '2026-07-09'])
  })
})

describe('loadUnavailableDates (#445)', () => {
  it('отдаёт даты YYYY-MM-DD за запрошенное окно', async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [{ date: new Date('2026-07-10T00:00:00.000Z') }, { date: '2026-07-11' }],
        rowCount: 2,
      })),
    }

    const dates = await loadUnavailableDates(client, 'oleg', '2026-07-06', '2026-07-12')

    expect(dates).toEqual(['2026-07-10', '2026-07-11'])
    const [text, params] = client.query.mock.calls[0]
    expect(text).toMatch(/from public\.athlete_unavailable_dates/i)
    expect(params).toEqual(['oleg', '2026-07-06', '2026-07-12'])
  })

  it('пустой результат — пустой массив', async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }
    expect(await loadUnavailableDates(client, 'oleg', '2026-07-06', '2026-07-12')).toEqual([])
  })
})
