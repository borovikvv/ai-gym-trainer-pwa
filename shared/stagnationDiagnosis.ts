// Этап 2 (#175): дифференциальная диагностика стагнации.
//
// Стагнация не была состоянием. Была локальная поправка к весу: тренд силовых
// по упражнению добавлял или снимал шаг. Вопрос «почему прогресса нет» не
// задавался, поэтому на все случаи применялось одно действие — а у стагнации
// причины с ПРОТИВОПОЛОЖНЫМ лечением: при недостаточном стимуле объём надо
// добавить, при перегрузке — снять. Одинаковая реакция гарантированно вредит
// в одном из двух случаев.
//
// Здесь диагноз ставится ДО реакции. Модуль чистый: на вход — уже собранные
// сигналы, на выход — картина, действие и признак того, что это проверка
// гипотезы, а не вывод. Сбор сигналов из истории живёт в
// server/mesocycleBlockGoal.ts, рядом с целью блока: без ожидаемого темпа
// (#174) отсчитывать стагнацию не от чего.

export type StagnationDiagnosis =
  | 'insufficient_stimulus' // недостаточный стимул
  | 'overload'              // перегрузка, недовосстановление
  | 'low_adherence'         // проблема не в программе
  | 'energy_deficit'        // энергетический дефицит
  | 'local_limit'           // локальный лимит одного движения
  | 'normal_slowdown'       // нормальное замедление

export type StagnationAction =
  | 'add_volume'      // добавить объём или интенсивность
  | 'deload'          // снять нагрузку
  | 'simplify'        // упростить и укоротить сессии
  | 'rotate_exercise' // сменить вариант движения
  | 'hold'            // не «чинить»: работать по плану

export interface StagnationSignals {
  /**
   * Факт отстаёт от ОЖИДАЕМОГО темпа блока (#174), а не от нуля. Без этого
   * входа медленный прогресс у продвинутого неотличим от стагнации у новичка.
   */
  behindExpectedPace: boolean
  /** Индекс стагнации: недель без прироста e1RM на целевом движении. */
  weeksStalled: number
  /** Доля выполненных тренировок от запланированных; null — судить не по чему. */
  adherence: number | null
  /** Усилие растёт на тех же весах (#167). null — данных нет. */
  effortRising: boolean | null
  /** Самочувствие по чек-инам снижено. null — чек-инов нет. */
  energyLow: boolean | null
  /** Тренировок с болью внутри блока (#163). */
  painSessions: number
  /** Вес тела идёт вниз по скользящему среднему (#176). */
  bodyWeightFalling: boolean
  goalIsMass: boolean
  /** Целевое движение стоит, а остальные растут. */
  localLimit: boolean
  /** Высокий стаж. */
  advanced: boolean
}

export interface StagnationVerdict {
  diagnosis: StagnationDiagnosis
  action: StagnationAction
  /** Картина была неоднозначна — это проверка гипотезы, а не вывод. */
  hypothesis: boolean
  /** Дата переоценки гипотезы; null — гипотезы нет. */
  reviewOn: string | null
  /** Текст пользователю: диагноз, основание, действие. */
  note: string
}

/**
 * Меньше двух недель без прироста — это не стагнация, а обычный разброс
 * результатов между тренировками.
 */
export const MIN_STALL_WEEKS = 2

/** Ниже этой доли выполненных тренировок причина не в программе. */
export const LOW_ADHERENCE_RATIO = 0.7

/** Столько признаков потолка складываются в диагноз перегрузки. */
const OVERLOAD_SIGNALS = 2

/**
 * До этого срока стагнация у продвинутого разбирается как проверяемая
 * гипотеза о стимуле, и только дальше называется нормальным замедлением:
 * «замедление» — это вывод после неудачной проверки, а не первая реакция.
 */
export const SLOWDOWN_STALL_WEEKS = 4

/** Срок проверки гипотезы — одна неделя. */
export const HYPOTHESIS_DAYS = 7

const DIAGNOSIS_LABEL: Record<StagnationDiagnosis, string> = {
  insufficient_stimulus: 'недостаточный стимул',
  overload: 'перегрузка, недовосстановление',
  low_adherence: 'проблема не в программе',
  energy_deficit: 'энергетический дефицит',
  local_limit: 'локальный лимит движения',
  normal_slowdown: 'нормальное замедление',
}

