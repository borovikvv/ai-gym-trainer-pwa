// Issue #139: LLM-советник для содержимого запланированной тренировки.
//
// Паттерн повторяет server/coachSetAdvisor.ts (per-set): детерминированный
// генератор (plannedWorkoutGenerator) собирает baseline-план — подбор
// упражнений и предписания. Здесь LLM УТОЧНЯЕТ предписания уже выбранных
// упражнений (вес, повторы, подходы, короткий фокус), а результат жёстко
// клампится теми же правилами, что и baseline (мезоцикл/разгрузка, шаг веса,
// не ниже рабочего веса — инвариант #136, ограничение прыжка по политике
// пользователя). На любой ошибке LLM возвращаем baseline без изменений
// (graceful degradation). Набор упражнений LLM не меняет — отбор остаётся
// детерминированным.
import { isLlmConfigured, requestLlmJson } from '../lib/llmClient.js'
import { roundWeight } from '../lib/format.js'

/** Предписание одного упражнения — вход и выход советника. */
export interface PlannedExercisePrescription {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
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

/** Сырое предложение LLM по одному упражнению (все поля опциональны). */
export interface LlmPrescriptionProposal {
  exerciseId?: string
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
  options: ClampPlannedOptions
  context: RefinePlannedWorkoutContext
}

export interface RefinePlannedWorkoutResult {
  exercises: PlannedExercisePrescription[]
  source: 'llm' | 'rules'
}

const LLM_TIMEOUT_MS = 6000

const SYSTEM_PROMPT = [
  'Ты персональный силовой тренер. Тебе дан черновик следующей тренировки атлета,',
  'собранный по правилам (подбор упражнений и предписания). Твоя задача — уточнить',
  'ПРЕДПИСАНИЯ уже выбранных упражнений под конкретного атлета: рабочий вес, повторы,',
  'число подходов и короткий фокус. Набор упражнений НЕ меняй и не добавляй новых.',
  'Безопасность, техника и восстановление важнее объёма. Не предлагай резких скачков',
  'веса. Если предписание правил разумно — оставь его. Учитывай рабочий вес, фазу',
  'цикла, готовность и усталость групп.',
  'Верни СТРОГО JSON без пояснений:',
  '{"exercises":[{"exerciseId":"...","targetWeight":60,"setsCount":3,"repMin":6,"repMax":8,"coachFocus":"короткая фраза"}]}',
].join('\n')

/**
 * Пул-чистый кламп: применяет предложение LLM к baseline и держит каждое
 * значение в безопасных границах относительно baseline. Никогда не бросает.
 * Экспортируется отдельно для прямого юнит-тестирования (как clampNextSetDecision).
 */
export function clampRefinedPlannedExercises(
  baseline: PlannedExercisePrescription[],
  proposals: LlmPrescriptionProposal[] | null | undefined,
  options: ClampPlannedOptions,
): { exercises: PlannedExercisePrescription[]; changed: boolean } {
  const byId = new Map<string, LlmPrescriptionProposal>()
  for (const proposal of proposals ?? []) {
    const id = String(proposal?.exerciseId ?? '')
    if (id) byId.set(id, proposal)
  }
  const maxJumpSteps = Math.max(0, Math.floor(safeNumber(options.maxWeightJumpSteps, 1)))
  let changed = false

  const exercises = baseline.map((base) => {
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
 * Уточнить предписания baseline-плана через LLM. Возвращает baseline без
 * изменений, если LLM не сконфигурирован, упал, ответил мусором или пустой
 * список упражнений — вызывающий код всегда получает валидный план.
 */
export async function refinePlannedWorkoutPrescriptions(input: RefinePlannedWorkoutInput): Promise<RefinePlannedWorkoutResult> {
  const baseline = input.baseline ?? []
  if (baseline.length === 0 || !isLlmConfigured()) {
    return { exercises: baseline, source: 'rules' }
  }

  const proposal = await requestLlmJson<{ exercises?: LlmPrescriptionProposal[] }>({
    tier: 'mid',
    caller: 'plannedWorkoutAdvisor',
    timeoutMs: LLM_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 700,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  })
  if (!proposal || !Array.isArray(proposal.exercises)) {
    return { exercises: baseline, source: 'rules' }
  }

  const { exercises, changed } = clampRefinedPlannedExercises(baseline, proposal.exercises, input.options)
  return { exercises, source: changed ? 'llm' : 'rules' }
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

Уточни предписания под атлета. Верни JSON с массивом exercises (только те же exerciseId).`
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
