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

// Issue #98 PR2: narrow helper types for ReadinessCheckIn. Frontend used
// CheckInLevel (1-5) and SorenessLevel; backend used plain number/string.
// The narrow types are more informative — adopt them in the shared contract.
export type CheckInLevel = 1 | 2 | 3 | 4 | 5
export type SorenessLevel = 'none' | 'light' | 'medium' | 'high'

// ---------------------------------------------------------------------------
// Volume landmarks (issue #62 / #36 decomposition)
//
// MEV = Minimum Effective Volume — below this, no adaptation stimulus
// MAV = Maximum Adaptive Volume — optimal range for growth
// MRV = Maximum Recoverable Volume — above this, recovery risk
//
// All values are working sets per 7-day rolling window for a single muscle
// group.
// ---------------------------------------------------------------------------

export interface VolumeLandmark {
  mev: number
  mav: number
  mrv: number
}

export type VolumeStatus = 'below_mev' | 'in_mev_mav' | 'above_mav' | 'at_mrv' | 'above_mrv'

export interface VolumeRecommendation {
  action: string
  reason: string
  priority: number
}

// ---------------------------------------------------------------------------
// Workout / Exercise / Set
// ---------------------------------------------------------------------------

export type ProgressionType = 'increase' | 'hold' | 'deload' | 'pain' | 'skip'

// Issue #98 PR3: WorkoutSet — rpe and completed are required in practice
// (the frontend WorkoutSetInput type requires them, and the DB schema
// has rpe NOT NULL DEFAULT 7, completed NOT NULL DEFAULT false). Making
// them required in the shared contract catches missing-data bugs earlier.
export interface WorkoutSet {
  weight: number
  reps: number
  rpe: number
  completed: boolean
}

// Issue #98 PR3: WorkoutDebrief moved from src/domain/workoutDebrief.ts
// so WorkoutHistoryEntry can reference it without a circular import.
export interface WorkoutDebrief {
  summary: string
  wentWell: string[]
  overload: string[]
  progressed: string[]
  nextChanges: string[]
  why: string
  qualityScore: number
}

export interface CompletedExerciseHistory {
  exerciseId: string
  exerciseName: string
  // Issue #98 PR3: muscleGroup is sent by backend (from exercise_library join)
  // but not always present on frontend-computed entries. Optional.
  muscleGroup?: string
  // Issue #98 PR3: canonicalExerciseId is computed on frontend (via
  // getCanonicalExerciseId) for exercise identity normalization. Optional
  // because backend doesn't compute it.
  canonicalExerciseId?: string
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
  // Issue #98 PR3: debrief is computed on frontend post-workout and may
  // be attached to the history entry. Optional because not all loaders
  // populate it (e.g. loadRecentHistory on backend doesn't).
  debrief?: WorkoutDebrief
  exercises: CompletedExerciseHistory[]
}

// ---------------------------------------------------------------------------
// Readiness check-in
// ---------------------------------------------------------------------------

export interface ReadinessCheckIn {
  sleepQuality: CheckInLevel   // 1-5
  energy: CheckInLevel          // 1-5
  stress: CheckInLevel          // 1-5
  soreness: SorenessLevel
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
  generatedAt: string
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
  // Issue #65: muscle group + exercise state (computed by coachState.ts)
  muscleGroups?: Record<string, MuscleGroupInfo | undefined>
  exercises?: Record<string, ExerciseStateInfo | undefined>
  // Additional computed fields produced by coachState.ts
  lastWorkoutId?: string | null
  lastWorkoutDayId?: string | null
  actualWorkoutsLast7Days?: number
  plannedWorkoutsPerWeek?: number
  personalization?: { trainingDataConfidence: number }
}

/** Per-muscle-group fatigue/volume state (issue #65). */
export interface MuscleGroupInfo {
  fatigue: 'low' | 'medium' | 'high' | 'unknown'
  recentHardSets: number
  recentMaxEffortSets: number
  recentVolume: number
  lastTrainedDaysAgo: number | null
}

/** Per-exercise state (issue #65). */
export interface ExerciseStateInfo {
  name: string
  muscleGroup: string
  status: MuscleGroupStatus
  lastWeight: number
  lastReps: number | null
  maxEffortSets: number
  hardSets: number
  pain: boolean
  target: string
}

/** Per-exercise profile (issue #65, used by coachMemory). */
export interface ExerciseProfile {
  id: string
  name: string
  muscleGroup: string
  muscleKey: string
  status: MuscleGroupStatus
  currentWorkingWeight: number
  lastReps: number | null
  lastTrainedAt: string | null
  recentSessions: number
  hardSets: number
  maxEffortSets: number
  pain: boolean
  recommendation: string
}

/** Extended MuscleGroupProfile used by coachMemory (issue #65). */
export interface MuscleGroupProfileExtended extends MuscleGroupProfile {
  maxEffortSetsLast7Days: number
  recentVolume: number
  pain: boolean
}

/** Live workout session context (issue #65, used by coachEngine/coachBrain). */
export interface CoachSessionContext {
  availableMinutes?: number
  nextExercise?: ExerciseRef | null
  workoutExercises?: ExerciseRef[]
  exerciseLibrary?: unknown[]
  readinessCheckIn?: ReadinessCheckIn | null
}

/** Minimal exercise reference used inside CoachSessionContext. */
export interface ExerciseRef {
  id?: string
  name?: string
  muscleGroup?: string
  exerciseName?: string
  targetWeight?: number
  weightStep?: number
  repMin?: number
  repMax?: number
  restSeconds?: number
}

/** Context bag passed into coachEngine.recommendNextSet (issue #65). */
export interface CoachEngineContext {
  session?: CoachSessionContext
  coachState?: CoachState | null
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

export type MuscleGroupStatus =
  | 'no_data'
  | 'hold'
  | 'consolidate'
  | 'progress_possible'
  | 'pain'
  // Issue #65: extended statuses used by coachMemory.muscleGroupProfiles
  | 'avoid'
  | 'fatigued'
  | 'medium'
  | 'ready'

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

// ---------------------------------------------------------------------------
// Program / exercise plan types (Issue #98 PR1: moved from src/data/mockProgram.ts
// so they can be shared between frontend and backend. mockProgram.ts now
// re-exports them for backward compatibility, but new code should import
// directly from shared/types.ts.)
// ---------------------------------------------------------------------------

export type UserProfile = {
  id: string
  name: string
  initials: string
  goal: string
  streak: string
}

export type ExercisePlan = {
  id: string
  canonicalExerciseId?: string
  programExerciseId?: string
  name: string
  muscleGroup: string
  prescription: string
  setsCount: number
  repMin: number
  repMax: number
  targetWeight: number
  weightStep: number
  restSeconds: number
  previous: string
  todayGoal: string
  coachFocus: string
  alternatives: { name: string; reason: string; badge?: string }[]
  instruction: string
  commonMistakes: string[]
}

export type WorkoutDay = {
  id: string
  name: string
  label: string
  description: string
  exercises: ExercisePlan[]
}
