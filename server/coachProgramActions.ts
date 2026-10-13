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

import type { AgeRecoveryPhase, WorkoutHistoryEntry } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import type { ProgramChange, ProgramChangeAppliedAction } from './coachProgramReview.js'
import { buildMuscleVolumeSnapshot } from './buildVolumeSnapshot.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'
import { labelFor, normalizeExerciseMuscleGroup, normalizeMuscleGroup } from '../shared/muscleGroups.js'
import { updateProgramExercise, loadUserProfile } from './services/programService.js'
import { loadWeeklyVolumeTargets, updateWeeklyVolumeTargetSets } from './weeklyVolumeTargets.js'
import { assertAllowedRowOwner } from './privateUsers.js'
import { dateToDateOnly, endOfWeek, startOfWeek } from './utils.js'
import { loadUnavailableDates } from './services/athleteAvailability.js'
import { cascadeRegenerateFutureWorkouts, regeneratePlannedWorkout } from './services/plannedWorkoutService.js'

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

export interface ApplyChangeFocusInput {
  userId: string
  change: ProgramChange
  ageRecoveryPhase: AgeRecoveryPhase
  /** Понедельник текущей недели (YYYY-MM-DD): цель этой недели и меняем. */
  weekStart: string
  now: Date
}

export interface RevertProgramChangeInput {
  actionId: string
  userId: string
  now?: Date
}

/**
 * Issue #445: перенос тренировки под ограничение атлета. Вызывается синхронно,
 * когда атлет отметил дату недоступной (POST /planned-workouts/:id/unavailable),
 * а не через недельный кэш обзора: ждать раз-в-неделю обновления противоречит
 * сценарию «уезжаю в четверг».
 */
export interface ApplyMoveWorkoutInput {
  userId: string
  plannedWorkoutId: string
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
 * Применяет изменение change_focus: двигает недельную цель подходов одной
 * группы мышц (weekly_volume_targets.target_sets), урезая её до [MEV, MRV].
 * `programExerciseId` в журнале хранит id строки weekly_volume_targets —
 * колонка общая, для adjust_volume в ней id упражнения. unmatched — БД не
 * трогали.
 */
export async function applyChangeFocusChange(
  client: DbClient,
  input: ApplyChangeFocusInput,
): Promise<ProgramChangeAppliedAction> {
  const { userId, change, ageRecoveryPhase, weekStart, now } = input

  const muscleKey = normalizeMuscleGroup(change.muscleGroup ?? '')
  const landmarks = getVolumeLandmarks(muscleKey, ageRecoveryPhase)
  if (!landmarks) {
    return unmatchedAction(userId, '', NaN, change, now, 'группа не распознана')
  }

  const targets = await loadWeeklyVolumeTargets(client, userId, weekStart)
  const target = targets[muscleKey]
  if (!target) {
    return unmatchedAction(userId, '', NaN, change, now, 'нет цели по группе на эту неделю')
  }

  const proposedSetsCount = Number(change.newSetsCount)
  if (!Number.isFinite(proposedSetsCount)) {
    return unmatchedAction(userId, target.id, target.targetSets, change, now, 'не указано новое число подходов')
  }

  const finalSetsCount = Math.max(landmarks.mev, Math.min(landmarks.mrv, Math.round(proposedSetsCount)))
  const clamped = finalSetsCount !== Math.round(proposedSetsCount)

  const safetyNote = clamped
    ? `подрезано: недельная цель ${Math.round(proposedSetsCount)} вне [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`
    : `в пределах нормы [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`

  return withTransaction(client, async () => {
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        target.id,
        change.type,
        clamped ? 'clamped' : 'applied',
        JSON.stringify({ setsCount: target.targetSets }),
        JSON.stringify({ setsCount: finalSetsCount }),
        change.rationale ?? null,
        safetyNote,
        now.toISOString(),
      ],
    )
    await updateWeeklyVolumeTargetSets(client, { id: target.id, targetSets: finalSetsCount })
    return mapActionRow(result.rows[0], userId, change)
  })
}