const ACTION_TEXT: Record<StagnationAction, string> = {
  add_volume: 'добавить объём или интенсивность',
  deload: 'разгрузка: снять объём и интенсивность',
  simplify: 'упрощать и укорачивать сессии, снижать порог входа',
  rotate_exercise: 'сменить вариант упражнения, работать со слабым звеном',
  hold: 'не «чинить»: объём не резать и не наращивать',
}

/**
 * Диагноз стагнации: одна из шести картин, действие и признак гипотезы.
 * null — стагнации нет (или ещё рано о ней говорить).
 *
 * Порядок проверок не произволен. Приверженность идёт первой: если человек не
 * тренируется, остальные картины не о чем. Перегрузка идёт раньше
 * недостаточного стимула, потому что цена ошибки несимметрична — добавить
 * объём перегруженному хуже, чем недодать недогруженному.
 */
export function diagnoseStagnation(signals: StagnationSignals, today: string): StagnationVerdict | null {
  if (!signals.behindExpectedPace || signals.weeksStalled < MIN_STALL_WEEKS) return null

  const ceilingSignals = [
    signals.effortRising === true ? 'усилие растёт на тех же весах' : null,
    signals.energyLow === true ? 'готовность снижена' : null,
    signals.painSessions > 0 ? `боль в ${signals.painSessions} тренировках` : null,
  ].filter((signal): signal is string => signal !== null)

  const stall = `прироста нет ${signals.weeksStalled} нед при отставании от ожидаемого темпа`

  if (signals.adherence !== null && signals.adherence < LOW_ADHERENCE_RATIO) {
    const percent = Math.round(signals.adherence * 100)
    return verdict('low_adherence', 'simplify', `${stall}; выполнено ${percent}% запланированных тренировок`)
  }

  if (ceilingSignals.length >= OVERLOAD_SIGNALS) {
    return verdict('overload', 'deload', `${stall}; ${ceilingSignals.join(', ')}`)
  }

  if (signals.localLimit) {
    return verdict('local_limit', 'rotate_exercise', `${stall}; целевое движение стоит, остальные растут`)
  }

  // Причина не в тренировках: объём не режем, но и не наращиваем как лечение.
  if (signals.bodyWeightFalling && signals.goalIsMass) {
    return verdict('energy_deficit', 'hold', `${stall}; вес тела снижается при цели «масса» — расхождение цели и питания`)
  }

  if (signals.advanced && ceilingSignals.length === 0 && signals.weeksStalled >= SLOWDOWN_STALL_WEEKS) {
    return verdict('normal_slowdown', 'hold', `${stall}; стаж высокий, остальное в норме — пора сменить критерий успеха`)
  }

  if (ceilingSignals.length === 0 && signals.effortRising === false && signals.energyLow === false) {
    return verdict('insufficient_stimulus', 'add_volume', `${stall}; усилие низкое, самочувствие нормальное, боли нет`)
  }

  if (ceilingSignals.length === 0 && signals.energyLow === null) {
    return verdict('insufficient_stimulus', 'hold', `${stall}; данных о самочувствии нет — добавлять объём вслепую нельзя`)
  }

  // Картина неоднозначна — проверяем более вероятную гипотезу одной неделей.
  return verdict('insufficient_stimulus', 'add_volume', `${stall}; ${ambiguity(signals, ceilingSignals)}`, today)
}

function ambiguity(signals: StagnationSignals, ceilingSignals: string[]): string {
  if (ceilingSignals.length === 1) return `${ceilingSignals[0]} — на диагноз перегрузки одного признака мало`
  const missing = [
    signals.effortRising === null ? 'усилие' : null,
    signals.energyLow === null ? 'самочувствие' : null,
  ].filter(Boolean)
  return missing.length > 0 ? `не хватает данных: ${missing.join(', ')}` : 'картина неоднозначна'
}

function verdict(
  diagnosis: StagnationDiagnosis,
  action: StagnationAction,
  reason: string,
  hypothesisFrom?: string,
): StagnationVerdict {
  const reviewOn = hypothesisFrom ? shiftDays(hypothesisFrom, HYPOTHESIS_DAYS) : null
  const disclosure = reviewOn ? ` Это проверка гипотезы до ${reviewOn}, а не окончательный вывод.` : ''
  return {
    diagnosis,
    action,
    hypothesis: reviewOn !== null,
    reviewOn,
    note: `${DIAGNOSIS_LABEL[diagnosis]}: ${reason} — ${ACTION_TEXT[action]}.${disclosure}`,
  }
}

function shiftDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
