/**
 * Shared types — single source of truth for contracts between frontend
 * and backend. Imported by both sides once the backend TypeScript migration
 * progresses further.
 *
 * Phase 3 plan item 3.3: 'Миграция бэкенда на TypeScript' —
 * 'Общие типы (Workout, Exercise, Set, MuscleGroup, Recommendation) следует
 * вынести в отдельный файл shared/types.ts, который будет импортироваться и
 * фронтендом, и бэкендом.'
 */

// ---------------------------------------------------------------------------
// Muscle groups
// ---------------------------------------------------------------------------

export type MuscleKey = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'other'

export type MesocyclePhase = 'idle' | 'loading' | 'accumulation' | 'intensification' | 'deload'

// ---------------------------------------------------------------------------
// Workout / Exercise / Set
// ---------------------------------------------------------------------------

export type ProgressionType = 'increase' | 'hold' | 'deload' | 'pain' | 'skip'

export interface WorkoutSet {
  weight: number
  reps: number
  rpe?: number
  completed?: boolean
}

export interface CompletedExerciseHistory {
  exerciseId: string
  exerciseName: string
  muscleGroup?: string
  pain: boolean
  sets: WorkoutSet[]
  volume: number
  nextRecommendedWeight: number
  progressionType: ProgressionType
  progressionReason: string
}

export interface WorkoutHistoryEntry {
  id: string
  userId: string
  workoutDayId: string
  workoutDayName: string
  completedAt: string
  totalVolume: number
  readinessCheckIn?: ReadinessCheckIn | null
  exercises: CompletedExerciseHistory[]
}

// ---------------------------------------------------------------------------
// Readiness check-in
// ---------------------------------------------------------------------------

export interface ReadinessCheckIn {
  sleepQuality: number   // 1-5
  energy: number          // 1-5
  stress: number          // 1-5
  soreness: 'none' | 'light' | 'medium' | 'high'
  soreMuscleGroups: string[]
  painAreas: string[]
  availableMinutes: number
  notes: string
}

// ---------------------------------------------------------------------------
// Coach state / memory / decision
// ---------------------------------------------------------------------------

export interface MesocycleState {
  phase: MesocyclePhase
  phaseDescription: string
  weekInCycle: number
  cycleLength: number
  loadingWeeks: number
  deloadWeeks: number
  isDeload: boolean
  deloadScheduled: boolean
  triggerReason: string | null
  completionRatio: number
  workoutsThisCycle: number
  plannedWorkoutsThisCycle: number
}

export interface CoachState {
  userId: string | null
  recoveryStatus: string
  readinessScore: number
  weeklyLoadStatus: string
  daysSinceLastWorkout: number | null
  mesocycle: MesocycleState | null
  warnings: string[]
  // Adaptive volume landmark state (Phase 3 issue #6)
  volumeLandmarkOverrides?: Record<string, { mev: number; mav: number; mrv: number }>
  volumeAdjustmentLog?: VolumeAdjustmentDecision[]
  volumeSnapshots?: Record<string, MuscleVolumeSnapshot>
}

export interface VolumeAdjustmentDecision {
  muscleKey: string
  action: 'increase_mrv' | 'decrease_mrv' | 'decrease_mev' | 'hold'
  delta: number
  reason: string
  newMrv: number
  newMev: number
}

export interface MuscleVolumeSnapshot {
  weeklySets: number
  weeksAtOrAboveMrv: number
  weeksBelowMev: number
  e1rmTrend: 'up' | 'down' | 'flat' | 'insufficient_data'
  lastAdjustmentIso: string | null
}

export type MuscleGroupStatus = 'no_data' | 'hold' | 'consolidate' | 'progress_possible' | 'pain'

export interface MuscleGroupProfile {
  key: string
  label: string
  status: MuscleGroupStatus
  fatigue: 'low' | 'medium' | 'high' | 'unknown'
  lastTrainedDaysAgo: number | null
  workingSetsLast7Days: number
  heavySetsLast7Days: number
}

export interface CoachMemory {
  userId: string | null
  generatedAt: string
  trainerProfile: string
  summary: string
  recommendations: string[]
  weeklyBalance: {
    plannedWorkoutsPerWeek: number
    completedWorkoutsLast7Days: number
    loadStatus: string
    muscleSetCounts: Record<string, number>
    focusAreas: string[]
  }
  muscleGroupProfiles: Record<string, MuscleGroupProfile>
}

export type CoachLoadPolicy = 'moderate_no_failure' | 'progressive_if_recovered' | 'balanced_strength_hypertrophy'

export interface CoachDecision {
  type: string
  priorityMuscleGroups: string[]
  avoidMuscleGroups: string[]
  loadPolicy: CoachLoadPolicy
  exercisePolicies: Record<string, MuscleGroupStatus>
  reasons: string[]
  summary: string
}

// ---------------------------------------------------------------------------
// User training policy
// ---------------------------------------------------------------------------

export type AgeRecoveryPhase = 'teen' | 'adult' | 'mature_adult'

export interface UserTrainingPolicy {
  userId: string
  ageRecoveryProfile: {
    phase: AgeRecoveryPhase
    allowFailureSets: boolean
    sessionStyle: 'volume_light' | 'balanced' | 'heavy_short'
    intensityTolerance: 'avoid_max' | 'rare_max' | 'aggressive'
  }
}
