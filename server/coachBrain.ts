// Issue #65 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState, ExerciseRef } from '../shared/types.js'
import { getUserTrainingPolicy, type UserTrainingPolicy } from './userTrainingPolicies.js'

const ALLOWED_LIVE_ACTIONS = new Set([
  'hold_strategy',
  'reduce_remaining_volume',
  'replace_next_exercise',
  'add_accessory',
  'finish_workout_early',
])

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

interface SetInput {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

interface SessionContext {
  availableMinutes?: number
  nextExercise?: ExerciseRef | null
  workoutExercises?: ExerciseRef[]
}

interface BuildLiveStrategyDecisionInput {
  userId: string
  exercise: ExerciseRef
  completedSets?: SetInput[]
  coachState?: CoachState | Partial<CoachState>
  session?: SessionContext
  requestLlm?: ((args: unknown) => Promise<LiveStrategyDecision>) | null
}

interface LiveStrategyAction {
  type: string
  reason: string
  exerciseId?: string
  programExerciseId?: string
}

interface LiveStrategyConstraints {
  maxRpe: number
  allowFailure: boolean
  maxAdditionalExercises: number
}

interface LiveStrategyDecision {
  source: 'llm' | 'rules'
  decisionType: 'live_strategy'
  summary: string
  actions: LiveStrategyAction[]
  constraints: LiveStrategyConstraints
  warnings: string[]
}

interface ClampLiveStrategyInput {
  userId: string
}

interface RawLlmDecision {
  source?: string
  summary?: string
  actions?: Array<{ type?: string; reason?: string; exerciseId?: string; programExerciseId?: string }>
  constraints?: { maxRpe?: number; allowFailure?: boolean; maxAdditionalExercises?: number }
  warnings?: unknown[]
}

interface LlmResponseBody {
  choices?: Array<{ message?: { content?: string } }>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildLiveStrategyDecision({
  userId,
  exercise,
  completedSets = [],
  coachState = {},
  session = {},
  requestLlm = null,
}: BuildLiveStrategyDecisionInput): Promise<LiveStrategyDecision> {
  const rulesDecision = buildRulesLiveStrategy({ userId, exercise, completedSets, coachState })
  if (!requestLlm) return rulesDecision

  try {
    const llmDecision = await requestLlm({
      userId,
      exercise,
      completedSets,
      coachState,
      session,
      rulesDecision,
    })
    return clampLiveStrategyDecision(llmDecision ?? rulesDecision, { userId })
  } catch {
    return rulesDecision
  }
}

export async function requestLlmLiveStrategy({
  userId,
  exercise,
  completedSets,
  coachState,
  session,
  rulesDecision,
}: {
  userId: string
  exercise: ExerciseRef
  completedSets: SetInput[]
  coachState: CoachState | Partial<CoachState>
  session: SessionContext
  rulesDecision: LiveStrategyDecision
}): Promise<LiveStrategyDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
  const prompt = buildLiveStrategyPrompt({ userId, exercise, completedSets, coachState, session, rulesDecision })

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Ты персональный силовой тренер. Верни только валидный JSON. Безопасность, техника и восстановление важнее добивания объёма.' },
          { role: 'user', content: prompt },
        ],
      }),
    })
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const body = (await response.json()) as LlmResponseBody
    const content = body?.choices?.[0]?.message?.content
    if (!content) return null
    return { ...(JSON.parse(content) as RawLlmDecision), source: 'llm', decisionType: 'live_strategy' } as LiveStrategyDecision
  } catch (error) {
    console.warn('LLM live strategy failed, using rules fallback:', error instanceof Error ? error.message : error)
    return null
  }
}

