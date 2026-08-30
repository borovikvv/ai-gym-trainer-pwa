import { describe, expect, it } from 'vitest'
import { getCanonicalExerciseId } from './exerciseIdentity'

describe('exercise identity', () => {
  it('resolves generated extra and replacement ids to the base exercise', () => {
    expect(getCanonicalExerciseId({ id: 'plank-extra-1780844823365', name: 'Планка' })).toBe('plank')
    expect(getCanonicalExerciseId({ id: 'dead-bug-extra-1780844563272', name: 'Dead bug' })).toBe('dead-bug')
    expect(getCanonicalExerciseId({ id: 'cable-curl-replacement-1780844563272', name: 'Сгибание рук на нижнем блоке' })).toBe('cable-curl')
  })

  it('uses explicit canonical ids before generated id cleanup', () => {
    expect(getCanonicalExerciseId({ id: 'custom-session-id', canonicalExerciseId: 'plank', name: 'Планка' })).toBe('plank')
  })

  it('strips alternative suffixes before extra/replacement timestamps (issue #286)', () => {
    expect(getCanonicalExerciseId({ id: 'seated-calf-raise-alternative-икры-в-жиме-ногами-replacement-1786124420031', name: 'Подъёмы на икры сидя' })).toBe('seated-calf-raise')
    expect(getCanonicalExerciseId({ id: 'cable-fly-alternative-svedeniya-v-krossovere', name: 'Сведение в кроссовере' })).toBe('cable-fly')
  })
})
