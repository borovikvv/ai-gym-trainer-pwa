import type { CoachState, WorkoutHistoryEntry } from '../shared/types.js'
import { resolveWeightDirection, harderWeight, easierWeight, strongerOf, easierOf } from '../shared/weightDirection.js'
import { roundWeight } from '../shared/format.js'
import { TEEN_LIMIT_REASONS, TEEN_MIN_REPS, teenLimitsApply } from '../shared/teenLimits.js'
import { isDeloadWeek, applyDeloadReduction } from './mesocycle.js'
import { applyPeriodization } from './periodization.js'
import type { ExerciseAnalysisFlag } from './coachProgressAnalysis.js'
import { emptyPreferences, emptyWeeklyContext, hasActivePainFlag, isLongBreakBeforeSession, latestExerciseHistory } from './workoutExerciseEligibility.js'
import { reasonForExercise } from './workoutExerciseSelection.js'
import type {
  CoachDecisionForGenerator,
  CoachMemoryForGenerator,
  GeneratedExercise,
  NormalizedLibraryExercise,
  NormalizedPreferences,
  ProfileForGenerator,
  UserTrainingPolicyForGenerator,
  WeeklyContext,
} from './plannedWorkoutGenerator.js'

export interface ApplyPrescriptionParams {
  exercise: NormalizedLibraryExercise
  profile?: ProfileForGenerator
  coachState: CoachState | null
  coachMemory?: CoachMemoryForGenerator | null
  coachDecision?: CoachDecisionForGenerator | null
  history: WorkoutHistoryEntry[]
  lowReadiness: boolean
  preferences?: NormalizedPreferences
  weeklyContext?: WeeklyContext
  userTrainingPolicy?: UserTrainingPolicyForGenerator | null
  // Issue #106: react to per-exercise analysis flags
  exerciseFlag?: ExerciseAnalysisFlag | null
}

