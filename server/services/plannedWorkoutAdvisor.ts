// Issue #139: LLM-советник для содержимого запланированной тренировки.
//
// Паттерн повторяет server/coachSetAdvisor.ts (per-set): детерминированный
// генератор (plannedWorkoutGenerator) собирает baseline-план — подбор
// упражнений и предписания. Здесь LLM:
//   1) может ЗАМЕНИТЬ упражнение слота на безопасную альтернативу из
//      детерминированного whitelist (та же мышечная группа, не забанено, не
//      забито, не в восстановлении) — набор кандидатов формирует генератор;
//   2) УТОЧНЯЕТ предписания оставшихся упражнений (вес, повторы, подходы,
//      короткий фокус).
// Свапы валидируются pure-функцией resolvePlannedSwaps (id из whitelist, та же
// группа, без дублей). Предписания клампятся теми же границами, что и baseline
// (мезоцикл/разгрузка, шаг веса, не ниже рабочего веса — инвариант #136,
// скачок по политике). На любой ошибке LLM возвращаем baseline без изменений
// (graceful degradation). Применение свапа (пере-предписание нового
// упражнения) делает генератор — он владеет applyPrescription/периодизацией.
import { isLlmConfigured, requestLlmJson } from '../lib/llmClient.js'
import { roundWeight } from '../lib/format.js'

/** Предписание одного упражнения — вход и выход советника. */
export interface PlannedExercisePrescription {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  /** Нормализованный ключ группы — по нему сверяем допустимость свапа. */
  muscleKey: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  coachFocus: string
  /** Запомненный рабочий вес (MAX топ-подхода за 3 сессии, #99) — нижняя
   * граница веса вне разгрузки (инвариант #136). */
  currentWorkingWeight?: number | null
}

/** Безопасная альтернатива для свапа (из детерминированного whitelist). */
export interface AllowedAlternative {
  exerciseId: string
  exerciseName: string
  muscleKey: string
}

/** Сырое предложение LLM по одному слоту (все поля опциональны). */
export interface LlmPrescriptionProposal {
  exerciseId?: string
  /** id упражнения из whitelist, на которое LLM предлагает заменить слот. */
  replaceWithExerciseId?: string
  targetWeight?: number
  setsCount?: number
  repMin?: number
  repMax?: number
  coachFocus?: string
}

export interface ClampPlannedOptions {
  isDeload: boolean
  /** Максимальный скачок веса вверх в шагах (политика пользователя). */
  maxWeightJumpSteps: number
}

export interface RefinePlannedWorkoutContext {
  goal?: string
  level?: string
  readinessScore?: number
  recoveryStatus?: string
  mesocyclePhase?: string
  weekInCycle?: number
  cycleLength?: number
  lowReadiness?: boolean
  muscleFatigue?: string
}

export interface RefinePlannedWorkoutInput {
  scheduledDate: string
  baseline: PlannedExercisePrescription[]
  allowedAlternatives?: AllowedAlternative[]
  options: ClampPlannedOptions
  context: RefinePlannedWorkoutContext
}

export interface RefinePlannedWorkoutResult {
  /** Клампованные предписания (для НЕ заменённых слотов). */
  exercises: PlannedExercisePrescription[]
  /** slotExerciseId → newExerciseId — валидные свапы, применяет генератор. */
  swaps: Map<string, string>
  source: 'llm' | 'rules'
}

const LLM_TIMEOUT_MS = 6000

const SYSTEM_PROMPT = [
  'Ты персональный силовой тренер. Тебе дан черновик следующей тренировки атлета,',
  'собранный по правилам: список упражнений и предписания, плюс список безопасных',
  'альтернатив для замены. Твоя задача:',
  '1) при желании ЗАМЕНИТЬ упражнение на более подходящую альтернативу — только из',
  '   присланного списка альтернатив и только той же мышечной группы (replaceWithExerciseId);',
  '2) уточнить ПРЕДПИСАНИЯ (рабочий вес, повторы, подходы, короткий фокус).',
  'Не добавляй и не удаляй упражнения, не меняй их количество. Безопасность, техника и',
  'восстановление важнее объёма. Не предлагай резких скачков веса. Если правила разумны —',
  'оставь как есть. Учитывай рабочий вес, фазу цикла, готовность и усталость групп.',
  'Верни СТРОГО JSON без пояснений:',
  '{"exercises":[{"exerciseId":"...","replaceWithExerciseId":null,"targetWeight":60,"setsCount":3,"repMin":6,"repMax":8,"coachFocus":"короткая фраза"}]}',
].join('\n')

