import { describe, expect, it } from 'vitest'
import { matchesPainArea } from './painAreaMuscleMap.js'

describe('matchesPainArea', () => {
  it('присед с поясницей в target_muscles связан с болью «Спина»', () => {
    expect(matchesPainArea({ targetMuscles: ['квадрицепс', 'ягодицы', 'поясница', 'кор'] }, 'Спина')).toBe(true)
  })

  it('жим ногами без дельт не связан с болью «Плечо»', () => {
    expect(matchesPainArea({ targetMuscles: ['квадрицепс', 'ягодицы'] }, 'Плечо')).toBe(false)
  })

  it('жим лёжа с трицепсом связан с болью «Локоть/рука»', () => {
    expect(matchesPainArea({ targetMuscles: ['верх груди', 'средняя груди', 'передняя дельта', 'трицепс'] }, 'Локоть/рука')).toBe(true)
  })

  it('зона «Другое» не связывает ни с одним упражнением', () => {
    expect(matchesPainArea({ targetMuscles: ['квадрицепс', 'поясница'] }, 'Другое')).toBe(false)
  })

  it('упражнение без метаданных не связано ни с одной зоной', () => {
    expect(matchesPainArea({ targetMuscles: [] }, 'Спина')).toBe(false)
  })

  it('регистр ключа зоны не важен', () => {
    expect(matchesPainArea({ targetMuscles: ['поясница'] }, 'спина')).toBe(true)
  })
})