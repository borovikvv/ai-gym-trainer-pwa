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
import { labelFor, normalizeExerciseMuscleGroup } from '../shared/muscleGroups.js'
import { updateProgramExercise } from './services/programService.js'
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
}

export interface RevertProgramChangeInput {
  actionId: string
  userId: string
  now?: Date
}

const ACTION_COLUMNS =
  'id, user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at, reverted_at, created_at'

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

  const weeklySets = buildMuscleVolumeSnapshot(muscleKey, history, e1rmHistories, ageRecoveryPhase, now).weeklySets
  const projected = weeklySets - oldSetsCount + proposedSetsCount
  const lowBound = oldSetsCount + (landmarks.mev - weeklySets)
  const highBound = oldSetsCount + (landmarks.mrv - weeklySets)
  const finalSetsCount = Math.max(0, Math.round(Math.min(Math.max(proposedSetsCount, lowBound), highBound)))
  const clamped = finalSetsCount !== proposedSetsCount

  const safetyNote = clamped
    ? `подрезано: проекция объёма ${projected} вне [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`
    : `в пределах нормы [${landmarks.mev}, ${landmarks.mrv}] по «${labelFor(muscleKey)}» (фаза ${ageRecoveryPhase})`

  await updateProgramExercise(client, { id: programExerciseId, setsCount: finalSetsCount })

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
  return mapActionRow(result.rows[0], userId, change)
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
  if (Number.isFinite(beforeSetsCount)) {
    await updateProgramExercise(client, { id: action.programExerciseId, setsCount: beforeSetsCount })
  }

  const updated = await client.query(
    `update public.program_change_actions
     set status = 'reverted', reverted_at = $2
     where id = $1
     returning ${ACTION_COLUMNS}`,
    [actionId, now.toISOString()],
  )
  return mapActionRow(updated.rows[0], userId, null)
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
