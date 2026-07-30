#!/usr/bin/env tsx
// Issue #168, этап 1: достоверность RPE на данных после фикса #133.
//
// Скрипт не принимает решение — он считает три величины и сверяет их с
// порогами, объявленными ДО того, как данные были увидены. Порядок «сначала
// правило, потом данные» здесь принципиален: сам issue появился из вывода
// «шкала сжата», сделанного на выборке, которую портил баг #133 (затирал rpe
// дефолтной семёркой). Повторять ту же ошибку в обратную сторону нельзя.
//
// Запуск (нужен туннель к боевой БД, см. reference/local-dev-runbook):
//   npx tsx --env-file=.env.local scripts/analyze-rpe-validity.ts

import { Pool } from 'pg'
import { computeSessionRepDeviation } from '../src/domain/repExpectation.js'
import { getCanonicalExerciseId } from '../src/domain/exerciseIdentity.js'

// --- Зафиксировано до просмотра данных -------------------------------------

// ponytail: граница по дате мержа PR #140 (979efc9), а не по времени деплоя —
// сессии, закрытые 22-го до выкатки, попадут в «после». Это максимум одна
// тренировка; если она окажется решающей, сдвинуть на дату следующего дня.
const FIX_133_DATE = '2026-07-22'

/** Гейт по объёму: меньше — анализ не проводим, вывод не пишем. */
const MIN_SETS = 150
const MIN_SESSIONS = 12
const MIN_PAIRS = 60
const MIN_SETS_WITH_EXPECTATION = 40

/**
 * A. Вырожденность. Шкала предлагает четыре значения (RIR 4+/3/1–2/0 → RPE
 * 6/7/8/10), так что доля моды 25 % — равномерность, 100 % — одно значение.
 * До фикса мода держала 75 %. Порог: ниже 60 % — шкалой пользуются.
 */
const MAX_MODAL_SHARE = 0.6

/**
 * B. Дискриминантность. На одном и том же весе больше повторов = ближе к
 * отказу = выше RPE. Считаем долю пар, где знак разницы совпал. 50 % — монета.
 */
const MIN_CONCORDANCE = 0.65

/** Высокая доля ничьих по RPE — та самая сжатость, но измеренная на парах. */
const MAX_TIE_RATE = 0.5

// --- Чистая арифметика (проверяется в analyze-rpe-validity.test.js) ---------

export interface RpeSet {
  userId: string
  sessionId: string
  completedAt: string
  exerciseId: string
  weight: number
  reps: number
  rpe: number
}

export function rpeDistribution(sets: RpeSet[]): { counts: Map<number, number>; modalShare: number; mode: number | null } {
  const counts = new Map<number, number>()
  for (const set of sets) counts.set(set.rpe, (counts.get(set.rpe) ?? 0) + 1)
  let mode: number | null = null
  let best = 0
  for (const [rpe, count] of counts) {
    if (count > best) { best = count; mode = rpe }
  }
  return { counts, modalShare: sets.length > 0 ? best / sets.length : 0, mode }
}

/**
 * Пары подходов одного пользователя на одном упражнении и одном весе с разным
 * числом повторов. Ничья по RPE считается отдельно, а не как несогласие:
 * это разные диагнозы — «шкала врёт» и «шкала стоит на месте».
 */
export function concordance(sets: RpeSet[]): { pairs: number; concordant: number; discordant: number; tied: number; rate: number; tieRate: number } {
  const groups = new Map<string, RpeSet[]>()
  for (const set of sets) {
    const key = `${set.userId}|${getCanonicalExerciseId({ exerciseId: set.exerciseId })}|${set.weight}`
    const group = groups.get(key)
    if (group) group.push(set)
    else groups.set(key, [set])
  }

  let concordant = 0
  let discordant = 0
  let tied = 0
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const repsDelta = group[i].reps - group[j].reps
        if (repsDelta === 0) continue
        const rpeDelta = group[i].rpe - group[j].rpe
        if (rpeDelta === 0) tied += 1
        else if (Math.sign(repsDelta) === Math.sign(rpeDelta)) concordant += 1
        else discordant += 1
      }
    }
  }

  const decided = concordant + discordant
  const pairs = decided + tied
  return {
    pairs,
    concordant,
    discordant,
    tied,
    rate: decided > 0 ? concordant / decided : 0,
    tieRate: pairs > 0 ? tied / pairs : 0,
  }
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX === 0 || varY === 0) return 0
  return cov / Math.sqrt(varX * varY)
}

