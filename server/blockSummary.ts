// Issue #350: итог мезоцикла — что выросло, где застой, что меняем. Ничего не
// пересчитывает: e1RM, стагнация и цель блока уже посчитаны в mesocycleBlockGoal.

import type { BlockSummary, MesocycleState, WorkoutHistoryEntry } from '../shared/types.js'
import type { BlockGoal, E1rmHistoryLike } from './mesocycleBlockGoal.js'
import {
  assessBlockOutcome,
  buildBlockGoalDraft,
  countPainSessions,
  evaluateBlockGoalProgress,
  summarizeE1rmForBlock,
  weeksWithoutGain,
} from './mesocycleBlockGoal.js'
import { MIN_STALL_WEEKS } from '../shared/stagnationDiagnosis.js'
import { dateToDateOnly } from './utils.js'

/** Не больше стольких упражнений в разделе «Выросло». */
const MAX_GAINS = 5

const ACHIEVED_WHY = 'Цель блока взята — новая цель считается от достигнутого e1RM и темпа вашего уровня.'
const MISSED_WHY = 'Цель блока не взята — новый блок стартует от фактического e1RM, темп ожидания прежний.'

/** null — показывать нечего: нет мезоцикла, это не разгрузка или нет цели блока. */
export function buildBlockSummary(input: {
  goal: BlockGoal | null
  mesocycle: MesocycleState | null
  e1rmHistories: E1rmHistoryLike[]
  history: WorkoutHistoryEntry[]
  profile: { age?: number | null; level?: string | null; goal?: string | null; workoutsPerWeek?: number | null }
  preferredExerciseId?: string | null
  now?: Date
}): BlockSummary | null {
  const { goal, mesocycle, e1rmHistories, history, profile, preferredExerciseId = null, now = new Date() } = input
  if (!mesocycle || mesocycle.isDeload !== true || !goal) return null

  const blockStartedOn = goal.blockStartedOn
  const today = dateToDateOnly(now)

  const gains: BlockSummary['gains'] = []
  const stalled: BlockSummary['stalled'] = []
  for (const historyEntry of e1rmHistories ?? []) {
    const dataPoints = historyEntry.dataPoints ?? []
    const summary = summarizeE1rmForBlock(dataPoints, blockStartedOn)
    // Нет точки в блоке — упражнение не делали; нет точки до блока — нет базы,
    // и weeksWithoutGain назвал бы застоем отсутствие истории.
    const hadPreBlockPoint = dataPoints.some((point) => String(point?.date ?? '').slice(0, 10) < blockStartedOn)
    if (summary.pointsInBlock < 1 || !hadPreBlockPoint) continue

    const delta = roundTo(summary.actual - summary.baseline, 0.1)
    if (delta > 0) {
      gains.push({
        exerciseId: String(historyEntry.exerciseId),
        exerciseName: String(historyEntry.exerciseName ?? historyEntry.exerciseId),
        baseline: summary.baseline,
        actual: summary.actual,
        delta,
      })
    }

    const weeks = weeksWithoutGain(dataPoints, blockStartedOn, today)
    if (weeks >= MIN_STALL_WEEKS) {
      stalled.push({
        exerciseId: String(historyEntry.exerciseId),
        exerciseName: String(historyEntry.exerciseName ?? historyEntry.exerciseId),
        weeks,
        // Причина есть только у цели блока: диагностика считается только для неё.
        diagnosisNote: String(historyEntry.exerciseId) === String(goal.exerciseId) ? goal.diagnosisNote : null,
      })
    }
  }
  gains.sort((a, b) => b.delta - a.delta)

  const goalHistory = (e1rmHistories ?? []).find(
    (historyEntry) => String(historyEntry.exerciseId) === String(goal.exerciseId),
  )
  const goalE1rm = summarizeE1rmForBlock(goalHistory?.dataPoints ?? [], blockStartedOn)
  // Ту же сверку, что делает syncBlockGoal при закрытии блока: срок вышел.
  const progress = evaluateBlockGoalProgress(goal, {
    actualValue: goalE1rm.pointsInBlock > 0 ? goalE1rm.actual : goal.baselineValue,
    weekInCycle: goal.horizonWeeks + 1,
    painSessions: countPainSessions(history, blockStartedOn),
  })
  const status = assessBlockOutcome(goal, progress).status

  const planned = Math.max(0, Number(mesocycle.plannedWorkoutsThisCycle) || 0)
  const done = Math.max(0, Number(mesocycle.workoutsThisCycle) || 0)
  const nextStart = mesocycle.cycleStartedOn
    ? shiftDays(mesocycle.cycleStartedOn, mesocycle.cycleLength * 7)
    : null
  const nextDraft = nextStart
    ? buildBlockGoalDraft({
        profile,
        mesocycle: { ...mesocycle, cycleStartedOn: nextStart },
        e1rmHistories,
        preferredExerciseId,
      })
    : null

  return {
    blockStartedOn,
    weeks: mesocycle.cycleLength,
    goal: {
      title: goal.title,
      status,
      baseline: goal.baselineValue,
      target: goal.targetValue,
      actual: roundTo(progress.actualValue, 0.1),
    },
    gains: gains.slice(0, MAX_GAINS),
    stalled,
    adherence: { done, planned, skipped: Math.max(0, planned - done) },
    next: { goalTitle: nextDraft?.title ?? null, why: status === 'achieved' ? ACHIEVED_WHY : MISSED_WHY },
  }
}

function shiftDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

function roundTo(value: number, step: number): number {
  return Math.round(Math.round(Number(value) / step) * step * 100) / 100
}
