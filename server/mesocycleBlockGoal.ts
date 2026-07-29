// Этап 1 (#174): измеримая цель тренировочного блока.
//
// Мезоцикл давал форму блока (загрузка / накопление / интенсификация /
// разгрузка), но не замысел: блок не мог закончиться ни успехом, ни провалом,
// только по календарю. Здесь у блока появляется цель — показатель, целевое
// значение, срок, ожидаемый темп прироста и критерии провала, — и факт
// сверяется с ожиданием.
//
// Ключевая оговорка (#174): ожидаемый темп берётся из уровня и возраста, а НЕ
// из наблюдаемого наклона тренда. После перерыва наклон отражает возврат к
// прежним рабочим весам (+3 кг/нед на жиме бывает и в 43), а не адаптацию;
// экстраполяция такого наклона в цель гарантирует ложную «стагнацию», когда
// возврат закончится. Возвратный сегмент отмечается отдельно (regainToValue) и
// не засчитывается как опережение графика.
//
// Арифметика — правилами (надёжно и проверяемо), LLM только пересказывает:
// цель блока попадает в промпты через coachLongTermMemory.

import type { AgeRecoveryPhase, MesocycleState } from '../shared/types.js'
import type { DbClient } from './dbClient.js'
import { getUserTrainingPolicy } from './userTrainingPolicies.js'

export type BlockGoalStatus = 'active' | 'achieved' | 'missed'

/** Вердикт сверки факта с ожиданием. */
export type BlockGoalVerdict =
  | 'achieved'    // цель блока взята
  | 'ahead'       // идём быстрее ожидания
  | 'on_track'    // в графике
  | 'regaining'   // прирост есть, но это возврат к прежнему уровню, не адаптация
  | 'behind'      // отстаём от ожидания
  | 'stalled'     // прироста нет вовсе (предпосылка диагностики стагнации, #175)
  | 'failed'      // критерий провала — сигнал к досрочному выходу из блока

export interface BlockGoal {
  id: string
  userId: string
  blockStartedOn: string
  exerciseId: string
  exerciseName: string
  title: string
  baselineValue: number
  targetValue: number
  expectedRatePerWeek: number
  regainToValue: number | null
  horizonWeeks: number
  failureDropValue: number | null
  failurePainSessions: number | null
  status: BlockGoalStatus
  progressNote: string | null
  progressVerdict: BlockGoalVerdict | null
  outcomeNote: string | null
}

export interface BlockGoalProgress {
  weeksElapsed: number
  expectedValue: number
  actualValue: number
  /** Факт минус ожидание, кг. Отрицательное — отстаём. */
  deviation: number
  verdict: BlockGoalVerdict
  note: string
}

// ---------------------------------------------------------------------------
// Ожидаемый темп прироста
// ---------------------------------------------------------------------------

// Прирост e1RM на базовом движении, кг/нед. Сознательно консервативные
// значения: переоценка темпа ведёт к ложным выводам о стагнации.
const BEGINNER_RATE = 0.75
const INTERMEDIATE_RATE = 0.35
const ADVANCED_RATE = 0.15

// Возраст правит темп через ту же классификацию, что и восстановление.
const AGE_FACTOR: Record<AgeRecoveryPhase, number> = {
  teen: 1,
  adult: 1,
  mature_adult: 0.6,
}

/** Возврат к прежним весам идёт заметно быстрее адаптации. */
const REGAIN_MULTIPLIER = 3

/** Провал блока: показатель просел ниже стартового больше чем на 5%. */
const FAILURE_DROP_RATIO = 0.95

/** Провал блока: столько тренировок с болью в блоке. */
const FAILURE_PAIN_SESSIONS = 2

interface ProfileForBlockGoal {
  age?: number | null
  level?: string | null
}

/**
 * Ожидаемый недельный прирост e1RM — из стажа (уровня) и возраста.
 * Наблюдаемый наклон тренда сюда сознательно не входит (см. шапку файла).
 */
