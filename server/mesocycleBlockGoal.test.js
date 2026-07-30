import { describe, expect, it } from 'vitest'
import {
  assessBlockOutcome,
  buildBlockGoalDraft,
  buildStagnationSignals,
  countPainSessions,
  evaluateBlockGoalProgress,
  expectedE1rmRatePerWeek,
  formatBlockGoalForPrompt,
  summarizeE1rmForBlock,
  syncBlockGoal,
  weeksWithoutGain,
} from './mesocycleBlockGoal.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLOCK_START = '2026-07-06'

function point(date, e1rm) {
  return { date: `${date}T10:00:00.000Z`, e1rm }
}

function mesocycle(overrides = {}) {
  return {
    phase: 'loading',
    phaseDescription: '',
    weekInCycle: 1,
    cycleStartedOn: BLOCK_START,
    cycleLength: 5,
    loadingWeeks: 4,
    deloadWeeks: 1,
    isDeload: false,
    deloadScheduled: false,
    triggerReason: null,
    completionRatio: 1,
    workoutsThisCycle: 3,
    plannedWorkoutsThisCycle: 3,
    ...overrides,
  }
}

function goal(overrides = {}) {
  return {
    id: 'goal-1',
    userId: 'u1',
    blockStartedOn: BLOCK_START,
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    title: 'Жим лёжа: e1RM 60 → 61.5 кг за 4 нед',
    baselineValue: 60,
    targetValue: 61.5,
    expectedRatePerWeek: 0.35,
    regainToValue: null,
    horizonWeeks: 4,
    failureDropValue: 57,
    failurePainSessions: 2,
    status: 'active',
    progressNote: null,
    progressVerdict: null,
    outcomeNote: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Ожидаемый темп прироста (#174: не экстраполировать разгон после перерыва)
// ---------------------------------------------------------------------------

describe('expectedE1rmRatePerWeek', () => {
  it('новичок растёт быстрее опытного', () => {
    expect(expectedE1rmRatePerWeek({ level: 'beginner', age: 30 }))
      .toBeGreaterThan(expectedE1rmRatePerWeek({ level: 'intermediate', age: 30 }))
    expect(expectedE1rmRatePerWeek({ level: 'intermediate', age: 30 }))
      .toBeGreaterThan(expectedE1rmRatePerWeek({ level: 'advanced', age: 30 }))
  })

  it('после 40 ожидание ниже, чем в 30 при том же уровне', () => {
    expect(expectedE1rmRatePerWeek({ level: 'intermediate', age: 43 }))
      .toBeLessThan(expectedE1rmRatePerWeek({ level: 'intermediate', age: 30 }))
  })

  it('ожидание берётся из уровня и возраста, а не из наблюдаемого разгона', () => {
    // 43 года, вернулся после перерыва: в истории бывает +3 кг/нед — это выход
    // на прежние рабочие веса, а не адаптация. В ожидание такое не попадает.
    const rate = expectedE1rmRatePerWeek({ level: 'beginner', age: 43 })
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1)
  })

  it('без уровня и возраста даёт средний темп, а не ноль', () => {
    expect(expectedE1rmRatePerWeek({})).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Показатель блока
// ---------------------------------------------------------------------------

describe('summarizeE1rmForBlock', () => {
  it('делит историю на «до блока» и «в блоке»', () => {
    const summary = summarizeE1rmForBlock([
      point('2026-06-20', 58),
      point('2026-06-30', 60),
      point('2026-07-08', 60.5),
      point('2026-07-15', 61.2),
    ], BLOCK_START)
    expect(summary.baseline).toBe(60)
    expect(summary.actual).toBe(61.2)
    expect(summary.pointsInBlock).toBe(2)
  })

  it('провальная тренировка внутри блока не выглядит потерей силы', () => {
    const summary = summarizeE1rmForBlock([
      point('2026-06-30', 60),
      point('2026-07-08', 61),
      point('2026-07-10', 55),
    ], BLOCK_START)
    expect(summary.actual).toBe(61)
  })

  it('точка отсчёта — уровень перед блоком, а не максимум за всю историю', () => {
    // Пик был до перерыва, перед блоком человек вышел на 55 — блок стартует с 55.
    const summary = summarizeE1rmForBlock([point('2026-05-01', 70), point('2026-06-30', 55)], BLOCK_START)
    expect(summary.baseline).toBe(55)
    expect(summary.allTimeBest).toBe(70)
  })

  it('без данных до блока берёт первую точку блока за отсчёт', () => {
    const summary = summarizeE1rmForBlock([point('2026-07-08', 50), point('2026-07-12', 52)], BLOCK_START)
    expect(summary.baseline).toBe(50)
    expect(summary.actual).toBe(52)
  })

  it('пустая история — нули, без падения', () => {
    expect(summarizeE1rmForBlock([], BLOCK_START)).toMatchObject({ baseline: 0, actual: 0, pointsInBlock: 0 })
  })
})

// ---------------------------------------------------------------------------
// Постановка цели блока
// ---------------------------------------------------------------------------

describe('buildBlockGoalDraft', () => {
  const histories = [
    {
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      currentBest: 60,
      dataPoints: [point('2026-06-20', 58), point('2026-06-30', 60)],
    },
    {
      exerciseId: 'squat',
      exerciseName: 'Присед',
      currentBest: 80,
      dataPoints: [point('2026-06-30', 80)],
    },
  ]

  it('цель измерима: показатель, стартовое значение, цель, срок, темп, критерии провала', () => {
    const draft = buildBlockGoalDraft({ profile: { level: 'intermediate', age: 43 }, mesocycle: mesocycle(), e1rmHistories: histories })
    expect(draft).toMatchObject({
      blockStartedOn: BLOCK_START,
      exerciseId: 'bench-press',
      baselineValue: 60,
      horizonWeeks: 4,
      failurePainSessions: 2,
    })
    expect(draft.targetValue).toBeGreaterThan(draft.baselineValue)
    expect(draft.expectedRatePerWeek).toBeGreaterThan(0)
    expect(draft.failureDropValue).toBeLessThan(draft.baselineValue)
  })

  it('цель блока работает на долгосрочную цель пользователя', () => {
    const withSquatHistory = [histories[0], { ...histories[1], dataPoints: [point('2026-06-20', 78), point('2026-06-30', 80)] }]
    const draft = buildBlockGoalDraft({
      profile: { level: 'intermediate' },
      mesocycle: mesocycle(),
      e1rmHistories: withSquatHistory,
      preferredExerciseId: 'squat',
    })
    expect(draft.exerciseId).toBe('squat')
  })

  it('прирост ожидается на загрузочных неделях, разгрузка в срок не входит', () => {
    const draft = buildBlockGoalDraft({ profile: { level: 'intermediate' }, mesocycle: mesocycle(), e1rmHistories: histories })
    expect(draft.horizonWeeks).toBe(4)
    expect(draft.horizonWeeks).toBeLessThan(mesocycle().cycleLength)
  })

  it('возврат к прежнему максимуму отмечен отдельно и поднимает цель', () => {
    const afterBreak = [{
      exerciseId: 'bench-press',
      exerciseName: 'Жим лёжа',
      currentBest: 70,
      dataPoints: [point('2026-05-01', 70), point('2026-06-30', 55)],
    }]
    const draft = buildBlockGoalDraft({ profile: { level: 'beginner', age: 43 }, mesocycle: mesocycle(), e1rmHistories: afterBreak })
    expect(draft.baselineValue).toBe(55)
    expect(draft.regainToValue).toBe(70)
    // Цель выше чисто адаптационной, но не выше прежнего максимума.
    expect(draft.targetValue).toBeGreaterThan(55 + draft.expectedRatePerWeek * 4)
    expect(draft.targetValue).toBeLessThanOrEqual(70)
  })

  it('без данных цель не выдумывается', () => {
    expect(buildBlockGoalDraft({ profile: {}, mesocycle: mesocycle(), e1rmHistories: [] })).toBeNull()
    expect(buildBlockGoalDraft({ profile: {}, mesocycle: mesocycle({ cycleStartedOn: null }), e1rmHistories: histories })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Сверка факта с ожиданием
// ---------------------------------------------------------------------------

describe('evaluateBlockGoalProgress', () => {
  it('в графике: факт совпал с ожиданием', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60.7, weekInCycle: 3 })
    expect(progress.weeksElapsed).toBe(2)
    expect(progress.expectedValue).toBe(60.7)
    expect(progress.verdict).toBe('on_track')
    expect(progress.deviation).toBe(0)
  })

  it('расхождение видно и в цифре, и в тексте', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60.1, weekInCycle: 4 })
    expect(progress.expectedValue).toBe(61)
    expect(progress.deviation).toBe(-0.9)
    expect(progress.verdict).toBe('behind')
    expect(progress.note).toContain('отстаём')
  })

  it('опережение графика', () => {
    const progress = evaluateBlockGoalProgress(goal({ targetValue: 63 }), { actualValue: 62, weekInCycle: 3 })
    expect(progress.verdict).toBe('ahead')
    expect(progress.deviation).toBeGreaterThan(0)
  })

  it('нет прироста со старта блока — стагнация, а не медленный темп', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60, weekInCycle: 3 })
    expect(progress.verdict).toBe('stalled')
    expect(progress.note).toContain('прироста нет')
  })

  it('в первую неделю блока стагнации ещё нет', () => {
    expect(evaluateBlockGoalProgress(goal(), { actualValue: 60, weekInCycle: 1 }).verdict).toBe('on_track')
  })

  it('цель взята — достижение фиксируется', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 61.5, weekInCycle: 3 })
    expect(progress.verdict).toBe('achieved')
    expect(progress.note).toContain('достигнута')
  })

  it('провал по падению силы — сигнал к досрочному выходу', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 56, weekInCycle: 3 })
    expect(progress.verdict).toBe('failed')
    expect(progress.note).toContain('досрочно')
  })

  it('провал по боли — сигнал к досрочному выходу', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 61, weekInCycle: 3, painSessions: 2 })
    expect(progress.verdict).toBe('failed')
    expect(progress.note).toContain('болью')
  })

  it('быстрый прирост на возврате к прежним весам не считается адаптацией', () => {
    const returning = goal({ baselineValue: 55, targetValue: 65, regainToValue: 70, expectedRatePerWeek: 0.45 })
    const progress = evaluateBlockGoalProgress(returning, { actualValue: 62, weekInCycle: 3 })
    expect(progress.verdict).toBe('regaining')
    expect(progress.note).toContain('возврат')
  })

  it('на возврате ожидание выше — иначе «в графике» означало бы «стоим»', () => {
    const returning = goal({ baselineValue: 55, targetValue: 65, regainToValue: 70, expectedRatePerWeek: 0.45 })
    const adapting = goal({ baselineValue: 55, targetValue: 65, regainToValue: null, expectedRatePerWeek: 0.45 })
    const week3 = { actualValue: 57, weekInCycle: 3 }
    expect(evaluateBlockGoalProgress(returning, week3).expectedValue)
      .toBeGreaterThan(evaluateBlockGoalProgress(adapting, week3).expectedValue)
  })

  it('ожидание не уезжает выше цели даже за пределами срока', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60.5, weekInCycle: 12 })
    expect(progress.expectedValue).toBeLessThanOrEqual(goal().targetValue)
    expect(progress.weeksElapsed).toBe(goal().horizonWeeks)
  })
})

