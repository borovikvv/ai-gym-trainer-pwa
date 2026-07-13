/**
 * AI Level 3 (#85): LLM-powered weekly program review.
 *
 * Analyzes the training program + recent progress and suggests changes:
 * - swap_exercise (replace plateaued exercise)
 * - adjust_volume (increase/decrease sets)
 * - change_focus (shift emphasis between muscle groups)
 * - add_deload (recommend early deload)
 *
 * Suggestions are NOT applied automatically — the user must confirm via UI.
 * Falls back to rule-based suggestions if no API key or LLM fails.
 */

import type { WorkoutHistoryEntry, CoachState, CoachMemory } from '../shared/types.js'
import { requestLlmJson } from './lib/llmClient.js'

interface WorkoutDayInput {
  name?: string
  exercises: Array<{ name: string; id?: string; muscleGroup?: string; setsCount?: number }>
}

interface ProgramReviewInput {
  userId: string
  history: WorkoutHistoryEntry[]
  programDays: WorkoutDayInput[]
  coachState: CoachState | null
  coachMemory: CoachMemory | null
  /** Фаза 2: блок долгосрочной памяти (травмы, реакции, цели с прогрессом). */
  longTermMemory?: string
  profile: {
    goal?: string
    level?: string
    age?: number | null
    workoutsPerWeek?: number
    bannedExercises?: string[]
    preferredExercises?: string[]
  }
  now: Date
}

export type ProgramChangeType = 'swap_exercise' | 'adjust_volume' | 'change_focus' | 'add_deload'

export interface ProgramChange {
  type: ProgramChangeType
  description: string
  rationale: string
  exerciseId?: string
  exerciseName?: string
  newExerciseId?: string
  newExerciseName?: string
  newSetsCount?: number
  priority: 'high' | 'medium' | 'low'
}

export interface ProgramReview {
  date: string
  summary: string
  rating: 'excellent' | 'good' | 'needs_adjustment' | 'stale'
  changes: ProgramChange[]
  nextWeekFocus: string
}

/**
 * Review the training program and suggest changes.
 */
export async function reviewProgram(input: ProgramReviewInput): Promise<ProgramReview> {
  const parsed = await requestLlmJson<ProgramReview>({
    tier: 'smart',
    caller: 'coachProgramReview',
    temperature: 0.3,
    maxTokens: 500,
    system:
      'Ты опытный силовой тренер. Проанализируй программу атлета за последнюю неделю и предложи изменения. Если у атлета есть цели и по ним видно отставание от графика — предлагай изменения, приближающие к цели (приоритет целевого упражнения, объём на нужную группу), и отрази путь к цели в nextWeekFocus. Верни строго JSON: {"summary":"коротко","rating":"excellent|good|needs_adjustment|stale","changes":[{"type":"swap_exercise|adjust_volume|change_focus|add_deload","description":"","rationale":"","exerciseName":"","newExerciseName":"","newSetsCount":0,"priority":"high|medium|low"}],"nextWeekFocus":""}. Пиши на русском. Максимум 3 изменения.',
    prompt: buildLlmPrompt(input),
  })
  if (!parsed) return ruleBasedReview(input)
  parsed.date = input.now.toISOString()
  // Clamp changes to 3
  if (parsed.changes && parsed.changes.length > 3) {
    parsed.changes = parsed.changes.slice(0, 3)
  }
  return parsed
}

function buildLlmPrompt(input: ProgramReviewInput): string {
  const now = input.now
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

  // Current program
  const programText = input.programDays
    .map((day) => `${day.name}: ${day.exercises.map((e: { name: string }) => e.name).join(', ')}`)
    .join('\n')

  // Recent workouts (last 7 days)
  const recentWorkouts = input.history.filter((s) => new Date(s.completedAt) >= sevenDaysAgo)
  const workoutsCount = recentWorkouts.length

  // RPE average
  const rpes: number[] = []
  for (const s of recentWorkouts) {
    for (const e of s.exercises ?? []) {
      for (const set of e.sets ?? []) {
        if (set.completed && set.rpe) rpes.push(set.rpe)
      }
    }
  }
  const avgRpe = rpes.length > 0 ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : 'нет данных'

  // Pain
  const painExercises = recentWorkouts
    .flatMap((s) => s.exercises ?? [])
    .filter((e) => e.pain)
    .map((e) => e.exerciseName)
  const painText = painExercises.length > 0 ? painExercises.join(', ') : 'нет'

  // Volume per muscle group
  const muscleVol: Record<string, number> = {}
  for (const s of recentWorkouts) {
    for (const e of s.exercises ?? []) {
      const vol = (e.sets ?? []).filter((s) => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0)
      muscleVol[e.muscleGroup ?? 'Другое'] = (muscleVol[e.muscleGroup ?? 'Другое'] ?? 0) + vol
    }
  }
  const volText = Object.entries(muscleVol).sort(([, a], [, b]) => b - a).map(([k, v]) => `${k}: ${Math.round(v)}`).join(', ')

  // e1RM trends from coachMemory
  const muscleProfiles = input.coachMemory?.muscleGroupProfiles
  const fatigueText = muscleProfiles
    ? Object.entries(muscleProfiles)
        .filter(([, g]) => g?.status === 'avoid' || g?.status === 'fatigued')
        .map(([k, g]) => `${k}: ${g?.status}`)
        .join(', ') || 'нет'
    : 'нет данных'

  const cs = input.coachState

  // Issue #90: explicitly flag deload context so the LLM does not suggest
  // add_deload or volume cuts when the user is already in a deload week.
  const isDeload = Boolean(cs?.mesocycle?.isDeload) || cs?.mesocycle?.phase === 'deload'
  const deloadHint = isDeload
    ? 'ВАЖНО: текущая неделя — разгрузочная (deload). Не предлагай add_deload или снижение объёма — пользователь уже разгружается. Снижение e1RM и рост RPE на этой неделе ожидаемы.'
    : ''

  // Фаза 2: память + цели. Обзор обязан оценивать «путь к цели» — прогресс
  // уже посчитан правилами (refreshGoalProgress) и входит в блок памяти.
  const memoryBlock = input.longTermMemory ? `\n${input.longTermMemory}\n` : ''

  return `Дата: ${now.toISOString().slice(0, 10)}
${memoryBlock}
Текущая программа:
${programText}

Тренировок за неделю: ${workoutsCount}
Средний RPE: ${avgRpe}
Боль: ${painText}
Объём по группам: ${volText}
Усталость: ${fatigueText}
Мезоцикл: ${cs?.mesocycle?.phase ?? 'unknown'} (неделя ${cs?.mesocycle?.weekInCycle ?? '?'}/${cs?.mesocycle?.cycleLength ?? '?'})
Готовность: ${cs?.readinessScore ?? '?'}/100
Цель: ${input.profile.goal ?? 'общий прогресс'}
Уровень: ${input.profile.level ?? 'intermediate'}
${deloadHint}

Предложи 1-3 изменения (не больше). Для каждого: тип, описание, обоснование.
Не меняй больше 2 упражнений за раз.
Учитывай фазу мезоцикла: не предлагай разгрузку, если уже идёт deload-неделя.`
}

