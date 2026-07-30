import { describe, expect, it } from 'vitest'
import { concordance, pearson, rpeDistribution } from './analyze-rpe-validity.ts'

const set = (overrides) => ({
  userId: 'u1',
  sessionId: 's1',
  completedAt: '2026-07-25T10:00:00.000Z',
  exerciseId: 'bench',
  weight: 60,
  reps: 8,
  rpe: 7,
  ...overrides,
})

describe('rpeDistribution', () => {
  it('находит моду и её долю', () => {
    const result = rpeDistribution([set({ rpe: 7 }), set({ rpe: 7 }), set({ rpe: 7 }), set({ rpe: 8 })])
    expect(result.mode).toBe(7)
    expect(result.modalShare).toBeCloseTo(0.75)
  })
})

describe('concordance', () => {
  it('на одном весе больше повторов с большим RPE — пара согласна', () => {
    const result = concordance([set({ reps: 8, rpe: 7 }), set({ reps: 10, rpe: 8 })])
    expect(result).toMatchObject({ pairs: 1, concordant: 1, discordant: 0, tied: 0 })
    expect(result.rate).toBe(1)
  })

  it('больше повторов с меньшим RPE — пара несогласна', () => {
    const result = concordance([set({ reps: 8, rpe: 8 }), set({ reps: 10, rpe: 7 })])
    expect(result).toMatchObject({ concordant: 0, discordant: 1 })
    expect(result.rate).toBe(0)
  })

  it('одинаковый RPE при разных повторах — ничья, а не несогласие', () => {
    const result = concordance([set({ reps: 8, rpe: 7 }), set({ reps: 10, rpe: 7 })])
    expect(result).toMatchObject({ concordant: 0, discordant: 0, tied: 1 })
    expect(result.tieRate).toBe(1)
  })

  it('не сравнивает разные веса, разные упражнения и разных пользователей', () => {
    expect(concordance([set({ reps: 8 }), set({ reps: 10, weight: 70 })]).pairs).toBe(0)
    expect(concordance([set({ reps: 8 }), set({ reps: 10, exerciseId: 'squat' })]).pairs).toBe(0)
    expect(concordance([set({ reps: 8 }), set({ reps: 10, userId: 'u2' })]).pairs).toBe(0)
  })

  it('пропускает пары с одинаковым числом повторов — сравнивать нечего', () => {
    expect(concordance([set({ reps: 8, rpe: 7 }), set({ reps: 8, rpe: 9 })]).pairs).toBe(0)
  })
})

describe('pearson', () => {
  it('строгая обратная связь даёт -1', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
  })

  it('постоянный ряд даёт 0, а не NaN', () => {
    expect(pearson([7, 7, 7], [1, 2, 3])).toBe(0)
  })
})
