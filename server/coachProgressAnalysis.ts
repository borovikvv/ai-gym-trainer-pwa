/**
 * AI Level 2 (#84): LLM-powered progress analysis.
 *
 * Analyzes workout history, e1RM trends, volume, and fatigue to detect:
 * - Plateaus (e1RM stagnant 3+ weeks)
 * - Lagging muscle groups
 * - Overtraining (e1RM dropping, RPE rising)
 * - Volume imbalances between muscle groups
 *
 * Falls back to rule-based analysis if no API key or LLM fails.
 */

import type { WorkoutHistoryEntry } from '../shared/types.js'
import type { CoachState, CoachMemory } from '../shared/types.js'

interface E1RMSummary {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  currentBest: number
  trendDirection: 'up' | 'down' | 'flat' | 'insufficient_data'
  slopePerWeek: number
  dataPointCount: number
}

interface ProgressAnalysisInput {
  userId: string
  history: WorkoutHistoryEntry[]
  e1rmHistories: E1RMSummary[]
  coachState: CoachState | null
  coachMemory: CoachMemory | null
  now: Date
}

export interface ProgressAnalysis {
  date: string
  summary: string
  plateaus: Array<{
    exerciseName: string
    weeksStagnant: number
    recommendation: string
  }>
  improvements: Array<{
    exerciseName: string
    e1rmChangePercent: number
    note: string
  }>
  warnings: string[]
  suggestions: string[]
}

interface LlmResponseBody {
  choices?: Array<{ message?: { content?: string } }>
}

const LLM_TIMEOUT_MS = 5000

/**
 * Analyze workout progress using LLM (if available) or rules (fallback).
 */
export async function analyzeProgress(input: ProgressAnalysisInput): Promise<ProgressAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return ruleBasedAnalysis(input)

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
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Ты спортивный аналитик. Проанализируй прогресс атлета. Верни строго JSON: {"summary":"коротко 2-3 предложения","plateaus":[{"exerciseName":"","weeksStagnant":0,"recommendation":""}],"improvements":[{"exerciseName":"","e1rmChangePercent":0,"note":""}],"warnings":[""],"suggestions":[""]}. Пиши на русском.',
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
    if (!content) throw new Error('Empty LLM response')

    const parsed = JSON.parse(content) as ProgressAnalysis
    parsed.date = input.now.toISOString()
    return parsed
  } catch (error) {
    console.warn('coachProgressAnalysis LLM failed, using rules:', error instanceof Error ? error.message : error)
    return ruleBasedAnalysis(input)
  }
}

function buildLlmPrompt(input: ProgressAnalysisInput): string {
  const cs = input.coachState
  const now = input.now
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86_400_000)

  // e1RM summaries
  const e1rmText = input.e1rmHistories
    .map((e) => `${e.exerciseName} (${e.muscleGroup}): e1RM=${e.currentBest}кг, тренд=${e.trendDirection}, ${e.slopePerWeek > 0 ? '+' : ''}${e.slopePerWeek.toFixed(1)}кг/нед, точек=${e.dataPointCount}`)
    .join('\n')

  // Volume per muscle group (last 4 weeks)
  const muscleVolume: Record<string, number> = {}
  for (const session of input.history) {
    const sessionDate = new Date(session.completedAt)
    if (sessionDate < fourWeeksAgo) continue
    for (const exercise of session.exercises ?? []) {
      const vol = (exercise.sets ?? []).filter((s) => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0)
      muscleVolume[exercise.muscleGroup ?? 'Другое'] = (muscleVolume[exercise.muscleGroup ?? 'Другое'] ?? 0) + vol
    }
  }
  const volumeText = Object.entries(muscleVolume)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}: ${Math.round(v)}кг`)
    .join(', ')

  // RPE trend
  const recentRpes: number[] = []
  for (const session of input.history) {
    const sessionDate = new Date(session.completedAt)
    if (sessionDate < fourWeeksAgo) continue
    for (const exercise of session.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        if (set.completed && set.rpe) recentRpes.push(set.rpe)
      }
    }
  }
  const avgRpe = recentRpes.length > 0 ? (recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length).toFixed(1) : 'нет данных'

  // Pain count
  const painCount = input.history
    .filter((s) => new Date(s.completedAt) >= fourWeeksAgo)
    .flatMap((s) => s.exercises ?? [])
    .filter((e) => e.pain).length

  // Workouts count
  const workoutsCount = input.history.filter((s) => new Date(s.completedAt) >= fourWeeksAgo).length

  return `Дата анализа: ${now.toISOString().slice(0, 10)}

Тренировок за 4 недели: ${workoutsCount}
Средний RPE: ${avgRpe}
Отметок боли: ${painCount}

e1RM по упражнениям:
${e1rmText || 'нет данных'}

Объём по группам мышц (4 нед):
${volumeText || 'нет данных'}

