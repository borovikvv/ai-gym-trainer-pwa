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

import type { MesocyclePhase } from '../shared/types.js'

export interface PeriodizationAdjustment {
  weightDelta: number        // signed change to targetWeight (in kg)
  repMinDelta: number        // signed change to repMin
  repMaxDelta: number        // signed change to repMax
  setsCountDelta: number     // signed change to setsCount
  intensityShift: 'none' | 'easier' | 'harder'
  focusNote: string          // Russian description of the phase focus
}

// Re-export for convenience (not used internally, but available to consumers)
export type { MesocyclePhase }

/**
 * Compute the periodization adjustment for the current mesocycle phase.
 *
 * @param phase — 'idle' | 'loading' | 'accumulation' | 'intensification' | 'deload'
 * @param weightStep — the exercise's weight step (e.g. 2.5 kg)
 * @returns PeriodizationAdjustment (deltas, all 0 for idle/deload)
 */
export function getPeriodizationAdjustment(
  phase: string | null | undefined,
  weightStep: number,
): PeriodizationAdjustment {
  const step = Math.max(0, Number(weightStep) || 2.5)

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
      return {
        weightDelta: step,    // +1 step (e.g. +2.5 kg) — heavier
        repMinDelta: 0,
        repMaxDelta: -1,      // -1 rep on the maximum → fewer reps at higher weight
        setsCountDelta: 0,
        intensityShift: 'harder',
        focusNote: `Интенсификация: повышаем вес на ${step} кг, сокращаем повторный диапазон.`,
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
): {
  targetWeight: number
  repMin: number
  repMax: number
  setsCount: number
  intensityTarget: string
  periodizationNote: string
} {
  const adj = getPeriodizationAdjustment(phase, base.weightStep)

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
