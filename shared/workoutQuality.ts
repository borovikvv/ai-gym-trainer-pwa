/**
 * Issue #162: единая оценка качества тренировки (0–100).
 *
 * Прошлая формула была аддитивной: старт 75, дальше «+2 за подход RPE 7–8,
 * +3 за упражнение, +5 за прогрессию…» с клампом Math.min(100, …). На обычной
 * тренировке из 4–6 упражнений по 3 подхода одни только RPE-бонусы давали +30,
 * поэтому счёт упирался в потолок: на боевой базе 27.07.2026 у ВСЕХ 19 записей
 * qualityScore = 100, разброс нулевой. Метрика не различала тренировки ни для
 * пользователя, ни как сигнал качества для обучающей выборки (#88).
 *
 * Новая шкала — нормированная, а не аддитивная:
 *   • вклад каждого упражнения ограничен долей 0..1 и усредняется по
 *     упражнениям, поэтому счёт не растёт от одного лишь количества подходов;
 *   • основа — ВЫПОЛНЕНИЕ ПЛАНА (сделанные подходы и повторы против
 *     предписанных), а не только самоотчёт RPE;
 *   • 90 из 100 даёт качественное выполнение, последние 10 — прогрессия,
 *     поэтому 100 остаётся исключением, а не нормой.
 *
 * Реализация одна на сервер и клиент: раньше формула была продублирована в
 * server/coachDebrief.ts и src/domain/workoutDebrief.ts, причём клиентская
 * копия имела ещё один бонус +5 и завышала счёт сильнее серверной.
 */

// Входные типы — «виды» на доменные объекты (WorkoutHistoryEntry и серверный
// WorkoutEntry): перечислены только поля, от которых зависит счёт. Функция
// принимает их как ограничение обобщённого параметра, поэтому вызывающие
// передают более богатые объекты как есть.
export interface QualitySetInput {
  reps?: number
  rpe?: number
  completed?: boolean
}

/** Предписание из плана — если известно, счёт опирается на его выполнение. */
export interface QualityPrescription {
  setsCount?: number
  repMin?: number
  repMax?: number
}

export interface QualityExerciseInput {
  pain?: boolean
  progressionType?: string
  sets?: readonly QualitySetInput[]
  planned?: QualityPrescription | null
}

export interface QualityWorkoutInput {
  exercises?: readonly QualityExerciseInput[]
}

/** Доля счёта за качество выполнения; остаток отдан прогрессии. */
const EXECUTION_WEIGHT = 90
const PROGRESSION_WEIGHT = 10

/**
 * Насколько усилие подхода соответствует продуктивной работе.
 * RPE 8 — целевое рабочее усилие, 7 — чуть легче, 9 — уже на грани,
 * 10 — отказ (не цель тренировки), ≤6 — недогруз.
 */
function setEffortQuality(rpe: unknown): number {
  const value = Number(rpe)
  if (!Number.isFinite(value)) return 0.7 // нет данных — нейтрально
  if (value >= 10) return 0.3
  if (value >= 9) return 0.75
  if (value >= 8) return 1
  if (value >= 7) return 0.9
  if (value >= 6) return 0.7
  return 0.5
}

/**
 * Насколько повторы попали в предписанный диапазон.
 * Ниже диапазона — вес был велик или подход не добран; выше — вес занижен
 * (тоже отклонение от плана, но менее значимое).
 */
function repAdherence(reps: unknown, repMin: number, repMax: number): number {
  const value = Number(reps)
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= repMin && value <= repMax) return 1
  if (value > repMax) return 0.7
  return Math.max(0.3, value / repMin) * 0.7
}

function completedSetsOf(exercise: QualityExerciseInput): QualitySetInput[] {
  return (exercise.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0)
}

function usablePrescription(planned: QualityPrescription | null | undefined): Required<QualityPrescription> | null {
  if (!planned) return null
  const setsCount = Number(planned.setsCount)
  const repMin = Number(planned.repMin)
  const repMax = Number(planned.repMax)
  if (!Number.isFinite(repMin) || repMin <= 0) return null
  return {
    setsCount: Number.isFinite(setsCount) && setsCount > 0 ? setsCount : 0,
    repMin,
    repMax: Number.isFinite(repMax) && repMax >= repMin ? repMax : repMin,
  }
}

/** Качество одного упражнения в долях 0..1. */
function exerciseQuality(exercise: QualityExerciseInput): number | null {
  const completedSets = completedSetsOf(exercise)
  if (completedSets.length === 0) return null

  const effort = completedSets.reduce((sum, set) => sum + setEffortQuality(set.rpe), 0) / completedSets.length

  const prescription = usablePrescription(exercise.planned)
  let quality = effort
  if (prescription) {
    const setsRatio = prescription.setsCount > 0
      ? Math.min(1, completedSets.length / prescription.setsCount)
      : 1
    const repsScore = completedSets
      .reduce((sum, set) => sum + repAdherence(set.reps, prescription.repMin, prescription.repMax), 0) / completedSets.length
    const adherence = 0.5 * setsRatio + 0.5 * repsScore
    // Выполнение плана и усилие весят одинаково: план без усилия — недогруз,
    // усилие без плана — работа не по программе.
    quality = 0.5 * adherence + 0.5 * effort
  }

  // Боль — не «минус несколько баллов», а качественно другая тренировка.
  if (exercise.pain) quality = Math.min(quality, 0.25)
  return quality
}

/**
 * Оценка качества тренировки, 0–100.
 *
 * Возвращает 0, если ни одного выполненного подхода нет — тогда оценивать
 * нечего. Заметьте: штрафа за нулевой объём больше нет; при работе с весом
 * тела и на время (планка, приседания без веса) объём равен нулю
 * законно, и прошлый штраф −20 срабатывал на нормальных тренировках.
 */
export function computeWorkoutQualityScore<T extends QualityWorkoutInput>(entry?: T): number {
  const exercises = entry?.exercises ?? []
  if (exercises.length === 0) return 0

  const qualities: number[] = []
  let performedCount = 0
  let progressedCount = 0

  for (const exercise of exercises) {
    const quality = exerciseQuality(exercise)
    if (quality === null) continue
    qualities.push(quality)
    performedCount += 1
    if (exercise.progressionType === 'increase') progressedCount += 1
  }

  if (qualities.length === 0) return 0

  const execution = qualities.reduce((sum, value) => sum + value, 0) / qualities.length
  const progression = performedCount > 0 ? progressedCount / performedCount : 0

  const score = EXECUTION_WEIGHT * execution + PROGRESSION_WEIGHT * progression
  return Math.max(0, Math.min(100, Math.round(score)))
}
