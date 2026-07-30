import { describe, expect, it } from 'vitest'
import {
  bodyWeightTrend,
  daysSinceLastMeasurement,
  shouldAskForBodyWeight,
} from './bodyWeight'

const m = (measuredOn: string, weightKg: number) => ({ measuredOn, weightKg })

describe('daysSinceLastMeasurement / shouldAskForBodyWeight', () => {
  it('считает дни от последнего замера, а не от первого', () => {
    expect(daysSinceLastMeasurement([m('2026-07-01', 80), m('2026-07-22', 80)], '2026-07-29')).toBe(7)
  })

  it('без замеров спрашивать пора', () => {
    expect(daysSinceLastMeasurement([], '2026-07-29')).toBeNull()
    expect(shouldAskForBodyWeight([], '2026-07-29')).toBe(true)
  })

  it('свежий замер карточку не показывает, семидневный — показывает', () => {
    expect(shouldAskForBodyWeight([m('2026-07-26', 80)], '2026-07-29')).toBe(false)
    expect(shouldAskForBodyWeight([m('2026-07-22', 80)], '2026-07-29')).toBe(true)
  })

  it('неотсортированный ряд не ломает расчёт', () => {
    expect(daysSinceLastMeasurement([m('2026-07-22', 80), m('2026-07-01', 79)], '2026-07-29')).toBe(7)
  })
})

describe('bodyWeightTrend', () => {
  it('без замеров тренда нет', () => {
    expect(bodyWeightTrend([])).toBeNull()
  })

  it('один замер: значение есть, направления нет', () => {
    const trend = bodyWeightTrend([m('2026-07-29', 80)])
    expect(trend?.averageKg).toBe(80)
    expect(trend?.direction).toBe('insufficient_data')
  })

  it('сглаживает суточные колебания: показывает среднее, а не последний замер', () => {
    // Замеры прыгают на ±1 кг вокруг 80, вес по сути стоит на месте.
    const trend = bodyWeightTrend([
      m('2026-07-01', 80), m('2026-07-08', 81), m('2026-07-15', 79), m('2026-07-22', 81),
    ])
    expect(trend?.latestKg).toBe(81)
    expect(trend?.averageKg).toBe(80.3)
    expect(trend?.direction).toBe('flat')
  })

  it('устойчивое снижение распознаётся как down', () => {
    const trend = bodyWeightTrend([
      m('2026-06-01', 84), m('2026-06-08', 83.4), m('2026-06-15', 82.8),
      m('2026-06-22', 82.2), m('2026-06-29', 81.5), m('2026-07-06', 80.9),
    ])
    expect(trend?.direction).toBe('down')
    expect(trend?.deltaKg).toBeLessThan(0)
  })

  it('сдвиг считается за окно тренда, а не за всю историю', () => {
    // Год назад человек весил 95 — к тому, что происходит сейчас, это
    // отношения не имеет. Сравниваем с точкой примерно месячной давности.
    const trend = bodyWeightTrend([
      m('2025-07-01', 95),
      m('2026-06-08', 81), m('2026-06-15', 80.8), m('2026-07-06', 80.4), m('2026-07-13', 80.2),
    ])
    // Среднее сейчас 80.3 против 80.9 месяцем раньше, а не против 95.
    expect(trend?.deltaKg).toBe(-0.6)
    expect(trend?.spanDays).toBe(28)
    expect(trend?.direction).toBe('down')
  })

  it('ряд короче окна сравнивается с первым замером', () => {
    const trend = bodyWeightTrend([m('2026-07-01', 80), m('2026-07-08', 81)])
    expect(trend?.deltaKg).toBe(0.5) // 80.5 против 80
    expect(trend?.spanDays).toBe(7)
  })

  it('устойчивый набор распознаётся как up', () => {
    const trend = bodyWeightTrend([
      m('2026-06-01', 78), m('2026-06-08', 78.5), m('2026-06-15', 79.1),
      m('2026-06-22', 79.6), m('2026-06-29', 80.2),
    ])
    expect(trend?.direction).toBe('up')
    expect(trend?.deltaKg).toBeGreaterThan(0)
  })

  it('окно скользящего среднего задано в днях: старые замеры из него выпадают', () => {
    // Замер трёхмесячной давности не должен тянуть последнее среднее вниз.
    const trend = bodyWeightTrend([m('2026-04-01', 70), m('2026-07-22', 80), m('2026-07-29', 80)])
    expect(trend?.averageKg).toBe(80)
  })

  it('пропуски в ряду не ломают расчёт', () => {
    // Между замерами 5 недель — окно просто оказывается из одной точки.
    const trend = bodyWeightTrend([m('2026-06-01', 82), m('2026-07-10', 80), m('2026-07-17', 80)])
    expect(trend?.points.map((point) => point.averageKg)).toEqual([82, 80, 80])
    expect(trend?.direction).toBe('down')
  })

  it('мусорные значения отбрасываются, а не превращаются в NaN', () => {
    const trend = bodyWeightTrend([
      m('2026-07-22', Number.NaN),
      m('', 80),
      m('2026-07-29', 0),
      m('2026-07-30', 80),
    ])
    expect(trend?.points).toEqual([{ measuredOn: '2026-07-30', averageKg: 80 }])
  })
})
