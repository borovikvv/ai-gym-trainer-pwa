#!/usr/bin/env tsx
// Issue #266: недельный самоаудит коуча.
//
// Четыре бага августа (#248, #245, #246, #249) оказались одним дефектом: ветка
// решения мертва, потому что мёртв её вход, и никто этого не замечал месяцами.
// Пока коуч не проверяет сам себя, следующая мёртвая ветка найдётся так же.
//
// Этот скрипт — отчёт, который раз в неделю печатает состояние решений и
// сигналов. Он ТОЛЬКО ЧИТАЕТ базу: ничего не пишет и не меняет поведение
// коуча. Отчёт находит мёртвые ветки и вырожденные сигналы, а issue по ним
// заводит человек.
//
// Запуск (нужен туннель к боевой БД, см. reference/local-dev-runbook):
//   npx tsx --env-file=.env.local scripts/coach-self-audit.ts
//
// Результат — текстовый отчёт в OUT_DIR, по образцу check-training-records.sh.

import { Pool } from 'pg'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// --- Окна отчёта -------------------------------------------------------------

/** Окна анализа в неделях: 4 и 12. */
export const WINDOWS_WEEKS = [4, 12] as const

/** Шесть картин стагнации (shared/stagnationDiagnosis.ts). */
export const STAGNATION_PICTURES = [
  'insufficient_stimulus',
  'overload',
  'low_adherence',
  'energy_deficit',
  'local_limit',
  'normal_slowdown',
] as const

/** Значения решения по недельному объёму (weekly_volume_targets.action). */
export const VOLUME_ACTIONS = ['add', 'hold', 'cut'] as const

/**
 * Порог тревоги вырожденности сигнала. Любое из трёх — сигнал вырожден:
 *  - мода занимает ≥ 80 % значений;
 *  - различных значений ≤ 2;
 *  - заполненность < 30 %.
 */
export const DEGENERATE_MAX_MODAL_SHARE = 0.8
export const DEGENERATE_MAX_DISTINCT = 2
export const DEGENERATE_MIN_FILL = 0.3

// --- Чистая арифметика (проверяется в coach-self-audit.test.js) -------------

export interface SignalStats {
  total: number
  filled: number
  fillRate: number
  distinct: number
  min: number | null
  max: number | null
  mode: number | string | null
  modeShare: number
}

/**
 * Статистика сигнала по выборке с пропусками (null).
 * Пропуски не участвуют в min/max/моде, но участвуют в заполненности.
 * Числовые сигналы дают min/max; категориальные (строки) — только моду и
 * число различных значений.
 */
export function analyzeSignal(values: Array<number | string | null>): SignalStats {
  const filled = values.filter((value): value is number | string => value !== null && value !== undefined)
  const counts = new Map<number | string, number>()
  for (const value of filled) counts.set(value, (counts.get(value) ?? 0) + 1)

  let mode: number | string | null = null
  let best = 0
  for (const [value, count] of counts) {
    if (count > best) {
      best = count
      mode = value
    }
  }

  const numerics = filled.filter((value): value is number => typeof value === 'number')
  const distinct = counts.size
  const min = numerics.length > 0 ? Math.min(...numerics) : null
  const max = numerics.length > 0 ? Math.max(...numerics) : null

  return {
    total: values.length,
    filled: filled.length,
    fillRate: values.length > 0 ? filled.length / values.length : 0,
    distinct,
    min,
    max,
    mode,
    modeShare: filled.length > 0 ? best / filled.length : 0,
  }
}

/**
 * Вырожден ли сигнал: любое из трёх условий — да.
 * Мода ≥ 80 % значений, ИЛИ различных значений ≤ 2, ИЛИ заполненность < 30 %.
 */
export function isDegenerate(stats: SignalStats): boolean {
  return (
    stats.modeShare >= DEGENERATE_MAX_MODAL_SHARE ||
    stats.distinct <= DEGENERATE_MAX_DISTINCT ||
    stats.fillRate < DEGENERATE_MIN_FILL
  )
}

/** Причина вырожденности для отчёта (может быть несколько). */
export function degeneracyReasons(stats: SignalStats): string[] {
  const reasons: string[] = []
  if (stats.modeShare >= DEGENERATE_MAX_MODAL_SHARE) {
    reasons.push(`мода ${fmtShare(stats.modeShare)} ≥ ${fmtShare(DEGENERATE_MAX_MODAL_SHARE)}`)
  }
  if (stats.distinct <= DEGENERATE_MAX_DISTINCT) {
    reasons.push(`различных значений ${stats.distinct} ≤ ${DEGENERATE_MAX_DISTINCT}`)
  }
  if (stats.fillRate < DEGENERATE_MIN_FILL) {
    reasons.push(`заполненность ${fmtShare(stats.fillRate)} < ${fmtShare(DEGENERATE_MIN_FILL)}`)
  }
  return reasons
}

