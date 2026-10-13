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

import type { AgeRecoveryPhase, CoachMemory, CoachState, WorkoutHistoryEntry } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import type { AdjustVolumeSnapshot, ProgramChange, ProgramChangeAppliedAction, SwapExerciseSnapshot } from './coachProgramReview.js'
import { buildMuscleVolumeSnapshot } from './buildVolumeSnapshot.js'
import { getVolumeLandmarks } from './volumeLandmarks.js'
import { labelFor, normalizeExerciseMuscleGroup, normalizeMuscleGroup } from '../shared/muscleGroups.js'
import { updateProgramExercise } from './services/programService.js'
import { loadWeeklyVolumeTargets, updateWeeklyVolumeTargetSets } from './weeklyVolumeTargets.js'
import { assertAllowedRowOwner } from './privateUsers.js'
import { formatWeight } from '../shared/format.js'
import type { CoachMemoryForGenerator, LibraryExerciseInput, ProfileForGenerator } from './plannedWorkoutGenerator.js'
import { normalizeExerciseLibrary } from './workoutExerciseSelection.js'
import { emptyPreferences, hasActivePainFlag, isBannedExercise, isCoachMemoryRestricted, isHighFatigue, normalizeText } from './workoutExerciseEligibility.js'
import { applyPrescription } from './workoutLoadPrescription.js'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'

