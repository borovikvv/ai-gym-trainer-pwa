import { getUserTrainingPolicy } from './userTrainingPolicies.js'

const ALLOWED_LIVE_ACTIONS = new Set([
  'hold_strategy',
  'reduce_remaining_volume',
  'replace_next_exercise',
  'add_accessory',
  'finish_workout_early',
])

export async function buildLiveStrategyDecision({
  userId,
  exercise,
  completedSets = [],
  coachState = {},
  session = {},
  requestLlm = null,
}) {
  const rulesDecision = buildRulesLiveStrategy({ userId, exercise, completedSets, coachState, session })
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

export async function requestLlmLiveStrategy({ userId, exercise, completedSets, coachState, session, rulesDecision }) {
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
    const body = await response.json()
    const content = body?.choices?.[0]?.message?.content
    if (!content) return null
    return { ...JSON.parse(content), source: 'llm', decisionType: 'live_strategy' }
  } catch (error) {
    console.warn('LLM live strategy failed, using rules fallback:', error instanceof Error ? error.message : error)
    return null
  }
}

export function clampLiveStrategyDecision(rawDecision, { userId }) {
  const policy = getUserTrainingPolicy(userId)
  const actions = (Array.isArray(rawDecision?.actions) ? rawDecision.actions : [])
    .filter((action) => ALLOWED_LIVE_ACTIONS.has(action?.type))
    .slice(0, 3)
    .map((action) => ({
      ...action,
      reason: String(action.reason ?? '').slice(0, 240),
    }))

  return {
    source: rawDecision?.source === 'llm' ? 'llm' : 'rules',
    decisionType: 'live_strategy',
    summary: String(rawDecision?.summary ?? 'Держим текущую стратегию.').slice(0, 400),
    actions: actions.length ? actions : [{ type: 'hold_strategy', reason: 'Нет безопасных изменений.' }],
    constraints: {
      maxRpe: policy.allowFailureSets === false ? 8 : Math.min(10, Number(rawDecision?.constraints?.maxRpe ?? 9)),
      allowFailure: Boolean(policy.allowFailureSets && rawDecision?.constraints?.allowFailure !== false),
      maxAdditionalExercises: Math.min(1, Math.max(0, Number(rawDecision?.constraints?.maxAdditionalExercises ?? 1))),
    },
    warnings: Array.isArray(rawDecision?.warnings)
      ? rawDecision.warnings.slice(0, 3).map((item) => String(item).slice(0, 200))
      : [],
  }
}

function buildLiveStrategyPrompt({ userId, exercise, completedSets, coachState, session, rulesDecision }) {
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

function buildRulesLiveStrategy({ userId, completedSets, coachState }) {
  const policy = getUserTrainingPolicy(userId)
  const hardSets = completedSets.filter((set) => Number(set.rpe) >= 9).length
  const lowRecovery = coachState.recoveryStatus === 'low' || Number(coachState.readinessScore ?? 70) < 55

  if (lowRecovery || hardSets >= 2 || (policy.allowFailureSets === false && hardSets >= 1)) {
    return {
      source: 'rules',
      decisionType: 'live_strategy',
      summary: 'Снизить оставшийся объём и не добивать отказными подходами.',
      actions: [{ type: 'reduce_remaining_volume', reason: 'Высокая тяжесть подходов или восстановление ниже оптимального.' }],
      constraints: {
        maxRpe: policy.allowFailureSets === false ? 8 : 9,
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
      maxRpe: policy.allowFailureSets === false ? 8 : 9,
      allowFailure: Boolean(policy.allowFailureSets),
      maxAdditionalExercises: 1,
    },
    warnings: [],
  }
}