Мезоцикл: ${cs?.mesocycle?.phase ?? 'unknown'} (неделя ${cs?.mesocycle?.weekInCycle ?? '?'}/${cs?.mesocycle?.cycleLength ?? '?'})
Готовность: ${cs?.readinessScore ?? '?'}/100
Восстановление: ${cs?.recoveryStatus ?? 'unknown'}
Усталость: ${cs?.muscleGroups ? Object.entries(cs.muscleGroups).filter(([, g]) => g?.fatigue === 'high').map(([k]) => k).join(', ') || 'нет' : 'нет данных'}

Найди:
1. Плато (e1RM не растёт 3+ недели или trend=flat/down при dataPointCount>=3)
2. Улучшения (e1RM растёт, trend=up)
3. Перетренированность (RPE высокий, e1RM падает)
4. Дисбаланс (разница в объёме между группами > 40%)`
}

/**
 * Fallback: rule-based analysis (without LLM).
 */
function ruleBasedAnalysis(input: ProgressAnalysisInput): ProgressAnalysis {
  const now = input.now
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86_400_000)
  const plateaus: ProgressAnalysis['plateaus'] = []
  const improvements: ProgressAnalysis['improvements'] = []
  const warnings: string[] = []
  const suggestions: string[] = []

  // Check e1RM trends
  for (const e of input.e1rmHistories) {
    if (e.dataPointCount < 3) continue

    if (e.trendDirection === 'flat') {
      plateaus.push({
        exerciseName: e.exerciseName,
        weeksStagnant: e.dataPointCount,
        recommendation: `e1RM на ${e.exerciseName} не растёт. Рассмотри замену упражнения или изменение схемы подходов.`,
      })
    } else if (e.trendDirection === 'down') {
      warnings.push(`${e.exerciseName}: e1RM падает (${e.slopePerWeek.toFixed(1)} кг/нед). Возможна перетренированность.`)
    } else if (e.trendDirection === 'up' && e.slopePerWeek > 0.5) {
      improvements.push({
        exerciseName: e.exerciseName,
        e1rmChangePercent: Math.round((e.slopePerWeek / e.currentBest) * 100 * 10) / 10,
        note: `Хороший прогресс: +${e.slopePerWeek.toFixed(1)} кг/нед.`,
      })
    }
  }

  // Check RPE trend
  const recentRpes: number[] = []
  for (const session of input.history) {
    if (new Date(session.completedAt) < fourWeeksAgo) continue
    for (const exercise of session.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        if (set.completed && set.rpe) recentRpes.push(set.rpe)
      }
    }
  }
  if (recentRpes.length > 0) {
    const avgRpe = recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length
    if (avgRpe > 8.5) {
      warnings.push(`Средний RPE за 4 недели: ${avgRpe.toFixed(1)}. Высокая усталость — рассмотри разгрузочную неделю.`)
    }
  }

  // Check volume imbalance
  const muscleVolume: Record<string, number> = {}
  for (const session of input.history) {
    if (new Date(session.completedAt) < fourWeeksAgo) continue
    for (const exercise of session.exercises ?? []) {
      const vol = (exercise.sets ?? []).filter((s) => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0)
      const key = exercise.muscleGroup ?? 'Другое'
      muscleVolume[key] = (muscleVolume[key] ?? 0) + vol
    }
  }
  const volumes = Object.entries(muscleVolume).sort(([, a], [, b]) => b - a)
  if (volumes.length >= 2) {
    const max = volumes[0][1]
    const min = volumes[volumes.length - 1][1]
    if (max > 0 && min > 0 && max / min > 2.5) {
      suggestions.push(`Дисбаланс объёма: ${volumes[0][0]} (${Math.round(max)}кг) значительно больше ${volumes[volumes.length - 1][0]} (${Math.round(min)}кг).`)
    }
  }

  // Pain check
  const painCount = input.history
    .filter((s) => new Date(s.completedAt) >= fourWeeksAgo)
    .flatMap((s) => s.exercises ?? [])
    .filter((e) => e.pain).length
  if (painCount > 0) {
    warnings.push(`За последние 4 недели: ${painCount} отметок боли. Не прогрессируй вес на болезненных упражнениях.`)
  }

  // Build summary
  const parts: string[] = []
  if (improvements.length > 0) {
    parts.push(`Прогресс есть: ${improvements.map((i) => i.exerciseName).join(', ')}.`)
  }
  if (plateaus.length > 0) {
    parts.push(`Плато: ${plateaus.map((p) => p.exerciseName).join(', ')}.`)
  }
  if (warnings.length > 0) {
    parts.push(`Есть замечания (${warnings.length}).`)
  }
  if (parts.length === 0) {
    parts.push('Прогресс стабильный, без тревожных сигналов.')
  }

  return {
    date: now.toISOString(),
    summary: parts.join(' '),
    plateaus,
    improvements,
    warnings,
    suggestions,
  }
}
