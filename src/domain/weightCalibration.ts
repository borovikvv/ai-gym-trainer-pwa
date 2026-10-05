import { estimateE1RM } from './estimatedOneRepMax'
import { resolveWeightDirection } from '../../shared/weightDirection'
import { roundWeight } from '../../shared/format'

/**
 * Калибровка стартового рабочего веса (issue #349).
 *
 * Для упражнений БЕЗ истории стартовый вес берётся из шаблона/анкеты. Если
 * шаблон ошибается сильно, `calculateProgression` за одну сессию сдвигает вес
 * лишь на один шаг — расхождение тянется недели. Калибровочный рам (подходы с
 * нарастающим весом до RPE 7–8 в целевом диапазоне повторов) позволяет по
 * одному «попавшему» подходу оценить рабочий вес сразу через e1RM.
 *
 * Функция чистая: ни истории, ни профиля, ни возраста. Всё, что нужно, лежит
 * во входе. Подростковые ограничения обеспечиваются не здесь, а тем, что
 * `qualifying` фильтрует по `repMin`/`repMax` конкретного плана, а у подростка
 * на осевых свободновесных движениях `repMin` уже поднят до `TEEN_MIN_REPS` при
 * генерации тренировки, — короткие подходы в `qualifying` не попадут.
 */

export type CalibrationSetInput = {
  weight: number
  reps: number
  rpe: number
  completed: boolean
}

export type CalibrationInput = {
  exerciseName: string
  repMin: number
  repMax: number
  weightStep: number
  sets: CalibrationSetInput[]
}

export type CalibrationResult = {
  recommendedWeight: number
  type: 'calibration'
  reason: string
}

export function calibrateWorkingWeight(input: CalibrationInput): CalibrationResult | null {
  // Гравитрон/помощь: «вес» — противовес, реальная нагрузка = вес тела − помощь.
  // Веса тела на этом слое нет, поэтому e1RM посчитать нельзя. Такие
  // упражнения продолжают получать обычный calculateProgression.
  if (resolveWeightDirection(input.exerciseName) === 'assistance') return null

  const completed = input.sets.filter((set) => set.completed && set.reps > 0 && set.weight > 0)
  if (completed.length === 0) return null

  // Калибровка — именно рам с нарастающим весом. Если во всех подходах один и
  // тот же вес, это обычная плоская сессия, и её обрабатывает calculateProgression
  // (иначе первая тренировка на шаблонном весе ошибочно попадала бы в калибровку).
  if (new Set(completed.map((set) => set.weight)).size < 2) return null

  const qualifying = completed.filter(
    (set) =>
      set.reps >= input.repMin &&
      set.reps <= input.repMax &&
      set.rpe >= 7 &&
      set.rpe <= 8,
  )
  if (qualifying.length === 0) return null

  const best = qualifying.reduce((top, set) =>
    estimateE1RM(set.weight, set.reps) > estimateE1RM(top.weight, top.reps) ? set : top,
  )

  const e1rm = estimateE1RM(best.weight, best.reps)
  // Обратная формула Helms/RTS к нижней границе диапазона: e1RM = w × (1 + r/40).
  const rawWeight = e1rm / (1 + input.repMin / 40)
  // Округляем вниз, а не до ближайшего: e1RM по одному подходу — оценка с шумом,
  // дешевле недогрузить (досыпет calculateProgression в следующую тренировку),
  // чем перегрузить.
  const recommendedWeight =
    input.weightStep > 0 ? floorToStep(rawWeight, input.weightStep) : roundWeight(rawWeight)

  return {
    recommendedWeight,
    type: 'calibration',
    reason: `${input.exerciseName}: калибровка — по подходу ${best.weight} кг × ${best.reps} на RPE ${best.rpe} рабочий вес на ${input.repMin}–${input.repMax} повторов — ${recommendedWeight} кг.`,
  }
}

function floorToStep(value: number, step: number): number {
  return roundWeight(Math.floor(value / step) * step)
}
