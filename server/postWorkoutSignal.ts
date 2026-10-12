// Issue #419: разбор свободного ответа атлета на вопрос тренера после
// тренировки в типизированный сигнал.
//
// Повод на старте один — отклонение фактического веса от плана. Атлет отвечает
// своими словами, LLM классифицирует ответ в один из пяти смыслов. Служебный
// тип "не разобрано" код подставляет сам — LLM его не возвращает.
//
// Урок #246 перенесён на LLM-разбор: текст атлета никогда не теряется и никогда
// не превращается в «легко»/«нормально» по умолчанию. Если LLM недоступна,
// вернула мусор или таймаут — сохраняем исходный текст и служебный тип.
import type { PostWorkoutSignalInput } from '../shared/types.js'
import { requestLlmJson } from './lib/llmClient.js'

/** Пять смысловых значений ответа плюс служебное «не разобрано». */
export type PostWorkoutSignalType = 'easy' | 'tired' | 'pain' | 'no_time' | 'other' | 'unparsed'

export const POST_WORKOUT_SIGNAL_SOURCE = 'athlete_response'

export interface PostWorkoutSignalTrigger {
  exerciseId: string
  exerciseName: string
  assignedWeight: number
  actualWeight: number
  deviation: number
}

export interface PostWorkoutSignal {
  trigger: PostWorkoutSignalTrigger
  responseText: string
  signalType: PostWorkoutSignalType
  /** Место боли, если ответ про боль и LLM его указала. */
  painLocation: string | null
  /** Уверенность разбора 0..1; null — разбора не было. */
  confidence: number | null
  source: typeof POST_WORKOUT_SIGNAL_SOURCE
  /** Время разбора; null — LLM не ответила, тип служебный. */
  parsedAt: string | null
}

interface ClassificationPayload {
  type?: string
  painLocation?: string
  confidence?: number
}

const VALID_SIGNAL_TYPES: readonly PostWorkoutSignalType[] = ['easy', 'tired', 'pain', 'no_time', 'other']

const LLM_TIMEOUT_MS = 6000

const SYSTEM_PROMPT = [
  'Ты разбираешь короткий ответ атлета на вопрос тренера после силовой тренировки.',
  'Вопрос был про отклонение фактического веса от плана.',
  'Определи ровно один смысл ответа из списка:',
  'easy — было легко, вес дался с запасом;',
  'tired — устал, не хватило сил;',
  'pain — что-то болит или болело;',
  'no_time — не было времени, тренировка была в спешке;',
  'other — другой смысл или ответ непонятен.',
  'Верни СТРОГО JSON без пояснений:',
  '{"type":"easy|tired|pain|no_time|other","painLocation":"место боли, если названо","confidence":0.0}',
  'confidence — число от 0 до 1: насколько уверенно разобран ответ.',
].join('\n')

/**
 * Строит сигнал из ответа атлета. null/пустой (после trim) ответ → null, LLM
 * не вызывается. При сбое LLM возвращает сигнал со служебным типом "unparsed",
 * сохраняя текст ответа и поля триггера.
 */
export async function buildPostWorkoutSignal(input: PostWorkoutSignalInput | null | undefined): Promise<PostWorkoutSignal | null> {
  if (!input) return null
  const responseText = String(input.responseText ?? '').trim()
  if (responseText === '') return null

  const trigger: PostWorkoutSignalTrigger = {
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    assignedWeight: input.assignedWeight,
    actualWeight: input.actualWeight,
    deviation: input.deviation,
  }

  const classification = await requestLlmJson<ClassificationPayload>({
    tier: 'fast',
    caller: 'postWorkoutSignal',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0,
    maxTokens: 200,
    system: SYSTEM_PROMPT,
    prompt: responseText,
  })

  if (!classification) {
    return {
      trigger,
      responseText,
      signalType: 'unparsed',
      painLocation: null,
      confidence: null,
      source: POST_WORKOUT_SIGNAL_SOURCE,
      parsedAt: null,
    }
  }

  const rawType = typeof classification.type === 'string' ? classification.type : ''
  const signalType = (VALID_SIGNAL_TYPES as readonly string[]).includes(rawType)
    ? (rawType as PostWorkoutSignalType)
    : 'unparsed'
  const confidence = Number.isFinite(Number(classification.confidence)) ? Number(classification.confidence) : null
  const painLocation = signalType === 'pain'
    && typeof classification.painLocation === 'string'
    && classification.painLocation.trim() !== ''
    ? classification.painLocation.trim()
    : null

  return {
    trigger,
    responseText,
    signalType,
    painLocation,
    confidence,
    source: POST_WORKOUT_SIGNAL_SOURCE,
    parsedAt: new Date().toISOString(),
  }
}
