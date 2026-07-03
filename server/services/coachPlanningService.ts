// Issue #67 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState, WorkoutHistoryEntry } from '../../shared/types.js'
import type { DbClient } from '../dbClient.js'
import type { SafeCoachPlan, CoachPlanChange } from '../coachPlanner.js'
import { COACH_PERSONA, buildCoachPrompt, buildSafeCoachPlan, clampCoachPlanToNextWorkout, chooseNextWorkoutDay } from '../coachPlanner.js'
import { computeCoachState } from '../coachState.js'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from '../coachDecisionLog.js'
import { loadExerciseLibrary, loadRecentHistory, loadUserProfile, loadUserWorkoutDays } from './programService.js'

interface CompletedEntry {
  userId: string
  id: string
  completedAt?: string
  workoutDayId?: string
  debrief?: { qualityScore?: number } | null
  exercises?: WorkoutHistoryEntry['exercises']
}

interface ProfileForPlanning {
  userId?: string
  age?: number | null
  goal?: string
  level?: string
  workoutsPerWeek?: number
  trainingDays?: string[]
}

interface WorkoutDayRef {
  id?: string
  name?: string
  label?: string
  exercises?: Array<{ programExerciseId?: string; name?: string }>
}

interface RequestLlmCoachPlanParams {
  profile: ProfileForPlanning
  workoutDays: WorkoutDayRef[]
  completedWorkout: CompletedEntry
  history: WorkoutHistoryEntry[]
  nextWorkoutDay: WorkoutDayRef | null
  coachState: CoachState | null
  exerciseLibrary: unknown[]
}

interface LlmPlan extends Partial<SafeCoachPlan> {
  source?: string
  nextWorkoutDayId?: string
}

interface LlmResponseBody {
  choices?: Array<{ message?: { content?: string } }>
}

// Issue #95: cap LLM call duration. Without this, a slow LLM (10-30s) holds
// the pg connection inside the save transaction, exhausting the pool under
// concurrent saves. All other LLM callers (coachNarrator, coachProgressAnalysis,
// coachProgramReview, coachBrain) already use AbortController with 3-5s timeout.
const LLM_TIMEOUT_MS = 5000