export function expectedE1rmRatePerWeek(profile: ProfileForBlockGoal = {}): number {
  const level = String(profile.level ?? '').toLowerCase()
  // Уровень приходит и по-английски (анкета), и по-русски (свободный текст).
  const isBeginner = ['beginner', 'нович', 'перерыв', 'возвращ', 'return'].some((key) => level.includes(key))
  const isAdvanced = ['advanced', 'опыт', 'продвин'].some((key) => level.includes(key))
  const baseRate = isBeginner ? BEGINNER_RATE : isAdvanced ? ADVANCED_RATE : INTERMEDIATE_RATE
  const phase: AgeRecoveryPhase =
    getUserTrainingPolicy({ age: profile.age ?? undefined })?.ageRecoveryProfile?.phase ?? 'adult'
  return roundTo(baseRate * (AGE_FACTOR[phase] ?? 1), 0.05)
}

// ---------------------------------------------------------------------------
// Показатель блока из истории e1RM
// ---------------------------------------------------------------------------

export interface E1rmPointLike {
  date: string
  e1rm: number
}

export interface E1rmHistoryLike {
  exerciseId: string
  exerciseName: string
  currentBest: number
  dataPoints: E1rmPointLike[]
}

export interface BlockE1rmSummary {
  /** Лучший e1RM до старта блока — точка отсчёта. */
  baseline: number
  /** Лучший e1RM внутри блока; без данных равен baseline. */
  actual: number
  /** Лучший e1RM за всю известную историю. */
  allTimeBest: number
  pointsInBlock: number
}

/** Окно перед стартом блока, по которому берётся точка отсчёта. */
const BASELINE_WINDOW_DAYS = 14

/**
 * Разложить историю e1RM на «до блока» и «в блоке».
 *
 * Точка отсчёта — уровень непосредственно перед блоком (максимум за две недели
 * до старта), а НЕ максимум за всю историю: иначе после перерыва блок начинался
 * бы с недостижимой отметки, а возвратный сегмент вообще не был бы виден.
 * Внутри блока берётся максимум: одна плохая тренировка не должна выглядеть
 * как потеря силы, а вот отсутствие роста максимума — это и есть стагнация.
 */
export function summarizeE1rmForBlock(dataPoints: E1rmPointLike[], blockStartedOn: string): BlockE1rmSummary {
  const windowStart = shiftDays(blockStartedOn, -BASELINE_WINDOW_DAYS)
  const before: Array<{ day: string; e1rm: number }> = []
  const inBlock: number[] = []
  for (const point of dataPoints ?? []) {
    const e1rm = Number(point?.e1rm)
    if (!Number.isFinite(e1rm) || e1rm <= 0) continue
    const day = String(point.date ?? '').slice(0, 10)
    if (day < blockStartedOn) before.push({ day, e1rm })
    else inBlock.push(e1rm)
  }
  before.sort((a, b) => a.day.localeCompare(b.day))
  const recent = before.filter((point) => point.day >= windowStart)
  const baseline = recent.length > 0
    ? Math.max(...recent.map((point) => point.e1rm))
    : before.length > 0
      ? before[before.length - 1].e1rm
      : (inBlock.length > 0 ? Math.min(...inBlock) : 0)
  const actual = inBlock.length > 0 ? Math.max(...inBlock) : baseline
  const allTimeBest = Math.max(baseline, actual, ...before.map((point) => point.e1rm))
  return { baseline: roundTo(baseline, 0.1), actual: roundTo(actual, 0.1), allTimeBest: roundTo(allTimeBest, 0.1), pointsInBlock: inBlock.length }
}

function shiftDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Постановка цели блока
// ---------------------------------------------------------------------------

export interface BlockGoalDraft {
  blockStartedOn: string
  exerciseId: string
  exerciseName: string
  title: string
  baselineValue: number
  targetValue: number
  expectedRatePerWeek: number
  regainToValue: number | null
  horizonWeeks: number
  failureDropValue: number
  failurePainSessions: number
}

