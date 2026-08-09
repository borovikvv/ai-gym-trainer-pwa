/**
 * Intra-cycle Periodization Adjustments
 *
 * Issue #35: apply different weight/volume/intensity targets based on the
 * current mesocycle phase (loading / accumulation / intensification).
 *
 * Before this module, only the deload week had real parameter changes.
 * Weeks 1-3 (or 1-4 for adults) all used the same base parameters — the
 * phase indicator was purely decorative.
 *
 * Phase adjustments (applied AFTER base prescription, BEFORE deload):
 *
 *   loading (week 1):
 *     - Base weight (from recent history or exercise.targetWeight)
 *     - Moderate volume: base setsCount
 *     - Focus: technique, establish working weight
 *
 *   accumulation (weeks 2 to N-1):
 *     - Same weight as loading
 *     - +1 rep on repMin (more volume at same weight)
 *     - Focus: build work capacity
 *
 *   intensification (last loading week):
 *     - +1 weightStep on targetWeight (heavier)
 *     - -1 rep on repMax (fewer reps at higher weight)
 *     - Focus: peak strength
 *
 * These are SMALL adjustments (±1 rep, ±1 step) — not drastic. The goal
 * is to give each week a distinct character without breaking the
 * progression curve. The coach engine still has the final say via
 * readiness, fatigue, and pain checks.
 */

import type { WeightDirection } from '../shared/weightDirection.js'

export interface PeriodizationAdjustment {
  weightDelta: number        // signed change to targetWeight (in kg)
  repMinDelta: number        // signed change to repMin
  repMaxDelta: number        // signed change to repMax
  setsCountDelta: number     // signed change to setsCount
  intensityShift: 'none' | 'easier' | 'harder'
  focusNote: string          // Russian description of the phase focus
}

/**
 * Compute the periodization adjustment for the current mesocycle phase.
 *
 * @param phase — 'idle' | 'loading' | 'accumulation' | 'intensification' | 'deload'
 * @param weightStep — the exercise's weight step (e.g. 2.5 kg)
 * @param weightDirection — issue #173: 'load' (default) | 'assistance'.
 *   For assisted machines "heavier" means LESS counterweight, so the
 *   intensification weight delta flips sign.
 * @returns PeriodizationAdjustment (deltas, all 0 for idle/deload)
 */
// Issue #233: 0 — валидный шаг веса для bodyweight-упражнений («прогрессии
// веса нет»), а не «шаг не задан». Только NaN/null/undefined уходят в
// дефолтный шаг 2.5 кг.
function resolveWeightStep(weightStep: number | null | undefined): number {
  if (weightStep === null || weightStep === undefined) return 2.5
  const n = Number(weightStep)
  return Number.isFinite(n) ? Math.max(0, n) : 2.5
}

export function getPeriodizationAdjustment(
  phase: string | null | undefined,
  weightStep: number,
  weightDirection: WeightDirection = 'load',
): PeriodizationAdjustment {
  const step = resolveWeightStep(weightStep)

  switch (phase) {
    case 'loading':
      return {
        weightDelta: 0,
        repMinDelta: 0,
        repMaxDelta: 0,
        setsCountDelta: 0,
        intensityShift: 'none',
        focusNote: 'Загрузка: устанавливаем рабочий вес, техника в приоритете.',
      }

    case 'accumulation':
      return {
        weightDelta: 0,
        repMinDelta: 1,       // +1 rep on the minimum → more volume at same weight
        repMaxDelta: 0,
        setsCountDelta: 0,
        intensityShift: 'none',
        focusNote: 'Накопление: добираем объём — +1 повтор к минимуму диапазона.',
      }

    case 'intensification':
      // Issue #173: «тяжелее» для гравитрона = МЕНЬШЕ помощи (дельта со знаком минус).
      return {
        weightDelta: weightDirection === 'assistance' ? -step : step,
        repMinDelta: 0,
        repMaxDelta: -1,      // -1 rep on the maximum → fewer reps at higher weight
        setsCountDelta: 0,
        intensityShift: 'harder',
        focusNote: weightDirection === 'assistance'
          ? `Интенсификация: уменьшаем помощь на ${step} кг, сокращаем повторный диапазон.`
          : `Интенсификация: повышаем вес на ${step} кг, сокращаем повторный диапазон.`,
      }

    // idle, deload, or unknown — no adjustment (deload handled separately)
    default:
      return {
        weightDelta: 0,
        repMinDelta: 0,
        repMaxDelta: 0,
        setsCountDelta: 0,
        intensityShift: 'none',
        focusNote: '',
      }
  }
}

/**
 * Apply a periodization adjustment to base prescription values.
 * Returns new values without mutating the input.
 */
export function applyPeriodization(
  base: {
    targetWeight: number
    repMin: number
    repMax: number
    setsCount: number
    intensityTarget: string
    weightStep: number
  },
  phase: string | null | undefined,
  weightDirection: WeightDirection = 'load',
): {
  targetWeight: number
  repMin: number
  repMax: number
  setsCount: number
  intensityTarget: string
  periodizationNote: string
} {
  const adj = getPeriodizationAdjustment(phase, base.weightStep, weightDirection)

  return {
    targetWeight: Math.max(0, base.targetWeight + adj.weightDelta),
    repMin: Math.max(1, base.repMin + adj.repMinDelta),
    repMax: Math.max(base.repMin + adj.repMinDelta + 1, base.repMax + adj.repMaxDelta),
    setsCount: Math.max(1, base.setsCount + adj.setsCountDelta),
    intensityTarget: adj.intensityShift === 'harder'
      ? (base.intensityTarget === 'easy' ? 'controlled' : base.intensityTarget)
      : adj.intensityShift === 'easier'
        ? 'controlled'
        : base.intensityTarget,
    periodizationNote: adj.focusNote,
  }
}
