// Issue #67 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState, WorkoutHistoryEntry } from '../../shared/types.js'
import type { DbClient } from '../dbClient.js'
import type { SafeCoachPlan, CoachPlanChange } from '../coachPlanner.js'
import { COACH_PERSONA, buildCoachPrompt, buildSafeCoachPlan, clampCoachPlanToNextWorkout, chooseNextWorkoutDay } from '../coachPlanner.js'
import { computeCoachState } from '../coachState.js'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from '../coachDecisionLog.js'
import { loadExerciseLibrary, loadRecentHistory, loadUserProfile, loadUserWorkoutDays } from './programService.js'
// Issue #107: LLM prompt includes analysis flags so it can reason about plateaus/overtraining
import { analyzeProgress } from '../coachProgressAnalysis.js'
import { buildAllExerciseE1RMHistories } from '../../src/domain/estimatedOneRepMax.js'
import type { ProgressAnalysis } from '../coachProgressAnalysis.js'
import { requestLlmJson } from '../lib/llmClient.js'

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
  // Issue #107: structured analysis flags so LLM can reason about plateaus
  analysisResult?: ProgressAnalysis | null
}

interface LlmPlan extends Partial<SafeCoachPlan> {
  source?: string
  nextWorkoutDayId?: string
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

  // Issue #107: run progress analysis so LLM can reason about plateaus,
  // overtraining, and muscle imbalance when planning the next workout.
  let analysisResult: ProgressAnalysis | null = null
  try {
    const e1rmHistories = buildAllExerciseE1RMHistories([completedEntry as unknown as WorkoutHistoryEntry, ...history])
    analysisResult = await analyzeProgress({
      userId: completedEntry.userId,
      history: [completedEntry as unknown as WorkoutHistoryEntry, ...history],
      e1rmHistories: e1rmHistories.map((h) => ({
        exerciseId: h.exerciseId,
        exerciseName: h.exerciseName,
        muscleGroup: h.muscleGroup,
        currentBest: h.currentBest,
        trendDirection: h.trend.direction,
        slopePerWeek: h.trend.slopePerWeek,
        dataPointCount: h.trend.dataPointCount,
      })),
      coachState,
      coachMemory: null,
      now: new Date(completedEntry.completedAt ?? Date.now()),
    })
  } catch (err) {
    console.warn('analyzeProgress in planAndApplyNextWorkout (non-fatal):', err instanceof Error ? err.message : err)
  }

  const llmPlan = await requestLlmCoachPlan({ profile, workoutDays, completedWorkout: completedEntry, history, nextWorkoutDay, coachState, exerciseLibrary, analysisResult })

  // Issue #107: LLM is primary, rules are guardrails.
  // If LLM gave a plan, use it (after clamping). Rules only fill in
  // exerciseId when LLM didn't suggest a specific replacement — they do
  // NOT replace LLM decisions wholesale.
  if (llmPlan) {
    const safePlan = clampCoachPlanToNextWorkout({ plan: llmPlan, nextWorkoutDay, exerciseLibrary: exerciseLibrary as unknown as NonNullable<Parameters<typeof clampCoachPlanToNextWorkout>[0]>["exerciseLibrary"] })
    // If LLM produced at least one valid change after clamping, use it.
    // Only fall back to rules if ALL changes were rejected by the clamp.
    if (safePlan.changes.length > 0) {
      // Fill in exerciseId from rules for changes where LLM didn't specify one
      // (safety: ensure the exercise is valid even if LLM left it blank)
      const rulesReplacements = new Map(rulesPlan.changes.filter((change) => change.exerciseId).map((change) => [change.programExerciseId, change]))
      safePlan.changes = safePlan.changes.map((change) => {
        const safeReplacement: CoachPlanChange | undefined = rulesReplacements.get(change.programExerciseId)
        if (!safeReplacement || change.exerciseId) return change
        return { ...change, ...safeReplacement, coachFocus: `${safeReplacement.coachFocus} ${change.coachFocus ?? ''}`.slice(0, 500) }
      })
      return applyPlanAndLog(client, completedEntry, safePlan, nextWorkoutDay, coachState)
    }
    // LLM plan was fully rejected by clamp → fall through to rules
  }

  // Fallback: no LLM (no API key, timeout, or all changes rejected)
  return applyPlanAndLog(client, completedEntry, rulesPlan, nextWorkoutDay, coachState)
}

// Issue #107: extracted helper — applies a plan to the DB and logs it.
// Used by both LLM-primary path and rules-fallback path.
async function applyPlanAndLog(
  client: DbClient,
  completedEntry: CompletedEntry,
  safePlan: SafeCoachPlan,
  nextWorkoutDay: WorkoutDayRef,
  coachState: CoachState | null,
): Promise<SafeCoachPlan> {
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

async function requestLlmCoachPlan({ profile, workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary, analysisResult = null }: RequestLlmCoachPlanParams): Promise<LlmPlan | null> {
  const prompt = buildCoachPrompt({ profile, workoutDays: workoutDays as unknown as NonNullable<Parameters<typeof buildCoachPrompt>[0]>["workoutDays"], completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary: exerciseLibrary as unknown as NonNullable<Parameters<typeof buildCoachPrompt>[0]>["exerciseLibrary"], analysisResult })
  const parsed = await requestLlmJson<Partial<LlmPlan>>({
    tier: 'mid',
    caller: 'coachPlanningService',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.2,
    system: `${COACH_PERSONA} Возвращай только валидный JSON.`,
    prompt,
  })
  if (!parsed) return null
  return { ...parsed, source: 'llm', nextWorkoutDayId: nextWorkoutDay?.id }
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