interface BuildDraftInput {
  profile: ProfileForBlockGoal
  mesocycle: MesocycleState
  e1rmHistories: E1rmHistoryLike[]
  /** Упражнение долгосрочной цели пользователя — блок работает на неё. */
  preferredExerciseId?: string | null
}

/** Минимум точек, чтобы показатель вообще имел смысл как цель. */
const MIN_DATA_POINTS = 2

/**
 * Сформулировать цель блока: упражнение, стартовое значение, цель к концу
 * загрузочных недель, ожидаемый темп и критерии провала.
 * null — данных для измеримой цели пока не хватает.
 */
export function buildBlockGoalDraft({
  profile,
  mesocycle,
  e1rmHistories,
  preferredExerciseId = null,
}: BuildDraftInput): BlockGoalDraft | null {
  const blockStartedOn = mesocycle?.cycleStartedOn
  if (!blockStartedOn) return null

  const candidates = (e1rmHistories ?? []).filter((h) => (h.dataPoints?.length ?? 0) >= MIN_DATA_POINTS)
  if (candidates.length === 0) return null

  // Цель блока служит долгосрочной цели пользователя, если та есть;
  // иначе — движение с самой длинной историей (там сигнал надёжнее).
  const preferred = preferredExerciseId
    ? candidates.find((h) => String(h.exerciseId) === String(preferredExerciseId))
    : undefined
  const chosen = preferred ?? [...candidates].sort((a, b) => {
    const byPoints = (b.dataPoints?.length ?? 0) - (a.dataPoints?.length ?? 0)
    return byPoints !== 0 ? byPoints : (b.currentBest ?? 0) - (a.currentBest ?? 0)
  })[0]

  const summary = summarizeE1rmForBlock(chosen.dataPoints ?? [], blockStartedOn)
  if (summary.baseline <= 0) return null

  // Прирост ожидается на загрузочных неделях: разгрузка — про восстановление.
  const horizonWeeks = Math.max(1, Number(mesocycle.loadingWeeks) || 1)
  const rate = expectedE1rmRatePerWeek(profile)
  // Возврат к прежнему максимуму — не адаптация, но и не повод занижать цель.
  const regainToValue = summary.allTimeBest > summary.baseline ? summary.allTimeBest : null
  const adaptationTarget = summary.baseline + rate * horizonWeeks
  const regainTarget = regainToValue
    ? Math.min(regainToValue, summary.baseline + rate * REGAIN_MULTIPLIER * horizonWeeks)
    : 0
  const targetValue = roundTo(Math.max(adaptationTarget, regainTarget), 0.5)

  return {
    blockStartedOn,
    exerciseId: String(chosen.exerciseId),
    exerciseName: String(chosen.exerciseName ?? chosen.exerciseId),
    title: `${chosen.exerciseName ?? chosen.exerciseId}: e1RM ${summary.baseline} → ${targetValue} кг за ${horizonWeeks} нед`,
    baselineValue: summary.baseline,
    targetValue,
    expectedRatePerWeek: rate,
    regainToValue,
    horizonWeeks,
    failureDropValue: roundTo(summary.baseline * FAILURE_DROP_RATIO, 0.5),
    failurePainSessions: FAILURE_PAIN_SESSIONS,
  }
}

// ---------------------------------------------------------------------------
// Сверка факта с ожиданием
// ---------------------------------------------------------------------------

interface EvaluateInput {
  actualValue: number
  /** Номер недели в цикле (1 — первая неделя блока). */
  weekInCycle: number
  /** Тренировок с болью внутри блока. */
  painSessions?: number
}

/** Полоса «в графике» вокруг ожидания — половина ожидаемого прироста. */
function toleranceFor(goal: Pick<BlockGoal, 'expectedRatePerWeek'>, weeksElapsed: number): number {
  return Math.max(0.5, goal.expectedRatePerWeek * Math.max(1, weeksElapsed) * 0.5)
}

/**
 * Сравнить факт с ожиданием. Именно ожидаемый темп отличает нормальное
 * замедление от стагнации: без него отсчитывать не от чего.
 */
