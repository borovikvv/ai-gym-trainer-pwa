// Issue #420: применение структурных изменений плана недельным агентом.
//
// Недельный обзор (coachProgramReview) предлагает изменения, но до этого никто
// их не применял — текст уходил на фронт для чтения. Здесь первый и пока
// единственный тип с готовой мутацией: adjust_volume (изменить число подходов
// упражнения). swap_exercise / change_focus / add_deload остаются предложением:
// под них нет ни мутации, ни детерминированного гейта.
//
// Рамки безопасности (#171/#136) — единственный гейт и он детерминированный:
// getVolumeLandmarks учитывает возрастную фазу (у подростка MRV ниже), а
// недельный объём по группе считается buildMuscleVolumeSnapshot. Личная модель
// (#418) в гейте не участвует — только в промпте как контекст.
//
// Двигатель не пишет килограммы и повторы — только число подходов. Веса
// пересчитает генератор плана после применения.

import type { AgeRecoveryPhase, MesocycleState, WorkoutHistoryEntry } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import type { ProgramChange, ProgramChangeAppliedAction } from './coachProgramReview.js'
import { buildMuscleVolumeSnapshot } from './buildVolumeSnapshot.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'
import { labelFor, normalizeExerciseMuscleGroup } from '../shared/muscleGroups.js'
import { updateProgramExercise } from './services/programService.js'
import { cascadeRegenerateFutureWorkouts } from './services/plannedWorkoutService.js'
import { dateToDateOnly, endOfWeek, startOfWeek } from './utils.js'
import { assertAllowedRowOwner } from './privateUsers.js'

interface ProgramExerciseForActions {
  id?: string
  exerciseId?: string
  programExerciseId?: string
  name?: string
  muscleGroup?: string
  setsCount?: number
}

export interface ProgramDayForActions {
  name?: string
  exercises?: ProgramExerciseForActions[]
}

interface E1rmHistoryLike {
  muscleGroup?: string | null
  exerciseName?: string | null
  dataPoints?: { date?: string; e1rm?: number }[] | null
  trend?: { direction?: 'up' | 'down' | 'flat' | 'insufficient_data' } | null
}

export interface ApplyAdjustVolumeInput {
  userId: string
  change: ProgramChange
  programDays: ProgramDayForActions[]
  history: WorkoutHistoryEntry[]
  e1rmHistories: E1rmHistoryLike[]
  ageRecoveryPhase: AgeRecoveryPhase
  now: Date
  /** Сдвиг недельного объёма по группе от изменений, уже применённых в этом проходе. */
  volumeOffsets?: Map<string, number>
}

export interface RevertProgramChangeInput {
  actionId: string
  userId: string
  now?: Date
}

/** Issue #444: вход применения add_deload — назначение разгрузочной недели. */
export interface ApplyAddDeloadInput {
  userId: string
  change: ProgramChange
  mesocycleState: MesocycleState | null
  /** Момент последнего применённого агентом add_deload (для гейта «не чаще цикла»). */
  latestAppliedAddDeloadAt: Date | string | null
  now: Date
}

/** program_exercises.sets_count: check (sets_count > 0). */
const MIN_SETS_COUNT = 1

const ACTION_COLUMNS =
  'id, user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at, reverted_at, created_at'

/**
 * Журнал и мутация упражнения должны применяться вместе: строки в журнале без
 * изменённого набора подходов (и наоборот) ломают гарантию «применено, можно
 * отменить». Оборачиваем оба запроса в транзакцию; клиент обязан быть
 * dedicated-соединением (pool.connect()), а не пулом — у пула begin и commit
 * могут уехать на разные соединения.
 */
