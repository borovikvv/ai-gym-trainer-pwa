/**
 * AI Level 4 (#86): Fine-tuned model — Phase 1: Data Collection.
 *
 * Collects structured training records for future fine-tuning.
 * Each record captures:
 *   - input: coachState, program, profile, readinessCheckIn at workout time
 *   - decision: exercises, weights, reps, sets (what the coach recommended)
 *   - outcome: completedReps, rpe, pain, e1rmChange, qualityScore (what happened)
 *
 * Records are stored in the `recommendations` table with type='training_record'.
 * After 50+ records, a fine-tuning job can be started.
 *
 * Phase 2 (training) and Phase 3 (inference) are separate — this file
 * only handles Phase 1 (collection) and Phase 2 (training data prep + launch).
 */

import type { DbClient } from './dbClient.js'
import type { WorkoutHistoryEntry, ReadinessCheckIn } from '../shared/types.js'
// Issue #108: capture analysis flags and decision source in training records
import type { ProgressAnalysis } from './coachProgressAnalysis.js'

export interface TrainingRecordChange {
  exerciseId: string
  type: 'swap' | 'weight_increase' | 'weight_decrease' | 'volume_change' | 'hold'
  details: string
}

export interface TrainingRecord {
  userId: string
  sessionId: string
  createdAt: string
  input: {
    readinessScore: number
    recoveryStatus: string
    weeklyLoadStatus: string
    mesocyclePhase: string | null
    mesocycleWeek: number | null
    readinessCheckIn: ReadinessCheckIn | null
    age: number | null
    goal: string | null
    level: string | null
    workoutsPerWeek: number | null
    // Issue #108: LLM analysis at workout time (plateaus, overtraining, etc.)
    analysis?: {
      exerciseFlags: ProgressAnalysis['exerciseFlags']
      globalFlags: ProgressAnalysis['globalFlags']
      summary: string
    } | null
  }
  decision: {
    exercises: Array<{
      exerciseId: string
      exerciseName: string
      muscleGroup: string
      setsCount: number
      repMin: number
      repMax: number
      targetWeight: number
    }>
    lowReadiness: boolean
    loadPolicy: string
    // Issue #108: source of the decision (rules / llm / llm_clamped)
    source?: string
    // Issue #108: what changed vs the previous workout
    changes?: TrainingRecordChange[]
  }
  outcome: {
    completedReps: number
    avgRpe: number
    painCount: number
    totalVolume: number
    qualityScore: number | null
  } | null
}

/**
 * Save a training record after workout completion.
 * Called from saveWorkoutHistoryEntry (non-fatal — collection is best-effort).
 */
export async function saveTrainingRecord(
  client: DbClient,
  entry: {
    userId: string
    id: string
    completedAt: string
    totalVolume: number
    qualityScore?: number | null
    readinessCheckIn?: ReadinessCheckIn | null
    exercises: WorkoutHistoryEntry['exercises']
  },
  coachState: {
    readinessScore?: number
    recoveryStatus?: string
    weeklyLoadStatus?: string
    mesocycle?: { phase?: string; weekInCycle?: number } | null
  } | null,
  decision: {
    exercises: Array<{
      exerciseId: string
      exerciseName: string
      muscleGroup: string
      setsCount: number
      repMin: number
      repMax: number
      targetWeight: number
    }>
    lowReadiness: boolean
    loadPolicy: string
    // Issue #108: source and changes
    source?: string
    changes?: TrainingRecordChange[]
  },
  profile: {
    age?: number | null
    goal?: string
    level?: string
    workoutsPerWeek?: number
  },
  // Issue #108: LLM analysis result at workout time
  analysisResult?: ProgressAnalysis | null,
): Promise<void> {
  // Compute outcome from completed sets
  let completedReps = 0
  let rpeSum = 0
  let rpeCount = 0
  let painCount = 0

  for (const exercise of entry.exercises ?? []) {
    if (exercise.pain) painCount++
    for (const set of exercise.sets ?? []) {
      if (set.completed) {
        completedReps += set.reps
        if (set.rpe) {
          rpeSum += set.rpe
          rpeCount++
        }
      }
    }
  }

  const record: TrainingRecord = {
    userId: entry.userId,
    sessionId: entry.id,
    createdAt: entry.completedAt,
    input: {
      readinessScore: coachState?.readinessScore ?? 70,
      recoveryStatus: coachState?.recoveryStatus ?? 'unknown',
      weeklyLoadStatus: coachState?.weeklyLoadStatus ?? 'unknown',
      mesocyclePhase: coachState?.mesocycle?.phase ?? null,
      mesocycleWeek: coachState?.mesocycle?.weekInCycle ?? null,
      readinessCheckIn: entry.readinessCheckIn ?? null,
      age: profile.age ?? null,
      goal: profile.goal ?? null,
      level: profile.level ?? null,
      workoutsPerWeek: profile.workoutsPerWeek ?? null,
      // Issue #108: capture analysis at workout time
      analysis: analysisResult ? {
        exerciseFlags: analysisResult.exerciseFlags,
        globalFlags: analysisResult.globalFlags,
        summary: analysisResult.summary,
      } : null,
    },
    decision: {
      exercises: decision.exercises,
      lowReadiness: decision.lowReadiness,
      loadPolicy: decision.loadPolicy,
      // Issue #108: capture decision source and changes
      source: decision.source ?? 'rules',
      changes: decision.changes ?? [],
    },
    outcome: {
      completedReps,
      avgRpe: rpeCount > 0 ? Math.round((rpeSum / rpeCount) * 10) / 10 : 0,
      painCount,
      totalVolume: entry.totalVolume,
      qualityScore: entry.qualityScore ?? null,
    },
  }

  await client.query(
    `insert into public.recommendations (user_id, session_id, recommendation_type, title, body, source)
     values ($1, $2, 'training_record', 'Training Record', $3, 'collected')`,
    [entry.userId, entry.id, JSON.stringify(record)],
  )
}