export function evaluateBlockGoalProgress(
  goal: BlockGoal | BlockGoalDraft,
  { actualValue, weekInCycle, painSessions = 0 }: EvaluateInput,
): BlockGoalProgress {
  const weeksElapsed = Math.max(0, Math.min(Number(weekInCycle) || 1, goal.horizonWeeks + 1) - 1)
  const actual = roundTo(actualValue, 0.1)

  // Возврат к прежним весам идёт быстрее адаптации — ожидание на этом
  // отрезке выше, иначе «в графике» будет означать «стоим».
  const regainTo = goal.regainToValue ?? null
  const rate = regainTo && actual < regainTo ? goal.expectedRatePerWeek * REGAIN_MULTIPLIER : goal.expectedRatePerWeek
  const expectedValue = roundTo(Math.min(goal.targetValue, goal.baselineValue + rate * weeksElapsed), 0.1)
  const deviation = roundTo(actual - expectedValue, 0.1)

  const verdict = resolveVerdict({ goal, actual, deviation, weeksElapsed, painSessions, regainTo })
  return {
    weeksElapsed,
    expectedValue,
    actualValue: actual,
    deviation,
    verdict,
    note: buildProgressNote({ goal, actual, expectedValue, deviation, weeksElapsed, verdict, painSessions }),
  }
}

interface ResolveVerdictInput {
  goal: BlockGoal | BlockGoalDraft
  actual: number
  deviation: number
  weeksElapsed: number
  painSessions: number
  regainTo: number | null
}

function resolveVerdict({ goal, actual, deviation, weeksElapsed, painSessions, regainTo }: ResolveVerdictInput): BlockGoalVerdict {
  const failureDrop = goal.failureDropValue ?? null
  const painLimit = goal.failurePainSessions ?? null
  if (failureDrop !== null && actual < failureDrop) return 'failed'
  if (painLimit !== null && painSessions >= painLimit) return 'failed'
  if (actual >= goal.targetValue) return 'achieved'
  // Прироста нет вовсе — это стагнация, а не медленный темп.
  if (weeksElapsed >= 2 && actual <= goal.baselineValue) return 'stalled'
  if (deviation > toleranceFor(goal, weeksElapsed)) {
    // Опережение внутри возвратного отрезка — не адаптация: экстраполировать
    // его в темп блока нельзя, он закончится сам.
    return regainTo && actual < regainTo ? 'regaining' : 'ahead'
  }
  if (deviation < -toleranceFor(goal, weeksElapsed)) return 'behind'
  return 'on_track'
}

interface ProgressNoteInput {
  goal: BlockGoal | BlockGoalDraft
  actual: number
  expectedValue: number
  deviation: number
  weeksElapsed: number
  verdict: BlockGoalVerdict
  painSessions: number
}

function buildProgressNote({ goal, actual, expectedValue, deviation, weeksElapsed, verdict, painSessions }: ProgressNoteInput): string {
  const base = `неделя ${weeksElapsed + 1}/${goal.horizonWeeks}: e1RM ${actual} из ${goal.targetValue} кг, ожидалось ${expectedValue}`
  const gap = `${deviation >= 0 ? '+' : ''}${deviation} кг к ожиданию`
  switch (verdict) {
    case 'achieved':
      return `цель блока достигнута: e1RM ${actual} при цели ${goal.targetValue} кг`
    case 'failed':
      return painSessions >= (goal.failurePainSessions ?? Infinity)
        ? `критерий провала: ${painSessions} тренировок с болью в блоке — блок пора закрывать досрочно`
        : `критерий провала: e1RM ${actual} кг ниже порога ${goal.failureDropValue} кг — блок пора закрывать досрочно`
    case 'stalled':
      return `${base} — прироста нет с начала блока`
    case 'regaining':
      return `${base} (${gap}) — это возврат к прежнему уровню (${goal.regainToValue} кг), не адаптация`
    case 'ahead':
      return `${base} (${gap}) — идём с опережением`
    case 'behind':
      return `${base} (${gap}) — отстаём от ожидания`
    default:
      return `${base} (${gap}) — в графике`
  }
}