/**
 * Fallback: rule-based program review (without LLM).
 */
function ruleBasedReview(input: ProgramReviewInput): ProgramReview {
  const now = input.now
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const changes: ProgramChange[] = []

  // Issue #90: do not suggest add_deload when the user is already in a
  // deload week. Surface a gentle informational note instead.
  const isDeloadPhase = Boolean(input.coachState?.mesocycle?.isDeload)
    || input.coachState?.mesocycle?.phase === 'deload'

  // Check pain
  const painExercises = input.history
    .filter((s) => new Date(s.completedAt) >= sevenDaysAgo)
    .flatMap((s) => s.exercises ?? [])
    .filter((e) => e.pain)

  if (painExercises.length >= 2) {
    const painNames = [...new Set(painExercises.map((e) => e.exerciseName))]
    changes.push({
      type: 'swap_exercise',
      description: `Заменить: ${painNames.join(', ')}`,
      rationale: `${painExercises.length} отметок боли за неделю. Упражнение вызывает дискомфорт.`,
      exerciseName: painNames[0],
      priority: 'high',
    })
  }

  // Check high RPE — but skip add_deload suggestion during a deload week
  const rpes: number[] = []
  input.history
    .filter((s) => new Date(s.completedAt) >= sevenDaysAgo)
    .forEach((s) => s.exercises?.forEach((e) => e.sets?.forEach((set) => {
      if (set.completed && set.rpe) rpes.push(set.rpe)
    })))

  if (rpes.length > 0) {
    const avgRpe = rpes.reduce((a, b) => a + b, 0) / rpes.length
    if (avgRpe > 8.5 && !isDeloadPhase) {
      changes.push({
        type: 'add_deload',
        description: 'Рекомендую разгрузочную неделю',
        rationale: `Средний RPE за неделю: ${avgRpe.toFixed(1)}. Высокая усталость.`,
        priority: 'high',
      })
    }
  }

  // Check muscle group fatigue from coachMemory
  const muscleProfiles = input.coachMemory?.muscleGroupProfiles
  if (muscleProfiles) {
    const fatigued = Object.entries(muscleProfiles)
      .filter(([, g]) => g?.status === 'fatigued' || g?.status === 'avoid')
      .map(([k]) => k)
    if (fatigued.length >= 2) {
      changes.push({
        type: 'change_focus',
        description: `Сменить фокус: избегать ${fatigued.join(', ')}`,
        rationale: `${fatigued.length} групп мышц с высокой усталостью.`,
        priority: 'medium',
      })
    }
  }

  // Check completion rate
  const workoutsCount = input.history.filter((s) => new Date(s.completedAt) >= sevenDaysAgo).length
  const planned = input.profile.workoutsPerWeek ?? 3
  if (workoutsCount < planned * 0.5 && workoutsCount > 0) {
    changes.push({
      type: 'adjust_volume',
      description: 'Снизить объём на 1 подход',
      rationale: `Выполнено ${workoutsCount} из ${planned} тренировок. Снижаем нагрузку.`,
      newSetsCount: 2,
      priority: 'low',
    })
  }

  // Build summary
  const rating: ProgramReview['rating'] = changes.length === 0
    ? 'good'
    : changes.some((c) => c.priority === 'high')
      ? 'needs_adjustment'
      : 'good'

  const parts: string[] = []
  if (changes.length === 0) {
    parts.push('Программа работает хорошо, изменений не требуется.')
  } else {
    parts.push(`Найдено ${changes.length} рекомендаций.`)
  }

  return {
    date: now.toISOString(),
    summary: parts.join(' '),
    rating,
    changes,
    nextWeekFocus: changes.length === 0
      ? 'Продолжаем в том же режиме.'
      : changes[0].description,
  }
}