async function withTransaction<T>(client: DbClient, run: () => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    const result = await run()
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/**
 * Применяет изменение adjust_volume. Находит упражнение по точному (без учёта
 * регистра) имени, проверяет проекцию недельного объёма по группе мышц и
 * урезает, если она выходит за [MEV, MRV]. Возвращает запись действия;
 * unmatched означает «плана не касались и в БД ничего не писали».
 */
export async function applyAdjustVolumeChange(
  client: DbClient,
  input: ApplyAdjustVolumeInput,
): Promise<ProgramChangeAppliedAction> {
  const { userId, change, programDays, history, e1rmHistories, ageRecoveryPhase, now } = input

  const exercise = findExerciseByName(programDays, change.exerciseName)
  const programExerciseId = String(exercise?.programExerciseId ?? exercise?.id ?? '')
  const oldSetsCount = Number(exercise?.setsCount)
  const proposedSetsCount = Number(change.newSetsCount)

  if (!exercise || !programExerciseId || !Number.isFinite(oldSetsCount) || !Number.isFinite(proposedSetsCount)) {
    return unmatchedAction(userId, programExerciseId, oldSetsCount, change, now, 'упражнение не найдено в программе')
  }

  const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.name ?? '')
  const landmarks = getVolumeLandmarks(muscleKey, ageRecoveryPhase)
  if (!landmarks) {
    return unmatchedAction(userId, programExerciseId, oldSetsCount, change, now, `группа «${exercise.muscleGroup ?? '?'}» без рамок объёма`)
  }

  // Изменения, уже применённые к этой группе в том же проходе, входят в объём:
  // иначе два изменения по отдельности укладываются в MRV, а вместе — нет.
  const weeklySets = buildMuscleVolumeSnapshot(muscleKey, history, e1rmHistories, ageRecoveryPhase, now).weeklySets
    + (input.volumeOffsets?.get(muscleKey) ?? 0)
  const projected = weeklySets - oldSetsCount + proposedSetsCount
  // MEV удерживает от урезания ниже минимума, но объём сам не наращивает: после
  // пропущенной недели факт ниже MEV, и граница вытянула бы упражнение далеко
  // выше предложенного. Гейт только ограничивает.
  const lowBound = Math.min(oldSetsCount, oldSetsCount + (landmarks.mev - weeklySets))
  const highBound = oldSetsCount + (landmarks.mrv - weeklySets)
  const finalSetsCount = Math.max(MIN_SETS_COUNT, Math.round(Math.min(Math.max(proposedSetsCount, lowBound), highBound)))
  const clamped = finalSetsCount !== proposedSetsCount

  const safetyNote = clamped
    ? `подрезано: проекция объёма ${projected} вне [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`
    : `в пределах нормы [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`

  const action = await withTransaction(client, async () => {
    // Сначала журнал, потом мутация: если вставка не прошла (например, не
    // накатили миграцию), число подходов не меняется и «тихой» порчи нет.
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        programExerciseId,
        change.type,
        clamped ? 'clamped' : 'applied',
        JSON.stringify({ setsCount: oldSetsCount }),
        JSON.stringify({ setsCount: finalSetsCount }),
        change.rationale ?? null,
        safetyNote,
        now.toISOString(),
      ],
    )
    await updateProgramExercise(client, { id: programExerciseId, setsCount: finalSetsCount })
    return mapActionRow(result.rows[0], userId, change)
  })
  // Следующие изменения того же прохода видят уже применённое: и объём группы,
  // и новое число подходов упражнения (programDays загружены на этот запрос).
  input.volumeOffsets?.set(muscleKey, (input.volumeOffsets.get(muscleKey) ?? 0) + finalSetsCount - oldSetsCount)
  exercise.setsCount = finalSetsCount
  return action
}

/**
 * Применяет все adjust_volume недельного обзора и кладёт результат в
 * change.appliedAction. Изменения одной группы учитывают друг друга через общий
 * сдвиг объёма. Сбой одного изменения не роняет обзор: оно остаётся
 * предложением без appliedAction, причина уходит в лог.
 */
export async function applyAdjustVolumeChanges(
  client: DbClient,
  { changes, ...input }: Omit<ApplyAdjustVolumeInput, 'change' | 'volumeOffsets'> & { changes: ProgramChange[] },
): Promise<void> {
  const volumeOffsets = new Map<string, number>()
  for (const change of changes) {
    if (change.type !== 'adjust_volume') continue
    try {
      change.appliedAction = await applyAdjustVolumeChange(client, { ...input, change, volumeOffsets })
    } catch (error) {
      console.error('applyAdjustVolumeChange (non-fatal):', error instanceof Error ? error.message : error)
    }
  }
}

/**
 * Issue #444: назначение разгрузочной недели агентом. Гейт детерминированный:
 *  - неделя уже разгрузочная (календарь или MRV/боль сработали раньше агента);
 *  - первая неделя цикла — разгрузка слишком рано;
 *  - агент уже назначал разгрузку в этом цикле (cycleStartedOn).
 * Не прошёл гейт — unmatched: плана не касались, строки в БД нет.
 */