/**
 * Пул-чистая валидация свапов: возвращает Map slotExerciseId → newExerciseId
 * для тех предложений LLM, где замена безопасна:
 *  - новое упражнение есть в whitelist безопасных альтернатив;
 *  - та же мышечная группа, что у заменяемого слота;
 *  - оно не дублирует уже выбранное в плане и не занято другим свапом.
 * Никогда не бросает. Экспортируется для прямого юнит-тестирования.
 */
export function resolvePlannedSwaps(
  baseline: PlannedExercisePrescription[],
  proposals: LlmPrescriptionProposal[] | null | undefined,
  allowedAlternatives: AllowedAlternative[] | null | undefined,
): Map<string, string> {
  const swaps = new Map<string, string>()
  const allowedById = new Map<string, AllowedAlternative>()
  for (const alt of allowedAlternatives ?? []) {
    const id = String(alt?.exerciseId ?? '')
    if (id) allowedById.set(id, alt)
  }
  const proposalBySlot = new Map<string, LlmPrescriptionProposal>()
  for (const proposal of proposals ?? []) {
    const slot = String(proposal?.exerciseId ?? '')
    if (slot) proposalBySlot.set(slot, proposal)
  }
  const baselineIds = new Set(baseline.map((exercise) => exercise.exerciseId))
  const claimed = new Set<string>()

  for (const slot of baseline) {
    const proposal = proposalBySlot.get(slot.exerciseId)
    const newId = String(proposal?.replaceWithExerciseId ?? '')
    if (!newId || newId === slot.exerciseId) continue
    const alt = allowedById.get(newId)
    if (!alt) continue // не из безопасного списка
    if (alt.muscleKey !== slot.muscleKey) continue // только та же группа
    if (baselineIds.has(newId) || claimed.has(newId)) continue // без дублей
    swaps.set(slot.exerciseId, newId)
    claimed.add(newId)
  }
  return swaps
}

/**
 * Пул-чистый кламп предписаний: применяет предложение LLM к baseline и держит
 * каждое значение в безопасных границах относительно baseline. Никогда не
 * бросает. Заменённые слоты (swaps) пропускает — их пере-предписывает генератор.
 */
export function clampRefinedPlannedExercises(
  baseline: PlannedExercisePrescription[],
  proposals: LlmPrescriptionProposal[] | null | undefined,
  options: ClampPlannedOptions,
  swaps: Map<string, string> = new Map(),
): { exercises: PlannedExercisePrescription[]; changed: boolean } {
  const byId = new Map<string, LlmPrescriptionProposal>()
  for (const proposal of proposals ?? []) {
    const id = String(proposal?.exerciseId ?? '')
    if (id) byId.set(id, proposal)
  }
  const maxJumpSteps = Math.max(0, Math.floor(safeNumber(options.maxWeightJumpSteps, 1)))
  let changed = false

  const exercises = baseline.map((base) => {
    // Заменённый слот пере-предписывает генератор — LLM-числа сюда не тянем.
    if (swaps.has(base.exerciseId)) return base
    const proposal = byId.get(base.exerciseId)
    if (!proposal) return base

    const step = base.weightStep > 0 ? base.weightStep : 2.5

    // Вес: только для упражнений со штангой/весом (targetWeight > 0). Для
    // упражнений с весом тела и на время (targetWeight = 0) вес не трогаем.
    let targetWeight = base.targetWeight
    if (base.targetWeight > 0 && Number.isFinite(Number(proposal.targetWeight))) {
      const upper = base.targetWeight + maxJumpSteps * step
      const workingFloor = Number.isFinite(Number(base.currentWorkingWeight)) && Number(base.currentWorkingWeight) > 0
        ? Number(base.currentWorkingWeight)
        : base.targetWeight
      // Вне разгрузки не опускаемся ниже рабочего веса (инвариант #136).
      // В разгрузку допускаем снижение до 2 шагов.
      const lower = options.isDeload
        ? Math.max(0, base.targetWeight - 2 * step)
        : Math.max(0, Math.min(base.targetWeight, workingFloor))
      targetWeight = roundToStep(clampNumber(Number(proposal.targetWeight), lower, upper), step)
    }

    // Подходы: ±1 от baseline.
    const setsCount = Number.isFinite(Number(proposal.setsCount))
      ? Math.round(clampNumber(Number(proposal.setsCount), Math.max(1, base.setsCount - 1), base.setsCount + 1))
      : base.setsCount

    // Повторы: близко к baseline (защита от абсурда, в т.ч. для упражнений на
    // время, где reps — это секунды).
    const repMin = Number.isFinite(Number(proposal.repMin))
      ? Math.round(clampNumber(Number(proposal.repMin), Math.max(1, base.repMin - 3), base.repMin + 5))
      : base.repMin
    const repMax = Number.isFinite(Number(proposal.repMax))
      ? Math.round(clampNumber(Number(proposal.repMax), repMin + 1, base.repMax + 5))
      : Math.max(repMin + 1, base.repMax)

    const coachFocus = typeof proposal.coachFocus === 'string' && proposal.coachFocus.trim().length > 0
      ? proposal.coachFocus.trim().slice(0, 500)
      : base.coachFocus

    const next: PlannedExercisePrescription = { ...base, targetWeight, setsCount, repMin, repMax, coachFocus }
    if (
      next.targetWeight !== base.targetWeight ||
      next.setsCount !== base.setsCount ||
      next.repMin !== base.repMin ||
      next.repMax !== base.repMax ||
      next.coachFocus !== base.coachFocus
    ) {
      changed = true
    }
    return next
  })

  return { exercises, changed }
}