// ---------------------------------------------------------------------------
// Оценка блока по завершении
// ---------------------------------------------------------------------------

export interface BlockOutcome {
  status: Exclude<BlockGoalStatus, 'active'>
  outcomeNote: string
}

/**
 * Оценка блока: достигли или нет и что это говорит о переносимости нагрузки.
 * Вызывается, когда начался новый блок, — по факту предыдущего.
 */
export function assessBlockOutcome(goal: BlockGoal, progress: BlockGoalProgress): BlockOutcome {
  const gained = roundTo(progress.actualValue - goal.baselineValue, 0.1)
  const planned = roundTo(goal.targetValue - goal.baselineValue, 0.1)
  const achieved = progress.actualValue >= goal.targetValue
  const pace = progress.weeksElapsed > 0 ? roundTo(gained / progress.weeksElapsed, 0.05) : gained
  const paceText = `факт ${gained >= 0 ? '+' : ''}${gained} кг за ${progress.weeksElapsed || goal.horizonWeeks} нед (${pace >= 0 ? '+' : ''}${pace} кг/нед) при плане +${planned}`

  if (achieved) {
    return {
      status: 'achieved',
      outcomeNote: `Блок ${goal.blockStartedOn}: цель взята — ${goal.exerciseName} e1RM ${progress.actualValue} кг, ${paceText}. Ожидаемый темп ${goal.expectedRatePerWeek} кг/нед подтвердился.`,
    }
  }
  const reason = progress.verdict === 'failed'
    ? 'блок закрыт по критерию провала'
    : gained <= 0
      ? 'прироста не было'
      : 'темп ниже ожидаемого'
  return {
    status: 'missed',
    outcomeNote: `Блок ${goal.blockStartedOn}: цель не взята (${reason}) — ${goal.exerciseName} e1RM ${progress.actualValue} из ${goal.targetValue} кг, ${paceText}. Ожидание ${goal.expectedRatePerWeek} кг/нед для следующего блока стоит пересмотреть.`,
  }
}

// ---------------------------------------------------------------------------
// Формат для промптов
// ---------------------------------------------------------------------------