interface ProgramExerciseForActions {
  id?: string
  exerciseId?: string
  programExerciseId?: string
  name?: string
  muscleGroup?: string
  setsCount?: number
  // Issue #442: полное предписание слота нужно для снимка before/after при замене.
  repMin?: number
  repMax?: number
  targetWeight?: number
  weightStep?: number
  restSeconds?: number
  equipment?: string | null
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

export interface ApplySwapExerciseInput {
  userId: string
  change: ProgramChange
  programDays: ProgramDayForActions[]
  /** Справочник упражнений: источник детерминированного белого списка замен. */
  exerciseLibrary: LibraryExerciseInput[]
  coachState: CoachState | null
  coachMemory: CoachMemory | null
  profile: ProfileForGenerator
  history: WorkoutHistoryEntry[]
  now: Date
}

export interface RevertProgramChangeInput {
  actionId: string
  userId: string
  now?: Date
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
 * Issue #442: детерминированный белый список замен для одной группы мышц.
 * Тот же набор фильтров, что генератор применяет к allowedAlternatives
 * (plannedWorkoutGenerator:403): та же группа, без дублей слотов, не забанено,
 * не avoid по памяти тренера, не высокоутомлённая группа и без отметки боли.
 * isRecoveryRestricted/isCoachDecisionRestricted сознательно не берём: оба
 * требуют weeklyContext/coachDecision под конкретный день, а недельный обзор
 * не привязан к сессии.
 */
function buildSwapWhitelist(
  exerciseLibrary: LibraryExerciseInput[],
  muscleKey: string,
  usedExerciseIds: Set<string>,
  coachState: CoachState | null,
  coachMemory: CoachMemory | null,
  preferences: ReturnType<typeof emptyPreferences>,
) {
  const memory = coachMemory as CoachMemoryForGenerator | null
  return normalizeExerciseLibrary(exerciseLibrary ?? [])
    .filter((candidate) => candidate.muscleKey === muscleKey)
    .filter((candidate) => !usedExerciseIds.has(candidate.id))
    .filter((candidate) => !isBannedExercise(candidate, preferences))
    .filter((candidate) => !isCoachMemoryRestricted(candidate.muscleKey, memory))
    .filter((candidate) => !isHighFatigue(candidate.muscleKey, coachState))
    .filter((candidate) => !hasActivePainFlag(candidate.id, coachState, memory))
}

/**
 * Применяет изменение swap_exercise. Находит упражнение слота по точному
 * имени, ищет замену в детерминированном белом списке (та же группа мышц +
 * фильтры генератора) и предписывает новое упражнение через applyPrescription
 * (вес/повторы/подходы считает генератор; подростковые ограничения #171 —
 * внутри). Снимок before/after хранит полное предписание слота, поэтому отмена
 * возвращает прежнее упражнение целиком. unmatched — вне белого списка, БД не
 * трогали.
 */
export async function applySwapExerciseChange(
  client: DbClient,
  input: ApplySwapExerciseInput,
): Promise<ProgramChangeAppliedAction> {
  const { userId, change, programDays, exerciseLibrary, coachState, coachMemory, profile, history, now } = input

  const exercise = findExerciseByName(programDays, change.exerciseName)
  const programExerciseId = String(exercise?.programExerciseId ?? exercise?.id ?? '')
  if (!exercise || !programExerciseId) {
    return unmatchedAction(userId, programExerciseId, NaN, change, now, 'упражнение не найдено в программе')
  }

  const muscleKey = normalizeExerciseMuscleGroup(exercise.muscleGroup ?? '', exercise.name ?? '')
  const preferences = {
    ...emptyPreferences(),
    bannedExerciseNames: (profile?.bannedExercises ?? []).map(normalizeText).filter(Boolean),
  }
  const usedExerciseIds = new Set<string>()
  for (const day of programDays ?? []) {
    for (const item of day.exercises ?? []) {
      const id = String(item.exerciseId ?? item.id ?? '')
      if (id) usedExerciseIds.add(id)
    }
  }

  const whitelist = buildSwapWhitelist(exerciseLibrary, muscleKey, usedExerciseIds, coachState, coachMemory, preferences)
  const targetName = normalizeText(change.newExerciseName)
  const candidate = targetName
    ? whitelist.find((item) => normalizeText(item.name) === targetName) ?? null
    : null
  if (!candidate) {
    return unmatchedAction(userId, programExerciseId, NaN, change, now, 'замена вне безопасного списка для этой группы мышц')
  }

  const prescription = applyPrescription({
    exercise: candidate,
    profile,
    coachState,
    coachMemory: coachMemory as CoachMemoryForGenerator | null,
    history,
    lowReadiness: false,
    userTrainingPolicy: getUserTrainingPolicy(profile),
  })

  const before: SwapExerciseSnapshot = {
    exerciseId: String(exercise.exerciseId ?? exercise.id ?? ''),
    exerciseName: String(exercise.name ?? ''),
    setsCount: Number(exercise.setsCount),
    repMin: Number(exercise.repMin),
    repMax: Number(exercise.repMax),
    targetWeight: Number(exercise.targetWeight),
    weightStep: Number(exercise.weightStep),
    restSeconds: Number(exercise.restSeconds),
  }
  const after: SwapExerciseSnapshot = {
    exerciseId: prescription.exerciseId,
    exerciseName: prescription.exerciseName,
    setsCount: prescription.setsCount,
    repMin: prescription.repMin,
    repMax: prescription.repMax,
    targetWeight: prescription.targetWeight,
    weightStep: prescription.weightStep,
    restSeconds: prescription.restSeconds,
  }
  const coachFocus = `${candidate.name}: замена вместо ${exercise.name} по недельному разбору — ${change.rationale ?? ''}`.slice(0, 500)

  const action = await withTransaction(client, async () => {
    const result = await client.query(
      `insert into public.program_change_actions
         (user_id, program_exercise_id, change_type, status, before, after, rationale, safety_note, applied_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${ACTION_COLUMNS}`,
      [
        userId,
        programExerciseId,
        change.type,
        'applied',
        JSON.stringify(before),
        JSON.stringify(after),
        change.rationale ?? null,
        `замена в белом списке по «${labelFor(muscleKey)}»`,
        now.toISOString(),
      ],
    )
    await updateProgramExercise(client, {
      id: programExerciseId,
      exerciseId: prescription.exerciseId,
      setsCount: prescription.setsCount,
      repMin: prescription.repMin,
      repMax: prescription.repMax,
      targetWeight: prescription.targetWeight,
      weightStep: prescription.weightStep,
      restSeconds: prescription.restSeconds,
      todayGoal: formatTodayGoal(prescription.targetWeight, prescription.setsCount, prescription.repMin).slice(0, 140),
      coachFocus,
    })
    return mapActionRow(result.rows[0], userId, change)
  })
  // Следующие изменения того же прохода видят замену: слот и его предписание
  // обновлены прямо в programDays.
  exercise.exerciseId = prescription.exerciseId
  exercise.id = prescription.exerciseId
  exercise.name = prescription.exerciseName
  exercise.muscleGroup = prescription.muscleGroup
  exercise.setsCount = prescription.setsCount
  exercise.repMin = prescription.repMin
  exercise.repMax = prescription.repMax
  exercise.targetWeight = prescription.targetWeight
  exercise.weightStep = prescription.weightStep
  exercise.restSeconds = prescription.restSeconds
  usedExerciseIds.add(prescription.exerciseId)
  return action
}

/**
 * Применяет все swap_exercise недельного обзора. Сбой одного изменения не
 * роняет обзор: оно остаётся предложением без appliedAction.
 */
export async function applySwapExerciseChanges(
  client: DbClient,
  { changes, ...input }: Omit<ApplySwapExerciseInput, 'change'> & { changes: ProgramChange[] },
): Promise<void> {
  for (const change of changes) {
    if (change.type !== 'swap_exercise') continue
    try {
      change.appliedAction = await applySwapExerciseChange(client, { ...input, change })
    } catch (error) {
      console.error('applySwapExerciseChange (non-fatal):', error instanceof Error ? error.message : error)
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

  return withTransaction(client, async () => {
    // Статус и мутация тоже в одной транзакции: если восстановление упадёт,
    // запись останется applied и повторный revert снова сработает.
    //
    // Issue #442: простая безусловная отмена. CAS-проверка «слот всё ещё занят
    // упражнением агента» вынесена в отдельный PR (потолок диффа этой задачи).
    // Принятый риск: если планировщик после тренировки уже заменил упражнение
    // в этом слоте, отмена перезапишет его более свежее решение.
    const updated = await client.query(
      `update public.program_change_actions
       set status = 'reverted', reverted_at = $2
       where id = $1
       returning ${ACTION_COLUMNS}`,
      [actionId, now.toISOString()],
    )
    await restoreSnapshot(client, action)
    return mapActionRow(updated.rows[0], userId, null)
  })
}

/** Issue #442: восстанавливает предписание слота из снимка before. */
async function restoreSnapshot(client: DbClient, action: ProgramChangeAppliedAction): Promise<void> {
  if (action.changeType === 'change_focus') {
    const sets = Number((action.before as AdjustVolumeSnapshot | null)?.setsCount)
    if (Number.isFinite(sets)) {
      await updateWeeklyVolumeTargetSets(client, { id: action.programExerciseId, targetSets: sets })
    }
    return
  }
  if (action.changeType === 'swap_exercise') {
    const snapshot = action.before as SwapExerciseSnapshot | null
    if (!snapshot?.exerciseId) return
    await updateProgramExercise(client, {
      id: action.programExerciseId,
      exerciseId: snapshot.exerciseId,
      setsCount: snapshot.setsCount,
      repMin: snapshot.repMin,
      repMax: snapshot.repMax,
      targetWeight: snapshot.targetWeight,
      weightStep: snapshot.weightStep,
      restSeconds: snapshot.restSeconds,
      todayGoal: formatTodayGoal(snapshot.targetWeight, snapshot.setsCount, snapshot.repMin).slice(0, 140),
    })
    return
  }
  const beforeSetsCount = Number((action.before as AdjustVolumeSnapshot | null)?.setsCount)
  if (Number.isFinite(beforeSetsCount)) {
    await updateProgramExercise(client, { id: action.programExerciseId, setsCount: beforeSetsCount })
  }
}

/**
 * Issue #442: цель дня из предписания (та же формула, что formatTodayGoal в
 * coachPlanner.ts — функция приватная, дублируем одну строку).
 */
function formatTodayGoal(weight: number, setsCount: number, repMin: number): string {
  const safeWeight = Number(weight)
  const goal = Number.isFinite(safeWeight) && safeWeight > 0 ? `${formatWeight(safeWeight)}×${repMin}` : String(repMin)
  const safeSets = Number.isFinite(Number(setsCount)) && Number(setsCount) > 0 ? Math.round(Number(setsCount)) : 1
  return Array.from({ length: safeSets }, () => goal).join('/')
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
