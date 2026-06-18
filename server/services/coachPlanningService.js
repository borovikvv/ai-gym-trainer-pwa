import { COACH_PERSONA, buildCoachPrompt, buildSafeCoachPlan, clampCoachPlanToNextWorkout, chooseNextWorkoutDay } from '../coachPlanner.js'
import { computeCoachState } from '../coachState.js'
import { buildCoachDecisionLogEntry, storeCoachDecisionLog } from '../coachDecisionLog.js'
import { loadExerciseLibrary, loadRecentHistory, loadUserProfile, loadUserWorkoutDays } from './programService.js'

export async function planAndApplyNextWorkout(client, completedEntry) {
  const [profile, workoutDays, history, exerciseLibrary] = await Promise.all([
    loadUserProfile(client, completedEntry.userId),
    loadUserWorkoutDays(client, completedEntry.userId),
    loadRecentHistory(client, completedEntry.userId),
    loadExerciseLibrary(client),
  ])
  const nextWorkoutDay = chooseNextWorkoutDay({ workoutDays, completedWorkout: completedEntry })
  if (!nextWorkoutDay) return null
  const debriefQualityScore = completedEntry.debrief?.qualityScore ?? null
  const coachState = computeCoachState({
    profile,
    workoutDays,
    history: [completedEntry, ...history],
    now: new Date(completedEntry.completedAt ?? Date.now()),
    lastWorkoutQualityScore: debriefQualityScore,
  })

  const rulesPlan = buildSafeCoachPlan({
    profile,
    workoutDays,
    completedWorkout: completedEntry,
    history: [completedEntry, ...history],
    now: new Date(completedEntry.completedAt ?? Date.now()),
    coachState,
    exerciseLibrary,
    workoutQualityScore: debriefQualityScore,
  })

  const llmPlan = await requestLlmCoachPlan({ profile, workoutDays, completedWorkout: completedEntry, history, nextWorkoutDay, coachState, exerciseLibrary })
  const safePlan = clampCoachPlanToNextWorkout(llmPlan ?? rulesPlan, nextWorkoutDay, exerciseLibrary)
  if (safePlan.changes.length === 0) {
    safePlan.changes = rulesPlan.changes
    safePlan.source = rulesPlan.source
    safePlan.summary = rulesPlan.summary
  } else {
    const rulesReplacements = new Map(rulesPlan.changes.filter((change) => change.exerciseId).map((change) => [change.programExerciseId, change]))
    safePlan.changes = safePlan.changes.map((change) => {
      const safeReplacement = rulesReplacements.get(change.programExerciseId)
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

async function requestLlmCoachPlan({ profile, workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary }) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
  const prompt = buildCoachPrompt({ profile, workoutDays, completedWorkout, history, nextWorkoutDay, coachState, exerciseLibrary })
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
    })
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const body = await response.json()
    const content = body?.choices?.[0]?.message?.content
    if (!content) return null
    return { ...JSON.parse(content), source: 'llm', nextWorkoutDayId: nextWorkoutDay.id }
  } catch (error) {
    console.warn('LLM coach plan failed, using rules fallback:', error instanceof Error ? error.message : error)
    return null
  }
}

function formatCoachPlanRecommendation(plan, nextWorkoutDay) {
  const changes = (plan.changes ?? [])
    .map((change) => `• ${change.exerciseName ?? exerciseNameByProgramExerciseId(nextWorkoutDay, change.programExerciseId)}: ${change.setsCount}×${change.repMin}–${change.repMax}, ${change.targetWeight} кг. ${change.coachFocus}`)
    .join('\n')
  const warnings = (plan.warnings ?? []).length ? `\n\nОграничения: ${(plan.warnings ?? []).join('; ')}` : ''
  return `${plan.summary}\n\n${changes}${warnings}`
}

function exerciseNameByProgramExerciseId(day, programExerciseId) {
  return day.exercises.find((exercise) => exercise.programExerciseId === programExerciseId)?.name ?? programExerciseId
}
