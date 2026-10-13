import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generatedExerciseGuideImages } from './ExerciseGuideModal'

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