export function applyPrescription({ exercise, profile, coachState, coachMemory = null, coachDecision = null, history, lowReadiness, preferences = emptyPreferences(), weeklyContext = emptyWeeklyContext(), userTrainingPolicy = null, exerciseFlag = null }: ApplyPrescriptionParams): GeneratedExercise {
  const recent = latestExerciseHistory(history, exercise.id)
  // Issue #294: для bodyweight-упражнений «исторический» вес не участвует —
  // старые фиктивные записи (вес 0 + шаг 2.5 → рекомендация 2.5) не должны
  // назначаться плану как реальный кандидат. Прогрессия у них по повторам.
  const historicWeight = exercise.equipment === 'bodyweight' ? NaN : Number(recent?.nextRecommendedWeight ?? NaN)
  // Разгрузка нужна дважды: она снимает инвариант рабочего веса (#170) и
  // переписывает предписание в самом конце — считаем один раз.
  const mesocycleState = coachState?.mesocycle
  const isDeloadSession = isDeloadWeek(mesocycleState as Parameters<typeof isDeloadWeek>[0])
  // Issue #100: use currentWorkingWeight from coachMemory as a fallback.
  // coachMemory computes currentWorkingWeight as the MAX of the last 3
  // sessions (issue #99), so after a deload it remembers the real working
  // weight. Without this fallback, the plan would use nextRecommendedWeight
  // from the last (deload) session, which is too low.
  const coachWorkingWeight = Number(
    coachMemory?.exerciseProfiles?.[exercise.id]?.currentWorkingWeight ?? NaN,
  )
  // historicWeight must be > 0 to be considered valid (0 means no
  // progression recommendation was recorded, e.g. first session or deload).
  //
  // Issue #136: раньше historicWeight (nextRecommendedWeight последней сессии)
  // имел безусловный приоритет над coachWorkingWeight. После разгрузки
  // nextRecommendedWeight занижен (напр. 47.5), а фактический рабочий вес был
  // выше (60кг подняли легко) — план ставил вес НИЖЕ факта. coachMemory уже
  // считает currentWorkingWeight как MAX топ-подхода за 3 сессии (#99), поэтому
  // берём максимум: обычная прогрессия сохраняется (historicWeight обычно ≥
  // рабочего), а после разгрузки не проваливаемся ниже реального рабочего веса.
  // Issue #139 (единый источник весов): exercise.targetWeight здесь — это вес из
  // program_exercises, который LLM-планировщик (planAndApplyNextWorkout →
  // applyPlanAndLog) обновляет после КАЖДОЙ тренировки и клампит
  // (clampCoachPlanToNextWorkout). Берём его авторитетным кандидатом базы —
  // так решение LLM о прогрессии программы доходит до видимого плана календаря,
  // а не расходится с ним (корень #136/#137). Максимум с рабочим весом
  // сохраняет инвариант #136: план не опускается ниже фактического рабочего веса.
  const programWeight = Number(exercise.targetWeight)
  const weightCandidates = [historicWeight, coachWorkingWeight, programWeight].filter((weight) => Number.isFinite(weight) && weight > 0)
  // Issue #173: «сильнейший» кандидат зависит от направления веса. Для
  // обычных упражнений это максимум, для гравитрона (помощь) — минимум:
  // инвариант #136 там работает в обратную сторону (помощь не растёт).
  const direction = resolveWeightDirection(exercise)
  // Issue #170: инвариант #136 разрешает неопределённость ВВЕРХ — при трёх
  // расходящихся кандидатах берётся сильнейший. Внутри нормального цикла это
  // верно, но цена недогруженной тренировки близка к нулю, а цена
  // перегруженной на невосстановленном организме — травма. Поэтому инвариант
  // не отменяется, а приостанавливается: в трёх ситуациях ниже из тех же
  // кандидатов берётся самый лёгкий, и вес свободно опускается.
  const isLongBreak = isLongBreakBeforeSession(coachState, weeklyContext)
  const invariantSuspended = isLongBreak
    || hasActivePainFlag(exercise.id, coachState, coachMemory)
    || isDeloadSession
  const resolveCandidates = invariantSuspended ? easierOf : strongerOf
  // Issue #263: приостановка инварианта означает «легче реального рабочего», а
  // не «легче чего угодно». programWeight для упражнения вне программы — это
  // статичный default_target_weight справочника (у skull-crusher 20 при рабочих
  // 35), и как кандидат «полегче» он назначал дефолт новичка вместо шага вниз.
  // Поэтому при приостановке пул — только реальные сигналы. Направление здесь
  // не различается: для assistance easierOf = max, и дефолт справочника
  // завышал помощь ровно так же (#173). Нет ни одного реального сигнала —
  // остаётся прежний полный пул, поведение для новых упражнений не меняется.
  const realWeightCandidates = [historicWeight, coachWorkingWeight].filter((weight) => Number.isFinite(weight) && weight > 0)
  const candidatePool = invariantSuspended && realWeightCandidates.length > 0 ? realWeightCandidates : weightCandidates
  let baseWeight = candidatePool.length > 0
    ? candidatePool.reduce((best, weight) => resolveCandidates(best, weight, direction))
    : exercise.targetWeight
  // Issue #283: приостановка инварианта после перерыва означает «самый лёгкий
  // из реальных кандидатов», а не «рабочий минус шаг». Когда оба реальных
  // сигнала совпадают, опускаться вниз некуда, и план выдаёт ровно
  // доперерывный рабочий вес, взятый на RPE 10. Поэтому при совпадении двух
  // независимых реальных сигналов снимается один шаг через easierWeight.
  // Правило завязано именно на isLongBreak, а не на invariantSuspended: боль и
  // разгрузка не меняются (у разгрузки свой шаг вниз — второй дал бы −2 шага).
  // Совпадение — это строго две оценки, historicWeight и coachWorkingWeight,
  // а не совпадение базы с «сильнейшим»: единственный реальный кандидат —
  // дефолт справочника из coachMemory (ветка no_data, #263) — «совпасть» с
  // собой не может, и с него шаг вниз не снимается.
  if (isLongBreak && realWeightCandidates.length > 1 && historicWeight === coachWorkingWeight) {
    baseWeight = roundWeight(easierWeight(baseWeight, exercise.weightStep, direction))
  }
  const baseSetsCount = preferences.sessionStyle === 'volume_light'
    ? clamp(exercise.setsCount + 1, 2, 4)
    : clamp(exercise.setsCount, 2, preferences.sessionStyle === 'heavy_short' ? 3 : 4)
  // Issue #166: не выписываем больше, чем осталось от недельной цели группы
  // (но не опускаемся ниже минимальных двух рабочих подходов).
  const remainingWeeklySets = weeklyContext.weeklyVolume?.[exercise.muscleKey]?.remainingSets
  let setsCount = Number.isFinite(remainingWeeklySets) && remainingWeeklySets > 0
    ? Math.max(2, Math.min(baseSetsCount, remainingWeeklySets))
    : baseSetsCount
  let repMin = lowReadiness ? Math.max(exercise.repMin, Math.min(exercise.repMax, 10)) : exercise.repMin
  let repMax = lowReadiness ? Math.max(repMin, exercise.repMax) : exercise.repMax
  const hasRecentWorkingWeight = Boolean(recent) && Number.isFinite(historicWeight)
  const policy = coachDecision?.exercisePolicies?.[exercise.id]
  const shouldConsolidate = policy === 'consolidate'
  let targetWeight = roundWeight(lowReadiness && baseWeight > 0 && !hasRecentWorkingWeight ? easierWeight(baseWeight, exercise.weightStep, direction) : baseWeight)

  // Issue #106: react to per-exercise analysis flags from #105.
  // These override the default weight progression based on e1RM trends.
  if (exerciseFlag) {
    const step = Math.max(0, Number(exercise.weightStep ?? 2.5))
    switch (exerciseFlag.recommendation) {
      case 'increase_weight':
        // e1RM trending up — один шаг ТЯЖЕЛЕЕ базы (для гравитрона = меньше помощи, #173)
        // Issue #192: у веса тела повышать нечего, и диапазон повторов здесь
        // тоже НЕ трогаем: генератор прогоняется заново на каждой
        // перегенерации и каскаде, счёт был бы кратным. Рост повторов живёт в
        // buildSafeCoachPlan — один раз на завершённую тренировку.
        if (targetWeight > 0) targetWeight = roundWeight(harderWeight(targetWeight, step, direction))
        break
      case 'decrease_weight':
        // e1RM trending down (non-deload) — один шаг ЛЕГЧЕ (для гравитрона = больше помощи, #173)
        if (targetWeight > 0) targetWeight = roundWeight(easierWeight(targetWeight, step, direction))
        break
      case 'consolidate':
        // Hold the weight, don't increase, keep intensity easy
        // (targetWeight stays at baseWeight, intensityTarget forced easy via flagConsolidate below)
        break
      case 'hold_weight':
      case 'monitor':
      case 'swap_exercise':
        // swap_exercise should not reach here (filtered in chooseBestExerciseForMuscle),
        // but if it does (no alternative), just hold the weight
        break
    }
  }
  const restSeconds = lowReadiness ? Math.min(120, Math.max(60, exercise.restSeconds)) : exercise.restSeconds
  const noFailurePolicy = userTrainingPolicy?.allowFailureSets === false
  // Issue #106: consolidate flag from analysis also forces easy intensity
  const flagConsolidate = exerciseFlag?.recommendation === 'consolidate'
  let intensityTarget = lowReadiness || shouldConsolidate || flagConsolidate || noFailurePolicy || preferences.intensityTolerance === 'avoid_max'
    ? 'easy'
    : preferences.intensityTolerance === 'rare_max'
      ? 'controlled'
      : preferences.intensityTolerance === 'aggressive'
        ? 'max_effort_allowed'
        : intensityForGoal(profile?.goal)
  let focusText = noFailurePolicy
    ? 'контролируемая работа без отказа, техника важнее веса'
    : lowReadiness
      ? 'лёгкий контролируемый объём, без отказа'
      : 'рабочая нагрузка под цель, 1–2 повтора в запасе'

  // Issue #35: apply intra-cycle periodization (loading/accumulation/intensification).
  const mesocyclePhase = coachState?.mesocycle?.phase
  if (mesocyclePhase && mesocyclePhase !== 'idle' && mesocyclePhase !== 'deload') {
    const periodized = applyPeriodization({
      targetWeight,
      repMin,
      repMax,
      setsCount,
      intensityTarget,
      weightStep: exercise.weightStep,
      equipment: exercise.equipment,
    }, mesocyclePhase, direction)
    targetWeight = roundWeight(periodized.targetWeight)
    repMin = periodized.repMin
    repMax = periodized.repMax
    setsCount = periodized.setsCount
    intensityTarget = periodized.intensityTarget
    if (periodized.periodizationNote) {
      focusText = periodized.periodizationNote
    }
  }

  // Mesocycle deload: if the user's mesocycle is in a deload week, override
  // the prescription with reduced sets/weight/reps and 'easy' intensity.
  let deloadNote: string | null = null
  if (isDeloadSession) {
    const deload = applyDeloadReduction({
      name: exercise.name,
      weightDirection: exercise.weightDirection,
      setsCount,
      targetWeight,
      repMin,
      repMax,
      weightStep: exercise.weightStep,
    })
    setsCount = deload.setsCount
    targetWeight = deload.targetWeight
    repMin = deload.repMin
    repMax = deload.repMax
    intensityTarget = deload.intensityTarget // 'easy'
    deloadNote = deload.deloadNote
    focusText = 'разгрузочная неделя мезоцикла — снижаем объём и интенсивность'
  }

  // Issue #171: подростковые ограничения — последнее слово в предписании.
  // Стоят ПОСЛЕ периодизации и разгрузки, потому что обе переписывают диапазон
  // повторов: у становой в справочнике он и так 4–6, а интенсификация уводит
  // его ещё ниже. Подход на 1–4 повтора — это проходка, а не рабочий подход.
  const teenLimited = teenLimitsApply(profile?.age, exercise)
  const teenNotes: string[] = []
  if (teenLimited) {
    teenNotes.push(TEEN_LIMIT_REASONS.no_failure)
    if (repMin < TEEN_MIN_REPS) teenNotes.push(TEEN_LIMIT_REASONS.min_reps)
    repMin = Math.max(TEEN_MIN_REPS, repMin)
    repMax = Math.max(repMin, repMax)
  }

  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    muscleGroup: exercise.muscleGroup,
    setsCount,
    repMin,
    repMax,
    targetWeight,
    weightStep: exercise.weightStep,
    restSeconds,
    intensityTarget,
    weightDirection: direction,
    teenLimited,
    workingFloorSuspended: invariantSuspended,
    // Причина ограничения идёт вместе с предписанием: необъяснённое ограничение
    // читается как недоверие (см. #171, правило 5).
    coachFocus: `${exercise.name}: ${shouldConsolidate && !deloadNote ? 'закрепляем текущий вес, без повышения и без отказа' : focusText}${deloadNote ? `. ${deloadNote}` : ''}.${teenNotes.length ? ` ${teenNotes.join('; ')}.` : ''}`,
    reason: reasonForExercise({ exercise, coachState, recent, lowReadiness, weeklyContext, policy }),
  }
}

function intensityForGoal(goal: string | undefined): string {
  const text = String(goal ?? '').toLowerCase()
  if (text.includes('сил')) return 'strength_quality'
  if (text.includes('масс') || text.includes('рост')) return 'hypertrophy'
  return 'normal'
}

function clamp(value: unknown, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, Math.round(number)))
}