/**
 * Ветка, не сработавшая ни разу за 12 недель — кандидат в «ветка не наблюдалась».
 * known — все возможные значения ветки, counts — наблюдаемые за окно.
 */
export function unobservedBranches(known: readonly string[], counts: Map<string, number>): string[] {
  return known.filter((branch) => (counts.get(branch) ?? 0) === 0)
}

function fmtShare(value: number): string {
  return `${Math.round(value * 100)} %`
}

// --- Загрузка (только чтение) -----------------------------------------------

interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
}

async function loadActionCounts(pool: PoolLike, weeks: number): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select action, count(*)::int as n
       from public.weekly_volume_targets
      where created_at >= now() - ($1 || ' weeks')::interval
      group by action`,
    [weeks],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ action: string; n: number }>) counts.set(row.action, row.n)
  return counts
}

async function loadDiagnosisCounts(pool: PoolLike, weeks: number): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select coalesce(diagnosis, '__none__') as diagnosis, count(*)::int as n
       from public.mesocycle_block_goals
      where created_at >= now() - ($1 || ' weeks')::interval
      group by diagnosis`,
    [weeks],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ diagnosis: string; n: number }>) counts.set(row.diagnosis, row.n)
  return counts
}

interface DecisionLogCount {
  decisionType: string
  source: string
  clamped: boolean
  n: number
}

