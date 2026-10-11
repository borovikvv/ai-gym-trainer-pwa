#!/usr/bin/env tsx
// Issue #418, этап 1: замер личной потери повторов на шаг веса (#415).
//
// Скрипт не принимает решение и ничего не пишет в БД — только читает и печатает
// отчёт. Он сверяет личное предсказание (`estimateRepsLostPerWeightStep` +
// `predictReps`) с тем, что в проде сейчас (`buildRepExpectation`), на
// held-out точках: для каждого реального подхода предсказание строится только
// по истории строго раньше этой сессии.
//
// Пороги зафиксированы ДО просмотра боевых данных — по той же причине, что и в
// analyze-rpe-validity.ts: сам #190 появился из вывода, сделанного на испорченной
// выборке, и повторять ошибку в обратную сторону нельзя.
//
// Запуск (нужен туннель к боевой БД, см. reference/local-dev-runbook):
//   npx tsx --env-file=.env.local scripts/analyze-reps-lost-per-step.ts

import { Pool } from 'pg'
import { buildRepExpectation } from '../src/domain/repExpectation.js'
import { estimateRepsLostPerWeightStep, predictReps } from '../src/domain/repsLostPerWeightStep.js'

// --- Зафиксировано до просмотра данных -------------------------------------

/**
 * Гейт по объёму: меньше точек с ОБОИМИ предсказаниями — вердикт не фиксируем.
 * Личная модель требует минимум 3 разных веса и 10 наблюдений в истории, а
 * базовой нужны свои совпадения по весу; на малой истории их пересечение
 * слишком шумное, чтобы что-то решать.
 */
export const MIN_HELDOUT_POINTS = 20

/**
 * Вердикт «личный метод лучше» — средняя абсолютная ошибка личного метода
 * минимум на 0.2 повтора ниже базового. Порядок величины взят по разнице 0.38
 * против 3.97 в измерении #190: нужен такой же явный зазор, а не «чуть лучше
 * на шумной выборке».
 */
export const MIN_MAE_IMPROVEMENT = 0.2

// --- Чистая арифметика (проверяется в analyze-reps-lost-per-step.test.js) ----

export interface PredictionPair {
  predicted: number
  actual: number
}

/** Средняя абсолютная ошибка по парам предсказание/факт; null — пар нет. */
export function meanAbsoluteError(pairs: PredictionPair[]): number | null {
  if (pairs.length === 0) return null
  const total = pairs.reduce((sum, pair) => sum + Math.abs(pair.predicted - pair.actual), 0)
  return total / pairs.length
}

/** Набралось ли held-out точек до порога, начиная с которого судим о вердикте. */
export function hasEnoughHeldoutPoints(count: number, minimum: number = MIN_HELDOUT_POINTS): boolean {
  return count >= minimum
}

// --- Загрузка ---------------------------------------------------------------

interface SessionLike {
  id: string
  userId: string
  completedAt: string
  exercises: Array<{ exerciseId: string; exerciseName: string; sets: Array<{ weight: number; reps: number; rpe: number; completed: boolean }> }>
}

/** Тот же SQL и та же сборка, что в loadSessions из analyze-rpe-validity.ts. */
async function loadSessions(pool: Pool): Promise<SessionLike[]> {
  const { rows } = await pool.query(`
    select s.id, s.user_id, s.completed_at,
           w.exercise_id, w.exercise_name, w.set_index, w.weight, w.reps, w.rpe, w.completed
    from public.workout_sessions s
    join public.workout_sets w on w.session_id = s.id
    order by s.completed_at, w.exercise_id, w.set_index
  `)

  const sessions = new Map<string, SessionLike>()
  for (const row of rows) {
    const id = String(row.id)
    let session = sessions.get(id)
    if (!session) {
      session = {
        id,
        userId: String(row.user_id),
        completedAt: (row.completed_at as Date)?.toISOString?.() ?? String(row.completed_at),
        exercises: [],
      }
      sessions.set(id, session)
    }
    const exerciseId = String(row.exercise_id)
    let exercise = session.exercises.find((item) => item.exerciseId === exerciseId)
    if (!exercise) {
      exercise = { exerciseId, exerciseName: String(row.exercise_name ?? exerciseId), sets: [] }
      session.exercises.push(exercise)
    }
    const weight = Number(row.weight)
    const reps = Number(row.reps)
    if (row.completed === false || reps <= 0 || weight <= 0) continue
    exercise.sets.push({ weight, reps, rpe: Number(row.rpe), completed: true })
  }

  return [...sessions.values()].filter((session) => session.exercises.some((exercise) => exercise.sets.length > 0))
}

