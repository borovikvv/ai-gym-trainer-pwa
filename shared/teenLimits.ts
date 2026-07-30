/**
 * Подростковые ограничения (issue #171) — единственный источник истины.
 *
 * Ограничения детерминированные: они не являются предметом суждения тренера,
 * в том числе LLM-советника. LLM может предложить что угодно — эти правила
 * применяются после него, в клампе, и его предложение переживает только то,
 * что в них укладывается.
 *
 * Область действия — возраст из профиля (`user_profiles.age`), а не
 * идентификатор пользователя: при добавлении второго подростка ограничения
 * должны включиться сами.
 *
 * Причина каждого ограничения хранится ЗДЕСЬ, рядом с самим ограничением, а
 * не собирается на лету у места применения: необъяснённое ограничение читается
 * как недоверие и бьёт по мотивации, а мотивация в 15 лет дороже оптимальности
 * нагрузки.
 */

/** Возраст, ниже которого действуют ограничения (границы см. в #171). */
export const TEEN_MAX_AGE = 18

/**
 * Минимум повторов в назначаемом подходе на осевых/свободновесных движениях.
 * Подходы на 1–4 повтора — это проходка, а не тренировка: ими не назначают
 * нагрузку и по ним не считают силу.
 */
export const TEEN_MIN_REPS = 5

export function isTeenAge(age: number | null | undefined): boolean {
  const value = Number(age)
  return Number.isFinite(value) && value > 0 && value < TEEN_MAX_AGE
}

/** Метаданные упражнения из справочника (`exercise_library`). */
export interface ExerciseMovementSource {
  equipment?: string | null
  exerciseType?: string | null
  movementPattern?: string | null
}

const FREE_WEIGHT_EQUIPMENT = new Set(['barbell', 'dumbbell'])
const AXIAL_PATTERNS = new Set(['push', 'squat', 'hinge'])

/**
 * Осевые и свободновесные многосуставные движения — жим лёжа со свободным
 * весом, присед со штангой, становая тяга, работа над головой со свободным
 * весом.
 *
 * Признак выводится из метаданных справочника, а не из списка id и не из
 * разбора названия: свободный вес (`barbell` / `dumbbell`) + многосуставное
 * (`compound`) + паттерн жима/приседа/наклона. Тренажёры и блоки сюда не
 * попадают — это и есть безопасные варианты тех же паттернов. Изоляция не
 * попадает тоже: ограничения на неё не распространяются.
 *
 * Упражнение без метаданных считается НЕосевым. Справочник заполнен целиком
 * (миграции 2026-06-23 / 2026-07-16), так что это касается только строк,
 * добавленных мимо них.
 */
export function isAxialFreeWeight(exercise: ExerciseMovementSource | null | undefined): boolean {
  if (!exercise) return false
  return (
    FREE_WEIGHT_EQUIPMENT.has(String(exercise.equipment ?? '')) &&
    String(exercise.exerciseType ?? '') === 'compound' &&
    AXIAL_PATTERNS.has(String(exercise.movementPattern ?? ''))
  )
}

export type TeenLimitCode = 'no_failure' | 'min_reps' | 'small_steps'

/**
 * Текст причины для каждого ограничения — то, что видит пользователь.
 * Без технических терминов, на «ты», одной фразой.
 */
export const TEEN_LIMIT_REASONS: Record<TeenLimitCode, string> = {
  no_failure:
    'работаем без отказа: в твоём возрасте сила растёт от техники и объёма, а не от предельных усилий',
  min_reps:
    'не берём подходы короче пяти повторов: связки и зоны роста набирают нагрузку медленнее мышц',
  small_steps:
    'вес добавляем мелкими шагами и чаще, а не большими прыжками',
}

/**
 * Применимы ли подростковые ограничения к этому подходу.
 * Обе части обязательны: возраст и осевое свободновесное движение.
 */
export function teenLimitsApply(
  age: number | null | undefined,
  exercise: ExerciseMovementSource | null | undefined,
): boolean {
  return isTeenAge(age) && isAxialFreeWeight(exercise)
}
