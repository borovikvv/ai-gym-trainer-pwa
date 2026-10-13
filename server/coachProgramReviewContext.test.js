import { describe, expect, it, vi } from 'vitest'
import { buildPersonalModelNote, loadAthleteSignalsNote } from './coachProgramReviewContext.js'

const NOW = new Date('2026-07-09T12:00:00Z')
const programDays = [{ name: 'День A', exercises: [{ id: 'bench-press', name: 'Жим лёжа' }] }]

// Двенадцать сессий жима: 50 кг × 10, 55 × 8, 60 × 6 — личный наклон 0.4 повтора на кг.
function benchHistory(sessions) {
  const repsByWeight = { 50: 10, 55: 8, 60: 6 }
  return Array.from({ length: sessions }, (_, i) => {
    const weight = [50, 55, 60][i % 3]
    return {
      id: `s${i}`,
      userId: 'oleg',
      workoutDayId: 'd1',
      workoutDayName: 'День A',
      completedAt: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(),
      totalVolume: 0,
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        muscleGroup: 'Грудь',
        pain: false,
        sets: [{ weight, reps: repsByWeight[weight], completed: true }],
      }],
    }
  })
}

describe('buildPersonalModelNote (#420)', () => {
  it('показывает личную потерю повторов для упражнения программы', () => {
    const note = buildPersonalModelNote(benchHistory(12), programDays)
    expect(note).toContain('Жим лёжа: −0.40 повт. на +1 кг')
    expect(note).toContain('12 сессий')
  })

  it('без личных данных (откат к общей норме) блока нет', () => {
    expect(buildPersonalModelNote(benchHistory(4), programDays)).toBe('')
  })
})

describe('loadAthleteSignalsNote (#420)', () => {
  function clientWith(rows) {
    return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) }
  }

  it('переводит разобранные ответы в строки, «не разобрано» пропускает', async () => {
    const client = clientWith([
      {
        completed_at: new Date('2026-07-08T18:00:00Z'),
        post_workout_signal: {
          trigger: { exerciseName: 'Жим лёжа', deviation: -5 },
          signalType: 'pain',
          painLocation: 'плечо',
          confidence: 0.9,
        },
      },
      {
        completed_at: '2026-07-06T18:00:00.000Z',
        post_workout_signal: { trigger: { exerciseName: 'Присед', deviation: 5 }, signalType: 'easy' },
      },
      {
        completed_at: '2026-07-05T18:00:00.000Z',
        post_workout_signal: { trigger: { exerciseName: 'Тяга' }, signalType: 'unparsed' },
      },
    ])

    const note = await loadAthleteSignalsNote(client, 'oleg', NOW)

    expect(note).toContain('2026-07-08, Жим лёжа (-5 кг к плану): боль, плечо')
    expect(note).toContain('2026-07-06, Присед (+5 кг к плану): было легко')
    expect(note).not.toContain('Тяга')
    expect(client.query.mock.calls[0][1]).toEqual(['oleg', '2026-07-02T12:00:00.000Z'])
  })

  it('без ответов за неделю блока нет', async () => {
    expect(await loadAthleteSignalsNote(clientWith([]), 'oleg', NOW)).toBe('')
  })
})