export function formatBlockGoalForPrompt(goal: BlockGoal | null): string {
  if (!goal) return ''
  const lines = [
    'ЦЕЛЬ ТЕКУЩЕГО БЛОКА:',
    `- ${goal.title} (ожидаемый темп +${goal.expectedRatePerWeek} кг/нед)`,
  ]
  if (goal.progressNote) lines.push(`- сверка: ${goal.progressNote}`)
  if (goal.failureDropValue !== null || goal.failurePainSessions !== null) {
    const criteria = [
      goal.failureDropValue !== null ? `e1RM ниже ${goal.failureDropValue} кг` : null,
      goal.failurePainSessions !== null ? `${goal.failurePainSessions} тренировки с болью` : null,
    ].filter(Boolean).join(' или ')
    lines.push(`- досрочный выход из блока: ${criteria}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Хранение
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `id, user_id, block_started_on, exercise_id, exercise_name, title,
  baseline_value, target_value, expected_rate_per_week, regain_to_value, horizon_weeks,
  failure_drop_value, failure_pain_sessions, status, progress_note, progress_verdict, outcome_note`

/**
 * Цель текущего блока — последняя незакрытая. Достигнутая досрочно (status
 * 'achieved') остаётся текущей до конца блока: оценка блока пишется при смене
 * блока, а не в момент достижения.
 */
export async function loadActiveBlockGoal(client: DbClient, userId: string): Promise<BlockGoal | null> {
  const result = await client.query(
    `select ${SELECT_COLUMNS} from public.mesocycle_block_goals
     where user_id = $1 and closed_at is null
     order by block_started_on desc limit 1`,
    [userId],
  )
  const row = (result.rows as Array<Record<string, unknown>>)[0]
  return row ? normalizeBlockGoalRow(row) : null
}

async function loadBlockGoalForBlock(client: DbClient, userId: string, blockStartedOn: string): Promise<BlockGoal | null> {
  const result = await client.query(
    `select ${SELECT_COLUMNS} from public.mesocycle_block_goals
     where user_id = $1 and block_started_on = $2 limit 1`,
    [userId, blockStartedOn],
  )
  const row = (result.rows as Array<Record<string, unknown>>)[0]
  return row ? normalizeBlockGoalRow(row) : null
}

async function insertBlockGoal(client: DbClient, userId: string, draft: BlockGoalDraft): Promise<BlockGoal | null> {
  const result = await client.query(
    `insert into public.mesocycle_block_goals
       (user_id, block_started_on, exercise_id, exercise_name, title, baseline_value, target_value,
        expected_rate_per_week, regain_to_value, horizon_weeks, failure_drop_value, failure_pain_sessions)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (user_id, block_started_on) do nothing
     returning ${SELECT_COLUMNS}`,
    [
      userId, draft.blockStartedOn, draft.exerciseId, draft.exerciseName, draft.title,
      draft.baselineValue, draft.targetValue, draft.expectedRatePerWeek, draft.regainToValue,
      draft.horizonWeeks, draft.failureDropValue, draft.failurePainSessions,
    ],
  )
  const row = (result.rows as Array<Record<string, unknown>>)[0]
  return row ? normalizeBlockGoalRow(row) : loadBlockGoalForBlock(client, userId, draft.blockStartedOn)
}

// ---------------------------------------------------------------------------
// Оркестрация
// ---------------------------------------------------------------------------

interface SyncInput {
  profile: ProfileForBlockGoal
  mesocycle: MesocycleState | null
  e1rmHistories: E1rmHistoryLike[]
  /** История тренировок — для подсчёта тренировок с болью внутри блока. */
  history: Array<{ completedAt: string; exercises?: Array<{ pain?: boolean }> }>
  preferredExerciseId?: string | null
}

export interface SyncBlockGoalResult {
  goal: BlockGoal | null
  progress: BlockGoalProgress | null
  /** Оценки завершённых блоков — пишутся в долгосрочную память вызывающим. */
  closedOutcomes: string[]
}

/**
 * Держит цель блока в актуальном состоянии: закрывает цель прошлого блока с
 * оценкой, ставит цель текущему блоку, сверяет факт с ожиданием.
 */
export async function syncBlockGoal(client: DbClient, userId: string, input: SyncInput): Promise<SyncBlockGoalResult> {
  const empty: SyncBlockGoalResult = { goal: null, progress: null, closedOutcomes: [] }
  const blockStartedOn = input.mesocycle?.cycleStartedOn
  if (!input.mesocycle || !blockStartedOn) return empty

  const closedOutcomes: string[] = []

  // 1. Цель прошлого блока — закрыть оценкой (в том числе достигнутую досрочно).
  const active = await loadActiveBlockGoal(client, userId)
  if (active && active.blockStartedOn !== blockStartedOn) {
    const history = findHistory(input.e1rmHistories, active.exerciseId)
    const summary = summarizeE1rmForBlock(history?.dataPoints ?? [], active.blockStartedOn)
    const progress = evaluateBlockGoalProgress(active, {
      actualValue: summary.pointsInBlock > 0 ? summary.actual : active.baselineValue,
      weekInCycle: active.horizonWeeks + 1,
      painSessions: countPainSessions(input.history, active.blockStartedOn, blockStartedOn),
    })
    const outcome = assessBlockOutcome(active, progress)
    await client.query(
      `update public.mesocycle_block_goals
       set status = $3, outcome_note = $4, progress_note = $5, progress_verdict = $6, closed_at = now()
       where id = $1 and user_id = $2`,
      [active.id, userId, outcome.status, outcome.outcomeNote, progress.note, progress.verdict],
    )
    closedOutcomes.push(outcome.outcomeNote)
  }

  // 2. Цель текущего блока — поставить, если её ещё нет.
  let goal = await loadBlockGoalForBlock(client, userId, blockStartedOn)
  if (!goal) {
    const draft = buildBlockGoalDraft({
      profile: input.profile,
      mesocycle: input.mesocycle,
      e1rmHistories: input.e1rmHistories,
      preferredExerciseId: input.preferredExerciseId,
    })
    if (!draft) return { ...empty, closedOutcomes }
    goal = await insertBlockGoal(client, userId, draft)
    if (!goal) return { ...empty, closedOutcomes }
  }

  // 3. Сверка факта с ожиданием.
  const history = findHistory(input.e1rmHistories, goal.exerciseId)
  const summary = summarizeE1rmForBlock(history?.dataPoints ?? [], goal.blockStartedOn)
  const progress = evaluateBlockGoalProgress(goal, {
    actualValue: summary.pointsInBlock > 0 ? summary.actual : goal.baselineValue,
    weekInCycle: input.mesocycle.weekInCycle,
    painSessions: countPainSessions(input.history, goal.blockStartedOn),
  })
  const status: BlockGoalStatus = progress.verdict === 'achieved' ? 'achieved' : goal.status
  if (progress.note !== goal.progressNote || progress.verdict !== goal.progressVerdict || status !== goal.status) {
    await client.query(
      `update public.mesocycle_block_goals
       set progress_note = $3, progress_verdict = $4, status = $5
       where id = $1 and user_id = $2`,
      [goal.id, userId, progress.note, progress.verdict, status],
    )
    goal = { ...goal, progressNote: progress.note, progressVerdict: progress.verdict, status }
  }

  return { goal, progress, closedOutcomes }
}

function findHistory(histories: E1rmHistoryLike[], exerciseId: string): E1rmHistoryLike | undefined {
  return (histories ?? []).find((h) => String(h.exerciseId) === String(exerciseId))
}

/** Тренировки с отметкой боли в интервале [from, until). */
export function countPainSessions(
  history: Array<{ completedAt: string; exercises?: Array<{ pain?: boolean }> }>,
  from: string,
  until?: string,
): number {
  return (history ?? []).filter((session) => {
    const day = String(session?.completedAt ?? '').slice(0, 10)
    if (!day || day < from) return false
    if (until && day >= until) return false
    return (session.exercises ?? []).some((exercise) => Boolean(exercise?.pain))
  }).length
}

/** Округление к шагу (0.1 — показатели, 0.5 — веса). Второе округление снимает мусор float. */
function roundTo(value: number, step: number): number {
  return Math.round(Math.round(Number(value) / step) * step * 100) / 100
}

function normalizeBlockGoalRow(row: Record<string, unknown>): BlockGoal {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    blockStartedOn: String((row.block_started_on as Date)?.toISOString?.()?.slice(0, 10) ?? row.block_started_on).slice(0, 10),
    exerciseId: String(row.exercise_id),
    exerciseName: String(row.exercise_name),
    title: String(row.title),
    baselineValue: Number(row.baseline_value),
    targetValue: Number(row.target_value),
    expectedRatePerWeek: Number(row.expected_rate_per_week),
    regainToValue: row.regain_to_value === null || row.regain_to_value === undefined ? null : Number(row.regain_to_value),
    horizonWeeks: Number(row.horizon_weeks),
    failureDropValue: row.failure_drop_value === null || row.failure_drop_value === undefined ? null : Number(row.failure_drop_value),
    failurePainSessions: row.failure_pain_sessions === null || row.failure_pain_sessions === undefined ? null : Number(row.failure_pain_sessions),
    status: row.status as BlockGoalStatus,
    progressNote: row.progress_note === null || row.progress_note === undefined ? null : String(row.progress_note),
    progressVerdict: row.progress_verdict === null || row.progress_verdict === undefined ? null : (row.progress_verdict as BlockGoalVerdict),
    outcomeNote: row.outcome_note === null || row.outcome_note === undefined ? null : String(row.outcome_note),
  }
}
