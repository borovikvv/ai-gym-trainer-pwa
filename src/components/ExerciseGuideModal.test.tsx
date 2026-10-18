import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exerciseGuideImageSrc, generatedExerciseGuideImages } from './ExerciseGuideModal'

describe('generatedExerciseGuideImages', () => {
  it('ссылается на существующие webp-файлы в public/', () => {
    const entries = Object.entries(generatedExerciseGuideImages)
    expect(entries.length).toBeGreaterThan(0)

    for (const [id, src] of entries) {
      expect(src.endsWith('.webp'), `${id} должен ссылаться на .webp: ${src}`).toBe(true)
      expect(existsSync(join(process.cwd(), 'public', src)), `${id}: нет файла public${src}`).toBe(true)
    }
  })
})

const ALL_EXERCISE_LIBRARY_IDS = [
  'arnold-press', 'assisted-pull-up', 'back-extension', 'bar-dips', 'barbell-curl',
  'barbell-overhead-press', 'barbell-row', 'barbell-squat', 'bench-dips', 'bench-press',
  'bulgarian-split-squat', 'cable-crossover', 'cable-curl', 'cable-lateral-raise',
  'cable-pull-through', 'cable-row', 'cable-triceps-pushdown', 'cable-woodchop',
  'calf-raise', 'captain-chair-knee-raise', 'chest-supported-row', 'conventional-deadlift',
  'db-shoulder-press', 'dead-bug', 'deadlift-machine-row', 'decline-bench-crunch',
  'dumbbell-bench-press', 'dumbbell-curl', 'dumbbell-fly', 'face-pull', 'hammer-curl',
  'hip-thrust', 'incline-db-press', 'lat-pulldown', 'lateral-raise-dumbbell',
  'leg-extension', 'leg-press', 'lying-leg-curl', 'machine-crunch', 'machine-lateral-raise',
  'machine-shoulder-press', 'overhead-triceps-extension', 'pallof-press', 'plank',
  'preacher-curl', 'pull-up', 'push-up', 'rear-delt-machine', 'rear-delt-raise-dumbbell',
  'romanian-deadlift', 'seated-calf-raise', 'side-plank', 'single-arm-dumbbell-row',
  'skull-crusher', 'walking-lunges',
]

// Упражнения, для которых иллюстрации пока нет: каждое со ссылкой на issue.
const PENDING_ILLUSTRATION = new Set(['back-extension']) // #478

describe('exerciseGuideImageSrc — у каждого упражнения справочника есть иллюстрация', () => {
  it.each(ALL_EXERCISE_LIBRARY_IDS.filter((id) => !PENDING_ILLUSTRATION.has(id)))(
    '%s ссылается на webp-иллюстрацию',
    (id) => {
      const src = exerciseGuideImageSrc(id)
      expect(src.endsWith('.webp')).toBe(true)
      expect(existsSync(join(process.cwd(), 'public', src))).toBe(true)
    },
  )

  it('исключения — только реальные id справочника без картинки', () => {
    for (const id of PENDING_ILLUSTRATION) {
      expect(ALL_EXERCISE_LIBRARY_IDS).toContain(id)
      expect(generatedExerciseGuideImages[id]).toBeUndefined()
    }
  })
})
