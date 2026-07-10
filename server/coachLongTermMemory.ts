// Фаза 2 (план развития): долгосрочная память тренера и цели.
//
// В отличие от coachMemory.ts (статистическая «память», пересчитываемая из
// последних 16 тренировок), этот модуль хранит персистентные факты бессрочно:
// травмы, наблюдения о реакции на нагрузку, предпочтения, ограничения, вехи —
// и явные многонедельные цели. Факты пишет пост-тренировочная LLM-рефлексия
// (services/memoryReflectionService.ts) и сам пользователь через UI; читают
// все LLM-промпты через formatLongTermMemoryForPrompt.
//
// Правила безопасности данных:
// - максимум MAX_ACTIVE_FACTS активных фактов на пользователя (память не пухнет)
// - дедупликация по нормализованному содержимому
// - факты-травмы LLM архивировать НЕ может — только пользователь
import type { DbClient } from './dbClient.js'

export type MemoryFactKind = 'injury' | 'load_response' | 'preference' | 'constraint' | 'milestone'
export type MemoryFactSource = 'llm' | 'user' | 'rules'

export interface CoachMemoryFact {
  id: string
  userId: string
  kind: MemoryFactKind
  content: string
  status: 'active' | 'archived'
  source: MemoryFactSource
  confidence: number | null
  createdAt: string
  updatedAt: string
}

export type GoalMetric = 'e1rm' | 'working_weight' | 'reps_at_weight' | 'bodyweight' | 'habit'
export type GoalStatus = 'active' | 'achieved' | 'paused' | 'dropped'

export interface CoachGoal {
  id: string
  userId: string
  title: string
  exerciseId: string | null
  metric: GoalMetric
  targetValue: number | null
  targetDate: string | null
  status: GoalStatus
  progressNote: string | null
  createdAt: string
  updatedAt: string
}

export const MAX_ACTIVE_FACTS = 25
const FACT_KINDS: MemoryFactKind[] = ['injury', 'load_response', 'preference', 'constraint', 'milestone']

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadMemoryFacts(client: DbClient, userId: string, status: 'active' | 'archived' | 'all' = 'active'): Promise<CoachMemoryFact[]> {
  const statusFilter = status === 'all' ? '' : `and status = '${status}'`
  const result = await client.query(
    `select id, user_id, kind, content, status, source, confidence, created_at, updated_at
     from public.coach_memory_facts
     where user_id = $1 ${statusFilter}
     order by case kind when 'injury' then 0 else 1 end, created_at desc`,
    [userId],
  )
  return (result.rows as Array<Record<string, unknown>>).map(normalizeFactRow)
}

export async function loadGoals(client: DbClient, userId: string, status: GoalStatus | 'all' = 'active'): Promise<CoachGoal[]> {
  const statusFilter = status === 'all' ? '' : `and status = '${status}'`
  const result = await client.query(
    `select id, user_id, title, exercise_id, metric, target_value, target_date, status, progress_note, created_at, updated_at
     from public.coach_goals
     where user_id = $1 ${statusFilter}
     order by created_at desc`,
    [userId],
  )
  return (result.rows as Array<Record<string, unknown>>).map(normalizeGoalRow)
}

// ---------------------------------------------------------------------------
// Format for LLM prompts
// ---------------------------------------------------------------------------

// Жёсткий лимит на блок памяти в промпте: активные факты (травмы первыми,
// уже отсортированы запросом) и активные цели с прогрессом.
// ~500 токенов ≈ 1800 символов русского текста.
const PROMPT_BLOCK_CHAR_LIMIT = 1800

const KIND_LABELS: Record<MemoryFactKind, string> = {
  injury: 'травма/боль',
  load_response: 'реакция на нагрузку',
  preference: 'предпочтение',
  constraint: 'ограничение',
  milestone: 'веха',
}

export function formatLongTermMemoryForPrompt(facts: CoachMemoryFact[], goals: CoachGoal[]): string {
  const lines: string[] = []
  const activeFacts = facts.filter((fact) => fact.status === 'active')
  if (activeFacts.length) {
    lines.push('ПАМЯТЬ ТРЕНЕРА О ПОЛЬЗОВАТЕЛЕ:')
    for (const fact of activeFacts) {
      const line = `- [${KIND_LABELS[fact.kind]}] ${fact.content}`
      if (joinedLength(lines) + line.length > PROMPT_BLOCK_CHAR_LIMIT) break
      lines.push(line)
    }
  }
  const activeGoals = goals.filter((goal) => goal.status === 'active')
  if (activeGoals.length && joinedLength(lines) < PROMPT_BLOCK_CHAR_LIMIT) {
    lines.push('ЦЕЛИ ПОЛЬЗОВАТЕЛЯ:')
    for (const goal of activeGoals) {
      const deadline = goal.targetDate ? ` к ${goal.targetDate}` : ''
      const progress = goal.progressNote ? ` — ${goal.progressNote}` : ''
      const line = `- ${goal.title}${deadline}${progress}`
      if (joinedLength(lines) + line.length > PROMPT_BLOCK_CHAR_LIMIT) break
      lines.push(line)
    }
  }
  return lines.join('\n')
}

