// Этап 1 (#267): расхождение «назначено vs выполнено» по весу на каждом подходе.
//
// Рейтинг тренировки убран (#249, #251) — вместе с ним ушёл единственный канал
// обратной связи о качестве рекомендаций. Новые вопросы пользователю (RPE,
// готовность, рейтинг, quality_score) выродились, поэтому здесь обратная связь
// берётся из поведения: разница между тем, что коуч назначил, и тем, что
// человек фактически сделал. Заполняемость 100 % по построению — чтобы
// тренироваться, вес всё равно вводится.
//
// ИСТОЧНИК НАЗНАЧЕННОГО ВЕСА — planned_workout_exercises.target_weight (та же
// таблица и то же сопоставление workoutDayId/дата, что использует
// attachPlannedPrescriptions в server/services/workoutService.ts для
// QualityPrescription). НЕ nextTargets/nextRecommendedWeight: это фолбэк-
// рекомендация на СЛЕДУЮЩУЮ сессию, а не то, что было прописано на эту
// тренировку (см. issue #33 — там зафиксирован тот же выбор). Сравнивать факт
// с собственным фолбэком системы значило бы мерить не исполнение решения
// коуча, а шум прогрессии.
//
// target_weight <= 0 (упражнения с весом тела / на время) — это отсутствие
// числового назначения, а не назначение нуля: assignedWeight = null и
// расхождение null (как и для рабочих подходов вовсе без плана).
//
// ПРО ШУМ: порог не считаем и не фильтруем на этом этапе. Пишем сырое
// подписанное отклонение по каждому подходу (факт минус назначение) без
// агрегации в «систематическое/шумовое» — ровно как computeSessionRepDeviation
// (#167) не решает, а просто копит величину. Системность — будущий анализ по
// множеству сессий, отдельный issue (как и подключение #167 к решениям было
// отдельным шагом).
//
// Величина считается и записывается, но на решения коуча не влияет (#267):
// сначала смотрим на данные — есть ли в ней сигнал.

export interface SetWeightDeviation {
  /** Номер рабочего подхода, с единицы. */
  setIndex: number
  actualWeight: number
  /** Назначенный вес плана; null — числового назначения нет. */
  assignedWeight: number | null
  /** Факт минус назначение; null — назначения нет. */
  deviation: number | null
}

export interface ExerciseWeightDeviation {
  exerciseId: string
  exerciseName: string
  sets: SetWeightDeviation[]
  avgDeviation: number | null
  setsWithAssignment: number
  setsWithoutAssignment: number
}

export interface SessionWeightDeviation {
  exercises: ExerciseWeightDeviation[]
  avgDeviation: number | null
  setsWithAssignment: number
  setsWithoutAssignment: number
}

interface SetLike {
  weight: number
  reps: number
  completed?: boolean
}

interface ExerciseLike {
  exerciseId: string
  exerciseName?: string
  /** Проставляется attachPlannedPrescriptions из planned_workout_exercises. */
  assignedWeight?: number | null
  sets: SetLike[]
}

interface SessionLike {
  exercises: ExerciseLike[]
}

/**
 * Расхождение факта от назначения по каждому рабочему подходу сессии,
 * с агрегатами по упражнению и по сессии.
 */
export function computeSessionWeightDeviation(entry: SessionLike): SessionWeightDeviation {
  const exercises: ExerciseWeightDeviation[] = []

  for (const exercise of entry?.exercises ?? []) {
    const assignedWeight = Number(exercise.assignedWeight) > 0 ? Number(exercise.assignedWeight) : null
    const sets: SetWeightDeviation[] = workingSets(exercise).map((set, index) => ({
      setIndex: index + 1,
      actualWeight: set.weight,
      assignedWeight,
      deviation: assignedWeight === null ? null : round1(set.weight - assignedWeight),
    }))
    if (sets.length === 0) continue
    exercises.push({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName ?? exercise.exerciseId,
      sets,
      ...summarize(sets),
    })
  }

  return { exercises, ...summarize(exercises.flatMap((exercise) => exercise.sets)) }
}

function summarize(sets: SetWeightDeviation[]): { avgDeviation: number | null; setsWithAssignment: number; setsWithoutAssignment: number } {
  const measured = sets.filter((set) => set.deviation !== null)
  return {
    avgDeviation: measured.length > 0
      ? round1(measured.reduce((sum, set) => sum + (set.deviation ?? 0), 0) / measured.length)
      : null,
    setsWithAssignment: measured.length,
    setsWithoutAssignment: sets.length - measured.length,
  }
}

// ---------------------------------------------------------------------------
// Внутреннее
// ---------------------------------------------------------------------------

/**
 * Рабочие подходы упражнения: выполненные, с повторами и весом. Тот же фильтр,
 * что в repExpectation.ts — скопирован локально, а не импортирован: модули
 * остаются независимыми, чтобы правки #267 не могли задеть #167.
 */
function workingSets(exercise: ExerciseLike): SetLike[] {
  return (exercise?.sets ?? []).filter((set) => set?.completed !== false && Number(set?.reps) > 0 && Number(set?.weight) > 0)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}