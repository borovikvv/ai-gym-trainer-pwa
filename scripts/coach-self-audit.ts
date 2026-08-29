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
import type { DbClient } from '../server/dbClient.js'
import { buildAllMuscleVolumeSnapshots } from '../server/buildVolumeSnapshot.js'
import { loadRecentHistory, loadUserProfile } from '../server/services/programService.js'
import { buildAllExerciseE1RMHistories, e1rmOptionsForProfile } from '../src/domain/estimatedOneRepMax.js'
import { CANONICAL_MUSCLE_KEYS } from '../shared/muscleGroups.js'

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

/**
 * Ниже этого числа заполненных значений о вырожденности не судим: на выборке
 * из трёх значений условие «различных ≤ 2» выполняется почти всегда, и окно в
 * 4 недели при двух пользователях кричало бы на каждый сигнал. Отчёт, который
 * кричит всегда, перестают читать — а это и есть отказ инструмента.
 *
 * «Мало данных» и «сигнал не различает» — разные состояния, и путать их здесь
 * нельзя ровно по той причине, ради которой заведён #266.
 */
export const DEGENERATE_MIN_SAMPLE = 10

/**
 * Столько решений должно набраться, чтобы «ветка не наблюдалась» что-то
 * значила. На пяти решениях большинство веток не наблюдается просто потому,
 * что решений мало, — и отчёт превращается в шум.
 */
export const BRANCH_MIN_SAMPLE = 10

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
 * e1rmTrend из снимка объёма. insufficient_data — sentinel домена
 * (src/domain/estimatedOneRepMax.ts), а не реальное значение тренда: если
 * считать его заполненным, заполненность и мода сигнала будут врать про то,
 * сколько данных реально есть.
 */
export function normalizeE1rmTrendValue(trend: string | null | undefined): string | null {
  if (trend === null || trend === undefined || trend === '') return null
  if (trend === 'insufficient_data') return null
  return trend
}

/**
 * Вырожден ли сигнал: любое из трёх условий — да.
 * Мода ≥ 80 % значений, ИЛИ различных значений ≤ 2, ИЛИ заполненность < 30 %.
 */
export function isDegenerate(stats: SignalStats): boolean {
  if (isUndersampled(stats)) return false
  return (
    stats.modeShare >= DEGENERATE_MAX_MODAL_SHARE ||
    stats.distinct <= DEGENERATE_MAX_DISTINCT ||
    stats.fillRate < DEGENERATE_MIN_FILL
  )
}

