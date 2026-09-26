// Issue #337: связь зоны боли с упражнением определяется по метаданным
// справочника (`target_muscles`), а не по подстроке названия.
//
// Ключи — ровно те строки, что реально приходят с UI
// (`painAreaOptions` / `soreMuscleGroupOptions` в PreWorkoutPreview), в нижнем
// регистре. Значения массивов — дословно из
// `supabase/2026-06-23_exercise_library_metadata_data.sql`
// (`target_muscles = array[...]`), не выдуманы.
//
// Упражнение без метаданных не считается связанным ни с одной зоной — так же,
// как `isAxialFreeWeight` считает неосевым упражнение без метаданных.

export interface ExerciseMuscleSource {
  targetMuscles?: string[] | null
}

const AREA_TARGET_MUSCLES: Record<string, string[]> = {
  'грудь': ['верх груди', 'средняя груди', 'низ груди'],
  'спина': ['широчайшие', 'ромбовидные', 'поясница', 'задняя дельта'],
  'ноги': ['квадрицепс', 'ягодицы', 'задняя поверхность бедра', 'икроножная', 'камбаловидная'],
  'колено/нога': ['квадрицепс', 'ягодицы', 'задняя поверхность бедра', 'икроножная', 'камбаловидная'],
  'плечо': ['передняя дельта', 'средняя дельта', 'задняя дельта', 'вращательная манжета'],
  'плечи': ['передняя дельта', 'средняя дельта', 'задняя дельта', 'вращательная манжета'],
  'локоть/рука': ['бицепс', 'трицепс', 'предплечье', 'длинная головка'],
  'руки': ['бицепс', 'трицепс', 'предплечье', 'длинная головка'],
  'кор': ['кор', 'прямая мышца живота', 'косые мышцы живота', 'поперечная мышца', 'подвздошно-поясничная'],
  'другое': [],
}

export function matchesPainArea(exercise: ExerciseMuscleSource | null | undefined, area: string): boolean {
  if (!exercise || !area) return false
  const muscles = AREA_TARGET_MUSCLES[area.toLowerCase()]
  if (!muscles || muscles.length === 0) return false
  const targetMuscles = exercise.targetMuscles ?? []
  return targetMuscles.some((muscle) => muscles.includes(muscle))
}