// Этап 1 (#166): недельный объём по группам — учёт факта, явная цель, сверка.
//
// У тренера был один горизонт — тренировка. Число подходов приходило из
// библиотеки упражнения (2–4) с поправкой на стиль, а решения «сколько объёма
// на группу за неделю» не существовало вовсе. При цели «масса» ноги получали
// порядка 2–3 рабочих подхода в неделю, и это никого не смущало, потому что
// величины, по которой это видно, в системе не было.
//
// Здесь появляется замкнутая петля: намерение на неделю (с обоснованием и
// датой) → факт → сверка в конце недели → правило изменения цели.
//
// Объём наращивается до появления признаков потолка, а не до заранее заданного
// числа: +1–2 подхода, пока производительность держится, крепатура успевает
// уйти и новых болей нет; держим при одном признаке; снимаем при двух и более.
//
// Оговорка (#166, комментарий владельца): сейчас все залогированные подходы
// рабочие. Когда тренер начнёт назначать разминку (#172), countCompletedSets
// должен начать отбрасывать разминочные — учёт объёма идёт только через него.

import type { CoachState, VolumeLandmark, WorkoutHistoryEntry } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import { CANONICAL_MUSCLE_KEYS, labelFor, normalizeExerciseMuscleGroup, normalizeMuscleGroup } from '../shared/muscleGroups.js'
import { countCompletedSets } from './buildVolumeSnapshot.js'
import { dateToDateOnly, startOfWeek } from './utils.js'
import { isWellbeingReported } from '../src/domain/readinessCheckIn.js'

export type VolumeAction = 'add' | 'hold' | 'cut'
export type WeeklyVolumeVerdict = 'undershoot' | 'hit' | 'overshoot'

export interface WeeklyVolumeTarget {
  id: string
  userId: string
  weekStart: string
  muscleKey: string
  targetSets: number
  reason: string
  previousTargetSets: number | null
  action: VolumeAction
  blockGoalId: string | null
  actualSets: number | null
  verdict: WeeklyVolumeVerdict | null
  reviewedAt: string | null
}

/** Факт по группе за одну календарную неделю. */
export interface MuscleWeekFacts {
  sets: number
  avgRpe: number | null
  /** Тренировок с отметкой боли на этой группе. */
  painSessions: number
  /** Чек-инов, где группа отмечена как забитая. */
  soreSessions: number
  sessions: number
}

export type WeeklyMuscleFacts = Record<string, MuscleWeekFacts>

// ---------------------------------------------------------------------------
// Учёт факта
// ---------------------------------------------------------------------------

/**
 * Рабочие подходы, средний RPE, боль и крепатура по группам за календарную
 * неделю [weekStart, weekEnd] (обе границы — даты YYYY-MM-DD, включительно).
 */
export function buildWeeklyMuscleFacts(
  history: WorkoutHistoryEntry[],
  weekStart: string,
  weekEnd: string,
): WeeklyMuscleFacts {
  const facts: WeeklyMuscleFacts = {}
  for (const key of CANONICAL_MUSCLE_KEYS) {
    facts[key] = { sets: 0, avgRpe: null, painSessions: 0, soreSessions: 0, sessions: 0 }
  }
  const rpeSums: Record<string, { sum: number; count: number }> = {}

  for (const session of history ?? []) {
    const day = String(session?.completedAt ?? '').slice(0, 10)
    if (!day || day < weekStart || day > weekEnd) continue

    const touched = new Set<string>()
    for (const exercise of session.exercises ?? []) {
      const key = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.exerciseName ?? '')
      if (!facts[key]) continue
      touched.add(key)
      facts[key].sets += countCompletedSets(exercise)
      if (exercise.pain) facts[key].painSessions += 1
      for (const set of exercise.sets ?? []) {
        const rpe = Number(set?.rpe)
        if (set?.completed === false || !Number.isFinite(rpe) || rpe <= 0) continue
        rpeSums[key] = rpeSums[key] ?? { sum: 0, count: 0 }
        rpeSums[key].sum += rpe
        rpeSums[key].count += 1
      }
    }
    for (const key of touched) facts[key].sessions += 1

    // Крепатура — из чек-ина готовности перед тренировкой. Нетронутый чек-ин
    // (дефолт) наблюдением не считается (#246): тумблер «забиты мышцы» меняет
    // soreness, поэтому несообщённое самочувствие не может нести крепатуру.
    if (isWellbeingReported(session.readinessCheckIn)) {
      for (const sore of session.readinessCheckIn?.soreMuscleGroups ?? []) {
        const key = normalizeMuscleGroup(String(sore))
        if (facts[key]) facts[key].soreSessions += 1
      }
    }
  }

  for (const [key, rpe] of Object.entries(rpeSums)) {
    if (rpe.count > 0) facts[key].avgRpe = Math.round((rpe.sum / rpe.count) * 10) / 10
  }
  return facts
}