async function loadDecisionLogCounts(pool: PoolLike, weeks: number): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select decision_type, source,
            (coalesce(body ->> 'clamped', 'false') = 'true'
              or coalesce(body->'decision' ->> 'clamped', 'false') = 'true') as clamped,
            count(*)::int as n
       from public.recommendations
      where recommendation_type = 'coach_decision_log'
        and created_at >= now() - ($1 || ' weeks')::interval
      group by decision_type, source, clamped`,
    [weeks],
  )
  const counts = new Map<string, number>()
  for (const row of rows as DecisionLogCount[]) {
    const key = clampedKey(row.decisionType, row.source, row.clamped)
    counts.set(key, row.n)
  }
  return counts
}

function clampedKey(decisionType: string, source: string, clamped: boolean): string {
  return `${decisionType} × ${source}${clamped ? ' (кламп)' : ''}`
}

async function loadSignalValues(pool: PoolLike, weeks: number): Promise<Map<string, Array<number | string | null>>> {
  const since = `now() - ($1 || ' weeks')::interval`

  const values = new Map<string, Array<number | string | null>>()

  const readiness = await pool.query(
    `select
       readiness_check_in ->> 'energy'        as energy,
       readiness_check_in ->> 'sleepQuality'  as sleepQuality,
       readiness_check_in ->> 'stress'        as stress,
       readiness_check_in ->> 'soreness'      as soreness
       from public.workout_sessions
      where created_at >= ${since}`,
    [weeks],
  )
  for (const row of readiness.rows as Array<Record<string, string | null>>) {
    for (const key of ['energy', 'sleepQuality', 'stress', 'soreness'] as const) {
      const raw = row[key]
      const numeric = raw !== null && raw !== undefined && raw !== '' ? Number(raw) : null
      const value = Number.isFinite(numeric as number) ? (numeric as number) : raw
      push(values, `readiness.${key}`, value)
    }
  }

  const quality = await pool.query(
    `select quality_score from public.workout_sessions where created_at >= ${since}`,
    [weeks],
  )
  for (const row of quality.rows as Array<{ quality_score: number | null }>) {
    push(values, 'quality_score', row.quality_score ?? null)
  }

  const rpe = await pool.query(
    `select w.rpe from public.workout_sets w where w.created_at >= ${since}`,
    [weeks],
  )
  for (const row of rpe.rows as Array<{ rpe: number | null }>) {
    push(values, 'set.rpe', row.rpe ?? null)
  }

  const repDev = await pool.query(
    `select body ->> 'outcome' as outcome_json
       from public.recommendations
      where recommendation_type = 'training_record' and created_at >= ${since}`,
    [weeks],
  )
  for (const row of repDev.rows as Array<{ outcome_json: string | null }>) {
    push(values, 'avgRepDeviation', readAvgRepDeviation(row.outcome_json))
  }

  const e1rm = await pool.query(
    `select body as body_json
       from public.recommendations
      where recommendation_type = 'coach_decision_log' and created_at >= ${since}`,
    [weeks],
  )
  for (const row of e1rm.rows as Array<{ body_json: string | null }>) {
    for (const trend of readE1rmTrends(row.body_json)) {
      push(values, 'e1rmTrend', trend)
    }
  }

  return values
}

function push(values: Map<string, Array<number | string | null>>, key: string, value: number | string | null): void {
  const bucket = values.get(key)
  if (bucket) bucket.push(value)
  else values.set(key, [value])
}

/** avgDeviation из outcome.repDeviation записи training_record. */
function readAvgRepDeviation(outcomeJson: string | null): number | null {
  if (!outcomeJson) return null
  try {
    const outcome = JSON.parse(outcomeJson) as { repDeviation?: { avgDeviation?: number | null } | null }
    const avg = outcome.repDeviation?.avgDeviation
    return typeof avg === 'number' && Number.isFinite(avg) ? avg : null
  } catch {
    return null
  }
}

/** e1rmTrend из payload решения: inputs.coachState.volumeSnapshots.<группа>.e1rmTrend. */
function readE1rmTrends(bodyJson: string | null): Array<string | null> {
  if (!bodyJson) return []
  try {
    const body = JSON.parse(bodyJson) as {
      inputs?: { coachState?: { volumeSnapshots?: Record<string, { e1rmTrend?: string | null }> } }
    }
    const snapshots = body.inputs?.coachState?.volumeSnapshots ?? {}
    return Object.values(snapshots).map((snapshot) => snapshot.e1rmTrend ?? null)
  } catch {
    return []
  }
}

// --- Отчёт -------------------------------------------------------------------

function statsLine(label: string, stats: SignalStats): string[] {
  const min = stats.min ?? '-'
  const max = stats.max ?? '-'
  const mode = stats.mode ?? '-'
  return [
    `  ${label.padEnd(22)} заполнено ${stats.filled}/${stats.total} (${fmtShare(stats.fillRate)}), различных ${stats.distinct}, min ${min}, max ${max}, мода ${mode} (${fmtShare(stats.modeShare)})`,
  ]
}

function fmtCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return '(пусто)'
  return [...counts.entries()].map(([key, n]) => `${key}: ${n}`).join(', ')
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL не задан (нужен --env-file=.env.local и живой туннель)')

  const outDir = process.env.SELF_AUDIT_OUT_DIR ?? '/root/coach-self-audit'
  mkdirSync(outDir, { recursive: true })

  const pool = new Pool({ connectionString })
  const lines: string[] = []
  try {
    lines.push(`=== Недельный самоаудит коуча: ${new Date().toISOString().slice(0, 10)} ===`)
    lines.push('Ничего не меняет — только читает. Найденное заводит issue человек.')
    lines.push('')

    for (const weeks of WINDOWS_WEEKS) {
      lines.push(`# Окно: последние ${weeks} недель`)
      lines.push('')

      // 1. Распределение решений
      lines.push('## 1. Распределение решений')
      lines.push('')

      const actions = await loadActionCounts(pool, weeks)
      lines.push(`### weekly_volume_targets.action`)
      lines.push(`  ${fmtCounts(actions)}`)
      if (weeks === 12) {
        for (const branch of unobservedBranches(VOLUME_ACTIONS, actions)) {
          lines.push(`  ВЕТКА НЕ НАБЛЮДАЛАСЬ: action = '${branch}' за 12 недель`)
        }
      }
      lines.push('')

      const diagnoses = await loadDiagnosisCounts(pool, weeks)
      lines.push(`### mesocycle_block_goals.diagnosis (шесть картин стагнации)`)
      lines.push(`  ${fmtCounts(diagnoses)}`)
      if (weeks === 12) {
        for (const branch of unobservedBranches(STAGNATION_PICTURES, diagnoses)) {
          lines.push(`  ВЕТКА НЕ НАБЛЮДАЛАСЬ: diagnosis = '${branch}' за 12 недель`)
        }
      }
      lines.push('')

      const decisionLogs = await loadDecisionLogCounts(pool, weeks)
      lines.push(`### coach_decision_log.decision_type × source`)
      lines.push(`  ${fmtCounts(decisionLogs)}`)
      lines.push('')

      // 2. Вырожденность сигналов
      lines.push('## 2. Вырожденность сигналов')
      lines.push(`Порог: мода ≥ ${fmtShare(DEGENERATE_MAX_MODAL_SHARE)} ИЛИ различных ≤ ${DEGENERATE_MAX_DISTINCT} ИЛИ заполненность < ${fmtShare(DEGENERATE_MIN_FILL)}`)
      lines.push('')

      const signals = await loadSignalValues(pool, weeks)
      for (const [name, rawValues] of signals) {
        const stats = analyzeSignal(rawValues)
        lines.push(...statsLine(name, stats))
        if (isDegenerate(stats)) {
          lines.push(`  !!! СИГНАЛ ВЫРОЖДЕН: ${degeneracyReasons(stats).join('; ')}`)
        }
      }
      lines.push('')
    }

    const outFile = resolve(outDir, `coach-self-audit-${new Date().toISOString().slice(0, 10)}.txt`)
    writeFileSync(outFile, `${lines.join('\n')}\n`)
    console.log(lines.join('\n'))
    console.log(`\nSaved: ${outFile}`)
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