/**
 * Применяет все change_focus недельного обзора. Сбой одного изменения не
 * роняет обзор: оно остаётся предложением без appliedAction.
 */
export async function applyChangeFocusChanges(
  client: DbClient,
  { changes, ...input }: Omit<ApplyChangeFocusInput, 'change'> & { changes: ProgramChange[] },
): Promise<void> {
  for (const change of changes) {
    if (change.type !== 'change_focus') continue
    try {
      change.appliedAction = await applyChangeFocusChange(client, { ...input, change })
    } catch (error) {
      console.error('applyChangeFocusChange (non-fatal):', error instanceof Error ? error.message : error)
    }
  }
}

/**
 * Issue #445: перенос тренировки на другой день той же недели, когда атлет
 * отметил исходный день недоступным. Детерминированно и без LLM: гейт подбирает
 * первую свободную дату недели, которая не нарушает восстановление (#225) и не
 * отмечена недоступной. Нет кандидата — пишем status=unmatched и план не трогаем
 * (это и есть «перенос, нарушающий восстановление, не применяется»).
 *
 * Возвращает null, когда переносить нечего (тренировка не найдена или её статус
 * не planned/generated) — в этом случае журнал не пишется.
 */
export async function applyMoveWorkoutChange(
  client: DbClient,
  { userId, plannedWorkoutId, now }: ApplyMoveWorkoutInput,
): Promise<ProgramChangeAppliedAction | null> {
  const current = await client.query(
    `select id, user_id, scheduled_date, status, workout_day_name
     from public.planned_workouts where id = $1`,
    [plannedWorkoutId],
  )
  const row = current.rows[0]
  if (!row) return null
  assertAllowedRowOwner(row)
  const status = String(row.status ?? '')
  if (status !== 'planned' && status !== 'generated') return null

  const originalDate = dateToDateOnly(row.scheduled_date as Date | string)
  const weekStart = dateToDateOnly(startOfWeek(new Date(`${originalDate}T00:00:00`)))
  const weekEnd = dateToDateOnly(endOfWeek(new Date(`${originalDate}T00:00:00`)))

  // Сиблинги недели задают занятые даты; текущая тренировка исключена — её
  // исходная дата станет свободной после переноса и не считается занятой.
  const siblings = await client.query(
    `select scheduled_date from public.planned_workouts
     where user_id = $1
       and id <> $2
       and scheduled_date between $3::date and $4::date
       and status in ('planned', 'generated', 'moved', 'completed')`,
    [userId, plannedWorkoutId, weekStart, weekEnd],
  )
  const occupied = new Set(siblings.rows.map((sibling) => dateToDateOnly(sibling.scheduled_date as Date | string)))
  const unavailable = new Set(await loadUnavailableDates(client, userId, weekStart, weekEnd))

  const profile = await loadUserProfile(client, userId)
  const workoutsPerWeek = Number(profile?.workoutsPerWeek ?? 3)

  const candidate = findMoveCandidate({
    originalDate,
    weekStart,
    weekEnd,
    today: dateToDateOnly(now),
    occupied,
    unavailable,
    workoutsPerWeek,
  })

  if (!candidate) {
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        plannedWorkoutId,
        'move_workout',
        'unmatched',
        JSON.stringify({ scheduledDate: originalDate }),
        null,
        `Атлет отметил «${originalDate}» недоступным`,
        'нет свободной даты в пределах недели без нарушения восстановления',
        null,
      ],
    )
    return mapActionRow(result.rows[0], userId, null)
  }

  const action = await withTransaction(client, async () => {
    // Сначала журнал, потом мутация: если вставка не прошла (например, не
    // накатили миграцию), дата тренировки не меняется и «тихой» порчи нет.
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        plannedWorkoutId,
        'move_workout',
        'applied',
        JSON.stringify({ scheduledDate: originalDate }),
        JSON.stringify({ scheduledDate: candidate }),
        `Атлет отметил «${originalDate}» недоступным`,
        'перенос в пределах недели, разрыв восстановления не нарушен',
        now.toISOString(),
      ],
    )
    await client.query(
      `update public.planned_workouts set scheduled_date = $2::date where id = $1`,
      [plannedWorkoutId, candidate],
    )
    await regeneratePlannedWorkout(client, { plannedWorkoutId, userId, scheduledDate: candidate })
    await cascadeRegenerateFutureWorkouts(client, { userId })
    return mapActionRow(result.rows[0], userId, null)
  })
  return action
}

