import type { WorkoutDay, ExercisePlan  } from '../../shared/types'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { NextSetHint } from '../components/gymTypes'
import type { ExerciseAddSuggestion } from '../domain/exerciseSuggestion'
import type { ReadinessCheckIn } from '../domain/readinessCheckIn'
import { useMemo } from 'react'
import type { Screen } from '../contexts/NavigationContext'
import { useProgram } from '../contexts/ProgramContext'
import { PreWorkoutPreview } from '../components/PreWorkoutPreview'
import { GymScreen } from '../components/GymScreen'
import { WorkoutReviewScreen } from '../components/WorkoutReviewScreen'
import { ExercisePickerSheet } from '../components/ExercisePickerSheet'
import { ExerciseGuideModal } from '../components/ExerciseGuideModal'
import { ReplacementSheet } from '../components/ReplacementSheet'
import { formatWeight } from '../lib/format'

type ReadinessMode = 'normal' | 'light' | 'very_light' | 'heavy'

interface ReadinessOption {
  mode: ReadinessMode
  label: string
  summary: string
  multiplier: number
}

interface GymPageProps {
  screen: Screen
  // Workout data
  activeWorkoutDay: WorkoutDay
  previewWorkoutDay: WorkoutDay
  activeExercise: ExercisePlan | undefined
  activeExerciseIndex: number
  activeLog: ExerciseLog | undefined
  activeSetIndex: number
  previousSetsSummary: string
  visibleNextSetRecommendation: NextSetHint | null
  allSetsCompleted: boolean
  restRemainingSeconds: number
  draftStatus: unknown
  nextExercise: ExercisePlan | undefined
  exerciseAddSuggestion: ExerciseAddSuggestion | null
  // Review data
  progressionSummary: import("../domain/progression").ProgressionResult[]
  totalVolume: number
  reviewDebrief: import("../domain/workoutDebrief").WorkoutDebrief | null | undefined
  isSavingWorkout: boolean
  // Readiness
  workoutReadinessMode: ReadinessMode
  readinessOptions: ReadinessOption[]
  readinessCheckIn: ReadinessCheckIn
  // Navigation
  onNavigate: (screen: Screen, options?: { allowReviewExit?: boolean }) => void
  // Workout actions
  onReadinessModeChange: (mode: ReadinessMode) => void
  onReadinessCheckInChange: (patch: Partial<ReadinessCheckIn>) => void
  onBeginPreparedWorkout: () => void
  onCopyPrevious: () => void
  onAdjustWeight: (delta: number) => void
  onMarkPain: () => void
  onClearRestTimer: () => void
  onEditCompletedSet: (setIndex: number) => void
  onRemoveSet: (setIndex: number) => void
  onUpdateSetWeight: (setIndex: number, weight: string) => void
  onUpdateSetReps: (setIndex: number, reps: string) => void
  onUpdateSet: (setIndex: number, patch: Partial<{ weight: number; reps: number; rpe: number; completed: boolean }>) => void
  onMarkSetDone: (setIndex: number) => void
  onAddSet: () => void
  onRemoveCurrentExercise: () => void
  onAddExerciseToCurrentWorkout: (exercise: ExercisePlan) => void
  onReplaceCurrentExercise: (replacement: ExercisePlan) => void
  onReplaceNextExercise: (exercise: ExercisePlan) => void
  onAcceptCoachDecision: (recommendation: NextSetHint) => void
  onGoToNextExercise: () => void
  onSaveAndExit: () => void
  // Utils
  estimateWorkoutMinutes: (day: WorkoutDay) => number
  // Issue #82: logs for progress bar computation
  logs: Record<string, ExerciseLog>
  // Modal state (owned by App.tsx, triggered by useWorkoutNavigation)
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  exerciseGuideOpen: boolean
  setExerciseGuideOpen: (open: boolean) => void
  exercisePickerOpen: boolean
  setExercisePickerOpen: (open: boolean) => void
}

/**
 * Issue #70 (#37 part 2): Page component for workout screens.
 *
 * Wraps PreWorkoutPreview, GymScreen, WorkoutReviewScreen, and the
 * workout-specific modals (ExercisePickerSheet, ExerciseGuideModal,
 * ReplacementSheet). Moves ~96 lines of JSX + 3 useState from App.tsx
 * into this file.
 *
 * The heavy hooks (useWorkoutSession, useWorkoutSetActions, etc.) stay
 * in App.tsx because their outputs are shared with useActiveWorkoutContext.
 * In #73 (final), as more state moves to context, these hooks can move here.
 */