export async function applyAddDeloadChange(
  client: DbClient,
  input: ApplyAddDeloadInput,
): Promise<ProgramChangeAppliedAction> {
  const { userId, change, mesocycleState, latestAppliedAddDeloadAt, now } = input

  if (mesocycleState?.isDeload) {
    return unmatchedAction(userId, '', NaN, change, now, 'неделя уже разгрузочная')
  }
  if (mesocycleState && mesocycleState.weekInCycle <= 1) {
    return unmatchedAction(userId, '', NaN, change, now, 'первая неделя цикла — разгрузка слишком рано')
  }
  if (latestAppliedAddDeloadAt && mesocycleState?.cycleStartedOn) {
    const last = new Date(latestAppliedAddDeloadAt).getTime()
    const cycleStart = new Date(`${mesocycleState.cycleStartedOn}T00:00:00`).getTime()
    if (Number.isFinite(last) && Number.isFinite(cycleStart) && last >= cycleStart) {
      return unmatchedAction(userId, '', NaN, change, now, 'разгрузка уже назначена агентом в этом цикле')
    }
  }

  const weekStart = dateToDateOnly(startOfWeek(now))
  return withTransaction(client, async () => {
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        '',
        change.type,
        'applied',
        null,
        JSON.stringify({ weekStart }),
        change.rationale ?? null,
        `агентом назначена разгрузочная неделя с ${weekStart}`,
        now.toISOString(),
      ],
    )
    return mapActionRow(result.rows[0], userId, change)
  })
}

/** Число дней от now до конца календарной недели, не меньше одного. */
function daysToEndOfWeek(now: Date): number {
  return Math.max(1, Math.ceil((endOfWeek(now).getTime() - now.getTime()) / 86_400_000))
}

/**
 * Issue #444: применяет add_deload из недельного обзора. Второе назначение в
 * том же проходе блокируется локальным флагом (без похода в БД). После первого
 * успешного применения оставшиеся запланированные тренировки недели
 * пересобираются, чтобы стать разгрузочными. Сбой одного изменения не роняет
 * обзор.
 */
export async function applyAddDeloadChanges(
  client: DbClient,
  { changes, ...input }: Omit<ApplyAddDeloadInput, 'change'> & { changes: ProgramChange[] },
): Promise<void> {
  let appliedThisPass = false
  for (const change of changes) {
    if (change.type !== 'add_deload') continue
    try {
      if (appliedThisPass) {
        change.appliedAction = unmatchedAction(input.userId, '', NaN, change, input.now, 'разгрузка уже назначена в этом обзоре')
        continue
      }
      const action = await applyAddDeloadChange(client, { ...input, change })
      change.appliedAction = action
      if (action.status === 'applied') {
        appliedThisPass = true
        try {
          await cascadeRegenerateFutureWorkouts(client, { userId: input.userId, horizonDays: daysToEndOfWeek(input.now) })
        } catch (error) {
          console.error('applyAddDeloadChanges cascade (non-fatal):', error instanceof Error ? error.message : error)
        }
      }
    } catch (error) {
      console.error('applyAddDeloadChange (non-fatal):', error instanceof Error ? error.message : error)
    }
  }
}

/**
 * Обзор кэшируется на неделю вместе со статусами действий, а отмена меняет
 * статус только в журнале. Перед отдачей кэша статусы перечитываются оттуда,
 * иначе отменённое изменение снова выглядело бы применённым.
 */
export async function refreshAppliedActionStatuses(
  client: DbClient,
  userId: string,
  changes: ProgramChange[],
): Promise<void> {
  const ids = changes.map((change) => change.appliedAction?.id).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return
  const result = await client.query(
    `select id, status, reverted_at from public.program_change_actions
     where user_id = $1 and id::text = any($2)`,
    [userId, ids],
  )
  const byId = new Map(result.rows.map((row) => [String(row.id), row]))
  for (const change of changes) {
    const action = change.appliedAction
    const row = action ? byId.get(action.id) : undefined
    if (!action || !row) continue
    action.status = row.status as ProgramChangeAppliedAction['status']
    action.revertedAt = toIsoString(row.reverted_at)
  }
}

