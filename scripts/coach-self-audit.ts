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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbClient } from '../server/dbClient.js'
import type { LlmOutcome, LlmOutcomeReason } from '../server/activityLog.js'
import { buildAllMuscleVolumeSnapshots } from '../server/buildVolumeSnapshot.js'
import { loadRecentHistory, loadUserProfile } from '../server/services/programService.js'
import { buildAllExerciseE1RMHistories, e1rmOptionsForProfile } from '../src/domain/estimatedOneRepMax.js'
import { estimateRepsLostPerWeightStep } from '../src/domain/repsLostPerWeightStep.js'
import { getCanonicalExerciseId } from '../src/domain/exerciseIdentity.js'
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
 * Issue #413: причины облегчения (planned_workout_exercises.easing_reasons).
 * Здесь — полный список известных веток для branchAlarms: причина, не
 * сработавшая ни разу за 12 недель, помечается как мёртвая ветка.
 */
export const EASING_REASONS = ['deload', 'low_readiness', 'consolidate', 'teen_no_failure', 'avoid_max'] as const

/** Наблюдение без причины облегчения — не «причина не сработала», а «причины нет». */
export const NO_EASING_REASON = '__none__'

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

/**
 * Issue #426: столько исходов LLM-вызовов должно набраться у вызывающего,
 * чтобы судить о тревоге. На меньшем числе «ok = 0» и доля fallback ещё ничего
 * не значат.
 */
export const LLM_OUTCOME_MIN_SAMPLE = 10

/**
 * Issue #426: доля fallback, начиная с которой самоаудит бьёт тревогу. 50 % —
 * осознанный дефолт: истории исходов до #426 не существует, калибровать по
 * прод-данным невозможно. Отдельным issue после первого прогона, если порог
 * окажется шумным или слишком тихим.
 */
export const LLM_FALLBACK_SHARE_ALARM_THRESHOLD = 0.5

/**
 * Issue #427 (часть А): доля `maxTokens`, при превышении которой p99 длины
 * ответа уже не оставляет «запаса» в 10 %.
 */
export const LLM_MAX_TOKENS_HEADROOM = 0.9

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

function fmtMs(value: number | null): string {
  return value === null ? '-' : `${value} мс`
}

// --- Исходы LLM-вызовов (issue #426) ----------------------------------------

export interface LlmOutcomeEvent {
  caller: string
  outcome: LlmOutcome
  reason: LlmOutcomeReason | null
}

export interface LlmOutcomeCallerTally {
  total: number
  outcomes: Map<string, number>
  reasons: Map<string, number>
}

export type LlmOutcomeTally = Map<string, LlmOutcomeCallerTally>

/**
 * Разобрать одну строку журнала (`TRAINER_EVENT {…}`) в событие исхода
 * LLM-вызова. Возвращает null на любой мусор — постороннее событие, битый
 * JSON, неизвестный исход — и никогда не бросает исключение.
 */
export function parseLlmOutcomeLine(line: string): LlmOutcomeEvent | null {
  if (typeof line !== 'string') return null
  const marker = 'TRAINER_EVENT '
  const start = line.indexOf(marker)
  if (start === -1) return null
  let body: { event?: unknown; caller?: unknown; outcome?: unknown; reason?: unknown }
  try {
    body = JSON.parse(line.slice(start + marker.length).trim()) as typeof body
  } catch {
    return null
  }
  if (body?.event !== 'llm.outcome') return null
  const caller = typeof body.caller === 'string' ? body.caller : ''
  if (!caller) return null
  const outcome = body.outcome
  if (outcome !== 'ok' && outcome !== 'degraded' && outcome !== 'fallback') return null
  const reason = body.reason === null || body.reason === undefined ? null : (String(body.reason) as LlmOutcomeReason)
  return { caller, outcome, reason }
}

/** Сгруппировать исходы по вызывающему: всего, разбивка по исходам и причинам. */
export function tallyLlmOutcomes(events: LlmOutcomeEvent[]): LlmOutcomeTally {
  const tally: LlmOutcomeTally = new Map()
  for (const event of events) {
    const bucket = tally.get(event.caller) ?? { total: 0, outcomes: new Map<string, number>(), reasons: new Map<string, number>() }
    bucket.total += 1
    bump(bucket.outcomes, event.outcome)
    if (event.reason) bump(bucket.reasons, event.reason)
    tally.set(event.caller, bucket)
  }
  return tally
}

/**
 * Тревоги по одному вызывающему: мало данных — не судим; ноль `ok` за окно;
 * доля `fallback` не ниже порога; плюс топ-3 причины по частоте.
 */
