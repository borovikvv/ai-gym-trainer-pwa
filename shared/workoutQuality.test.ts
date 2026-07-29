import { describe, expect, it } from 'vitest'
import { computeWorkoutQualityScore } from './workoutQuality'

// Issue #162: до правки шкала была аддитивной и упиралась в кламп 100 —
// у всех 19 боевых записей qualityScore был ровно 100. Эти тесты фиксируют
// то, чего не хватало: нормировку по упражнениям, опору на выполнение плана
// и распределённость счёта по диапазону.

const plan = { setsCount: 3, repMin: 8, repMax: 12 }

/** Упражнение из N одинаковых выполненных подходов. */
function exercise({
  sets = 3,
  reps = 10,
  rpe = 8,
  planned = plan,
  pain = false,
  progressionType = 'hold',
}: {
  sets?: number
  reps?: number
  rpe?: number
  planned?: { setsCount: number; repMin: number; repMax: number } | null
  pain?: boolean
  progressionType?: string
} = {}) {
  return {
    pain,
    progressionType,
    planned,
    sets: Array.from({ length: sets }, () => ({ reps, rpe, completed: true })),
  }
}

describe('computeWorkoutQualityScore — граничные случаи', () => {
  it('идеальная тренировка: план выполнен, усилие рабочее, есть прогрессия → 100', () => {
    const score = computeWorkoutQualityScore({
      exercises: [
        exercise({ progressionType: 'increase' }),
        exercise({ progressionType: 'increase' }),
        exercise({ progressionType: 'increase' }),
      ],
    })
    expect(score).toBe(100)
  })

  it('безупречное выполнение без прогрессии не даёт 100 — последние баллы за прогресс', () => {
    const score = computeWorkoutQualityScore({
      exercises: [exercise(), exercise(), exercise()],
    })
    expect(score).toBe(90)
    expect(score).toBeLessThan(100)
  })

  it('провальная тренировка: план недобран, все подходы в отказ → низкий счёт', () => {
    const score = computeWorkoutQualityScore({
      exercises: [
        exercise({ sets: 1, reps: 4, rpe: 10 }),
        exercise({ sets: 1, reps: 4, rpe: 10 }),
      ],
    })
    expect(score).toBeLessThan(40)
    expect(score).toBeGreaterThan(0)
  })

  it('боль обваливает вклад упражнения, а не снимает несколько баллов', () => {
    const withoutPain = computeWorkoutQualityScore({ exercises: [exercise(), exercise()] })
    const withPain = computeWorkoutQualityScore({
      exercises: [exercise({ pain: true }), exercise()],
    })
    expect(withPain).toBeLessThan(70)
    expect(withoutPain - withPain).toBeGreaterThan(20)
  })

  it('нет выполненных подходов или упражнений → 0', () => {
    expect(computeWorkoutQualityScore({ exercises: [] })).toBe(0)
    expect(computeWorkoutQualityScore({})).toBe(0)
    expect(computeWorkoutQualityScore({
      exercises: [{ sets: [{ reps: 0, rpe: 8, completed: true }] }],
    })).toBe(0)
  })
})

describe('computeWorkoutQualityScore — нормировка (корень #162)', () => {
  it('длинная посредственная тренировка не обгоняет короткую качественную', () => {
    // Аддитивная шкала давала больше баллов просто за количество подходов:
    // шесть упражнений недогруза набирали больше, чем два выполненных точно.
    const shortExcellent = computeWorkoutQualityScore({
      exercises: [
        exercise({ sets: 2, planned: { setsCount: 2, repMin: 8, repMax: 12 } }),
        exercise({ sets: 2, planned: { setsCount: 2, repMin: 8, repMax: 12 } }),
      ],
    })
    const longMediocre = computeWorkoutQualityScore({
      exercises: Array.from({ length: 6 }, () =>
        exercise({ sets: 4, reps: 15, rpe: 6, planned: { setsCount: 4, repMin: 8, repMax: 12 } }),
      ),
    })
    expect(longMediocre).toBeLessThan(shortExcellent)
  })

  it('добавление ещё одного посредственного упражнения не поднимает счёт', () => {
    const base = [exercise(), exercise()]
    const before = computeWorkoutQualityScore({ exercises: base })
    const after = computeWorkoutQualityScore({
      exercises: [...base, exercise({ sets: 1, reps: 5, rpe: 10 })],
    })
    expect(after).toBeLessThan(before)
  })
})

describe('computeWorkoutQualityScore — выполнение плана', () => {
  it('недобор подходов снижает счёт при том же усилии', () => {
    const full = computeWorkoutQualityScore({ exercises: [exercise({ sets: 3 })] })
    const partial = computeWorkoutQualityScore({ exercises: [exercise({ sets: 1 })] })
    expect(partial).toBeLessThan(full)
  })

  it('повторы выше диапазона (вес занижен) — отклонение, но мягче недобора', () => {
    const inRange = computeWorkoutQualityScore({ exercises: [exercise({ reps: 10 })] })
    const above = computeWorkoutQualityScore({ exercises: [exercise({ reps: 20 })] })
    const below = computeWorkoutQualityScore({ exercises: [exercise({ reps: 3 })] })
    expect(above).toBeLessThan(inRange)
    expect(below).toBeLessThan(above)
  })

  it('без предписания счёт считается по усилию и остаётся валидным', () => {
    const score = computeWorkoutQualityScore({
      exercises: [exercise({ planned: null }), exercise({ planned: null })],
    })
    expect(score).toBe(90)
  })

  it('работа с весом тела и на время не штрафуется за нулевой объём', () => {
    // Планка и приседания без веса дают volume 0 — прошлая формула снимала
    // за это 20 баллов на совершенно нормальной тренировке.
    const score = computeWorkoutQualityScore({
      totalVolume: 0,
      exercises: [
        exercise({ planned: { setsCount: 3, repMin: 40, repMax: 60 }, reps: 50 }),
        exercise({ planned: { setsCount: 3, repMin: 12, repMax: 15 }, reps: 14 }),
      ],
    })
    expect(score).toBeGreaterThanOrEqual(80)
  })
})

describe('computeWorkoutQualityScore — распределение', () => {
  // Критерий из #162: если после правки >80% записей всё ещё в верхней
  // децили — шкала опять не работает.
  const representativeWorkouts = [
    // безупречная с прогрессией
    [exercise({ progressionType: 'increase' }), exercise({ progressionType: 'increase' })],
    // обычная рабочая: RPE 7-8, план выполнен
    [exercise({ rpe: 7 }), exercise({ rpe: 8 }), exercise({ rpe: 7 })],
    // недогруз: легко и выше диапазона
    [exercise({ rpe: 6, reps: 15 }), exercise({ rpe: 5, reps: 16 })],
    // тяжёлая: на грани отказа
    [exercise({ rpe: 9 }), exercise({ rpe: 10, reps: 6 })],
    // недобранная: половина подходов
    [exercise({ sets: 1 }), exercise({ sets: 2, rpe: 9 })],
    // с болью
    [exercise({ pain: true }), exercise({ rpe: 7 })],
  ]

  const scores = representativeWorkouts.map((exercises) => computeWorkoutQualityScore({ exercises }))

  it('счёт не залипает в верхней децили', () => {
    const topDecile = scores.filter((score) => score >= 90).length
    expect(topDecile / scores.length).toBeLessThanOrEqual(0.5)
  })

  it('разные тренировки получают заметно разные оценки', () => {
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(25)
    expect(new Set(scores).size).toBeGreaterThanOrEqual(5)
  })

  it('все оценки остаются в пределах 0..100', () => {
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })
})