// ---------------------------------------------------------------------------
// Правило изменения цели
// ---------------------------------------------------------------------------

export interface VolumeTargetDecision {
  muscleKey: string
  targetSets: number
  previousTargetSets: number | null
  action: VolumeAction
  delta: number
  reason: string
  /** Признаки приближения к потолку, найденные в факте. */
  ceilingSignals: string[]
}

interface DecideInput {
  muscleKey: string
  landmarks: VolumeLandmark | null
  /** Цель прошлой недели; null — цели ещё не было. */
  previousTarget: number | null
  /** Факт прошлой недели — на нём строится решение. */
  lastWeek: MuscleWeekFacts
  /** Факт позапрошлой недели — нужен для «усилие растёт на том же весе». */
  priorWeek?: MuscleWeekFacts | null
  /** Тренд e1RM по группе (coachState.volumeSnapshots). */
  e1rmTrend?: 'up' | 'down' | 'flat' | 'insufficient_data'
}

/** Крепатура держится, если группа отмечена забитой в двух чек-инах и более. */
const LINGERING_SORENESS_SESSIONS = 2

/** Рост среднего RPE на столько считаем ростом усилия на том же весе. */
const RPE_RISE = 1

/** Доля цели, ниже которой неделя считается недобранной — добавлять нечего. */
const UNDERSHOOT_RATIO = 0.9

/**
 * Решение по объёму на следующую неделю.
 * Объём растёт до появления признаков потолка, а не до заданного числа.
 */
