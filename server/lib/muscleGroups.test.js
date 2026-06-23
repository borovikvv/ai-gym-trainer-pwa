import { describe, expect, it } from 'vitest'
import {
  normalizeMuscleGroup,
  labelFor,
  labelForLower,
  MUSCLE_LABELS,
  CANONICAL_MUSCLE_KEYS,
} from './muscleGroups.js'

// ---------------------------------------------------------------------------
// normalizeMuscleGroup
// ---------------------------------------------------------------------------

describe('normalizeMuscleGroup', () => {
  describe('chest classification', () => {
    it('classifies bench press as chest', () => {
      expect(normalizeMuscleGroup('Жим лёжа')).toBe('chest')
      expect(normalizeMuscleGroup('bench press')).toBe('chest')
    })

    it('classifies dumbbell press as chest (regression: was "other" after Phase 1 dedup)', () => {
      expect(normalizeMuscleGroup('Жим гантелей')).toBe('chest')
    })

    it('classifies incline dumbbell press as chest', () => {
      expect(normalizeMuscleGroup('Жим гантелей на наклонной скамье')).toBe('chest')
    })

    it('classifies dumbbell fly as chest (via "груд")', () => {
      expect(normalizeMuscleGroup('Разведения гантелей для груди')).toBe('chest')
    })
  })

  describe('shoulders classification', () => {
    it('classifies Arnold press as shoulders (NOT chest, despite containing "жим")', () => {
      // 'Жим Арнольда' contains both 'жим' (chest alias) and 'арнольд'
      // (shoulders alias). Shoulders must win because the array order
      // checks shoulders before chest.
      expect(normalizeMuscleGroup('Жим Арнольда')).toBe('shoulders')
    })

    it('classifies lateral raise as shoulders', () => {
      expect(normalizeMuscleGroup('lateral raise')).toBe('shoulders')
      expect(normalizeMuscleGroup('lateral raise with cables')).toBe('shoulders')
    })

    it('classifies overhead press as shoulders', () => {
      expect(normalizeMuscleGroup('overhead press')).toBe('shoulders')
      expect(normalizeMuscleGroup('Жим гантелей стоя для плеч')).toBe('shoulders')
    })
  })

  describe('back classification', () => {
    it('classifies lat pulldown as back', () => {
      expect(normalizeMuscleGroup('Тяга верхнего блока')).toBe('back')
    })

    it('classifies barbell row as back', () => {
      expect(normalizeMuscleGroup('Тяга штанги в наклоне')).toBe('back')
      expect(normalizeMuscleGroup('barbell row')).toBe('back')
    })

    it('classifies deadlift as back (regression: was "other" after Phase 1 dedup)', () => {
      expect(normalizeMuscleGroup('Становая тяга')).toBe('back')
      expect(normalizeMuscleGroup('deadlift')).toBe('back')
    })
  })

  describe('legs classification', () => {
    it('classifies squats as legs', () => {
      expect(normalizeMuscleGroup('Приседания со штангой')).toBe('legs')
      expect(normalizeMuscleGroup('barbell squat')).toBe('legs')
    })

    it('classifies lunges as legs', () => {
      expect(normalizeMuscleGroup('Выпады с гантелями')).toBe('legs')
    })

    it('classifies leg press as legs (regression: was chest because "жим" matched first)', () => {
      expect(normalizeMuscleGroup('Жим ногами')).toBe('legs')
      expect(normalizeMuscleGroup('leg press')).toBe('legs')
    })
  })

  describe('arms classification', () => {
    it('classifies biceps curl as arms', () => {
      expect(normalizeMuscleGroup('Подъём штанги на бицепс')).toBe('arms')
      expect(normalizeMuscleGroup('barbell curl')).toBe('arms')
    })

    it('classifies triceps pushdown as arms', () => {
      expect(normalizeMuscleGroup('Трицепс на блоке')).toBe('arms')
      expect(normalizeMuscleGroup('triceps pushdown')).toBe('arms')
    })
  })

  describe('core classification', () => {
    it('classifies plank as core', () => {
      expect(normalizeMuscleGroup('Планка')).toBe('core')
      expect(normalizeMuscleGroup('plank')).toBe('core')
    })

    it('classifies dead bug as core', () => {
      expect(normalizeMuscleGroup('Мёртвый жук для кора')).toBe('core')
    })
  })

  describe('edge cases', () => {
    it('returns "other" for unknown exercises', () => {
      expect(normalizeMuscleGroup('Растяжка')).toBe('other')
      expect(normalizeMuscleGroup('Бег')).toBe('other')
    })

    it('returns "other" for empty/null/undefined', () => {
      expect(normalizeMuscleGroup('')).toBe('other')
      expect(normalizeMuscleGroup(null)).toBe('other')
      expect(normalizeMuscleGroup(undefined)).toBe('other')
    })

    it('is case-insensitive', () => {
      expect(normalizeMuscleGroup('BENCH PRESS')).toBe('chest')
      expect(normalizeMuscleGroup('Bench Press')).toBe('chest')
      expect(normalizeMuscleGroup('ЖИМ ЛЁЖА')).toBe('chest')
    })

    it('uses combined text from muscleGroup + name (typical call site)', () => {
      // Mirrors: normalizeMuscleGroup(`${exercise.muscleGroup} ${exercise.name}`)
      expect(normalizeMuscleGroup('Грудь Жим лёжа')).toBe('chest')
      expect(normalizeMuscleGroup('Спина Тяга верхнего блока')).toBe('back')
      expect(normalizeMuscleGroup('Плечи Жим Арнольда')).toBe('shoulders')
    })
  })
})

// ---------------------------------------------------------------------------
// labelFor / labelForLower
// ---------------------------------------------------------------------------

describe('labelFor', () => {
  it('returns Russian Title Case label for canonical keys', () => {
    expect(labelFor('chest')).toBe('Грудь')
    expect(labelFor('back')).toBe('Спина')
    expect(labelFor('legs')).toBe('Ноги')
    expect(labelFor('shoulders')).toBe('Плечи')
    expect(labelFor('arms')).toBe('Руки')
    expect(labelFor('core')).toBe('Кор')
    expect(labelFor('other')).toBe('Другое')
  })

  it('returns the input for unknown keys', () => {
    expect(labelFor('unknown')).toBe('unknown')
    expect(labelFor('')).toBe('')
  })
})

describe('labelForLower', () => {
  it('returns lowercase Russian label', () => {
    expect(labelForLower('chest')).toBe('грудь')
    expect(labelForLower('back')).toBe('спина')
    expect(labelForLower('shoulders')).toBe('плечи')
  })

  it('returns the input (lowercased) for unknown keys', () => {
    expect(labelForLower('Unknown')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('MUSCLE_LABELS', () => {
  it('has labels for all 7 keys including "other"', () => {
    expect(Object.keys(MUSCLE_LABELS).sort()).toEqual(
      ['arms', 'back', 'chest', 'core', 'legs', 'other', 'shoulders'],
    )
  })
})

describe('CANONICAL_MUSCLE_KEYS', () => {
  it('contains 6 keys without "other"', () => {
    expect(CANONICAL_MUSCLE_KEYS).toHaveLength(6)
    expect(CANONICAL_MUSCLE_KEYS).not.toContain('other')
  })

  it('contains all canonical groups', () => {
    expect(CANONICAL_MUSCLE_KEYS.sort()).toEqual(
      ['arms', 'back', 'chest', 'core', 'legs', 'shoulders'],
    )
  })
})
