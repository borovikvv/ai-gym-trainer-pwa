/**
 * AI Level 1 (#83): LLM-powered coach narration.
 *
 * Replaces template-based buildCoachReason with LLM-generated human-readable
 * text. Falls back to templates if no API key or LLM fails.
 */

import type { CoachState } from '../shared/types.js'
import { requestLlmText } from './lib/llmClient.js'

interface NarrationInput {
  scheduledDate: string
  coachState: CoachState | null
  coachMemory: unknown
  decision: {
    summary?: string
    reasons?: string[]
    priorityMuscleGroups?: string[]
    avoidMuscleGroups?: string[]
    loadPolicy?: string
  } | null
  lowReadiness: boolean
  weeklyContext: {
    daysSincePreviousWorkout: number | null
    calendarWorkoutCountLast7: number
    effectiveWorkoutsPerWeek: number
    previousExerciseIds: Set<string>
    recoveryRestrictedMuscleKeys: Set<string>
  }
  selectedExercises: Array<{
    exerciseName: string
    muscleGroup: string
    targetWeight: number
    setsCount: number
    repMin: number
    repMax: number
  }>
  profile: {
    goal?: string
    level?: string
    age?: number | null
    workoutsPerWeek?: number
  }
  preferences: {
    focusAreas?: string[]
  }
  /** Фаза 2: блок долгосрочной памяти (травмы, реакции, цели). */
  longTermMemory?: string
}

const LLM_TIMEOUT_MS = 3000

/**
 * Generate a human-readable coach narration using LLM.
 * Falls back to template if no API key, LLM fails, or timeout.
 */
export async function generateCoachNarration(input: NarrationInput): Promise<string> {
  const content = await requestLlmText({
    tier: 'fast',
    caller: 'coachNarrator',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.4,
    maxTokens: 200,
    system:
      'Ты персональный силовой тренер. Объясни пользователю коротко (2-3 предложения) почему именно эта тренировка. Пиши на русском, дружелюбно, без технических терминов (readiness, MEV, MRV). Без emoji. Максимум 3 предложения.',
    prompt: buildLlmPrompt(input),
  })
  if (!content || content.length < 10) return buildTemplateNarration(input)
  return content
}

function buildLlmPrompt(input: NarrationInput): string {
  const cs = input.coachState
  const m = cs?.mesocycle
  const muscleFatigue = cs?.muscleGroups
    ? Object.entries(cs.muscleGroups)
        .filter(([, g]) => g?.fatigue === 'high' || g?.fatigue === 'medium')
        .map(([k, g]) => `${muscleLabel(k)}: ${g?.fatigue}`)
        .join(', ')
    : 'нет данных'

  const exercises = input.selectedExercises
    .map((e) => `${e.exerciseName} (${e.muscleGroup}, ${e.setsCount}×${e.repMin}-${e.repMax}, ${e.targetWeight}кг)`)
    .join('; ')

  const daysSince = input.weeklyContext.daysSincePreviousWorkout
  const phase = m ? `${m.phase} (неделя ${m.weekInCycle}/${m.cycleLength})` : 'нет данных'
  // Issue #90: make the LLM aware of deload context so it explains the lighter
  // session as a planned recovery week, not as low readiness or fatigue.
  const isDeload = Boolean(m?.isDeload) || m?.phase === 'deload'
  const deloadHint = isDeload
    ? 'Сейчас разгрузочная неделя (deload) — объём и интенсивность снижены намеренно, это часть плана. Объясни это пользователю.'
    : ''

  // Фаза 2: долгосрочная память — нарратор может ссылаться на цели и травмы.
  const memoryBlock = input.longTermMemory ? `${input.longTermMemory}\n` : ''

  return `${memoryBlock}Дата: ${input.scheduledDate}
Готовность: ${cs?.readinessScore ?? 70}/100
Восстановление: ${cs?.recoveryStatus ?? 'unknown'}
Недельная нагрузка: ${cs?.weeklyLoadStatus ?? 'unknown'}
Мезоцикл: ${phase}
Усталость по группам: ${muscleFatigue}
Тренировок за 7 дней: ${input.weeklyContext.calendarWorkoutCountLast7}
Предыдущая тренировка: ${daysSince !== null ? `${daysSince} дн назад` : 'нет данных'}
Цель: ${input.profile.goal ?? 'общий прогресс'}
Уровень: ${input.profile.level ?? 'intermediate'}
Упражнения: ${exercises}
Приоритет: ${input.decision?.priorityMuscleGroups?.join(', ') ?? 'нет'}
Избегать: ${input.decision?.avoidMuscleGroups?.join(', ') ?? 'нет'}
${input.lowReadiness ? 'Внимание: сниженная готовность, тренировка облегчена.' : ''}
${deloadHint}

Объясни почему эта тренировка именно такая.`
}

/**
 * Fallback: template-based narration (same as old buildCoachReason,
 * but simplified and human-readable).
 */
function buildTemplateNarration(input: NarrationInput): string {
  const cs = input.coachState
  const readiness = cs?.readinessScore ?? 70
  const recovery = cs?.recoveryStatus ?? 'unknown'
  const exercises = input.selectedExercises
  const muscleGroups = [...new Set(exercises.map((e) => e.muscleGroup))].join(', ')
  const daysSince = input.weeklyContext.daysSincePreviousWorkout

  if (input.lowReadiness) {
    return `Готовность снижена (${readiness}/100), поэтому тренировка облегчена. Работаем ${muscleGroups}, без отказа. ${daysSince !== null ? `Отдых после прошлой тренировки: ${daysSince} дн.` : ''}`
  }

  const phaseText = cs?.mesocycle?.isDeload
    ? 'Разгрузочная неделя — снижаем объём и интенсивность.'
    : cs?.mesocycle?.phase === 'intensification'
      ? 'Пиковая неделя мезоцикла — работаем на полную.'
      : ''

  const focusText = input.preferences.focusAreas?.length
    ? `Фокус на ${input.preferences.focusAreas.join(', ')}.`
    : ''

  const parts = [
    `Восстановление ${recovery === 'ready' ? 'хорошее' : recovery === 'partial' ? 'частичное' : 'снижено'}, готовность ${readiness}/100.`,
    `Сегодня работаем: ${muscleGroups}.`,
    phaseText,
    focusText,
    daysSince !== null && daysSince <= 1 ? 'Внимание: маленький отдых после прошлой тренировки.' : '',
  ].filter(Boolean)

  return parts.join(' ')
}

function muscleLabel(key: string): string {
  const labels: Record<string, string> = {
    chest: 'Грудь',
    back: 'Спина',
    legs: 'Ноги',
    shoulders: 'Плечи',
    arms: 'Руки',
    core: 'Кор',
  }
  return labels[key] ?? key
}