export function GymPage(props: GymPageProps) {
  const program = useProgram()

  // Issue #82: compute workout progress (completed sets / total sets)
  const { completedSets, totalSets, progressPercent } = useMemo(() => {
    let completed = 0
    let total = 0
    for (const exercise of props.activeWorkoutDay.exercises) {
      const log = props.logs[exercise.id]
      const plannedSets = log?.sets.length ?? exercise.setsCount
      total += plannedSets
      completed += (log?.sets ?? []).filter((s) => s.completed).length
    }
    return {
      completedSets: completed,
      totalSets: total,
      progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    }
  }, [props.activeWorkoutDay, props.logs])

  // Modal state is owned by App.tsx (because useWorkoutNavigation hook
  // triggers setExerciseGuideOpen/setExercisePickerOpen). GymPage just
  // renders the modals using the passed-in state + setters.
  const {
    sheetOpen, setSheetOpen,
    exerciseGuideOpen, setExerciseGuideOpen,
    exercisePickerOpen, setExercisePickerOpen,
  } = props

  const { screen, onNavigate } = props

  return (
    <>
      {/* Issue #82: workout progress bar — shows during session */}
      {screen === 'session' && totalSets > 0 && (
        <div className="workout-progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`Прогресс: ${completedSets} из ${totalSets} подходов`}>
          <div className="workout-progress-bar__fill" style={{ width: `${progressPercent}%` }} />
          <span className="workout-progress-bar__label">{completedSets}/{totalSets}</span>
        </div>
      )}

      {screen === 'preview' && (
        <PreWorkoutPreview
          workoutDay={props.previewWorkoutDay}
          readinessMode={props.workoutReadinessMode}
          readinessOptions={props.readinessOptions}
          readinessCheckIn={props.readinessCheckIn}
          onReadinessModeChange={props.onReadinessModeChange}
          onReadinessCheckInChange={props.onReadinessCheckInChange}
          onBack={() => onNavigate('home')}
          onBegin={props.onBeginPreparedWorkout}
          estimateWorkoutMinutes={props.estimateWorkoutMinutes}
          formatWeight={formatWeight}
        />
      )}

      {screen === 'session' && (
        <GymScreen
          activeWorkoutDay={props.activeWorkoutDay}
          activeExercise={props.activeExercise!}
          activeExerciseIndex={props.activeExerciseIndex}
          activeLog={props.activeLog!}
          activeSetIndex={props.activeSetIndex}
          previousSetsSummary={props.previousSetsSummary}
          visibleNextSetRecommendation={props.visibleNextSetRecommendation}
          allSetsCompleted={props.allSetsCompleted}
          restRemainingSeconds={props.restRemainingSeconds}
          draftStatus={props.draftStatus as string}
          nextExercise={props.nextExercise}
          exerciseAddSuggestion={props.exerciseAddSuggestion}
          formatWeight={formatWeight}
          navigate={(nextScreen: Screen) => onNavigate(nextScreen)}
          openExerciseGuide={() => setExerciseGuideOpen(true)}
          openReplacementSheet={() => setSheetOpen(true)}
          openExercisePicker={() => setExercisePickerOpen(true)}
          copyPrevious={props.onCopyPrevious}
          adjustWeight={props.onAdjustWeight}
          markPain={props.onMarkPain}
          clearRestTimer={props.onClearRestTimer}
          editCompletedSet={props.onEditCompletedSet}
          removeSet={props.onRemoveSet}
          updateSetWeight={props.onUpdateSetWeight}
          updateSetReps={props.onUpdateSetReps}
          updateSet={props.onUpdateSet as unknown as (setIndex: number, patch: Partial<{ weight: number; reps: number; rpe: number; completed: boolean }>) => void}
          markSetDone={props.onMarkSetDone}
          addSet={props.onAddSet}
          removeCurrentExercise={props.onRemoveCurrentExercise}
          addSuggestedExercise={() => {
            if (props.exerciseAddSuggestion) props.onAddExerciseToCurrentWorkout(props.exerciseAddSuggestion.exercise)
          }}
          applyCoachExerciseSuggestion={(recommendation: { suggestedExercise?: ExercisePlan; action?: string }) => {
            if (!recommendation.suggestedExercise) return
            if (recommendation.action === 'replace_next_exercise') {
              props.onReplaceNextExercise(recommendation.suggestedExercise)
              return
            }
            props.onAddExerciseToCurrentWorkout(recommendation.suggestedExercise)
          }}
          acceptCoachDecision={props.onAcceptCoachDecision}
          goToNextExercise={props.onGoToNextExercise}
        />
      )}

      {screen === 'review' && (
        <WorkoutReviewScreen
          progressionSummary={props.progressionSummary}
          totalVolume={props.totalVolume}
          debrief={props.reviewDebrief}
          isSaving={props.isSavingWorkout}
          onBackToWorkout={() => onNavigate('session')}
          onSaveAndExit={props.onSaveAndExit}
        />
      )}

      {/* Workout-specific modals — moved from App.tsx */}
      {exercisePickerOpen && (
        <ExercisePickerSheet
          exerciseLibrary={program.exerciseLibrary}
          activeExercises={props.activeWorkoutDay.exercises}
          onAddExercise={props.onAddExerciseToCurrentWorkout}
          onClose={() => setExercisePickerOpen(false)}
        />
      )}

      {exerciseGuideOpen && (
        <ExerciseGuideModal
          exercise={props.activeExercise as ExercisePlan}
          onClose={() => setExerciseGuideOpen(false)}
        />
      )}

      {sheetOpen && (
        <ReplacementSheet
          exercise={props.activeExercise as ExercisePlan}
          exerciseLibrary={program.exerciseLibrary}
          onClose={() => setSheetOpen(false)}
          onChooseReplacement={(replacement: ExercisePlan) => {
            props.onReplaceCurrentExercise(replacement)
            setSheetOpen(false)
          }}
        />
      )}
    </>
  )
}
