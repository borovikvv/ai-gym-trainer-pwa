// Issue #459: миграция перепривязывает подходы legacy-замен к фактически
// выполненному упражнению. Живой Postgres в CI недоступен, поэтому проверяем
// текст .sql-файла напрямую (прецедент — supabase/exerciseLibraryFreshDb.test.js).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/2026-10-13_reassign_legacy_alternative_set_exercise_ids.sql',
  ),
  'utf-8',
)

const cases = [
  {
    prefix: 'skull-crusher-alternative-разгибание-рук-из-за-головы-replacement-',
    target: 'overhead-triceps-extension',
  },
  {
    prefix: 'cable-lateral-raise-alternative-разведение-в-тренажёре-replacement-',
    target: 'machine-lateral-raise',
  },
  {
    prefix: 'seated-calf-raise-alternative-икры-в-жиме-ногами-replacement-',
    target: 'икры-в-жиме-ногами',
  },
  {
    prefix: 'lying-leg-curl-alternative-сгибание-ног-сидя-replacement-',
    target: 'сгибание-ног-сидя',
  },
]

describe('legacy alternative set exercise_id reassignment (issue #459)', () => {
  it.each(cases)('reassigns $prefix to $target', ({ prefix, target }) => {
    const statement = migrationSql.match(
      new RegExp(
        `set exercise_id = '${target}-replacement-' \\|\\| substring\\(exercise_id from '-replacement-\\(\\\\d\\+\\)\\$'\\)` +
          `[\\s\\S]*?where exercise_id like '${prefix}%';`,
      ),
    )
    expect(statement).not.toBeNull()
  })

  it('keeps the last replacement timestamp suffix for uniqueness', () => {
    // Якорь `$` обязателен: для вложенной цепочки skull-crusher он берёт ts
    // последнего звена, а не первого. Четыре statement’а — четыре хвоста.
    const occurrences = migrationSql.match(/-replacement-\(\\d\+\)\$/g) ?? []
    expect(occurrences).toHaveLength(cases.length)
  })

  it('does not add rows to the exercise library', () => {
    expect(migrationSql).not.toMatch(/(insert into|update) public\.exercise_library/)
  })
})
