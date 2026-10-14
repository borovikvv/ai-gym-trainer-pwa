// Issue #467: гиперэкстензия в справочнике. Миграция добавляет строку
// `back-extension`, которая закрывает и пробел в справочнике, и фантомную
// альтернативу cable-pull-through. В CI нет живого Postgres, поэтому .sql
// читается как текст, а значения извлекаются из самой миграции, чтобы тест не
// проверял сам себя. Функции — настоящие, из shared/, без моков.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { normalizeExerciseName } from '../shared/exerciseIdentity.js'
import { matchesPainArea } from '../shared/painAreaMuscleMap.js'
import { normalizeExerciseMuscleGroup } from '../shared/muscleGroups.js'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/2026-10-14_add_back_extension.sql'),
  'utf-8',
)
const pullThroughSql = readFileSync(
  resolve(process.cwd(), 'supabase/2026-06-07_expand_exercise_library.sql'),
  'utf-8',
)

const rowMatch = migrationSql.match(/'(back-extension)',\s*'([^']+)',\s*'([^']+)'/)
if (!rowMatch) throw new Error('не нашёл строку back-extension в миграции #467')
const [, exerciseId, exerciseName, muscleGroup] = rowMatch

const targetMusclesMatch = migrationSql.match(/array\[([^\]]+)\],\s*'hinge'/)
if (!targetMusclesMatch) throw new Error('не нашёл target_muscles в миграции #467')
const targetMuscles = [...targetMusclesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

function cablePullThroughAlternativeNames() {
  const block = pullThroughSql.slice(pullThroughSql.indexOf("'cable-pull-through'"))
  const alternativesMatch = block.match(/\$\$(\[[\s\S]*?\])\$\$::jsonb/)
  if (!alternativesMatch) throw new Error('не нашёл alternatives у cable-pull-through')
  return JSON.parse(alternativesMatch[1]).map((alternative) => alternative.name)
}

describe('back-extension migration (#467)', () => {
  it('использует id, совпадающий с фикстурой генератора', () => {
    expect(exerciseId).toBe('back-extension')
  })

  it('имя совпадает с альтернативой cable-pull-through — замена не уйдёт в слаг', () => {
    const alternativeNames = cablePullThroughAlternativeNames().map(normalizeExerciseName)
    expect(alternativeNames).toContain(normalizeExerciseName(exerciseName))
  })

  it('распознаётся как нагружающее спину при боли в зоне «спина»', () => {
    expect(matchesPainArea({ targetMuscles }, 'спина')).toBe(true)
  })

  it('muscle_group нормализуется в ноги, а не в спину', () => {
    expect(normalizeExerciseMuscleGroup(muscleGroup, exerciseName)).toBe('legs')
  })
})