/**
 * Отменяет применённое действие: возвращает упражнению прежнее число подходов
 * и помечает запись reverted. Идемпотентно — повторный вызов уже отменённого
 * действия ничего не делает. null — запись не найдена.
 */
export async function revertProgramChangeAction(
  client: DbClient,
  { actionId, userId, now = new Date() }: RevertProgramChangeInput,
): Promise<ProgramChangeAppliedAction | null> {
  const found = await client.query(
    `select ${ACTION_COLUMNS} from public.program_change_actions where id = $1`,
    [actionId],
  )
  const row = found.rows[0]
  if (!row) return null
  assertAllowedRowOwner(row)

  const action = mapActionRow(row, userId, null)
  if (action.userId !== String(userId ?? '')) {
    const error = new Error('row owner is not allowed') as Error & { statusCode?: number }
    error.statusCode = 403
    throw error
  }
  if (action.status === 'reverted') return action

  const beforeSetsCount = Number(action.before?.setsCount)
  const reverted = await withTransaction(client, async () => {
    // Статус и мутация тоже в одной транзакции: если восстановление подходов
    // упадёт, запись останется applied и повторный revert снова сработает.
    const updated = await client.query(
      `update public.program_change_actions
       set status = 'reverted', reverted_at = $2
       where id = $1
       returning ${ACTION_COLUMNS}`,
      [actionId, now.toISOString()],
    )
    // Issue #444: у add_deload нет упражнения — снимаем только назначение.
    if (action.changeType !== 'add_deload' && Number.isFinite(beforeSetsCount)) {
      await updateProgramExercise(client, { id: action.programExerciseId, setsCount: beforeSetsCount })
    }
    return mapActionRow(updated.rows[0], userId, null)
  })
  // Issue #444: после снятия назначения пересобираем неделю, иначе разгрузочные
  // тренировки останутся разгрузочными. Сбой не фатален — статус уже отменён.
  if (action.changeType === 'add_deload') {
    try {
      await cascadeRegenerateFutureWorkouts(client, { userId, horizonDays: daysToEndOfWeek(now) })
    } catch (error) {
      console.error('revertProgramChangeAction cascade (non-fatal):', error instanceof Error ? error.message : error)
    }
  }
  return reverted
}

function findExerciseByName(
  programDays: ProgramDayForActions[],
  name: string | undefined,
): ProgramExerciseForActions | null {
  const target = String(name ?? '').trim().toLowerCase()
  if (!target) return null
  for (const day of programDays ?? []) {
    for (const exercise of day.exercises ?? []) {
      if (String(exercise.name ?? '').trim().toLowerCase() === target) return exercise
    }
  }
  return null
}

function unmatchedAction(
  userId: string,
  programExerciseId: string,
  oldSetsCount: number,
  change: ProgramChange,
  now: Date,
  safetyNote: string,
): ProgramChangeAppliedAction {
  return {
    id: '',
    userId,
    programExerciseId,
    changeType: change.type,
    status: 'unmatched',
    before: Number.isFinite(oldSetsCount) ? { setsCount: oldSetsCount } : null,
    after: null,
    rationale: change.rationale ?? null,
    safetyNote,
    appliedAt: null,
    revertedAt: null,
    createdAt: now.toISOString(),
  }
}

function mapActionRow(
  row: Record<string, unknown> | undefined,
  fallbackUserId: string,
  change: ProgramChange | null,
): ProgramChangeAppliedAction {
  const before = parseJsonColumn(row?.before)
  const after = parseJsonColumn(row?.after)
  return {
    id: String(row?.id ?? ''),
    userId: String(row?.user_id ?? fallbackUserId),
    programExerciseId: String(row?.program_exercise_id ?? ''),
    changeType: (row?.change_type ?? change?.type ?? 'adjust_volume') as ProgramChangeAppliedAction['changeType'],
    status: (row?.status ?? 'unmatched') as ProgramChangeAppliedAction['status'],
    before: before as ProgramChangeAppliedAction['before'],
    after: after as ProgramChangeAppliedAction['after'],
    rationale: (row?.rationale ?? change?.rationale ?? null) as string | null,
    safetyNote: (row?.safety_note ?? null) as string | null,
    appliedAt: toIsoString(row?.applied_at),
    revertedAt: toIsoString(row?.reverted_at),
    createdAt: toIsoString(row?.created_at) ?? new Date().toISOString(),
  }
}

function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : String(value)
}