export function clampLiveStrategyDecision(
  rawDecision: LiveStrategyDecision | RawLlmDecision,
  { userId }: ClampLiveStrategyInput,
): LiveStrategyDecision {
  const policy: UserTrainingPolicy | null = getUserTrainingPolicy(userId)
  const rawActions = Array.isArray(rawDecision?.actions) ? rawDecision.actions : []
  const actions: LiveStrategyAction[] = rawActions
    .filter((action): action is { type: string; reason?: string; exerciseId?: string; programExerciseId?: string } =>
      typeof action?.type === 'string' && ALLOWED_LIVE_ACTIONS.has(action.type))
    .slice(0, 3)
    .map((action) => ({
      type: action.type,
      reason: String(action.reason ?? '').slice(0, 240),
      ...(action.exerciseId ? { exerciseId: action.exerciseId } : {}),
      ...(action.programExerciseId ? { programExerciseId: action.programExerciseId } : {}),
    }))

  const rawConstraints = (rawDecision as RawLlmDecision)?.constraints ?? {}
  return {
    source: rawDecision?.source === 'llm' ? 'llm' : 'rules',
    decisionType: 'live_strategy',
    summary: String(rawDecision?.summary ?? 'Держим текущую стратегию.').slice(0, 400),
    actions: actions.length ? actions : [{ type: 'hold_strategy', reason: 'Нет безопасных изменений.' }],
    constraints: {
      maxRpe: policy?.allowFailureSets === false ? 8 : Math.min(10, Number(rawConstraints.maxRpe ?? 9)),
      allowFailure: Boolean(policy?.allowFailureSets && rawConstraints.allowFailure !== false),
      maxAdditionalExercises: Math.min(1, Math.max(0, Number(rawConstraints.maxAdditionalExercises ?? 1))),
    },
    warnings: Array.isArray((rawDecision as RawLlmDecision)?.warnings)
      ? ((rawDecision as RawLlmDecision).warnings as unknown[]).slice(0, 3).map((item) => String(item).slice(0, 200))
      : [],
  }
}

function buildLiveStrategyPrompt({
  userId,
  exercise,
  completedSets,
  coachState,
  session,
  rulesDecision,
}: {
  userId: string
  exercise: ExerciseRef
  completedSets: SetInput[]
  coachState: CoachState | Partial<CoachState>
  session: SessionContext
  rulesDecision: LiveStrategyDecision
}): string {
  return `Пользователь: ${userId}

Текущее упражнение: ${JSON.stringify(exercise)}

Завершённые подходы упражнения: ${JSON.stringify(completedSets)}

Coach State: ${JSON.stringify(coachState)}

Контекст тренировки: ${JSON.stringify(session)}

Базовое решение правил: ${JSON.stringify(rulesDecision)}

Задача: оцени не следующий отдельный подход, а стратегию остатка текущей тренировки. Верни строго JSON:
{"summary":"коротко что делать","actions":[{"type":"hold_strategy|reduce_remaining_volume|replace_next_exercise|add_accessory|finish_workout_early","reason":"коротко","exerciseId":"optional","programExerciseId":"optional"}],"constraints":{"maxRpe":8,"allowFailure":false,"maxAdditionalExercises":0},"warnings":[]}.

Не предлагай отказные подходы подростку. Не повышай нагрузку при боли, низком восстановлении или RPE 9-10. Не добавляй больше одного упражнения.`
}

function buildRulesLiveStrategy({
  userId,
  completedSets,
  coachState,
}: {
  userId: string
  exercise: ExerciseRef
  completedSets: SetInput[]
  coachState: CoachState | Partial<CoachState>
}): LiveStrategyDecision {
  const policy: UserTrainingPolicy | null = getUserTrainingPolicy(userId)
  const hardSets = completedSets.filter((set) => Number(set.rpe) >= 9).length
  const lowRecovery = coachState.recoveryStatus === 'low' || Number(coachState.readinessScore ?? 70) < 55

  if (lowRecovery || hardSets >= 2 || (policy?.allowFailureSets === false && hardSets >= 1)) {
    return {
      source: 'rules',
      decisionType: 'live_strategy',
      summary: 'Снизить оставшийся объём и не добивать отказными подходами.',
      actions: [{ type: 'reduce_remaining_volume', reason: 'Высокая тяжесть подходов или восстановление ниже оптимального.' }],
      constraints: {
        maxRpe: policy?.allowFailureSets === false ? 8 : 9,
        allowFailure: false,
        maxAdditionalExercises: 0,
      },
      warnings: [],
    }
  }

  return {
    source: 'rules',
    decisionType: 'live_strategy',
    summary: 'Стратегию тренировки можно оставить без изменений.',
    actions: [{ type: 'hold_strategy', reason: 'Подходы идут в рабочем диапазоне.' }],
    constraints: {
      maxRpe: policy?.allowFailureSets === false ? 8 : 9,
      allowFailure: Boolean(policy?.allowFailureSets),
      maxAdditionalExercises: 1,
    },
    warnings: [],
  }
}