/** Заполненных значений слишком мало, чтобы судить о вырожденности. */
export function isUndersampled(stats: SignalStats): boolean {
  return stats.filled < DEGENERATE_MIN_SAMPLE
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

/** Сколько решений всего наблюдалось — знаменатель для суждения о ветках. */
export function totalObservations(counts: Map<string, number>): number {
  let total = 0
  for (const n of counts.values()) total += n
  return total
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

/**
 * Вид решения в БД отдельной колонкой НЕ хранится: storeCoachDecisionLog
 * (server/coachDecisionLog.ts:67) кладёт в recommendations только
 * user_id/session_id/recommendation_type/title/body/source, а decisionType
 * доходит лишь как один из трёх фиксированных заголовков. Поэтому группируем
 * по title. Отдельная колонка — тема отдельной задачи, здесь схему не трогаем.
 *
 * body — колонка типа text, а не jsonb (supabase/schema.sql), поэтому оператор
 * `->>` к ней неприменим: JSON разбирается на стороне JS.
 */
async function loadDecisionLogCounts(pool: PoolLike, weeks: number): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select title, source, body
       from public.recommendations
      where recommendation_type = 'coach_decision_log'
        and created_at >= now() - ($1 || ' weeks')::interval`,
    [weeks],
  )
  const counts = new Map<string, number>()
  for (const row of rows as Array<{ title: string; source: string; body: string | null }>) {
    const key = clampedKey(row.title, row.source, readClamped(row.body))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Кламп из payload решения. Отсутствие признака — не «клампа не было», а
 * «не записано»: третье состояние, и в ключ оно попадает отдельной пометкой.
 * Ровно та ошибка, ради которой заведён #266, — не схлопывать «нет данных» в
 * «нет события».
 */
export function readClamped(bodyJson: string | null): boolean | null {
  if (!bodyJson) return null
  try {
    const body = JSON.parse(bodyJson) as {
      clamped?: unknown
      decision?: { clamped?: unknown }
    }
    const flag = body.clamped ?? body.decision?.clamped
    return typeof flag === 'boolean' ? flag : null
  } catch {
    return null
  }
}

export function clampedKey(title: string, source: string, clamped: boolean | null): string {
  const mark = clamped === null ? ' (кламп не записан)' : clamped ? ' (кламп)' : ''
  return `${title} × ${source}${mark}`
}

export async function loadSignalValues(pool: PoolLike, weeks: number): Promise<Map<string, Array<number | string | null>>> {
  const since = `now() - ($1 || ' weeks')::interval`

  const values = new Map<string, Array<number | string | null>>()

  const readiness = await pool.query(
    `select
       readiness_check_in ->> 'energy'        as energy,
       readiness_check_in ->> 'sleepQuality'  as "sleepQuality",
       readiness_check_in ->> 'stress'        as stress,
       readiness_check_in ->> 'soreness'      as soreness
       from public.workout_sessions
      where completed_at >= ${since}`,
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
    `select quality_score from public.workout_sessions where completed_at >= ${since}`,
    [weeks],
  )
  for (const row of quality.rows as Array<{ quality_score: number | null }>) {
    push(values, 'quality_score', row.quality_score ?? null)
  }

  // У подходов своего completed_at нет, поэтому окно берётся от сессии:
  // created_at подхода — это момент вставки строки, а не время тренировки.
  const rpe = await pool.query(
    `select w.rpe
       from public.workout_sets w
       join public.workout_sessions s on s.id = w.session_id
      where s.completed_at >= ${since}`,
    [weeks],
  )
  for (const row of rpe.rows as Array<{ rpe: number | null }>) {
    push(values, 'set.rpe', row.rpe ?? null)
  }

  const repDev = await pool.query(
    `select body
       from public.recommendations
      where recommendation_type = 'training_record' and created_at >= ${since}`,
    [weeks],
  )
  for (const row of repDev.rows as Array<{ body: string | null }>) {
    push(values, 'avgRepDeviation', readAvgRepDeviation(row.body))
  }

  return values
}

function push(values: Map<string, Array<number | string | null>>, key: string, value: number | string | null): void {
  const bucket = values.get(key)
  if (bucket) bucket.push(value)
  else values.set(key, [value])
}

/** avgDeviation из outcome.repDeviation записи training_record. */
export function readAvgRepDeviation(bodyJson: string | null): number | null {
  if (!bodyJson) return null
  try {
    const body = JSON.parse(bodyJson) as { outcome?: { repDeviation?: { avgDeviation?: number | null } | null } | null }
    const avg = body.outcome?.repDeviation?.avgDeviation
    return typeof avg === 'number' && Number.isFinite(avg) ? avg : null
  } catch {
    return null
  }
}

/**
 * Текущий срез e1rmTrend — без окна. Выбор по issue #273 — вариант 2: убрать
 * величину из раздела вырожденности, а не дедуплицировать её.
 *
 * Раньше знаменатель раздувался числом обращений к коучу: значение читалось из
 * body каждой строки coach_decision_log, и 2988 = 582 строки лога × ~5 групп
 * мышц на снимок в среднем. При этом величина не оконная — buildMuscleVolumeSnapshot
 * пересчитывает её из полной истории при каждом обращении, хранимого тренда в
 * базе нет. Поэтому окно не подделываем: считаем текущий срез теми же
 * прод-функциями напрямую, один раз на пользователя × группу мышц, вне цикла
 * по окнам 4 и 12 недель.
 */
async function loadCurrentE1rmTrendSnapshot(pool: DbClient): Promise<Array<string | null>> {
  const { rows } = await pool.query('select distinct user_id from public.workout_sessions')
  const values: Array<string | null> = []
  for (const row of rows as Array<{ user_id: string }>) {
    const userId = String(row.user_id)
    const [profile, history] = await Promise.all([loadUserProfile(pool, userId), loadRecentHistory(pool, userId)])
    const e1rmHistories = buildAllExerciseE1RMHistories(history, e1rmOptionsForProfile(profile))
    const snapshots = buildAllMuscleVolumeSnapshots(history, e1rmHistories)
    for (const key of CANONICAL_MUSCLE_KEYS) {
      values.push(normalizeE1rmTrendValue(snapshots[key].e1rmTrend))
    }
  }
  return values
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

/**
 * Строки тревоги по веткам. На малой выборке молчим: «ветка не наблюдалась»
 * при пяти решениях означает только то, что решений было пять.
 */
function branchAlarms(known: readonly string[], counts: Map<string, number>, field: string): string[] {
  const total = totalObservations(counts)
  if (total < BRANCH_MIN_SAMPLE) {
    return [`  мало решений за 12 недель: ${total} < ${BRANCH_MIN_SAMPLE}, о непройденных ветках не судим`]
  }
  return unobservedBranches(known, counts).map(
    (branch) => `  ВЕТКА НЕ НАБЛЮДАЛАСЬ: ${field} = '${branch}' за 12 недель (всего решений ${total})`,
  )
}

function fmtCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return '(пусто)'
  return [...counts.entries()].map(([key, n]) => `${key}: ${n}`).join(', ')
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL не задан (нужен --env-file=.env.local и живой туннель)')

  // На сервере задаётся через SELF_AUDIT_OUT_DIR, как у check-training-records.sh.
  // Дефолт — рабочий каталог: скрипт проверяют прогоном через туннель с ноутбука,
  // где /root недоступен и mkdir падает раньше первого запроса к БД.
  const outDir = process.env.SELF_AUDIT_OUT_DIR ?? process.cwd()
  mkdirSync(outDir, { recursive: true })

  const pool = new Pool({ connectionString })
  const lines: string[] = []
  try {
    lines.push(`=== Недельный самоаудит коуча: ${new Date().toISOString().slice(0, 10)} ===`)
    lines.push('Ничего не меняет — только читает. Найденное заводит issue человек.')
    lines.push('')

    // e1rmTrend — не оконная величина: хранимого тренда в базе нет, снимок
    // пересчитывается из полной истории при каждом обращении. Поэтому он не
    // участвует в разделе вырожденности сигналов по окнам 4/12 недель ниже,
    // а печатается текущим срезом один раз (issue #273).
    const e1rmTrend = await loadCurrentE1rmTrendSnapshot(pool)
    lines.push('## e1rmTrend — текущий срез, без окна')
    lines.push('Величина не хранит историю и не привязана к числу обращений к')
    lines.push('коучу; о вырожденности по ней не судим (issue #273).')
    lines.push(...statsLine('e1rmTrend', analyzeSignal(e1rmTrend)))
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
      if (weeks === 12) lines.push(...branchAlarms(VOLUME_ACTIONS, actions, 'action'))
      lines.push('')

      const diagnoses = await loadDiagnosisCounts(pool, weeks)
      lines.push(`### mesocycle_block_goals.diagnosis (шесть картин стагнации)`)
      lines.push('  Оговорка: истории диагнозов в базе нет. Таблица держит одну')
      lines.push('  строку на блок, диагноз в ней перезаписывается, поэтому здесь')
      lines.push('  видно последнее значение каждого блока, а не все срабатывания.')
      lines.push(`  ${fmtCounts(diagnoses)}`)
      if (weeks === 12) lines.push(...branchAlarms(STAGNATION_PICTURES, diagnoses, 'diagnosis'))
      lines.push('')

      const decisionLogs = await loadDecisionLogCounts(pool, weeks)
      lines.push(`### coach_decision_log: вид решения (title) × source`)
      lines.push(`  ${fmtCounts(decisionLogs)}`)
      lines.push('')

      // 2. Вырожденность сигналов
      lines.push('## 2. Вырожденность сигналов')
      lines.push(`Порог: мода ≥ ${fmtShare(DEGENERATE_MAX_MODAL_SHARE)} ИЛИ различных ≤ ${DEGENERATE_MAX_DISTINCT} ИЛИ заполненность < ${fmtShare(DEGENERATE_MIN_FILL)}`)
      lines.push(`Судим начиная с ${DEGENERATE_MIN_SAMPLE} заполненных значений; меньше — «мало данных».`)
      lines.push('')

      const signals = await loadSignalValues(pool, weeks)
      for (const [name, rawValues] of signals) {
        const stats = analyzeSignal(rawValues)
        lines.push(...statsLine(name, stats))
        if (isUndersampled(stats)) {
          lines.push(`  мало данных: ${stats.filled} < ${DEGENERATE_MIN_SAMPLE}, о вырожденности не судим`)
        } else if (isDegenerate(stats)) {
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
