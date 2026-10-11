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
import { requestLlmJsonDetailed } from './lib/llmClient.js'
import { logActivity } from './activityLog.js'

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
  /** Фаза 2: блок долгосрочной памяти (травмы, реакции, цели). */
  longTermMemory?: string
}

export interface ExerciseAnalysisFlag {
  exerciseId: string
  exerciseName: string
  status: 'plateau' | 'trending_up' | 'trending_down' | 'stable' | 'insufficient_data'
  weeksStagnant?: number
  slopePerWeek?: number
  recommendation: 'swap_exercise' | 'increase_weight' | 'hold_weight' | 'decrease_weight' | 'consolidate' | 'monitor'
  reason: string
}

export interface GlobalAnalysisFlags {
  overtraining: boolean
  overtrainingReason?: string
  muscleImbalance?: Array<{ muscleGroup: string; status: 'overworked' | 'underworked' }>
  recommendedDeload: boolean
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
  // Issue #105: structured flags for the planner (#106) and training records (#108)
  exerciseFlags: ExerciseAnalysisFlag[]
  globalFlags: GlobalAnalysisFlags
  // Issue #410: response was cut off by the token budget (`finish_reason:
  // 'length'`); treat the analysis as lower-confidence.
  degraded?: boolean
}

type LlmProgressAnalysisResponse = Omit<Partial<ProgressAnalysis>, 'exerciseFlags' | 'globalFlags'>

/**
 * Analyze workout progress using LLM (if available) or rules (fallback).
 */
export async function analyzeProgress(input: ProgressAnalysisInput): Promise<ProgressAnalysis> {
  // Issue #416: structured flags are decisions, not text — always derive them
  // from rules. The LLM only writes the text fields and sees the rule decisions
  // as input so its text cannot contradict them.
  const rules = ruleBasedAnalysis(input)
  const { data: parsed, truncated } = await requestLlmJsonDetailed<LlmProgressAnalysisResponse>({
    tier: 'smart',
    caller: 'coachProgressAnalysis',
    temperature: 0.3,
    maxTokens: 6000,
    system:
      'Ты спортивный аналитик. Проанализируй прогресс атлета. Верни строго JSON: {"summary":"коротко 2-3 предложения","plateaus":[{"exerciseName":"","weeksStagnant":0,"recommendation":""}],"improvements":[{"exerciseName":"","e1rmChangePercent":0,"note":""}],"warnings":[""],"suggestions":[""]}. Пиши на русском. Решения по статусам, рекомендациям по каждому упражнению и глобальным флагам (перетренированность, разгрузка) уже приняты правилами и переданы во входных данных. Не меняй эти решения — только опиши их словами в текстовых полях.',
    prompt: buildLlmPrompt(input, rules),
  })
  if (!parsed) {
    if (truncated) {
      rules.degraded = true
      logActivity('coachProgressAnalysis.degraded', {
        caller: 'coachProgressAnalysis',
        reason: 'truncated_fallback_to_rules',
      })
    }
    return rules
  }
  parsed.date = input.now.toISOString()
  // Issue #416: structured flags always come from rules, never from the LLM.
  const analysis = parsed as ProgressAnalysis
  analysis.exerciseFlags = rules.exerciseFlags
  analysis.globalFlags = rules.globalFlags
  // Issue #410: a truncated response may still repair to valid JSON, but tail
  // fields can be missing — mark it degraded rather than trusting it fully.
  if (truncated) {
    analysis.degraded = true
    logActivity('coachProgressAnalysis.degraded', {
      caller: 'coachProgressAnalysis',
      reason: 'truncated_partial_json',
    })
  }
  return analysis
}

