// Issue #471: миграция перепривязывает legacy-подходы замен пользователя oleg
// (4 id, не покрытые #459) к фактически выполненному упражнению и закрывает
// пробел в справочнике строкой machine-shoulder-press. Живой Postgres в CI
// недоступен, поэтому проверяем текст .sql-файла напрямую (прецедент —
// supabase/legacyAlternativeSetExerciseIds.test.js,
// supabase/exerciseLibraryBackExtension.test.js).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { normalizeExerciseName } from '../shared/exerciseIdentity.js'

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/2026-10-14_reassign_oleg_legacy_alternative_set_exercise_ids.sql',
  ),
  'utf-8',
)
const arnoldSql = readFileSync(
  resolve(process.cwd(), 'supabase/2026-06-07_expand_exercise_library.sql'),
  'utf-8',
)
const seedSql = readFileSync(resolve(process.cwd(), 'supabase/seed.sql'), 'utf-8')

const cases = [
  {
    prefix: 'deadlift-machine-row-alternative-горизонтальная-тяга-блока-replacement-',
    target: 'cable-row',
  },
  {
    prefix: 'captain-chair-knee-raise-alternative-скручивания-на-наклонной-скамье-replacement-',
    target: 'decline-bench-crunch',
  },
  {
    prefix: 'arnold-press-alternative-жим-в-тренажёре-replacement-',
    target: 'machine-shoulder-press',
  },
]

const rowMatch = migrationSql.match(/'(machine-shoulder-press)',\s*'([^']+)'/)
if (!rowMatch) throw new Error('не нашёл строку machine-shoulder-press в миграции #471')
const [, exerciseId, exerciseName] = rowMatch

function alternativeNames(sql, id) {
  const block = sql.slice(sql.indexOf(`'${id}'`))
  const dollar = block.match(/\$\$(\[[\s\S]*?\])\$\$::jsonb/)
  const quoted = block.match(/'(\[[\s\S]*?\])'::jsonb/)
  const raw = dollar?.[1] ?? quoted?.[1]
  if (!raw) throw new Error(`не нашёл alternatives у ${id}`)
  return JSON.parse(raw).map((alternative) => alternative.name)
}

describe('oleg legacy alternative set exercise_id reassignment (#471)', () => {
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
    // Три UPDATE — три хвоста `-replacement-<ts>`; якорь `$` берёт ts
    // последнего звена.
    const occurrences = migrationSql.match(/-replacement-\(\\d\+\)\$/g) ?? []
    expect(occurrences).toHaveLength(cases.length)
  })

  it('добавляет строку справочника machine-shoulder-press «Жим в тренажёре»', () => {
    expect(migrationSql).toMatch(/insert into public\.exercise_library/)
    expect(migrationSql).toContain("'machine-shoulder-press'")
    expect(migrationSql).toContain("'Жим в тренажёре'")
  })

  it('имя закрывает фантомную альтернативу arnold-press и db-shoulder-press', () => {
    const expected = normalizeExerciseName(exerciseName)
    const arnoldAlternatives = alternativeNames(arnoldSql, 'arnold-press').map(normalizeExerciseName)
    const dbAlternatives = alternativeNames(seedSql, 'db-shoulder-press').map(normalizeExerciseName)
    expect(arnoldAlternatives).toContain(expected)
    expect(dbAlternatives).toContain(expected)
  })
})