export function decideWeeklyVolumeTarget({
  muscleKey,
  landmarks,
  previousTarget,
  lastWeek,
  priorWeek = null,
  e1rmTrend = 'insufficient_data',
}: DecideInput): VolumeTargetDecision {
  const mev = landmarks?.mev ?? 0
  const mrv = landmarks?.mrv ?? 99
  const label = labelFor(muscleKey)

  // Первая цель ставится от факта, а не от абстрактного числа: берём то, что
  // человек уже делает, но не ниже минимально работающего объёма.
  const base = previousTarget ?? clamp(Math.max(lastWeek.sets, mev), mev, mrv)

  const ceilingSignals: string[] = []
  if (e1rmTrend === 'down') ceilingSignals.push('производительность падает')
  if (lastWeek.soreSessions >= LINGERING_SORENESS_SESSIONS) ceilingSignals.push('крепатура не уходит')
  if (lastWeek.painSessions > 0) ceilingSignals.push('появилась боль')
  if (
    priorWeek?.avgRpe !== null && priorWeek?.avgRpe !== undefined
    && lastWeek.avgRpe !== null
    && lastWeek.avgRpe - priorWeek.avgRpe >= RPE_RISE
  ) {
    ceilingSignals.push('усилие выросло на тех же весах')
  }

  if (ceilingSignals.length >= 2) {
    const target = clamp(base - 1, mev, mrv)
    return decision({
      muscleKey, base, target, previousTarget, action: 'cut', ceilingSignals,
      reason: `${label}: ${ceilingSignals.join(', ')} — снимаем подход (${base} → ${target}).`,
    })
  }

  // Недобрали прошлую цель — добавлять нечего, сначала выполнить намеченное.
  if (previousTarget !== null && lastWeek.sets < previousTarget * UNDERSHOOT_RATIO) {
    return decision({
      muscleKey, base, target: clamp(base, mev, mrv), previousTarget, action: 'hold', ceilingSignals,
      reason: `${label}: за неделю ${lastWeek.sets} из ${previousTarget} подходов — держим цель, пока не выполняется.`,
    })
  }

  if (ceilingSignals.length === 1) {
    return decision({
      muscleKey, base, target: clamp(base, mev, mrv), previousTarget, action: 'hold', ceilingSignals,
      reason: `${label}: ${ceilingSignals[0]} — держим ${clamp(base, mev, mrv)} подходов, добавим на следующей неделе.`,
    })
  }

  if (e1rmTrend === 'insufficient_data' && previousTarget === null) {
    const target = clamp(base, mev, mrv)
    return decision({
      muscleKey, base, target, previousTarget, action: 'hold', ceilingSignals,
      reason: `${label}: первая цель по факту прошлой недели — ${target} подходов, дальше по сигналам.`,
    })
  }

  // Признаков потолка нет — растём. Ниже MEV догоняем быстрее: два подхода.
  const step = base < mev ? 2 : 1
  const target = clamp(base + step, mev, mrv)
  if (target === base) {
    return decision({
      muscleKey, base, target, previousTarget, action: 'hold', ceilingSignals,
      reason: `${label}: ${target} подходов — потолок восстановления (MRV), выше не идём.`,
    })
  }
  return decision({
    muscleKey, base, target, previousTarget, action: 'add', ceilingSignals,
    reason: `${label}: признаков перегрузки нет — добавляем ${target - base} подход(а) (${base} → ${target}).`,
  })
}

interface DecisionInput {
  muscleKey: string
  base: number
  target: number
  previousTarget: number | null
  action: VolumeAction
  reason: string
  ceilingSignals: string[]
}

function decision({ muscleKey, base, target, previousTarget, action, reason, ceilingSignals }: DecisionInput): VolumeTargetDecision {
  return { muscleKey, targetSets: target, previousTargetSets: previousTarget, action, delta: target - base, reason, ceilingSignals }
}

// ---------------------------------------------------------------------------
// Сверка факта с целью
// ---------------------------------------------------------------------------

/** Допуск попадания: один подход туда-сюда — это та же неделя. */
const HIT_TOLERANCE = 1

export function reconcileWeeklyVolume(targetSets: number, actualSets: number): { verdict: WeeklyVolumeVerdict; note: string } {
  const gap = actualSets - targetSets
  if (gap < -HIT_TOLERANCE) return { verdict: 'undershoot', note: `недобор: ${actualSets} из ${targetSets} подходов` }
  if (gap > HIT_TOLERANCE) return { verdict: 'overshoot', note: `перебор: ${actualSets} при цели ${targetSets}` }
  return { verdict: 'hit', note: `попали: ${actualSets} при цели ${targetSets}` }
}

// ---------------------------------------------------------------------------
// Хранение
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `id, user_id, week_start, muscle_key, target_sets, reason, previous_target_sets,
  action, block_goal_id, actual_sets, verdict, reviewed_at`

export async function loadWeeklyVolumeTargets(client: DbClient, userId: string, weekStart: string): Promise<Record<string, WeeklyVolumeTarget>> {
  const result = await client.query(
    `select ${SELECT_COLUMNS} from public.weekly_volume_targets
     where user_id = $1 and week_start = $2`,
    [userId, weekStart],
  )
  const targets: Record<string, WeeklyVolumeTarget> = {}
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const target = normalizeTargetRow(row)
    targets[target.muscleKey] = target
  }
  return targets
}

// ---------------------------------------------------------------------------
// Оркестрация
// ---------------------------------------------------------------------------

/** Недельная цель и то, сколько по ней уже сделано. */
export interface WeeklyVolumeStatus {
  muscleKey: string
  targetSets: number
  actualSets: number
  remainingSets: number
  reason: string
}