/**
 * Уточнить план через LLM: возможные свапы (валидируются по whitelist) +
 * уточнение предписаний. Возвращает baseline без изменений, если LLM не
 * сконфигурирован, упал, ответил мусором или пустой список — вызывающий код
 * всегда получает валидный план.
 */
export async function refinePlannedWorkoutPrescriptions(input: RefinePlannedWorkoutInput): Promise<RefinePlannedWorkoutResult> {
  const baseline = input.baseline ?? []
  const empty: RefinePlannedWorkoutResult = { exercises: baseline, swaps: new Map(), source: 'rules' }
  if (baseline.length === 0 || !isLlmConfigured()) return empty

  const proposal = await requestLlmJson<{ exercises?: LlmPrescriptionProposal[] }>({
    tier: 'mid',
    caller: 'plannedWorkoutAdvisor',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 800,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  })
  if (!proposal || !Array.isArray(proposal.exercises)) return empty

  const swaps = resolvePlannedSwaps(baseline, proposal.exercises, input.allowedAlternatives)
  const { exercises, changed } = clampRefinedPlannedExercises(baseline, proposal.exercises, input.options, swaps)
  return { exercises, swaps, source: swaps.size > 0 || changed ? 'llm' : 'rules' }
}

function buildPrompt(input: RefinePlannedWorkoutInput): string {
  const c = input.context
  const cycle = c.mesocyclePhase
    ? `${c.mesocyclePhase}${c.weekInCycle && c.cycleLength ? ` (неделя ${c.weekInCycle}/${c.cycleLength})` : ''}`
    : 'нет данных'
  const deloadHint = input.options.isDeload
    ? 'Сейчас разгрузочная неделя — объём и интенсивность снижены намеренно, не повышай вес.'
    : ''
  const exercises = input.baseline
    .map((e) => {
      const working = Number.isFinite(Number(e.currentWorkingWeight)) && Number(e.currentWorkingWeight) > 0
        ? `, рабочий вес ${e.currentWorkingWeight}кг`
        : ''
      const weight = e.targetWeight > 0 ? `${e.targetWeight}кг` : 'вес тела/на время'
      return `- ${e.exerciseId} (${e.exerciseName}, ${e.muscleGroup}): ${e.setsCount}×${e.repMin}-${e.repMax}, ${weight}${working}`
    })
    .join('\n')
  const alternatives = (input.allowedAlternatives ?? []).length > 0
    ? (input.allowedAlternatives ?? [])
        .map((a) => `- ${a.exerciseId} (${a.exerciseName}, группа ${a.muscleKey})`)
        .join('\n')
    : 'нет'

  return `Дата: ${input.scheduledDate}
Цель: ${c.goal ?? 'общий прогресс'}
Уровень: ${c.level ?? 'intermediate'}
Готовность: ${c.readinessScore ?? 70}/100
Восстановление: ${c.recoveryStatus ?? 'unknown'}
Мезоцикл: ${cycle}
Усталость по группам: ${c.muscleFatigue ?? 'нет данных'}
${c.lowReadiness ? 'Внимание: сниженная готовность, тренировка облегчена.' : ''}
${deloadHint}

Черновик тренировки (правила):
${exercises}

Безопасные альтернативы для замены (только та же группа):
${alternatives}

Уточни план. Верни JSON с массивом exercises (по тем же exerciseId; replaceWithExerciseId — только из списка альтернатив или null).`
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function roundToStep(weight: number, step: number): number {
  if (!(step > 0)) return roundWeight(weight)
  return roundWeight(Math.round(weight / step) * step)
}

function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
