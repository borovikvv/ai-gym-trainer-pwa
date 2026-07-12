// Фаза 1.2 (план развития): LLM-советник на каждый подход.
//
// On every completed set the route builds a rules baseline (recommendNextSet)
// and calls this advisor. The advisor asks a FAST-tier LLM to refine the next
// set and the remaining-workout strategy using the rich live context
// (liveCoachContext). The answer is forced through clampNextSetDecision — the
// hard safety layer (teen: no failure, bounded weight jumps) — and mapped back
// to the SetRecommendation shape the frontend already understands. On any LLM
// failure the rules baseline is returned unchanged, so the user experience
// degrades gracefully to today's behavior.
import type { CoachSessionContext, ExerciseRef } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import { isLlmConfigured, requestLlmJson } from './lib/llmClient.js'
import {
  clampNextSetDecision,
  getUserTrainingPolicy,
  type ClampedNextSetDecision,
  type NextSetProposal,
} from './userTrainingPolicies.js'
import {
  buildLiveContextPrompt,
  loadLiveCoachUserData,
  type RulesBaseline,
  type SessionExerciseLog,
} from './services/liveCoachContext.js'
import { isTimedExercise } from '../src/domain/exerciseMetrics.js'

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
  'Реши, каким должен быть следующий подход и нужна ли смена стратегии на остаток тренировки.',
  'Безопасность, техника и восстановление важнее добивания объёма. Не предлагай резких скачков веса.',
  'Учитывай ощущения по RPE, историю упражнения, готовность и фазу цикла. Если базовая рекомендация правил разумна — уточни её, а не ломай.',
  'Верни СТРОГО JSON без пояснений:',
  '{"nextSet":{"weight":60,"reps":8,"restSeconds":120,"targetRpe":7},',
  '"strategyAction":{"type":"hold|skip_remaining_sets|replace_next_exercise|add_exercise|finish_workout|stop_exercise|suggest_replacement","exerciseId":null},',
  '"reason":"одна короткая фраза для атлета (до 15 слов)",',
  '"detail":"2-3 предложения: почему именно так, ссылаясь на его данные"}',
  'strategyAction.type="hold" почти всегда; другие типы — только при веской причине.',
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

  // Упражнение на время (планка): reps = секунды, веса нет. Без явной
  // пометки LLM путал секунды с килограммами («вес 60» для планки).
  const timed = isTimedExercise({
    id: input.exercise.id ?? '',
    name: input.exercise.name ?? '',
    muscleGroup: input.exercise.muscleGroup ?? '',
  })
  const system = timed
    ? `${SYSTEM_PROMPT}\nВНИМАНИЕ: текущее упражнение — НА ВРЕМЯ. nextSet.reps — это СЕКУНДЫ удержания, nextSet.weight всегда 0.`
    : SYSTEM_PROMPT

  const proposal = await requestLlmJson<NextSetProposal>({
    tier: 'fast',
    caller: 'coachSetAdvisor',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 400,
    system,
    prompt,
  })
  if (!proposal) return { decision: rulesFallback, prompt, clamped: null }

  const completedOnly = input.completedSets.filter((set) => set.completed !== false && Number(set.reps) > 0)
  const lastSet = completedOnly.at(-1) ?? null
  const clamped = clampNextSetDecision(proposal, {
    userId: input.userId,
    policy: getUserTrainingPolicy(input.userId),
    // Anchor weight bounds to the last real set; on the first set anchor to
    // the rules baseline so the LLM cannot invent a wild starting weight.
    lastSet: lastSet ?? (input.rulesDecision.recommendedWeight > 0 ? { weight: input.rulesDecision.recommendedWeight } : null),
    weightStep: input.exercise.weightStep,
    pain: input.pain,
    timed,
  })

  return { decision: mapClampedToDecision(clamped, input, rulesFallback), prompt, clamped }
}

function mapClampedToDecision(
  clamped: ClampedNextSetDecision,
  input: BuildNextSetDecisionInput,
  rulesFallback: NextSetDecision,
): NextSetDecision {
  const actionType = clamped.strategyAction.type
  const reason = clamped.reason || rulesFallback.reason
  const detail = clamped.detail || undefined

  if (actionType !== 'hold') {
    // Strategy actions carry no set numbers (same contract as the rules
    // engine's stop/replace/finish decisions). For replacement-like actions
    // reuse the rules engine's suggestions when the LLM did not point at a
    // valid library exercise — the frontend needs a concrete suggestion.
    const suggested = resolveSuggestedExercise(clamped.strategyAction.exerciseId, input)
    return {
      action: actionType,
      recommendedWeight: 0,
      recommendedReps: 0,
      recommendedRestSeconds: actionType === 'stop_exercise' || actionType === 'replace_next_exercise' ? 180 : 0,
      reason,
      detail,
      source: 'llm',
      suggestedExercise: suggested ?? rulesFallback.suggestedExercise,
      suggestedExercises: suggested ? [suggested] : rulesFallback.suggestedExercises,
    }
  }

  if (!clamped.nextSet) return { ...rulesFallback, reason, detail, source: 'llm' }

  const remainingCount = Math.max(0, Math.floor(input.remainingSets))
  return {
    action: deriveSetAction(clamped.nextSet.weight, input, rulesFallback),
    recommendedWeight: clamped.nextSet.weight,
    recommendedReps: clamped.nextSet.reps,
    recommendedRestSeconds: clamped.nextSet.restSeconds,
    targetRpe: clamped.nextSet.targetRpe,
    reason,
    detail,
    source: 'llm',
    ...(remainingCount > 0
      ? {
          remainingSetUpdates: Array.from({ length: remainingCount }, (_, setOffset) => ({
            setOffset,
            recommendedWeight: clamped.nextSet!.weight,
            recommendedReps: clamped.nextSet!.reps,
            recommendedRestSeconds: clamped.nextSet!.restSeconds,
          })),
        }
      : {}),
  }
}

function deriveSetAction(weight: number, input: BuildNextSetDecisionInput, rulesFallback: NextSetDecision): string {
  const completedOnly = input.completedSets.filter((set) => set.completed !== false && Number(set.reps) > 0)
  const lastWeight = Number(completedOnly.at(-1)?.weight ?? NaN)
  if (Number.isFinite(lastWeight) && lastWeight > 0) {
    if (weight < lastWeight) return 'reduce_load'
    if (weight === lastWeight) return rulesFallback.action === 'hold_load' ? 'hold_load' : 'continue'
  }
  return 'continue'
}

function resolveSuggestedExercise(exerciseId: string | null, input: BuildNextSetDecisionInput): ExerciseRef | undefined {
  if (!exerciseId) return undefined
  const library = (input.session?.exerciseLibrary ?? []) as Array<{ id?: string; name?: string; muscleGroup?: string }>
  const found = library.find((exercise) => String(exercise.id) === String(exerciseId))
  if (!found) return undefined
  return { id: found.id, name: found.name, muscleGroup: found.muscleGroup }
}