/**
 * Count training records for a user (to check if enough for fine-tuning).
 */
export async function countTrainingRecords(client: DbClient, userId: string): Promise<number> {
  const result = await client.query(
    `select count(*)::int as count from public.recommendations
     where user_id = $1 and recommendation_type = 'training_record'`,
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * Export training records as JSONL (for OpenAI fine-tuning).
 * Returns the data as a string (JSONL format, one JSON object per line).
 */
export async function exportTrainingRecords(client: DbClient, userId: string): Promise<string> {
  const result = await client.query(
    `select body from public.recommendations
     where user_id = $1 and recommendation_type = 'training_record'
     order by created_at asc`,
    [userId],
  )

  const lines: string[] = []
  for (const row of result.rows) {
    const record = JSON.parse(row.body as string) as TrainingRecord

    // Only include records with outcomes (completed workouts)
    if (!record.outcome) continue

    // Build fine-tuning example:
    // input = structured context
    // output = ideal recommendation (based on what actually happened)
    const input = JSON.stringify({
      readiness: record.input.readinessScore,
      recovery: record.input.recoveryStatus,
      mesocycle: record.input.mesocyclePhase,
      mesocycleWeek: record.input.mesocycleWeek,
      goal: record.input.goal,
      level: record.input.level,
      age: record.input.age,
      exercises: record.decision.exercises.map((e) => ({
        name: e.exerciseName,
        muscle: e.muscleGroup,
        sets: e.setsCount,
        reps: `${e.repMin}-${e.repMax}`,
        weight: e.targetWeight,
      })),
    })

    // Determine if the decision was "good" or "bad" based on outcome
    const avgRpe = record.outcome.avgRpe
    const hadPain = record.outcome.painCount > 0
    const qualityScore = record.outcome.qualityScore ?? 0

    let assessment: string
    if (hadPain) {
      assessment = 'Тренировка вызвала боль. В следующий раз снизь вес или замени упражнение.'
    } else if (avgRpe > 9) {
      assessment = 'Тренировка была слишком тяжёлой (RPE > 9). В следующий раз снизь вес на один шаг.'
    } else if (avgRpe < 6 && qualityScore > 0) {
      assessment = 'Тренировка была слишком лёгкой (RPE < 6). Можно увеличить вес на один шаг.'
    } else if (qualityScore >= 70) {
      assessment = 'Тренировка прошла хорошо. Вес и объём подобраны правильно.'
    } else {
      assessment = 'Тренировка завершена. Продолжай в том же режиме.'
    }

    const example = {
      messages: [
        { role: 'system', content: 'Ты персональный силовой тренер. Оцени тренировку и дай рекомендацию на следующую.' },
        { role: 'user', content: input },
        { role: 'assistant', content: assessment },
      ],
    }

    lines.push(JSON.stringify(example))
  }

  return lines.join('\n')
}

/**
 * Check if a user has enough training records for fine-tuning.
 * OpenAI recommends at least 50 examples.
 */
export async function isReadyForFineTuning(client: DbClient, userId: string, minRecords = 50): Promise<boolean> {
  const count = await countTrainingRecords(client, userId)
  return count >= minRecords
}