// --- Отчёт ------------------------------------------------------------------

interface MethodPairs {
  personal: PredictionPair[]
  base: PredictionPair[]
}

function emptyPairs(): MethodPairs {
  return { personal: [], base: [] }
}

function maeLine(label: string, pairs: PredictionPair[]): string {
  const mae = meanAbsoluteError(pairs)
  return `  ${label.padEnd(10)} точек ${pairs.length}, MAE ${mae === null ? '-' : mae.toFixed(2)}`
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL не задан (нужен --env-file=.env.local и живой туннель)')

  const pool = new Pool({ connectionString })
  try {
    const sessions = await loadSessions(pool)

    const overall = emptyPairs()
    const byUser = new Map<string, MethodPairs>()

    for (const session of sessions) {
      const history = sessions.filter((item) => item.userId === session.userId)
      for (const exercise of session.exercises) {
        for (let index = 0; index < exercise.sets.length; index += 1) {
          const set = exercise.sets[index]
          const setIndex = index + 1

          const estimate = estimateRepsLostPerWeightStep(history, {
            exerciseId: exercise.exerciseId,
            setIndex,
            before: session.completedAt,
          })
          const personalPrediction = predictReps(estimate, set.weight)
          if (personalPrediction === null) continue

          const baseExpectation = buildRepExpectation(history, {
            exerciseId: exercise.exerciseId,
            weight: set.weight,
            setIndex,
            before: session.completedAt,
          })
          if (baseExpectation.expectedReps === null) continue

          const personalPair: PredictionPair = { predicted: personalPrediction, actual: set.reps }
          const basePair: PredictionPair = { predicted: baseExpectation.expectedReps, actual: set.reps }
          overall.personal.push(personalPair)
          overall.base.push(basePair)

          const bucket = byUser.get(session.userId) ?? emptyPairs()
          bucket.personal.push(personalPair)
          bucket.base.push(basePair)
          byUser.set(session.userId, bucket)
        }
      }
    }

    console.log('=== Issue #418: личная потеря повторов на шаг веса (замер) ===\n')
    console.log(`Точек с обоими предсказаниями: ${overall.personal.length}\n`)
    console.log('--- Сводка ---')
    console.log(maeLine('личный', overall.personal))
    console.log(maeLine('базовый', overall.base))
    console.log('')

    console.log('--- По пользователям ---')
    for (const [userId, pairs] of byUser) {
      console.log(userId)
      console.log(maeLine('личный', pairs.personal))
      console.log(maeLine('базовый', pairs.base))
    }
    console.log('')

    console.log('--- Вердикт ---')
    if (!hasEnoughHeldoutPoints(overall.personal.length)) {
      console.log(
        `ДАННЫХ НЕ ХВАТАЕТ: точек ${overall.personal.length} < ${MIN_HELDOUT_POINTS}. Вердикт не фиксируем.`,
      )
      return
    }

    const personalMae = meanAbsoluteError(overall.personal) ?? 0
    const baseMae = meanAbsoluteError(overall.base) ?? 0
    const improvement = baseMae - personalMae
    if (improvement >= MIN_MAE_IMPROVEMENT) {
      console.log(
        `ЛИЧНЫЙ МЕТОД ЛУЧШЕ: MAE ${personalMae.toFixed(2)} против ${baseMae.toFixed(2)} ` +
          `(выигрыш ${improvement.toFixed(2)} ≥ ${MIN_MAE_IMPROVEMENT}). Параметр можно включать в решение.`,
      )
    } else {
      console.log(
        `НЕ ПОДТВЕРЖДЕНО: MAE ${personalMae.toFixed(2)} против ${baseMae.toFixed(2)} ` +
          `(выигрыш ${improvement.toFixed(2)} < ${MIN_MAE_IMPROVEMENT}). В решение не идёт; число зафиксировано.`,
      )
    }
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