// ---------------------------------------------------------------------------
// Оценка блока по завершении
// ---------------------------------------------------------------------------

describe('assessBlockOutcome', () => {
  it('цель взята — блок засчитан, темп подтверждён', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 62, weekInCycle: 5 })
    const outcome = assessBlockOutcome(goal(), progress)
    expect(outcome.status).toBe('achieved')
    expect(outcome.outcomeNote).toContain('цель взята')
    expect(outcome.outcomeNote).toContain('0.35')
  })

  it('цель не взята — оценка называет причину и ставит под вопрос ожидание', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60.4, weekInCycle: 5 })
    const outcome = assessBlockOutcome(goal(), progress)
    expect(outcome.status).toBe('missed')
    expect(outcome.outcomeNote).toContain('темп ниже ожидаемого')
    expect(outcome.outcomeNote).toContain('пересмотреть')
  })

  it('прироста не было — так и написано', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60, weekInCycle: 5 })
    expect(assessBlockOutcome(goal(), progress).outcomeNote).toContain('прироста не было')
  })

  it('оценка помещается в факт долгосрочной памяти (лимит 500 символов)', () => {
    const progress = evaluateBlockGoalProgress(goal(), { actualValue: 60.4, weekInCycle: 5 })
    expect(assessBlockOutcome(goal(), progress).outcomeNote.length).toBeLessThanOrEqual(500)
  })
})