/**
 * Первая дата недели от max(сегодня, понедельник) до воскресенья, свободная от
 * занятых и недоступных дней и не дающая разрыв ровно в 1 день до соседней
 * тренировки, когда неделя короткая (workoutsPerWeek <= 3, #225). Иначе null.
 */
function findMoveCandidate({
  originalDate,
  weekStart,
  weekEnd,
  today,
  occupied,
  unavailable,
  workoutsPerWeek,
}: {
  originalDate: string
  weekStart: string
  weekEnd: string
  today: string
  occupied: Set<string>
  unavailable: Set<string>
  workoutsPerWeek: number
}): string | null {
  let cursor = today > weekStart ? today : weekStart
  while (cursor <= weekEnd) {
    if (
      cursor !== originalDate
      && !occupied.has(cursor)
      && !unavailable.has(cursor)
      && !violatesRecoveryGap(cursor, occupied, workoutsPerWeek)
    ) {
      return cursor
    }
    cursor = addDaysDateOnly(cursor, 1)
  }
  return null
}

/** Соседняя тренировка через день при короткой неделе — нарушение восстановления. */
function violatesRecoveryGap(candidate: string, occupied: Set<string>, workoutsPerWeek: number): boolean {
  if (workoutsPerWeek > 3) return false
  for (const date of occupied) {
    if (Math.abs(daysBetweenDateOnly(date, candidate)) === 1) return true
  }
  return false
}

function addDaysDateOnly(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00`)
  if (Number.isNaN(base.getTime())) return dateOnly
  base.setDate(base.getDate() + days)
  return dateToDateOnly(base)
}

function daysBetweenDateOnly(from: string, to: string): number {
  const fromMs = new Date(`${from}T00:00:00`).getTime()
  const toMs = new Date(`${to}T00:00:00`).getTime()
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return Number.POSITIVE_INFINITY
  return Math.round((toMs - fromMs) / 86_400_000)
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

  const before = action.before
  const beforeSetsCount = before && 'setsCount' in before ? Number(before.setsCount) : Number.NaN
  const beforeScheduledDate = before && 'scheduledDate' in before ? before.scheduledDate : null
  return withTransaction(client, async () => {
    // Статус и мутация тоже в одной транзакции: если восстановление упадёт,
    // запись останется applied и повторный revert снова сработает.
    const updated = await client.query(
      `update public.program_change_actions
       set status = 'reverted', reverted_at = $2
       where id = $1
       returning ${ACTION_COLUMNS}`,
      [actionId, now.toISOString()],
    )
    if (action.changeType === 'move_workout') {
      // Issue #445: у move_workout program_exercise_id хранит id тренировки,
      // before.scheduledDate — прежнюю дату. Возвращаем дату и пересобираем.
      if (beforeScheduledDate) {
        await client.query(
          `update public.planned_workouts set scheduled_date = $2::date where id = $1`,
          [action.programExerciseId, beforeScheduledDate],
        )
        await regeneratePlannedWorkout(client, { plannedWorkoutId: action.programExerciseId, userId, scheduledDate: beforeScheduledDate })
        await cascadeRegenerateFutureWorkouts(client, { userId })
      }
    } else if (Number.isFinite(beforeSetsCount)) {
      if (action.changeType === 'change_focus') {
        await updateWeeklyVolumeTargetSets(client, { id: action.programExerciseId, targetSets: beforeSetsCount })
      } else {
        await updateProgramExercise(client, { id: action.programExerciseId, setsCount: beforeSetsCount })
      }
    }
    return mapActionRow(updated.rows[0], userId, null)
  })
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