export interface SyncWeeklyVolumeResult {
  weekStart: string
  status: Record<string, WeeklyVolumeStatus>
  /** Сверки закрытых недель, сделанные этим вызовом. */
  reviewed: Array<{ weekStart: string; muscleKey: string; verdict: WeeklyVolumeVerdict; note: string }>
}

interface SyncInput {
  history: WorkoutHistoryEntry[]
  coachState: CoachState | null
  blockGoalId?: string | null
  now?: Date
}

/**
 * Держит недельные цели в актуальном состоянии: закрывает прошлые недели
 * сверкой факта с целью, ставит цели текущей неделе по правилу, возвращает
 * остаток цели — им пользуется планировщик сессии.
 */
export async function syncWeeklyVolumeTargets(client: DbClient, userId: string, input: SyncInput): Promise<SyncWeeklyVolumeResult> {
  const now = input.now ?? new Date()
  const weekStart = dateToDateOnly(startOfWeek(now))
  const landmarks = (input.coachState?.volumeLandmarkOverrides ?? {}) as Record<string, VolumeLandmark>
  const snapshots = input.coachState?.volumeSnapshots ?? {}

  // 1. Закрыть прошлые недели сверкой факта с целью.
  const reviewed = await reconcilePastWeeks(client, userId, weekStart, input.history)

  // 2. Поставить цели текущей неделе, если их ещё нет.
  let targets = await loadWeeklyVolumeTargets(client, userId, weekStart)
  if (Object.keys(targets).length === 0) {
    const lastWeekStart = shiftDays(weekStart, -7)
    const priorWeekStart = shiftDays(weekStart, -14)
    const lastWeek = buildWeeklyMuscleFacts(input.history, lastWeekStart, shiftDays(weekStart, -1))
    const priorWeek = buildWeeklyMuscleFacts(input.history, priorWeekStart, shiftDays(lastWeekStart, -1))
    const previousTargets = await loadWeeklyVolumeTargets(client, userId, lastWeekStart)
    for (const muscleKey of CANONICAL_MUSCLE_KEYS) {
      const decided = decideWeeklyVolumeTarget({
        muscleKey,
        landmarks: landmarks[muscleKey] ?? null,
        previousTarget: previousTargets[muscleKey]?.targetSets ?? null,
        lastWeek: lastWeek[muscleKey],
        priorWeek: priorWeek[muscleKey],
        e1rmTrend: snapshots[muscleKey]?.e1rmTrend,
      })
      await client.query(
        `insert into public.weekly_volume_targets
           (user_id, week_start, muscle_key, target_sets, reason, previous_target_sets, action, block_goal_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (user_id, week_start, muscle_key) do nothing`,
        [userId, weekStart, muscleKey, decided.targetSets, decided.reason, decided.previousTargetSets, decided.action, input.blockGoalId ?? null],
      )
    }
    targets = await loadWeeklyVolumeTargets(client, userId, weekStart)
  }

  // 3. Остаток текущей недели — им пользуется планировщик.
  const thisWeek = buildWeeklyMuscleFacts(input.history, weekStart, shiftDays(weekStart, 6))
  return { weekStart, status: buildWeeklyVolumeStatus(targets, thisWeek), reviewed }
}

/** Цель, факт и остаток по группам — вход планировщика сессии. */
export function buildWeeklyVolumeStatus(
  targets: Record<string, WeeklyVolumeTarget>,
  facts: WeeklyMuscleFacts,
): Record<string, WeeklyVolumeStatus> {
  const status: Record<string, WeeklyVolumeStatus> = {}
  for (const [muscleKey, target] of Object.entries(targets)) {
    const actualSets = facts[muscleKey]?.sets ?? 0
    status[muscleKey] = {
      muscleKey,
      targetSets: target.targetSets,
      actualSets,
      remainingSets: target.targetSets - actualSets,
      reason: target.reason,
    }
  }
  return status
}

/**
 * Остаток недельной цели на дату планирования — только чтение.
 * Цели ставит coach-хаб (loadCoachMemoryForUser); если для недели их ещё нет
 * (например, планируем будущую неделю), возвращается пусто и планировщик
 * работает как раньше.
 */