// ---------------------------------------------------------------------------
// Прочее
// ---------------------------------------------------------------------------

describe('countPainSessions', () => {
  const history = [
    { completedAt: '2026-06-30T10:00:00.000Z', exercises: [{ pain: true }] },
    { completedAt: '2026-07-08T10:00:00.000Z', exercises: [{ pain: true }] },
    { completedAt: '2026-07-09T10:00:00.000Z', exercises: [{ pain: false }] },
    { completedAt: '2026-07-20T10:00:00.000Z', exercises: [{ pain: true }] },
  ]

  it('считает только тренировки с болью внутри блока', () => {
    expect(countPainSessions(history, BLOCK_START)).toBe(2)
  })

  it('верхняя граница исключает следующий блок', () => {
    expect(countPainSessions(history, BLOCK_START, '2026-07-13')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Оркестрация: постановка цели блоку и закрытие предыдущего оценкой
// ---------------------------------------------------------------------------

/** Мок pg-клиента: отдаёт заготовленные строки по фрагменту запроса. */
function mockClient(script = []) {
  const queries = []
  const pending = script.map((entry) => ({ ...entry, used: false }))
  const client = {
    async query(text, params) {
      queries.push({ text, params })
      const handler = pending.find((entry) => !entry.used && text.includes(entry.match))
      if (!handler) return { rows: [] }
      handler.used = true
      return { rows: handler.rows ?? [] }
    },
  }
  return { client, queries }
}

function goalRow(overrides = {}) {
  return {
    id: 'goal-1',
    user_id: 'u1',
    block_started_on: BLOCK_START,
    exercise_id: 'bench-press',
    exercise_name: 'Жим лёжа',
    title: 'Жим лёжа: e1RM 60 → 61.5 кг за 4 нед',
    baseline_value: 60,
    target_value: 61.5,
    expected_rate_per_week: 0.35,
    regain_to_value: null,
    horizon_weeks: 4,
    failure_drop_value: 57,
    failure_pain_sessions: 2,
    status: 'active',
    progress_note: null,
    progress_verdict: null,
    outcome_note: null,
    ...overrides,
  }
}

const HISTORIES = [{
  exerciseId: 'bench-press',
  exerciseName: 'Жим лёжа',
  currentBest: 60.5,
  dataPoints: [point('2026-06-25', 59), point('2026-06-30', 60), point('2026-07-08', 60.5)],
}]

describe('syncBlockGoal', () => {
  it('новому блоку ставит цель и сразу сверяет факт с ожиданием', async () => {
    const { client, queries } = mockClient([{ match: 'insert into public.mesocycle_block_goals', rows: [goalRow()] }])
    const result = await syncBlockGoal(client, 'u1', {
      profile: { level: 'intermediate', age: 43 },
      mesocycle: mesocycle({ weekInCycle: 2 }),
      e1rmHistories: HISTORIES,
      history: [],
    })

    expect(queries.some((q) => q.text.includes('insert into public.mesocycle_block_goals'))).toBe(true)
    expect(result.goal.blockStartedOn).toBe(BLOCK_START)
    expect(result.progress.actualValue).toBe(60.5)
    expect(result.progress.verdict).toBeTruthy()
    // Сверка сохраняется — расхождение видно и без пересчёта.
    expect(queries.some((q) => q.text.includes('set progress_note'))).toBe(true)
  })

  it('со сменой блока закрывает предыдущую цель оценкой', async () => {
    const { client, queries } = mockClient([
      { match: 'closed_at is null', rows: [goalRow({ block_started_on: '2026-06-01' })] },
      { match: 'insert into public.mesocycle_block_goals', rows: [goalRow()] },
    ])
    const result = await syncBlockGoal(client, 'u1', {
      profile: { level: 'intermediate', age: 43 },
      mesocycle: mesocycle({ weekInCycle: 1 }),
      e1rmHistories: HISTORIES,
      history: [],
    })

    const close = queries.find((q) => q.text.includes('set status = $3'))
    expect(close).toBeTruthy()
    expect(close.params[2]).toBe('missed')
    expect(result.closedOutcomes).toHaveLength(1)
    expect(result.closedOutcomes[0]).toContain('цель не взята')
    // Новый блок получил свою цель.
    expect(result.goal.blockStartedOn).toBe(BLOCK_START)
  })

  it('блок, взятый досрочно, тоже получает оценку при смене блока', async () => {
    const { client, queries } = mockClient([
      { match: 'closed_at is null', rows: [goalRow({ block_started_on: '2026-06-01', status: 'achieved', target_value: 59 })] },
      { match: 'insert into public.mesocycle_block_goals', rows: [goalRow()] },
    ])
    const result = await syncBlockGoal(client, 'u1', {
      profile: { level: 'intermediate', age: 43 },
      mesocycle: mesocycle({ weekInCycle: 1 }),
      e1rmHistories: HISTORIES,
      history: [],
    })

    expect(queries.find((q) => q.text.includes('set status = $3')).params[2]).toBe('achieved')
    expect(result.closedOutcomes[0]).toContain('цель взята')
  })

  it('без старта блока (нет истории) ничего не пишет', async () => {
    const { client, queries } = mockClient()
    const result = await syncBlockGoal(client, 'u1', {
      profile: {},
      mesocycle: mesocycle({ cycleStartedOn: null }),
      e1rmHistories: HISTORIES,
      history: [],
    })
    expect(result).toEqual({ goal: null, progress: null, closedOutcomes: [], stagnation: null })
    expect(queries).toHaveLength(0)
  })
})

describe('formatBlockGoalForPrompt', () => {
  it('в промпт идут цель, ожидаемый темп, сверка и критерии выхода', () => {
    const text = formatBlockGoalForPrompt(goal({ progressNote: 'неделя 3/4: e1RM 60.1 из 61.5 кг' }))
    expect(text).toContain('ЦЕЛЬ ТЕКУЩЕГО БЛОКА')
    expect(text).toContain('+0.35 кг/нед')
    expect(text).toContain('неделя 3/4')
    expect(text).toContain('57')
  })

  it('без цели — пустая строка, промпт не мусорится', () => {
    expect(formatBlockGoalForPrompt(null)).toBe('')
  })

  it('диагноз стагнации попадает в промпт вместе с целью (#175)', () => {
    const text = formatBlockGoalForPrompt(goal({
      diagnosis: 'overload',
      diagnosisNote: 'перегрузка: прироста нет 3 нед — разгрузка.',
    }))
    expect(text).toContain('ДИАГНОЗ СТАГНАЦИИ')
    expect(text).toContain('разгрузка')
  })
})

// ---------------------------------------------------------------------------
// Сигналы диагностики стагнации (#175)
// ---------------------------------------------------------------------------

describe('weeksWithoutGain', () => {
  it('считает недели от последнего НОВОГО максимума, а не от любой точки вверх', () => {
    // 08.07 — новый максимум; 15.07 выше предыдущей точки, но ниже максимума.
    const points = [point('2026-07-08', 60.5), point('2026-07-12', 58), point('2026-07-15', 59)]
    expect(weeksWithoutGain(points, BLOCK_START, '2026-07-29')).toBe(3)
  })

  it('без приростов внутри блока отсчёт идёт от старта блока', () => {
    expect(weeksWithoutGain([point('2026-06-25', 59)], BLOCK_START, '2026-07-20')).toBe(2)
  })
})

describe('buildStagnationSignals', () => {
  const progress = { weeksElapsed: 3, expectedValue: 61, actualValue: 60, deviation: -1, verdict: 'stalled', note: '' }

  function session(day, overrides = {}) {
    return {
      completedAt: `${day}T10:00:00.000Z`,
      exercises: [{ exerciseId: 'bench-press', exerciseName: 'Жим лёжа', pain: false, sets: [{ weight: 60, reps: 8, completed: true }] }],
      ...overrides,
    }
  }

  it('собирает приверженность, самочувствие и боль из истории', () => {
    const signals = buildStagnationSignals({
      goal: goal(),
      progress,
      profile: { level: 'intermediate', goal: 'масса', workoutsPerWeek: 3 },
      e1rmHistories: HISTORIES,
      history: [
        session('2026-07-20', { readinessCheckIn: { energy: 2 } }),
        session('2026-07-24', { readinessCheckIn: { energy: 2 } }),
        session('2026-07-27', { exercises: [{ exerciseId: 'squat', exerciseName: 'Присед', pain: true, sets: [] }] }),
      ],
      bodyWeightLog: [],
      today: '2026-07-30',
    })

    expect(signals.behindExpectedPace).toBe(true)
    // Две недели плана по 3 тренировки — 6, сделано 3.
    expect(signals.adherence).toBeCloseTo(0.5)
    expect(signals.energyLow).toBe(true)
    expect(signals.painSessions).toBe(1)
    expect(signals.goalIsMass).toBe(true)
  })

  it('отсутствующие сигналы остаются null, а не подменяются догадкой', () => {
    const signals = buildStagnationSignals({
      goal: goal(),
      progress,
      profile: {},
      e1rmHistories: HISTORIES,
      history: [session('2026-07-27')],
      bodyWeightLog: [],
      today: '2026-07-30',
    })
    expect(signals.adherence).toBeNull()
    expect(signals.energyLow).toBeNull()
    expect(signals.effortRising).toBeNull()
  })

  it('падение веса берётся из ряда замеров (#176)', () => {
    const log = [
      { measuredOn: '2026-06-25', weightKg: 82 },
      { measuredOn: '2026-07-02', weightKg: 81 },
      { measuredOn: '2026-07-28', weightKg: 79 },
    ]
    const signals = buildStagnationSignals({
      goal: goal(), progress, profile: {}, e1rmHistories: HISTORIES,
      history: [], bodyWeightLog: log, today: '2026-07-30',
    })
    expect(signals.bodyWeightFalling).toBe(true)
  })

  it('локальный лимит: целевое движение стоит, другое растёт', () => {
    const histories = [
      { ...HISTORIES[0], trend: { direction: 'flat', dataPointCount: 3 } },
      { exerciseId: 'squat', exerciseName: 'Присед', currentBest: 90, dataPoints: [], trend: { direction: 'up', dataPointCount: 3 } },
    ]
    const signals = buildStagnationSignals({
      goal: goal(), progress, profile: {}, e1rmHistories: histories,
      history: [], bodyWeightLog: [], today: '2026-07-30',
    })
    expect(signals.localLimit).toBe(true)
  })
})

describe('syncBlockGoal: диагноз стагнации', () => {
  const STALLED = [{
    exerciseId: 'bench-press',
    exerciseName: 'Жим лёжа',
    currentBest: 60,
    // Максимум взят до блока — внутри блока прироста нет.
    dataPoints: [point('2026-06-25', 60), point('2026-07-08', 58), point('2026-07-20', 59)],
    trend: { direction: 'flat', dataPointCount: 3 },
  }]

  const NOW = new Date('2026-07-30T10:00:00.000Z')

  /** Тренировался как договаривались, чувствует себя нормально, боли нет. */
  function sessions({ energy = 4, painOn = null } = {}) {
    return ['2026-07-20', '2026-07-24', '2026-07-28'].map((day) => ({
      completedAt: `${day}T10:00:00.000Z`,
      readinessCheckIn: { energy },
      exercises: [{
        exerciseId: 'bench-press',
        exerciseName: 'Жим лёжа',
        pain: day === painOn,
        sets: [{ weight: 60, reps: 8, completed: true }],
      }],
    }))
  }

  const PROFILE = { level: 'intermediate', age: 43, workoutsPerWeek: 2 }

  it('ставит диагноз и сохраняет его вместе с целью', async () => {
    const { client, queries } = mockClient([
      { match: 'insert into public.mesocycle_block_goals', rows: [goalRow({ target_value: 61.5 })] },
    ])
    const result = await syncBlockGoal(client, 'u1', {
      profile: PROFILE,
      mesocycle: mesocycle({ weekInCycle: 4 }),
      e1rmHistories: STALLED,
      history: sessions(),
      now: NOW,
    })

    expect(result.stagnation.diagnosis).toBe('insufficient_stimulus')
    const saved = queries.find((q) => q.text.includes('set diagnosis = $3'))
    expect(saved.params[3]).toBe(result.stagnation.note)
    expect(result.goal.diagnosisNote).toBe(result.stagnation.note)
  })

  it('гипотеза держится до своего срока, а не переставляется каждый пересчёт', async () => {
    const stored = goalRow({
      target_value: 61.5,
      diagnosis: 'insufficient_stimulus',
      diagnosis_note: 'недостаточный стимул: прежняя формулировка — добавить объём.',
      hypothesis_review_on: '2026-08-05',
    })
    const { client, queries } = mockClient([{ match: 'where user_id = $1 and block_started_on = $2', rows: [stored] }])
    const result = await syncBlockGoal(client, 'u1', {
      profile: PROFILE,
      mesocycle: mesocycle({ weekInCycle: 4 }),
      e1rmHistories: STALLED,
      history: sessions(),
      now: NOW,
    })

    expect(result.stagnation.note).toBe(stored.diagnosis_note)
    expect(result.stagnation.reviewOn).toBe('2026-08-05')
    expect(queries.some((q) => q.text.includes('set diagnosis = $3'))).toBe(false)
  })

  it('перегрузка перебивает незакрытую гипотезу — признаки потолка важнее срока проверки', async () => {
    const stored = goalRow({
      target_value: 61.5,
      diagnosis: 'insufficient_stimulus',
      diagnosis_note: 'недостаточный стимул: добавить объём.',
      hypothesis_review_on: '2026-08-05',
    })
    const { client } = mockClient([{ match: 'where user_id = $1 and block_started_on = $2', rows: [stored] }])
    const result = await syncBlockGoal(client, 'u1', {
      profile: PROFILE,
      mesocycle: mesocycle({ weekInCycle: 4 }),
      e1rmHistories: STALLED,
      // Готовность снижена и одна тренировка с болью — два признака потолка.
      history: sessions({ energy: 2, painOn: '2026-07-28' }),
      now: NOW,
    })

    expect(result.stagnation.diagnosis).toBe('overload')
    expect(result.stagnation.action).toBe('deload')
  })
})