// --- Загрузка ---------------------------------------------------------------

interface SessionLike {
  id: string
  userId: string
  completedAt: string
  exercises: Array<{ exerciseId: string; exerciseName: string; sets: Array<{ weight: number; reps: number; rpe: number; completed: boolean }> }>
}

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
    // Только рабочие подходы, теми же правилами, что и #167 — тогда позиция в
    // массиве совпадает с setIndex, по которому потом приклеивается отклонение.
    const weight = Number(row.weight)
    const reps = Number(row.reps)
    if (row.completed === false || reps <= 0 || weight <= 0) continue
    exercise.sets.push({ weight, reps, rpe: Number(row.rpe), completed: true })
  }

  return [...sessions.values()].filter((session) => session.exercises.some((exercise) => exercise.sets.length > 0))
}

function flatten(sessions: SessionLike[]): RpeSet[] {
  return sessions.flatMap((session) =>
    session.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => ({
        userId: session.userId,
        sessionId: session.id,
        completedAt: session.completedAt,
        exerciseId: exercise.exerciseId,
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe,
      })),
    ),
  )
}

// --- Отчёт ------------------------------------------------------------------

function percent(value: number): string {
  return `${(value * 100).toFixed(0)} %`
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL не задан (нужен --env-file=.env.local и живой туннель)')

  const pool = new Pool({ connectionString })
  try {
    const sessions = await loadSessions(pool)
    const post = sessions.filter((session) => session.completedAt >= FIX_133_DATE)
    const preSets = flatten(sessions.filter((session) => session.completedAt < FIX_133_DATE))
    const postSets = flatten(post)

    console.log(`=== Issue #168: достоверность RPE (фикс #133 от ${FIX_133_DATE}) ===\n`)
    console.log(`До фикса:    ${preSets.length} подходов`)
    console.log(`После фикса: ${postSets.length} подходов, ${post.length} сессий\n`)

    // A. Распределение
    const pre = rpeDistribution(preSets)
    const postDist = rpeDistribution(postSets)
    console.log('--- A. Распределение RPE ---')
    const values = [...new Set([...pre.counts.keys(), ...postDist.counts.keys()])].sort((a, b) => a - b)
    console.log(`RPE      ${values.map((rpe) => String(rpe).padStart(6)).join('')}`)
    console.log(`до       ${values.map((rpe) => String(pre.counts.get(rpe) ?? 0).padStart(6)).join('')}`)
    console.log(`после    ${values.map((rpe) => String(postDist.counts.get(rpe) ?? 0).padStart(6)).join('')}`)
    console.log(`Мода после фикса: ${postDist.mode} — ${percent(postDist.modalShare)} (порог вырожденности ${percent(MAX_MODAL_SHARE)})`)
    // Пользователей в базе больше одного, а шкалу каждый использует по-своему:
    // общая мода может быть суммой двух разных привычек. Личный сдвиг — пункт 3 issue.
    const users = [...new Set(postSets.map((set) => set.userId))].sort()
    for (const userId of users) {
      const userDist = rpeDistribution(postSets.filter((set) => set.userId === userId))
      console.log(`  ${userId}: мода ${userDist.mode} — ${percent(userDist.modalShare)}`)
    }
    console.log('')

    // B. Дискриминантность
    const conc = concordance(postSets)
    console.log('--- B. Различает ли шкала разные ситуации ---')
    console.log(`Пар (тот же вес, разные повторы): ${conc.pairs}`)
    console.log(`Согласных: ${conc.concordant}, несогласных: ${conc.discordant}, ничьих: ${conc.tied}`)
    console.log(`Согласованность: ${percent(conc.rate)} (порог ${percent(MIN_CONCORDANCE)}), ничьих: ${percent(conc.tieRate)} (порог ${percent(MAX_TIE_RATE)})`)
    for (const userId of users) {
      const userConc = concordance(postSets.filter((set) => set.userId === userId))
      console.log(`  ${userId}: пар ${userConc.pairs}, согласованность ${percent(userConc.rate)}, ничьих ${percent(userConc.tieRate)}`)
    }
    console.log('')

    // C. Сверка с отклонением повторов (#167)
    const rpes: number[] = []
    const deviations: number[] = []
    const byUser = new Map<string, { rpe: number[]; deviation: number[] }>()
    let noExpectation = 0
    for (const session of post) {
      const history = sessions.filter((item) => item.userId === session.userId)
      const result = computeSessionRepDeviation(session, history)
      noExpectation += result.setsWithoutExpectation
      for (const exercise of result.exercises) {
        const source = session.exercises.find((item) => item.exerciseId === exercise.exerciseId)
        for (const set of exercise.sets) {
          if (set.deviation === null) continue
          const rpe = source?.sets[set.setIndex - 1]?.rpe
          if (rpe === undefined) continue
          rpes.push(rpe)
          deviations.push(set.deviation)
          const bucket = byUser.get(session.userId) ?? { rpe: [], deviation: [] }
          bucket.rpe.push(rpe)
          bucket.deviation.push(set.deviation)
          byUser.set(session.userId, bucket)
        }
      }
    }
    const r = pearson(rpes, deviations)
    const covered = rpes.length + noExpectation
    console.log('--- C. RPE против отклонения повторов (#167) ---')
    console.log(`Подходов с ожиданием: ${rpes.length} из ${covered} (покрытие ${percent(covered > 0 ? rpes.length / covered : 0)})`)
    console.log(`Корреляция RPE ↔ отклонение: ${r.toFixed(2)}`)
    console.log('  r ≤ -0.3  RPE ловит усталость: недобрал повторов — оценил тяжелее. Оставить ведущим.')
    console.log('  |r| < 0.15 RPE несёт что-то своё, не сводимое к повторам. Оставить, но не как меру недобора.')
    console.log('  r ≥ +0.3  RPE лишь пересказывает число повторов — это уже считает #167. Понизить до вторичного.')
    for (const [userId, bucket] of byUser) {
      const meanRpe = bucket.rpe.reduce((sum, value) => sum + value, 0) / bucket.rpe.length
      const meanDev = bucket.deviation.reduce((sum, value) => sum + value, 0) / bucket.deviation.length
      console.log(`  ${userId}: n=${bucket.rpe.length}, средний RPE ${meanRpe.toFixed(1)}, среднее отклонение ${meanDev.toFixed(1)}`)
    }
    console.log('')

    // Гейт по объёму — последним, чтобы цифры выше были видны и на неполных данных.
    // Решение опирается на A и B; C — подпорка, и её нехватка вердикт не блокирует:
    // ожидание повторов требует двух прошлых сессий на том же весе, а под
    // прогрессией вес не повторяется, так что покрытие C растёт медленно.
    const gaps: string[] = []
    if (postSets.length < MIN_SETS) gaps.push(`подходов ${postSets.length} < ${MIN_SETS}`)
    if (post.length < MIN_SESSIONS) gaps.push(`сессий ${post.length} < ${MIN_SESSIONS}`)
    if (conc.pairs < MIN_PAIRS) gaps.push(`пар ${conc.pairs} < ${MIN_PAIRS}`)

    console.log('--- Вердикт ---')
    if (gaps.length > 0) {
      console.log(`ДАННЫХ НЕ ХВАТАЕТ: ${gaps.join('; ')}`)
      console.log('Цифры выше — предварительные, решение по роли RPE не фиксируем.')
      return
    }
    if (rpes.length < MIN_SETS_WITH_EXPECTATION) {
      console.log(`Оговорка: подходов с ожиданием ${rpes.length} < ${MIN_SETS_WITH_EXPECTATION} — пункт C ниже порога, вердикт только по A и B.`)
    }
    if (postDist.modalShare >= MAX_MODAL_SHARE) {
      console.log('Шкала вырождена и после фикса → RPE не может быть ведущим сигналом.')
    } else if (conc.tieRate >= MAX_TIE_RATE || conc.rate < MIN_CONCORDANCE) {
      console.log('Шкалой пользуются, но объективно разные ситуации она не различает → понизить RPE до вторичного.')
    } else {
      console.log('Шкала не вырождена и различает разные ситуации → оставить RPE ведущим.')
      console.log('Личный сдвиг смотреть по средним на пользователя выше; корреляцию C — как ограничение роли.')
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
