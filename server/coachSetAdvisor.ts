// Фаза 1.2 (план развития): LLM-советник на каждый подход.
//
// On every completed set the route builds a rules baseline (recommendNextSet)
// and calls this advisor. Numbers (weight/reps/rest) and the strategy action
// ALWAYS come from `input.rulesDecision` — the LLM never changes arithmetic.
// The advisor asks a FAST-tier LLM only to EXPLAIN that decision to the athlete
// (`reason`/`detail`) using the rich live context (liveCoachContext), which
// already carries the rules baseline as input. On any LLM failure or timeout the
// rules baseline — including its text — is returned unchanged, so the user
// experience degrades gracefully.
import type { CoachSessionContext, ExerciseRef } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import { isLlmConfigured, requestLlmJson } from './lib/llmClient.js'
import {
  clampNextSetDecision,
  getUserTrainingPolicy,
  type ClampedNextSetDecision,
  type NextSetProposal,
  type UserTrainingPolicy,
} from './userTrainingPolicies.js'
import {
  buildLiveContextPrompt,
  loadLiveCoachUserData,
  type RulesBaseline,
  type SessionExerciseLog,
} from './services/liveCoachContext.js'

const LLM_TIMEOUT_MS = 6000

interface SetLike {
  weight?: number
  reps?: number
  rpe?: number
  completed?: boolean
}

interface ExerciseInputLike {
  id?: string
  name?: string
  muscleGroup?: string
  repMin?: number
  repMax?: number
  weightStep?: number
  restSeconds?: number
  targetWeight?: number
  lastKnownWeight?: number
  /** Issue #173: 'load' | 'assistance' из справочника; без него — по имени. */
  weightDirection?: string | null
  // Issue #171: метаданные справочника — по ним определяется, осевое ли это
  // свободновесное движение. Роут дополняет ими payload от клиента.
  equipment?: string | null
  exerciseType?: string | null
  movementPattern?: string | null
}

export interface NextSetDecision extends RulesBaseline {
  source: 'llm' | 'rules'
  detail?: string
  targetRpe?: number
  suggestedExercise?: ExerciseRef
  suggestedExercises?: ExerciseRef[]
  remainingSetUpdates?: Array<{
    setOffset: number
    recommendedWeight: number
    recommendedReps: number
    recommendedRestSeconds: number
  }>
}

export interface BuildNextSetDecisionInput {
  client: DbClient
  userId: string
  /**
   * Issue #171: политика, выведенная из возраста профиля. Роут строит её один
   * раз и передаёт сюда; без неё пришлось бы выводить из одного userId, а по
   * нему возраст неизвестен и взрослый получал бы подростковые ограничения.
   */
  policy?: UserTrainingPolicy | null
  exercise: ExerciseInputLike
  completedSets: SetLike[]
  remainingSets: number
  pain: boolean
  sessionSoFar?: SessionExerciseLog[]
  session?: CoachSessionContext
  rulesDecision: RulesBaseline & {
    suggestedExercise?: ExerciseRef
    suggestedExercises?: ExerciseRef[]
    remainingSetUpdates?: NextSetDecision['remainingSetUpdates']
  }
}

export interface BuildNextSetDecisionResult {
  decision: NextSetDecision
  /** Prompt sent to the LLM (null when rules-only) — stored in the decision log. */
  prompt: string | null
  /** Clamped LLM proposal (null when rules-only) — stored in the decision log. */
  clamped: ClampedNextSetDecision | null
}

const SYSTEM_PROMPT = [
  'Ты персональный силовой тренер, стоящий рядом с атлетом в зале. Атлет только что закончил подход.',
  'Числа следующего подхода и решение о стратегии уже приняты системой безопасности — тебе их менять нельзя. Они даны во входных данных как "БАЗОВАЯ РЕКОМЕНДАЦИЯ ПО ПРАВИЛАМ".',
  'Твоя единственная задача — объяснить атлету это решение простыми словами: почему именно такой вес/повторы/отдых и почему такое действие, опираясь на его RPE, историю упражнения, готовность и фазу цикла.',
  'Верни СТРОГО JSON без пояснений:',
  '{"reason":"одна короткая фраза для атлета (до 15 слов)",',
  '"detail":"2-3 предложения: почему именно так, ссылаясь на его данные"}',
  'Пиши на русском, без технических терминов (readiness, MEV/MRV), обращайся к атлету на «ты».',
].join('\n')

export async function buildNextSetDecision(input: BuildNextSetDecisionInput): Promise<BuildNextSetDecisionResult> {
  const rulesFallback: NextSetDecision = { ...input.rulesDecision, source: 'rules' }
  if (!isLlmConfigured()) return { decision: rulesFallback, prompt: null, clamped: null }

  let prompt: string
  try {
    const userData = await loadLiveCoachUserData(input.client, input.userId)
    prompt = buildLiveContextPrompt({
      userId: input.userId,
      exercise: input.exercise,
      completedSets: input.completedSets,
      remainingSets: input.remainingSets,
      pain: input.pain,
      sessionSoFar: input.sessionSoFar,
      session: input.session,
      rulesDecision: input.rulesDecision,
      userData,
    })
  } catch (error) {
    console.warn('liveCoachContext failed, using rules:', error instanceof Error ? error.message : error)
    return { decision: rulesFallback, prompt: null, clamped: null }
  }

  const proposal = await requestLlmJson<NextSetProposal>({
    tier: 'fast',
    caller: 'coachSetAdvisor',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 400,
    system: SYSTEM_PROMPT,
    prompt,
  })
  if (!proposal) return { decision: rulesFallback, prompt, clamped: null }

  const clamped = clampNextSetDecision(proposal, {
    userId: input.userId,
    policy: input.policy ?? getUserTrainingPolicy(input.userId),
  })

  return { decision: mapClampedToDecision(clamped, rulesFallback), prompt, clamped }
}

function mapClampedToDecision(clamped: ClampedNextSetDecision, rulesFallback: NextSetDecision): NextSetDecision {
  return {
    ...rulesFallback,
    reason: clamped.reason || rulesFallback.reason,
    detail: clamped.detail || undefined,
    source: 'llm',
  }
}
