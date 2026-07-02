/**
 * AI Level 1 (#83): LLM-powered coach narration.
 *
 * Replaces template-based buildCoachReason with LLM-generated human-readable
 * text. Falls back to templates if no API key or LLM fails.
 */

import type { CoachState } from '../shared/types.js'

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
}

interface LlmResponseBody {
  choices?: Array<{ message?: { content?: string } }>
}

const LLM_TIMEOUT_MS = 3000

/**
 * Generate a human-readable coach narration using LLM.
 * Falls back to template if no API key, LLM fails, or timeout.
 */
export async function generateCoachNarration(input: NarrationInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return buildTemplateNarration(input)

  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'

  const prompt = buildLlmPrompt(input)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: 'Ты персональный силовой тренер. Объясни пользователю коротко (2-3 предложения) почему именно эта тренировка. Пиши на русском, дружелюбно, без технических терминов (readiness, MEV, MRV). Без emoji. Максимум 3 предложения.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const body = (await response.json()) as LlmResponseBody
    const content = body?.choices?.[0]?.message?.content
    if (!content || content.trim().length < 10) throw new Error('Empty LLM response')

    return content.trim()
  } catch (error) {
    console.warn('coachNarrator LLM failed, using template:', error instanceof Error ? error.message : error)
    return buildTemplateNarration(input)
  }
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

  return `Дата: ${input.scheduledDate}
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
