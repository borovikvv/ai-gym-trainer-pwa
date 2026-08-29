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
import type { PainLog, PainLogEntry } from '../shared/painChannel.js'
// Issue #108: capture analysis flags and decision source in training records
import type { ProgressAnalysis } from './coachProgressAnalysis.js'
// Issue #167: объективная величина исполнения — повторы против ожидания
import type { SessionRepDeviation } from '../src/domain/repExpectation.js'
// Issue #267: расхождение «назначено vs выполнено» по весу
import type { SessionWeightDeviation } from '../src/domain/weightAdherence.js'

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
    // Issue #161: user rating 1–5 after workout, collected on review screen.
    // Used by #88 (extractTrainingRecords) to filter records with feedback ≥ 3.
    userRating?: number | null
    // Issue #163: pain log per exercise for fine-tuning data
    painDetails?: Array<PainLogEntry & { exerciseId: string }>
    // Issue #167: отклонение фактических повторов от ожидаемых на том же весе.
    // Копится, чтобы понять, сколько сессий истории нужно для надёжного
    // ожидания; на решения тренера пока не влияет.
    repDeviation?: {
      avgDeviation: number | null
      setsWithExpectation: number
      setsWithoutExpectation: number
      exercises: Array<{ exerciseId: string; avgDeviation: number | null; setsWithExpectation: number }>
    } | null
    // Issue #267: расхождение «назначено vs выполнено» по весу. Копится, чтобы
    // понять, есть ли в нём сигнал о качестве рекомендаций; на решения тренера
    // пока не влияет.
    weightDeviation?: {
      avgDeviation: number | null
      setsWithAssignment: number
      setsWithoutAssignment: number
      exercises: Array<{ exerciseId: string; avgDeviation: number | null; setsWithAssignment: number }>
    } | null
    // Issue #268: чистый отдых между подходами («начало текущего − конец
    // предыдущего»). Агрегат на сессию; null — данных нет вовсе. На решения
    // тренера пока не влияет (фаза 1 — сбор величины).
    netRest?: {
      avgNetRestSeconds: number | null
      setsWithData: number
      setsWithoutData: number
    } | null
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
    userRating?: number | null
    painLog?: PainLog | null
    readinessCheckIn?: ReadinessCheckIn | null
    exercises: WorkoutHistoryEntry['exercises']
    // Issue #167: считается вызывающим (нужна история до этой сессии)
    repDeviation?: SessionRepDeviation | null
    // Issue #267: считается вызывающим из назначенного веса плана
    weightDeviation?: SessionWeightDeviation | null
    // Issue #268: чистый отдых между подходами (агрегат на сессию)
    netRest?: { avgNetRestSeconds: number | null; setsWithData: number; setsWithoutData: number } | null
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
      userRating: entry.userRating ?? null,
      // Issue #163: build pain details array from painLog map
      painDetails: entry.painLog
        ? Object.entries(entry.painLog).map(([exerciseId, entryValue]) => ({ exerciseId, ...entryValue }))
        : undefined,
      // Issue #167: агрегаты, а не все подходы — запись остаётся компактной.
      repDeviation: entry.repDeviation
        ? {
          avgDeviation: entry.repDeviation.avgDeviation,
          setsWithExpectation: entry.repDeviation.setsWithExpectation,
          setsWithoutExpectation: entry.repDeviation.setsWithoutExpectation,
          exercises: entry.repDeviation.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            avgDeviation: exercise.avgDeviation,
            setsWithExpectation: exercise.setsWithExpectation,
          })),
        }
        : null,
      // Issue #267: те же агрегаты для расхождения по весу.
      weightDeviation: entry.weightDeviation
        ? {
          avgDeviation: entry.weightDeviation.avgDeviation,
          setsWithAssignment: entry.weightDeviation.setsWithAssignment,
          setsWithoutAssignment: entry.weightDeviation.setsWithoutAssignment,
          exercises: entry.weightDeviation.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            avgDeviation: exercise.avgDeviation,
            setsWithAssignment: exercise.setsWithAssignment,
          })),
        }
        : null,
      // Issue #268: чистый отдых — null, когда данных нет (не подставляем 0).
      netRest: entry.netRest
        ? {
          avgNetRestSeconds: entry.netRest.avgNetRestSeconds,
          setsWithData: entry.netRest.setsWithData,
          setsWithoutData: entry.netRest.setsWithoutData,
        }
        : null,
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