function joinedLength(lines: string[]): number {
  return lines.reduce((sum, line) => sum + line.length + 1, 0)
}

/**
 * Удобный вход для всех LLM-промптов: загрузить активные факты и цели и
 * отрендерить компактный блок. Пустая строка = памяти пока нет. Ошибки БД
 * (например, миграция ещё не применена) не роняют вызывающий код.
 */
export async function loadLongTermMemoryBlock(client: DbClient, userId: string): Promise<string> {
  try {
    const [facts, goals] = await Promise.all([
      loadMemoryFacts(client, userId, 'active'),
      loadGoals(client, userId, 'active'),
    ])
    return formatLongTermMemoryForPrompt(facts, goals)
  } catch (error) {
    console.warn('loadLongTermMemoryBlock failed (non-fatal):', error instanceof Error ? error.message : error)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Apply LLM-proposed updates (validated)
// ---------------------------------------------------------------------------

export interface MemoryFactOperation {
  op: 'add' | 'update' | 'archive'
  id?: string
  kind?: MemoryFactKind
  content?: string
  confidence?: number
}

export interface ApplyMemoryUpdatesResult {
  added: number
  updated: number
  archived: number
  rejected: Array<{ op: MemoryFactOperation; reason: string }>
}

export async function applyMemoryUpdates(
  client: DbClient,
  userId: string,
  operations: MemoryFactOperation[],
  source: MemoryFactSource = 'llm',
): Promise<ApplyMemoryUpdatesResult> {
  const result: ApplyMemoryUpdatesResult = { added: 0, updated: 0, archived: 0, rejected: [] }
  if (!Array.isArray(operations) || operations.length === 0) return result

  const existing = await loadMemoryFacts(client, userId, 'all')
  const activeFacts = existing.filter((fact) => fact.status === 'active')
  const byId = new Map(existing.map((fact) => [fact.id, fact]))
  const activeNormalized = new Set(activeFacts.map((fact) => normalizeContent(fact.content)))
  let activeCount = activeFacts.length

  // LLM может предложить не больше нескольких операций за раз — защищаемся
  // от прожорливых ответов.
  for (const op of operations.slice(0, 10)) {
    if (op.op === 'add') {
      const content = String(op.content ?? '').trim().slice(0, 500)
      const kind = op.kind && FACT_KINDS.includes(op.kind) ? op.kind : null
      if (!kind || content.length < 3) {
        result.rejected.push({ op, reason: 'invalid kind or content' })
        continue
      }
      if (activeCount >= MAX_ACTIVE_FACTS) {
        result.rejected.push({ op, reason: `active facts cap (${MAX_ACTIVE_FACTS}) reached` })
        continue
      }
      if (activeNormalized.has(normalizeContent(content))) {
        result.rejected.push({ op, reason: 'duplicate content' })
        continue
      }
      const confidence = clampConfidence(op.confidence)
      await client.query(
        `insert into public.coach_memory_facts (user_id, kind, content, source, confidence)
         values ($1, $2, $3, $4, $5)`,
        [userId, kind, content, source, confidence],
      )
      activeNormalized.add(normalizeContent(content))
      activeCount += 1
      result.added += 1
      continue
    }

    const target = op.id ? byId.get(op.id) : undefined
    if (!target || target.userId !== userId) {
      result.rejected.push({ op, reason: 'fact not found' })
      continue
    }

    if (op.op === 'archive') {
      // Травмы архивирует только пользователь: LLM не имеет права «забыть»
      // боль, которую пользователь не подтвердил как прошедшую.
      if (target.kind === 'injury' && source !== 'user') {
        result.rejected.push({ op, reason: 'injury facts can only be archived by the user' })
        continue
      }
      await client.query(
        `update public.coach_memory_facts set status = 'archived' where id = $1 and user_id = $2`,
        [target.id, userId],
      )
      if (target.status === 'active') activeCount -= 1
      result.archived += 1
      continue
    }

    if (op.op === 'update') {
      const content = String(op.content ?? '').trim().slice(0, 500)
      if (content.length < 3) {
        result.rejected.push({ op, reason: 'invalid content' })
        continue
      }
      await client.query(
        `update public.coach_memory_facts set content = $3, confidence = coalesce($4, confidence)
         where id = $1 and user_id = $2`,
        [target.id, userId, content, clampConfidence(op.confidence)],
      )
      result.updated += 1
      continue
    }

    result.rejected.push({ op, reason: 'unknown op' })
  }

  return result
}

// ---------------------------------------------------------------------------
// Goal progress (deterministic trajectory math — LLM only narrates on top)
// ---------------------------------------------------------------------------

interface E1rmHistoryLike {
  exerciseId: string
  currentBest: number
  trend: { direction: string; slopePerWeek: number; dataPointCount: number }
}

export interface GoalProgressEvaluation {
  progressNote: string
  achieved: boolean
}

/**
 * «Путь к цели»: сравнивает факт с траекторией. Для целей по e1RM/рабочему
 * весу строит прогноз из текущего значения и наклона тренда (кг/нед) и
 * говорит, идём ли по графику. Считается правилами — надёжная арифметика,
 * LLM поверх этого только рассказывает.
 */
export function evaluateGoalProgress(goal: CoachGoal, e1rmHistories: E1rmHistoryLike[], now: Date = new Date()): GoalProgressEvaluation | null {
  if (goal.status !== 'active') return null
  if (goal.metric !== 'e1rm' && goal.metric !== 'working_weight') return null
  if (!goal.exerciseId || !Number.isFinite(Number(goal.targetValue))) return null
  const history = e1rmHistories.find((h) => String(h.exerciseId) === String(goal.exerciseId))
  if (!history || !Number.isFinite(history.currentBest) || history.currentBest <= 0) return null

  const target = Number(goal.targetValue)
  const current = round1(history.currentBest)
  if (current >= target) {
    return { progressNote: `цель достигнута: e1RM ${current} кг при цели ${target} кг`, achieved: true }
  }

  const slope = Number(history.trend?.slopePerWeek ?? 0)
  if (!goal.targetDate) {
    const pace = slope > 0 ? `+${round1(slope)} кг/нед` : 'без роста'
    return { progressNote: `e1RM ${current} из ${target} кг, темп ${pace}`, achieved: false }
  }

  const weeksLeft = (new Date(`${goal.targetDate}T12:00:00.000Z`).getTime() - now.getTime()) / (7 * 86_400_000)
  if (weeksLeft <= 0) {
    return { progressNote: `срок прошёл: e1RM ${current} из ${target} кг`, achieved: false }
  }
  const requiredPace = (target - current) / weeksLeft
  const projected = current + slope * weeksLeft
  const paceText = `нужно +${round1(requiredPace)} кг/нед, факт ${slope > 0 ? '+' : ''}${round1(slope)} кг/нед`
  if (projected >= target) {
    return { progressNote: `в графике: e1RM ${current} из ${target} кг (${paceText})`, achieved: false }
  }
  return { progressNote: `отстаём от графика: e1RM ${current} из ${target} кг (${paceText})`, achieved: false }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Обновляет progress_note активных целей по фактическим трендам; цель с
 * достигнутым значением помечает achieved (объективный факт). Возвращает
 * цели с обновлёнными заметками.
 */
export async function refreshGoalProgress(client: DbClient, userId: string, e1rmHistories: E1rmHistoryLike[], now: Date = new Date()): Promise<CoachGoal[]> {
  const goals = await loadGoals(client, userId, 'active')
  for (const goal of goals) {
    const evaluation = evaluateGoalProgress(goal, e1rmHistories, now)
    if (!evaluation) continue
    await client.query(
      `update public.coach_goals set progress_note = $3, status = $4 where id = $1 and user_id = $2`,
      [goal.id, userId, evaluation.progressNote, evaluation.achieved ? 'achieved' : 'active'],
    )
    goal.progressNote = evaluation.progressNote
    if (evaluation.achieved) goal.status = 'achieved'
  }
  return goals
}

function clampConfidence(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.min(1, Math.max(0, num))
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

function normalizeFactRow(row: Record<string, unknown>): CoachMemoryFact {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as MemoryFactKind,
    content: String(row.content),
    status: row.status as 'active' | 'archived',
    source: row.source as MemoryFactSource,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function normalizeGoalRow(row: Record<string, unknown>): CoachGoal {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    exerciseId: row.exercise_id === null || row.exercise_id === undefined ? null : String(row.exercise_id),
    metric: row.metric as GoalMetric,
    targetValue: row.target_value === null || row.target_value === undefined ? null : Number(row.target_value),
    targetDate: row.target_date ? String((row.target_date as Date)?.toISOString?.()?.slice(0, 10) ?? row.target_date).slice(0, 10) : null,
    status: row.status as GoalStatus,
    progressNote: row.progress_note === null || row.progress_note === undefined ? null : String(row.progress_note),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function toIso(value: unknown): string {
  return String((value as Date)?.toISOString?.() ?? value ?? '')
}