export async function loadWeeklyVolumeStatus(
  client: DbClient,
  userId: string,
  { history, now }: { history: WorkoutHistoryEntry[]; now: Date },
): Promise<Record<string, WeeklyVolumeStatus>> {
  const weekStart = dateToDateOnly(startOfWeek(now))
  const targets = await loadWeeklyVolumeTargets(client, userId, weekStart)
  if (Object.keys(targets).length === 0) return {}
  return buildWeeklyVolumeStatus(targets, buildWeeklyMuscleFacts(history, weekStart, shiftDays(weekStart, 6)))
}

async function reconcilePastWeeks(
  client: DbClient,
  userId: string,
  weekStart: string,
  history: WorkoutHistoryEntry[],
): Promise<SyncWeeklyVolumeResult['reviewed']> {
  const pending = await client.query(
    `select ${SELECT_COLUMNS} from public.weekly_volume_targets
     where user_id = $1 and week_start < $2 and reviewed_at is null
     order by week_start`,
    [userId, weekStart],
  )
  const reviewed: SyncWeeklyVolumeResult['reviewed'] = []
  const factsByWeek = new Map<string, WeeklyMuscleFacts>()
  for (const row of pending.rows as Array<Record<string, unknown>>) {
    const target = normalizeTargetRow(row)
    if (!factsByWeek.has(target.weekStart)) {
      factsByWeek.set(target.weekStart, buildWeeklyMuscleFacts(history, target.weekStart, shiftDays(target.weekStart, 6)))
    }
    const actualSets = factsByWeek.get(target.weekStart)?.[target.muscleKey]?.sets ?? 0
    const { verdict, note } = reconcileWeeklyVolume(target.targetSets, actualSets)
    await client.query(
      `update public.weekly_volume_targets
       set actual_sets = $3, verdict = $4, reviewed_at = now()
       where id = $1 and user_id = $2`,
      [target.id, userId, actualSets, verdict],
    )
    reviewed.push({ weekStart: target.weekStart, muscleKey: target.muscleKey, verdict, note })
  }
  return reviewed
}

// ---------------------------------------------------------------------------
// Формат для промптов
// ---------------------------------------------------------------------------

export function formatWeeklyVolumeForPrompt(status: Record<string, WeeklyVolumeStatus>): string {
  const rows = Object.values(status ?? {})
  if (rows.length === 0) return ''
  const lines = rows
    .sort((a, b) => b.remainingSets - a.remainingSets)
    .map((row) => `- ${labelFor(row.muscleKey)}: ${row.actualSets}/${row.targetSets} подходов${row.remainingSets > 0 ? `, осталось ${row.remainingSets}` : ''}`)
  return ['НЕДЕЛЬНЫЙ ОБЪЁМ (цель / факт на сегодня):', ...lines].join('\n')
}

// ---------------------------------------------------------------------------
// Внутреннее
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function shiftDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

function normalizeTargetRow(row: Record<string, unknown>): WeeklyVolumeTarget {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    weekStart: String((row.week_start as Date)?.toISOString?.()?.slice(0, 10) ?? row.week_start).slice(0, 10),
    muscleKey: String(row.muscle_key),
    targetSets: Number(row.target_sets),
    reason: String(row.reason),
    previousTargetSets: row.previous_target_sets === null || row.previous_target_sets === undefined ? null : Number(row.previous_target_sets),
    action: row.action as VolumeAction,
    blockGoalId: row.block_goal_id === null || row.block_goal_id === undefined ? null : String(row.block_goal_id),
    actualSets: row.actual_sets === null || row.actual_sets === undefined ? null : Number(row.actual_sets),
    verdict: row.verdict === null || row.verdict === undefined ? null : (row.verdict as WeeklyVolumeVerdict),
    reviewedAt: row.reviewed_at === null || row.reviewed_at === undefined ? null : String((row.reviewed_at as Date)?.toISOString?.() ?? row.reviewed_at),
  }
}