export function llmOutcomeAlarms(caller: string, tally: LlmOutcomeCallerTally): string[] {
  if (tally.total < LLM_OUTCOME_MIN_SAMPLE) {
    return [`  ${caller}: мало данных (${tally.total} < ${LLM_OUTCOME_MIN_SAMPLE}), об исходах не судим`]
  }
  const alarms: string[] = []
  const okCount = tally.outcomes.get('ok') ?? 0
  if (okCount === 0) {
    alarms.push(`  ВЕТКА НЕ НАБЛЮДАЛАСЬ: ${caller} ok = 0 за окно (всего вызовов ${tally.total})`)
  }
  const fallbackShare = (tally.outcomes.get('fallback') ?? 0) / tally.total
  if (fallbackShare >= LLM_FALLBACK_SHARE_ALARM_THRESHOLD) {
    alarms.push(`  !!! ДОЛЯ FALLBACK: ${caller} ${fmtShare(fallbackShare)} ≥ ${fmtShare(LLM_FALLBACK_SHARE_ALARM_THRESHOLD)}`)
  }
  const top = [...tally.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (top.length > 0) {
    alarms.push(`  топ причин ${caller}: ${top.map(([reason, n]) => `${reason}: ${n}`).join(', ')}`)
  }
  return alarms
}

// --- Бюджеты LLM-вызовов (issue #427, часть А) ------------------------------

export interface LlmCallLine {
  caller: string; model: string; latencyMs: number
  ok: boolean; truncated: boolean
  completionTokens: number | null; maxTokens: number | null; timeoutMs: number | null
  reason: string | null
}

/** Строка журнала → событие `llm.call`; мусор, чужое событие и llm.outcome → null. */
export function parseLlmCallLine(line: string): LlmCallLine | null {
  if (typeof line !== 'string') return null
  const marker = 'TRAINER_EVENT '
  const start = line.indexOf(marker)
  if (start === -1) return null
  let body: Record<string, unknown>
  try {
    body = JSON.parse(line.slice(start + marker.length).trim()) as Record<string, unknown>
  } catch {
    return null
  }
  if (body.event !== 'llm.call') return null
  if (typeof body.latencyMs !== 'number' || !Number.isFinite(body.latencyMs)) return null
  const caller = typeof body.caller === 'string' ? body.caller : ''
  const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : '?'
  return {
    caller, model, latencyMs: body.latencyMs,
    ok: body.ok === true, truncated: body.truncated === true,
    completionTokens: finiteOrNull(body.completionTokens),
    maxTokens: finiteOrNull(body.maxTokens),
    timeoutMs: finiteOrNull(body.timeoutMs),
    reason: typeof body.reason === 'string' ? body.reason : null,
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** nearest-rank: отсортировать, взять `ceil(p/100 · n) − 1`; пустой → null. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]
}

export interface LlmCallBucket {
  caller: string; model: string; total: number
  latencies: number[]; completionTokens: number[]
  timeouts: number; truncated: number
  timeoutMs: number | null; maxTokens: number | null
}

export type LlmCallTally = Map<string, LlmCallBucket>

/** Корзины «вызывающий × модель»: completionTokens только из ok; timeoutMs/maxTokens — последнее ненулевое. */
export function tallyLlmCalls(events: LlmCallLine[]): LlmCallTally {
  const tally: LlmCallTally = new Map()
  for (const event of events) {
    const key = `${event.caller} × ${event.model}`
    const bucket = tally.get(key) ?? {
      caller: event.caller, model: event.model, total: 0,
      latencies: [], completionTokens: [], timeouts: 0, truncated: 0,
      timeoutMs: null, maxTokens: null,
    }
    bucket.total += 1
    bucket.latencies.push(event.latencyMs)
    if (event.ok && event.completionTokens !== null) bucket.completionTokens.push(event.completionTokens)
    if (event.reason === 'timeout') bucket.timeouts += 1
    if (event.truncated) bucket.truncated += 1
    if (event.timeoutMs !== null) bucket.timeoutMs = event.timeoutMs
    if (event.maxTokens !== null) bucket.maxTokens = event.maxTokens
    tally.set(key, bucket)
  }
  return tally
}

export interface LlmBudgetAlarm { code: string; line: string }

/** Тревоги по бюджетам пары «вызывающий × модель»; тесты проверяют `code`. */
export function llmBudgetAlarms(bucket: LlmCallBucket): LlmBudgetAlarm[] {
  const name = `${bucket.caller} × ${bucket.model}`
  if (bucket.total < LLM_OUTCOME_MIN_SAMPLE) {
    return [{ code: 'undersampled', line: `  ${name}: мало данных (${bucket.total} < ${LLM_OUTCOME_MIN_SAMPLE}), о бюджетах не судим` }]
  }
  const alarms: LlmBudgetAlarm[] = []
  const p99Latency = percentile(bucket.latencies, 99)
  if (bucket.timeoutMs === null) {
    alarms.push({ code: 'timeout_unknown', line: `  ${name}: таймаут в журнале не записан (старые события) — сверить с LLM_TIMEOUT_* вручную` })
  } else if (p99Latency !== null && p99Latency >= bucket.timeoutMs) {
    // задержка оборванного вызова ≈ таймауту: при таймаутах p99 — оценка снизу.
    alarms.push({ code: 'timeout_binding', line: `  !!! ТАЙМАУТ В УПОР: ${name} p99 ${p99Latency} мс ≥ таймаута ${bucket.timeoutMs} мс` })
  }
  if (bucket.truncated > 0) {
    alarms.push({ code: 'truncated', line: `  !!! ОБРЕЗАНО: ${name} обрезанных ответов ${bucket.truncated}` })
  }
  if (bucket.maxTokens !== null) {
    const p99Tokens = percentile(bucket.completionTokens, 99)
    if (p99Tokens !== null && p99Tokens > LLM_MAX_TOKENS_HEADROOM * bucket.maxTokens) {
      alarms.push({ code: 'max_tokens_headroom', line: `  !!! МАЛ ЗАПАС maxTokens: ${name} p99 токенов ${p99Tokens} > ${fmtShare(LLM_MAX_TOKENS_HEADROOM)} от maxTokens ${bucket.maxTokens}` })
    }
  }
  return alarms
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
 * Записи training_record за окно. Источник разреза по весу (issue #413) —
 * outcome.weightDeviation, который пишется в body (server/coachTrainingRecord.ts).
 * Один SQL-запрос на окно, не на каждую причину отдельно.
 */
export async function loadWeightAdherenceRecords(pool: PoolLike, weeks: number): Promise<WeightAdherenceRecord[]> {
  const { rows } = await pool.query(
    `select user_id, body
       from public.recommendations
      where recommendation_type = 'training_record'
        and created_at >= now() - ($1 || ' weeks')::interval`,
    [weeks],
  )
  return (rows as Array<{ user_id: string; body: string | null }>).map((row) => ({
    userId: String(row.user_id),
    body: row.body,
  }))
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

// --- Назначено и выполнено по весу (issue #413) -----------------------------

export type WeightBucket = 'heavier' | 'as_planned' | 'lighter'

/**
 * Бакет отклонения фактического рабочего веса от назначенного планом.
 * deviation = факт − назначение; null — числового назначения не было.
 */
export function weightBucket(deviation: number | null | undefined): WeightBucket | null {
  if (deviation === null || deviation === undefined) return null
  if (!Number.isFinite(deviation)) return null
  if (deviation > 0) return 'heavier'
  if (deviation < 0) return 'lighter'
  return 'as_planned'
}

export interface WeightAdherenceRecord {
  userId: string
  body: string | null
}

export interface WeightAdherenceTally {
  buckets: Map<string, number>
  repOutcomes: Map<string, number>
  byUser: Map<string, Map<string, number>>
  byReason: Map<string, Map<string, number>>
  reasonTotals: Map<string, number>
}

interface WeightDeviationBody {
  outcome?: {
    weightDeviation?: {
      exercises?: Array<{
        easingReasons?: string[]
        sets?: Array<{ deviation?: number | null; repOutcome?: string | null }>
      }>
    } | null
  } | null
}

/**
 * Свернуть записи training_record в разрезы «назначено и выполнено по весу».
 * Чистая функция: тестируется синтетическими body, без БД. Битый JSON
 * пропускается, а не роняет отчёт (как readClamped).
 */
export function tallyWeightAdherence(records: WeightAdherenceRecord[]): WeightAdherenceTally {
  const buckets = new Map<string, number>()
  const repOutcomes = new Map<string, number>()
  const byUser = new Map<string, Map<string, number>>()
  const byReason = new Map<string, Map<string, number>>()
  const reasonTotals = new Map<string, number>()

  for (const record of records) {
    let body: WeightDeviationBody
    try {
      body = JSON.parse(record.body ?? '') as WeightDeviationBody
    } catch {
      continue
    }
    const exercises = body?.outcome?.weightDeviation?.exercises ?? []
    for (const exercise of exercises) {
      const reasons = Array.isArray(exercise?.easingReasons) && exercise.easingReasons.length > 0
        ? exercise.easingReasons
        : [NO_EASING_REASON]
      for (const set of exercise?.sets ?? []) {
        const bucket = weightBucket(set?.deviation)
        if (bucket) {
          bump(buckets, bucket)
          bump(nested(byUser, record.userId), bucket)
          for (const code of reasons) bump(nested(byReason, code), bucket)
        }
        if (set?.repOutcome) bump(repOutcomes, set.repOutcome)
        // Знаменатель для branchAlarms: наблюдения на причину без '__none__'.
        for (const code of reasons) {
          if (code !== NO_EASING_REASON) bump(reasonTotals, code)
        }
      }
    }
  }

  return { buckets, repOutcomes, byUser, byReason, reasonTotals }
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function nested(map: Map<string, Map<string, number>>, key: string): Map<string, number> {
  const bucket = map.get(key)
  if (bucket) return bucket
  const created = new Map<string, number>()
  map.set(key, created)
  return created
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

/**
 * Текущий срез личной модели «потеря повторов на шаг веса» (#418, часть #415) —
 * без окна, как e1rmTrend: параметр не хранится в БД, считается заново из
 * истории при каждом вызове. Сигнал категориальный: basis = 'personal' или
 * 'fallback_general_norm'. Высокая доля отката к общей норме — это и есть
 * «откат виден в самоаудите» из требований issue.
 *
 * Собственных SQL-запросов не заводим: история читается теми же
 * loadRecentHistory/loadUserProfile, что и для e1rmTrend.
 */
async function loadCurrentRepsLostSnapshot(pool: DbClient): Promise<Array<string | null>> {
  const { rows } = await pool.query('select distinct user_id from public.workout_sessions')
  const values: Array<string | null> = []
  for (const row of rows as Array<{ user_id: string }>) {
    const userId = String(row.user_id)
    const history = await loadRecentHistory(pool, userId)
    const exerciseIds = new Set<string>()
    for (const session of history) {
      for (const exercise of session.exercises ?? []) {
        exerciseIds.add(getCanonicalExerciseId({ exerciseId: exercise.exerciseId }))
      }
    }
    for (const exerciseId of exerciseIds) {
      for (const setIndex of [1, 2, 3]) {
        values.push(estimateRepsLostPerWeightStep(history, { exerciseId, setIndex }).basis)
      }
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

    // Личная потеря повторов на шаг веса (#418) — тоже не оконная величина:
    // параметра в базе нет, срез пересчитывается из истории при каждом вызове.
    // Категориальный basis: personal vs откат к общей норме.
    const repsLostBasis = await loadCurrentRepsLostSnapshot(pool)
    lines.push('## repsLostPerWeightStep — текущий срез, без окна')
    lines.push('Личная потеря повторов на шаг веса (#418): не хранится, считается')
    lines.push('заново из истории. basis — категориальный сигнал; высокая доля')
    lines.push('fallback_general_norm означает откат к общей норме (в решение не идёт).')
    const repsLostStats = analyzeSignal(repsLostBasis)
    lines.push(...statsLine('repsLostPerWeightStep', repsLostStats))
    if (isUndersampled(repsLostStats)) {
      lines.push(`  мало данных: ${repsLostStats.filled} < ${DEGENERATE_MIN_SAMPLE}, о вырожденности не судим`)
    } else if (repsLostStats.mode === 'fallback_general_norm' && repsLostStats.modeShare >= DEGENERATE_MAX_MODAL_SHARE) {
      lines.push(
        `  !!! ОТКАТ К ОБЩЕЙ НОРМЕ: fallback_general_norm ${fmtShare(repsLostStats.modeShare)} ≥ ${fmtShare(DEGENERATE_MAX_MODAL_SHARE)}`,
      )
    } else {
      const personalShare = repsLostStats.mode === 'personal' ? repsLostStats.modeShare : 1 - repsLostStats.modeShare
      lines.push(`  личная модель доступна: personal ${fmtShare(personalShare)}`)
    }
    lines.push('')

    // Issue #426: исходы LLM-вызовов. Источник — выгрузка журнала
    // (TRAINER_EVENT, событие llm.outcome) в файл, как journalctl для
    // check-llm-health.sh: сам скрипт журнал не читает. Без SELF_AUDIT_LOG_FILE
    // раздел пропускается — это ожидаемо, выгрузка лога остаётся ручным шагом,
    // как и туннель к БД. Без этого раздела самоаудит исходы LLM не покажет.
    //
    // Issue #427 (часть А): из той же выгрузки строится раздел бюджетов,
    // поэтому файл читается один раз, а строки отдаются обоим парсерам.
    const auditLogFile = process.env.SELF_AUDIT_LOG_FILE
    const rawLogLines = auditLogFile && existsSync(auditLogFile)
      ? readFileSync(auditLogFile, 'utf8').split('\n')
      : null

    lines.push('## Исходы LLM-вызовов (журнал)')
    if (!auditLogFile) {
      lines.push('  источник не настроен (SELF_AUDIT_LOG_FILE), пропускаем')
    } else if (rawLogLines === null) {
      lines.push(`  файл журнала не найден: ${auditLogFile}, пропускаем`)
    } else {
      const events = rawLogLines
        .map(parseLlmOutcomeLine)
        .filter((event): event is LlmOutcomeEvent => event !== null)
      const outcomeTally = tallyLlmOutcomes(events)
      if (outcomeTally.size === 0) {
        lines.push('  событий llm.outcome не найдено')
      } else {
        for (const [caller, bucket] of outcomeTally) {
          lines.push(`  ${caller}: всего ${bucket.total}, исходы ${fmtCounts(bucket.outcomes)}; причины ${fmtCounts(bucket.reasons)}`)
          lines.push(...llmOutcomeAlarms(caller, bucket))
        }
      }
    }
    lines.push('')

    // Issue #427 (часть А): правило из DEPLOYMENT.md — таймаут ≥ p99 задержки,
    // `maxTokens` ≥ p99 длины ответа с запасом. Раздел только показывает.
    lines.push('## Бюджеты LLM-вызовов (журнал)')
    lines.push('Правило #427: таймаут вызывающего ≥ p99 задержки на его промптах,')
    lines.push('`maxTokens` ≥ p99 длины ответа с запасом 10 %.')
    if (!auditLogFile) {
      lines.push('  источник не настроен (SELF_AUDIT_LOG_FILE), пропускаем')
    } else if (rawLogLines === null) {
      lines.push(`  файл журнала не найден: ${auditLogFile}, пропускаем`)
    } else {
      const callTally = tallyLlmCalls(
        rawLogLines
          .map(parseLlmCallLine)
          .filter((event): event is LlmCallLine => event !== null),
      )
      if (callTally.size === 0) {
        lines.push('  событий llm.call не найдено')
      } else {
        for (const bucket of callTally.values()) {
          const p50 = percentile(bucket.latencies, 50)
          const p95 = percentile(bucket.latencies, 95)
          const p99 = percentile(bucket.latencies, 99)
          const p99Tokens = percentile(bucket.completionTokens, 99)
          lines.push(
            `  ${bucket.caller} × ${bucket.model}: вызовов ${bucket.total}; задержка p50 ${fmtMs(p50)} / p95 ${fmtMs(p95)} / p99 ${fmtMs(p99)} (таймаут ${fmtMs(bucket.timeoutMs)}); таймаутов ${bucket.timeouts}, обрезано ${bucket.truncated}; p99 токенов ${p99Tokens ?? '-'} (maxTokens ${bucket.maxTokens ?? '-'})`,
          )
          lines.push(...llmBudgetAlarms(bucket).map((alarm) => alarm.line))
        }
      }
    }
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

      // 3. Назначено и выполнено по весу (issue #413)
      lines.push('## 3. Назначено и выполнено по весу')
      lines.push('Источник: outcome.weightDeviation записи training_record (issue #267).')
      lines.push('Отклонение = факт − назначение; разрез идёт по рабочим подходам.')
      lines.push('')

      const weightTally = tallyWeightAdherence(await loadWeightAdherenceRecords(pool, weeks))
      lines.push('### 3.1. Вес относительно плана')
      lines.push(`  ${fmtCounts(weightTally.buckets)}`)
      lines.push('### 3.1. Исход по повторам при рабочем весе')
      lines.push(`  ${fmtCounts(weightTally.repOutcomes)}`)
      lines.push('')

      lines.push('### 3.2. Разрез по пользователю')
      if (weightTally.byUser.size === 0) {
        lines.push('  (пусто)')
      } else {
        for (const [userId, counts] of weightTally.byUser) lines.push(`  ${userId}: ${fmtCounts(counts)}`)
      }
      lines.push('')

      lines.push('### 3.3. Разрез по причине облегчения')
      if (weightTally.byReason.size === 0) {
        lines.push('  (пусто)')
      } else {
        for (const [reason, counts] of weightTally.byReason) lines.push(`  ${reason}: ${fmtCounts(counts)}`)
      }
      if (weeks === 12) lines.push(...branchAlarms(EASING_REASONS, weightTally.reasonTotals, 'easing_reason'))
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
