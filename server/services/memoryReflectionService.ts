// Фаза 2.3 (план развития): пост-тренировочная «рефлексия» памяти тренера.
//
// После сохранения тренировки (вне транзакции, fire-and-forget) MID-модель
// смотрит на прошедшую сессию + текущие факты и цели и предлагает операции
// над памятью: добавить наблюдение («после тяжёлых приседаний нужно 3 дня»),
// уточнить старое, отметить прогресс цели. Все операции проходят валидацию
// applyMemoryUpdates (лимит, дедуп, защита травм). Сбой любой части не
// затрагивает сохранение тренировки.
import type { DbClient } from '../dbClient.js'
import type { WorkoutHistoryEntry } from '../../shared/types.js'
import { isLlmConfigured, requestLlmJson } from '../lib/llmClient.js'
import {
  applyMemoryUpdates,
  loadGoals,
  loadMemoryFacts,
  type CoachGoal,
  type CoachMemoryFact,
  type MemoryFactOperation,
} from '../coachLongTermMemory.js'

interface DebriefLike {
  summary?: string
  wentWell?: string[]
  qualityScore?: number
}

export interface RunMemoryReflectionInput {
  client: DbClient
  entry: Pick<WorkoutHistoryEntry, 'userId' | 'exercises' | 'totalVolume'> & {
    completedAt?: string
    readinessCheckIn?: { painAreas?: string[]; soreMuscleGroups?: string[]; notes?: string } | null
  }
  debrief?: DebriefLike | null
}

interface ReflectionResponse {
  factOperations?: MemoryFactOperation[]
  goalNotes?: Array<{ id?: string; progressNote?: string }>
}

const SYSTEM_PROMPT = [
  'Ты персональный силовой тренер, который после тренировки обновляет свои заметки о подопечном.',
  'Твоя память — короткий список фактов. Добавляй только НОВОЕ и ДОЛГОСРОЧНО ВАЖНОЕ:',
  'травмы/боль (kind="injury"), устойчивые реакции на нагрузку (kind="load_response"),',
  'предпочтения (kind="preference"), ограничения (kind="constraint"), достигнутые вехи (kind="milestone").',
  'НЕ дублируй существующие факты. НЕ записывай разовые события без долгосрочного значения.',
  'Чаще всего правильный ответ — пустой список операций.',
  'Верни СТРОГО JSON:',
  '{"factOperations":[{"op":"add|update","id":"для update — id существующего факта","kind":"injury|load_response|preference|constraint|milestone","content":"краткий факт на русском","confidence":0.8}],',
  '"goalNotes":[{"id":"id цели","progressNote":"короткая оценка прогресса на русском"}]}',
  'Архивировать факты ты не можешь. Пиши кратко, по-русски.',
].join('\n')

export async function runMemoryReflection({ client, entry, debrief = null }: RunMemoryReflectionInput): Promise<void> {
  if (!isLlmConfigured()) return
  const userId = String(entry.userId ?? '')
  if (!userId) return

  const [facts, goals] = await Promise.all([
    loadMemoryFacts(client, userId, 'active'),
    loadGoals(client, userId, 'active'),
  ])

  const response = await requestLlmJson<ReflectionResponse>({
    tier: 'mid',
    caller: 'memoryReflection',
    timeoutMs: 8000,
    temperature: 0.2,
    maxTokens: 500,
    system: SYSTEM_PROMPT,
    prompt: buildReflectionPrompt({ entry, debrief, facts, goals }),
  })
  if (!response) return

  const operations = (response.factOperations ?? []).filter((op) => op?.op === 'add' || op?.op === 'update')
  if (operations.length) {
    const result = await applyMemoryUpdates(client, userId, operations, 'llm')
    if (result.added || result.updated) {
      console.log(`memoryReflection: +${result.added} фактов, ~${result.updated} обновлено для ${userId}`)
    }
  }

  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  for (const note of response.goalNotes ?? []) {
    const goal = note?.id ? goalById.get(String(note.id)) : undefined
    const progressNote = String(note?.progressNote ?? '').trim().slice(0, 300)
    if (!goal || progressNote.length < 3) continue
    await client.query(
      `update public.coach_goals set progress_note = $3 where id = $1 and user_id = $2`,
      [goal.id, userId, progressNote],
    )
  }
}

function buildReflectionPrompt({
  entry,
  debrief,
  facts,
  goals,
}: {
  entry: RunMemoryReflectionInput['entry']
  debrief: DebriefLike | null
  facts: CoachMemoryFact[]
  goals: CoachGoal[]
}): string {
  const lines: string[] = []

  lines.push('ПРОШЕДШАЯ ТРЕНИРОВКА:')
  for (const exercise of entry.exercises ?? []) {
    const ex = exercise as {
      exerciseName?: string
      exerciseId?: string
      pain?: boolean
      sets?: Array<{ weight?: number; reps?: number; rpe?: number; completed?: boolean }>
    }
    const sets = (ex.sets ?? [])
      .filter((set) => set.completed !== false && Number(set.reps) > 0)
      .map((set) => `${Number(set.weight ?? 0)}×${Number(set.reps ?? 0)}${Number(set.rpe) > 0 ? `@${set.rpe}` : ''}`)
      .join(', ')
    if (!sets) continue
    lines.push(`- ${ex.exerciseName ?? ex.exerciseId}: ${sets}${ex.pain ? ' (БОЛЬ)' : ''}`)
  }
  if (debrief?.summary) lines.push(`ИТОГ: ${debrief.summary}${debrief.qualityScore ? ` Качество ${debrief.qualityScore}/100.` : ''}`)
  const checkIn = entry.readinessCheckIn
  if (checkIn?.painAreas?.length) lines.push(`БОЛЬ ДО ТРЕНИРОВКИ: ${checkIn.painAreas.join(', ')}`)
  if (checkIn?.notes) lines.push(`ЗАМЕТКА ПОЛЬЗОВАТЕЛЯ: ${checkIn.notes}`)

  lines.push('')
  lines.push('ТЕКУЩИЕ ФАКТЫ ПАМЯТИ (id | вид | содержимое):')
  if (facts.length === 0) lines.push('- пусто')
  for (const fact of facts) lines.push(`- ${fact.id} | ${fact.kind} | ${fact.content}`)

  lines.push('')
  lines.push('АКТИВНЫЕ ЦЕЛИ (id | цель | срок | прошлая оценка):')
  if (goals.length === 0) lines.push('- нет целей')
  for (const goal of goals) lines.push(`- ${goal.id} | ${goal.title} | ${goal.targetDate ?? 'без срока'} | ${goal.progressNote ?? '—'}`)

  return lines.join('\n')
}
