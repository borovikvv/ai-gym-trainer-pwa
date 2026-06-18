import { describe, expect, it } from 'vitest'
import { dayTemplate } from './programTemplates.js'

describe('program day templates', () => {
  it('uses full body A/B templates for two trainings per week', () => {
    const dayA = dayTemplate(1, 2)
    const dayB = dayTemplate(2, 2)

    expect(dayA.label).toBe('Full Body A')
    expect(dayB.label).toBe('Full Body B')
    expect(dayA.exercises.map((exercise) => exercise[0])).toEqual([
      'bench-press',
      'lat-pulldown',
      'barbell-squat',
      'cable-row',
      'plank',
    ])
    expect(dayB.exercises.map((exercise) => exercise[0])).toEqual([
      'romanian-deadlift',
      'incline-db-press',
      'deadlift-machine-row',
      'db-shoulder-press',
      'walking-lunges',
    ])
  })
})
