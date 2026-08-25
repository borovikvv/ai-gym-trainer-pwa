import { describe, it, expect } from 'vitest'
import {
  diagnoseStagnation,
  MIN_STALL_WEEKS,
  SLOWDOWN_STALL_WEEKS,
  type StagnationSignals,
} from './stagnationDiagnosis'

const TODAY = '2026-07-30'

/** Стагнация есть, но ни одного отягчающего сигнала — база для картин. */
function signals(overrides: Partial<StagnationSignals> = {}): StagnationSignals {
  return {
    behindExpectedPace: true,
    weeksStalled: 3,
    adherence: 1,
    effortRising: false,
    energyLow: false,
    painSessions: 0,
    bodyWeightFalling: false,
    goalIsMass: false,
    localLimit: false,
    advanced: false,
    ...overrides,
  }
}

describe('диагноз ставится только на стагнации', () => {
  it('не ставится, пока факт не отстаёт от ожидаемого темпа', () => {
    expect(diagnoseStagnation(signals({ behindExpectedPace: false }), TODAY)).toBeNull()
  })

  it('не ставится раньше порога недель без прироста', () => {
    expect(diagnoseStagnation(signals({ weeksStalled: MIN_STALL_WEEKS - 1 }), TODAY)).toBeNull()
  })
})

describe('шесть картин разводятся', () => {
  it('недостаточный стимул: усилие низкое, самочувствие нормальное, боли нет', () => {
    const verdict = diagnoseStagnation(signals(), TODAY)
    expect(verdict?.diagnosis).toBe('insufficient_stimulus')
    expect(verdict?.action).toBe('add_volume')
    expect(verdict?.hypothesis).toBe(false)
  })

  it('перегрузка: усилие растёт на тех же весах и готовность снижена', () => {
    const verdict = diagnoseStagnation(signals({ effortRising: true, energyLow: true }), TODAY)
    expect(verdict?.diagnosis).toBe('overload')
    expect(verdict?.action).toBe('deload')
  })

  it('проблема не в программе: приверженность ниже порога', () => {
    const verdict = diagnoseStagnation(signals({ adherence: 0.5 }), TODAY)
    expect(verdict?.diagnosis).toBe('low_adherence')
    expect(verdict?.action).toBe('simplify')
  })

  it('энергетический дефицит: вес вниз при цели «масса»', () => {
    const verdict = diagnoseStagnation(signals({ bodyWeightFalling: true, goalIsMass: true }), TODAY)
    expect(verdict?.diagnosis).toBe('energy_deficit')
    expect(verdict?.action).toBe('hold')
  })

  it('локальный лимит: целевое движение стоит при прогрессе остальных', () => {
    const verdict = diagnoseStagnation(signals({ localLimit: true }), TODAY)
    expect(verdict?.diagnosis).toBe('local_limit')
    expect(verdict?.action).toBe('rotate_exercise')
  })

  it('нормальное замедление: высокий стаж, всё остальное в норме', () => {
    const verdict = diagnoseStagnation(signals({ advanced: true, weeksStalled: SLOWDOWN_STALL_WEEKS }), TODAY)
    expect(verdict?.diagnosis).toBe('normal_slowdown')
    expect(verdict?.action).toBe('hold')
  })
})

describe('противоположные действия при недостаточном стимуле и перегрузке', () => {
  it('одна и та же стагнация даёт add_volume или deload в зависимости от причины', () => {
    const understimulated = diagnoseStagnation(signals(), TODAY)
    const overloaded = diagnoseStagnation(signals({ effortRising: true, energyLow: true }), TODAY)
    expect(understimulated?.action).toBe('add_volume')
    expect(overloaded?.action).toBe('deload')
    expect(understimulated?.action).not.toBe(overloaded?.action)
  })

  it('перегрузка перевешивает недостаточный стимул: объём не добавляется при двух признаках потолка', () => {
    // Приверженность полная, вес стабилен — по всем прочим признакам это была
    // бы картина недостаточного стимула.
    const verdict = diagnoseStagnation(signals({ effortRising: true, painSessions: 1 }), TODAY)
    expect(verdict?.action).toBe('deload')
  })

  it('приверженность важнее прочих картин: не тренируется — программа ни при чём', () => {
    const verdict = diagnoseStagnation(signals({ adherence: 0.4, effortRising: true, energyLow: true }), TODAY)
    expect(verdict?.diagnosis).toBe('low_adherence')
  })
})

describe('правило неопределённости', () => {
  it('одного признака перегрузки мало — проверяется гипотеза о стимуле со сроком', () => {
    const verdict = diagnoseStagnation(signals({ energyLow: true }), TODAY)
    expect(verdict?.diagnosis).toBe('insufficient_stimulus')
    expect(verdict?.hypothesis).toBe(true)
    expect(verdict?.reviewOn).toBe('2026-08-06')
    expect(verdict?.note).toContain('проверка гипотезы')
  })

  it('без данных об усилии диагноз не выдаётся за окончательный', () => {
    const verdict = diagnoseStagnation(signals({ effortRising: null }), TODAY)
    expect(verdict?.diagnosis).toBe('insufficient_stimulus')
    expect(verdict?.hypothesis).toBe(true)
    expect(verdict?.note).toContain('не хватает данных')
  })

  it('без данных о самочувствии объём не добавляется — hold, а не add_volume', () => {
    const verdict = diagnoseStagnation(signals({ energyLow: null }), TODAY)
    expect(verdict?.diagnosis).toBe('insufficient_stimulus')
    expect(verdict?.action).toBe('hold')
    expect(verdict?.hypothesis).toBe(false)
    expect(verdict?.reviewOn).toBeNull()
  })

  it('у продвинутого стагнация сначала проверяется как гипотеза о стимуле', () => {
    const verdict = diagnoseStagnation(signals({ advanced: true, weeksStalled: SLOWDOWN_STALL_WEEKS - 1 }), TODAY)
    expect(verdict?.diagnosis).toBe('insufficient_stimulus')
  })
})

describe('текст для пользователя', () => {
  it('называет диагноз и действие', () => {
    const verdict = diagnoseStagnation(signals({ effortRising: true, energyLow: true }), TODAY)
    expect(verdict?.note).toContain('перегрузка')
    expect(verdict?.note).toContain('разгрузка')
  })

  it('окончательный диагноз не выдаётся за гипотезу', () => {
    const verdict = diagnoseStagnation(signals(), TODAY)
    expect(verdict?.reviewOn).toBeNull()
    expect(verdict?.note).not.toContain('гипотез')
  })
})