function buildLlmPrompt(input: ProgressAnalysisInput, rules: ProgressAnalysis): string {
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

  // Issue #90: explicitly flag deload context so the LLM does not interpret
  // an expected temporary dip in e1RM as overtraining.
  const isDeload = Boolean(cs?.mesocycle?.isDeload) || cs?.mesocycle?.phase === 'deload'
  const deloadHint = isDeload
    ? 'ВАЖНО: текущая неделя — разгрузочная (deload). Временное снижение e1RM и рост RPE — ожидаемая норма, НЕ признак перетренированности. Не флаги падение e1RM как тревожный сигнал в этой фазе.'
    : ''

  // Фаза 2: долгосрочная память (травмы, реакции на нагрузку, цели)
  const memoryBlock = input.longTermMemory ? `\n${input.longTermMemory}\n` : ''

  // Issue #416: pass the rule-based decisions to the LLM as input so its text
  // does not contradict the flags that will be returned in the result.
  const flagsText = rules.exerciseFlags
    .map((f) => `${f.exerciseName}: статус=${f.status}, рекомендация=${f.recommendation}, причина=${f.reason}`)
    .join('\n')
  const globalFlagsText = `Глобально: overtraining=${rules.globalFlags.overtraining}${rules.globalFlags.overtrainingReason ? ` (${rules.globalFlags.overtrainingReason})` : ''}, recommendedDeload=${rules.globalFlags.recommendedDeload}`

  return `Дата анализа: ${now.toISOString().slice(0, 10)}
${memoryBlock}
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
${deloadHint}

Флаги по правилам (не меняй решения, только опиши их словами):
${flagsText || 'нет данных'}
${globalFlagsText}

Найди:
1. Плато (e1RM не растёт 3+ недели или trend=flat/down при dataPointCount>=3, и это НЕ deload-неделя)
2. Улучшения (e1RM растёт, trend=up)
3. Перетренированность (RPE высокий, e1RM падает). ВАЖНО: если текущая или предыдущая неделя — разгрузочная (deload phase), временное снижение e1RM НОРМАЛЬНО и НЕ является признаком перетренированности. Учитывай фазу мезоцикла при интерпретации трендов.
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
  // Issue #105: structured flags for the planner
  const exerciseFlags: ExerciseAnalysisFlag[] = []
  let overtraining = false
  let overtrainingReason: string | undefined
  let recommendedDeload = false

  // Issue #90: deload-aware e1RM interpretation. A temporary dip during a
  // deload week (or the week right after) is expected and should NOT be
  // flagged as overtraining. We only flag a downward trend as a warning
  // when the user is NOT in a deload phase.
  const isDeloadPhase = Boolean(input.coachState?.mesocycle?.isDeload)
    || input.coachState?.mesocycle?.phase === 'deload'

  // Check e1RM trends
  for (const e of input.e1rmHistories) {
    if (e.dataPointCount < 3) {
      // Insufficient data — still emit a flag so the planner knows
      exerciseFlags.push({
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        status: 'insufficient_data',
        recommendation: 'monitor',
        reason: `Мало данных (${e.dataPointCount} точек) для оценки тренда`,
      })
      continue
    }

    if (e.trendDirection === 'flat') {
      plateaus.push({
        exerciseName: e.exerciseName,
        weeksStagnant: e.dataPointCount,
        recommendation: `e1RM на ${e.exerciseName} не растёт. Рассмотри замену упражнения или изменение схемы подходов.`,
      })
      exerciseFlags.push({
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        status: 'plateau',
        weeksStagnant: e.dataPointCount,
        slopePerWeek: e.slopePerWeek,
        recommendation: 'swap_exercise',
        reason: `e1RM не растёт ${e.dataPointCount} недель — плато, рассмотри замену`,
      })
    } else if (e.trendDirection === 'down') {
      if (isDeloadPhase) {
        // Expected during deload — surface as informational, not a warning.
        suggestions.push(`${e.exerciseName}: e1RM ниже обычного (${e.slopePerWeek.toFixed(1)} кг/нед), но это разгрузочная неделя — снижение ожидаемо.`)
        exerciseFlags.push({
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          status: 'trending_down',
          slopePerWeek: e.slopePerWeek,
          recommendation: 'monitor',
          reason: 'Снижение e1RM в deload-неделю — ожидаемо',
        })
      } else {
        warnings.push(`${e.exerciseName}: e1RM падает (${e.slopePerWeek.toFixed(1)} кг/нед). Возможна перетренированность.`)
        overtraining = true
        overtrainingReason = `${e.exerciseName}: e1RM падает (${e.slopePerWeek.toFixed(1)} кг/нед)`
        exerciseFlags.push({
          exerciseId: e.exerciseId,
          exerciseName: e.exerciseName,
          status: 'trending_down',
          slopePerWeek: e.slopePerWeek,
          recommendation: 'decrease_weight',
          reason: 'e1RM падает — снизить вес, возможна перетренированность',
        })
      }
    } else if (e.trendDirection === 'up' && e.slopePerWeek > 0.5) {
      improvements.push({
        exerciseName: e.exerciseName,
        e1rmChangePercent: Math.round((e.slopePerWeek / e.currentBest) * 100 * 10) / 10,
        note: `Хороший прогресс: +${e.slopePerWeek.toFixed(1)} кг/нед.`,
      })
      exerciseFlags.push({
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        status: 'trending_up',
        slopePerWeek: e.slopePerWeek,
        recommendation: 'increase_weight',
        reason: `e1RM растёт +${e.slopePerWeek.toFixed(1)} кг/нед — можно повысить вес`,
      })
    } else {
      // Stable or slow up
      exerciseFlags.push({
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        status: 'stable',
        slopePerWeek: e.slopePerWeek,
        recommendation: 'hold_weight',
        reason: 'e1RM стабилен — держать вес',
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
    if (avgRpe > 8.5 && !isDeloadPhase) {
      warnings.push(`Средний RPE за 4 недели: ${avgRpe.toFixed(1)}. Высокая усталость — рассмотри разгрузочную неделю.`)
      overtraining = true
      if (!overtrainingReason) overtrainingReason = `Средний RPE ${avgRpe.toFixed(1)} — высокая усталость`
      recommendedDeload = true
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
  const muscleImbalance: Array<{ muscleGroup: string; status: 'overworked' | 'underworked' }> = []
  if (volumes.length >= 2) {
    const max = volumes[0][1]
    const min = volumes[volumes.length - 1][1]
    if (max > 0 && min > 0 && max / min > 2.5) {
      suggestions.push(`Дисбаланс объёма: ${volumes[0][0]} (${Math.round(max)}кг) значительно больше ${volumes[volumes.length - 1][0]} (${Math.round(min)}кг).`)
      muscleImbalance.push({ muscleGroup: volumes[0][0], status: 'overworked' })
      muscleImbalance.push({ muscleGroup: volumes[volumes.length - 1][0], status: 'underworked' })
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
    exerciseFlags,
    globalFlags: {
      overtraining,
      overtrainingReason,
      muscleImbalance: muscleImbalance.length > 0 ? muscleImbalance : undefined,
      recommendedDeload,
    },
  }
}