export async function planAndApplyNextWorkout(client: DbClient, completedEntry: CompletedEntry): Promise<SafeCoachPlan | null> {
  const [profile, workoutDays, history, exerciseLibrary] = await Promise.all([
    loadUserProfile(client, completedEntry.userId),
    loadUserWorkoutDays(client, completedEntry.userId),
    loadRecentHistory(client, completedEntry.userId),
    loadExerciseLibrary(client),
  ]) as unknown as [ProfileForPlanning, WorkoutDayRef[], WorkoutHistoryEntry[], unknown[]]
  const nextWorkoutDay = chooseNextWorkoutDay({ workoutDays, completedWorkout: completedEntry })
  if (!nextWorkoutDay) return null
  const debriefQualityScore = completedEntry.debrief?.qualityScore ?? null
  const coachState = computeCoachState({
    profile,
    workoutDays: workoutDays as unknown as Parameters<typeof computeCoachState>[0]['workoutDays'],
    history: [completedEntry as unknown as WorkoutHistoryEntry, ...history],
    now: new Date(completedEntry.completedAt ?? Date.now()),
    lastWorkoutQualityScore: debriefQualityScore,
  })

  const rulesPlan = buildSafeCoachPlan({
    profile,
    workoutDays: workoutDays as unknown as Parameters<typeof buildSafeCoachPlan>[0]['workoutDays'],
    completedWorkout: completedEntry,
    history: [completedEntry as unknown as WorkoutHistoryEntry, ...history],
    now: new Date(completedEntry.completedAt ?? Date.now()),
    coachState,
    exerciseLibrary: exerciseLibrary as unknown as NonNullable<Parameters<typeof buildSafeCoachPlan>[0]>["exerciseLibrary"],
    workoutQualityScore: debriefQualityScore,
  })

  const llmPlan = await requestLlmCoachPlan({ profile, workoutDays, completedWorkout: completedEntry, history, nextWorkoutDay, coachState, exerciseLibrary })
  const safePlan = clampCoachPlanToNextWorkout({ plan: llmPlan ?? rulesPlan, nextWorkoutDay, exerciseLibrary: exerciseLibrary as unknown as NonNullable<Parameters<typeof clampCoachPlanToNextWorkout>[0]>["exerciseLibrary"] })
  if (safePlan.changes.length === 0) {
    safePlan.changes = rulesPlan.changes
    safePlan.source = rulesPlan.source
    safePlan.summary = rulesPlan.summary
  } else {
    const rulesReplacements = new Map(rulesPlan.changes.filter((change) => change.exerciseId).map((change) => [change.programExerciseId, change]))
    safePlan.changes = safePlan.changes.map((change) => {
      const safeReplacement: CoachPlanChange | undefined = rulesReplacements.get(change.programExerciseId)
      if (!safeReplacement || change.exerciseId) return change
      return { ...change, ...safeReplacement, coachFocus: `${safeReplacement.coachFocus} ${change.coachFocus ?? ''}`.slice(0, 500) }
    })
  }

  for (const change of safePlan.changes) {
    await client.query(
      `update public.program_exercises
       set exercise_id = coalesce($9, exercise_id),
           target_weight = $2,
           sets_count = $3,
           rep_min = $4,
           rep_max = $5,
           rest_seconds = $6,
           today_goal = $7,
           coach_focus = $8
       where id = $1`,
      [
        change.programExerciseId,
        change.targetWeight,
        change.setsCount,
        change.repMin,
        change.repMax,
        change.restSeconds,
        change.todayGoal,
        change.coachFocus,
        change.exerciseId ?? null,
      ],
    )
  }

  await client.query(
    `insert into public.recommendations (user_id, session_id, recommendation_type, title, body, source)
     values ($1,$2,'post_workout_plan','Следующая тренировка перестроена',$3,$4)`,
    [completedEntry.userId, completedEntry.id, formatCoachPlanRecommendation(safePlan, nextWorkoutDay), safePlan.source],
  )
  const logEntry = buildCoachDecisionLogEntry({
    userId: completedEntry.userId,
    sessionId: completedEntry.id,
    decisionType: 'post_workout_plan',
    source: safePlan.source,
    inputs: { coachState },
    decision: safePlan,
  })
  await storeCoachDecisionLog(client, logEntry)
  return safePlan
}

async function requestLlmCoachPlan({ profile, workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary }: RequestLlmCoachPlanParams): Promise<LlmPlan | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
  const prompt = buildCoachPrompt({ profile, workoutDays: workoutDays as unknown as NonNullable<Parameters<typeof buildCoachPrompt>[0]>["workoutDays"], completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary: exerciseLibrary as unknown as NonNullable<Parameters<typeof buildCoachPrompt>[0]>["exerciseLibrary"] })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${COACH_PERSONA} Возвращай только валидный JSON.` },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const body = (await response.json()) as LlmResponseBody
    const content = body?.choices?.[0]?.message?.content
    if (!content) return null
    return { ...(JSON.parse(content) as Partial<LlmPlan>), source: 'llm', nextWorkoutDayId: nextWorkoutDay?.id }
  } catch (error) {
    clearTimeout(timeout)
    console.warn('LLM coach plan failed, using rules fallback:', error instanceof Error ? error.message : error)
    return null
  }
}

function formatCoachPlanRecommendation(plan: SafeCoachPlan, nextWorkoutDay: WorkoutDayRef): string {
  const changes = (plan.changes ?? [])
    .map((change) => `• ${change.exerciseName ?? exerciseNameByProgramExerciseId(nextWorkoutDay, change.programExerciseId)}: ${change.setsCount}×${change.repMin}–${change.repMax}, ${change.targetWeight} кг. ${change.coachFocus}`)
    .join('\n')
  const warnings = (plan.warnings ?? []).length ? `\n\nОграничения: ${(plan.warnings ?? []).join('; ')}` : ''
  return `${plan.summary}\n\n${changes}${warnings}`
}

function exerciseNameByProgramExerciseId(day: WorkoutDayRef, programExerciseId: string | undefined): string {
  return day.exercises?.find((exercise) => exercise.programExerciseId === programExerciseId)?.name ?? programExerciseId ?? ''
}
