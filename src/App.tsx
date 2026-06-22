import { useEffect, useMemo, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { ExerciseGuideModal } from './components/ExerciseGuideModal'
import { PreWorkoutPreview } from './components/PreWorkoutPreview'
import { ProgressScreen } from './components/ProgressScreen'
import { ProgramExerciseEditor } from './components/ProgramExerciseEditor'
import { ExercisePickerSheet } from './components/ExercisePickerSheet'
import { ReplacementSheet } from './components/ReplacementSheet'
import { PlanCalendar } from './components/PlanCalendar'
import { UserProfileScreen } from './components/UserProfileScreen'
import { CoachHome } from './components/CoachHome'
import { GymScreen } from './components/GymScreen'
import { WorkoutReviewScreen } from './components/WorkoutReviewScreen'
import { ExerciseLibraryScreen } from './components/ExerciseLibraryScreen'
import { AppShell } from './components/ui'
import './App.css'
import type { ExercisePlan, WorkoutDay } from './data/mockProgram'
import { fallbackProgramData, loadCoachMemoryAndState, type CoachMemory, type CoachState } from './data/programApi'
import { loadHistory, useProgramData } from './hooks/useProgramData'
import { loadActiveWorkoutDraft, useDraftAutosave } from './hooks/useDraftAutosave'
import { useCoachRecommendations } from './hooks/useCoachRecommendations'
import { createInitialLogs, formatWeight, useWorkoutNavigation, useWorkoutSession, useWorkoutSetActions } from './hooks/useWorkoutSession'
import { useWorkoutSave } from './hooks/useWorkoutSave'
import { addDays, formatDateOnly, todayDateInputValue, usePlannedWorkouts } from './hooks/usePlannedWorkouts'
import { useProgramEditing } from './hooks/useProgramEditing'
import { useQuestionnaire } from './hooks/useQuestionnaire'
import { useExtraWorkoutToday } from './hooks/useExtraWorkoutToday'
import { useActiveWorkoutContext } from './hooks/useActiveWorkoutContext'
import { useUserSelection } from './hooks/useUserSelection'
import { useRestTimer } from './hooks/useRestTimer'
import { buildNextTargets, createWorkoutHistoryEntry } from './domain/workoutHistory'
import { suggestExerciseToAdd } from './domain/exerciseSuggestion'
import {
  adaptWorkoutDayForReadiness,
  estimateWorkoutMinutes,
  readinessOptions,
  type ReadinessMode,
} from './domain/workoutReadiness'
import {
  defaultReadinessCheckIn,
  resolveReadinessMode,
  type ReadinessCheckIn,
} from './domain/readinessCheckIn'

type Screen = 'home' | 'preview' | 'session' | 'review' | 'progress' | 'plan' | 'profile' | 'library'

function formatDateTime(isoDate: string) {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'дата неизвестна'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(' г.,', ',')
}

const fallbackFirstWorkoutDay = fallbackProgramData.workoutDays[0]
const fallbackFirstUser = fallbackProgramData.users[0]

function App() {
  const initialDraft = loadActiveWorkoutDraft()
  const [screen, setScreen] = useState<Screen>('home')
  const {
    activeExerciseIndex,
    setActiveExerciseIndex,
    logs,
    setLogs,
  } = useWorkoutSession({
    initialDraft,
    fallbackWorkoutDay: fallbackFirstWorkoutDay,
    fallbackUserId: fallbackFirstUser.id,
    loadInitialHistory: loadHistory,
  })
  const [toast, setToast] = useState('')
  const [coachMemory, setCoachMemory] = useState<CoachMemory | null>(null)
  const [coachState, setCoachState] = useState<CoachState | null>(null)
  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1700)
  }
  const {
    programData,
    setProgramData,
    activeUserId,
    setActiveUserId,
    activeWorkoutDayId,
    setActiveWorkoutDayId,
    history,
    setHistory,
    plannedWorkouts,
    setPlannedWorkouts,
    restoredDraftKey,
  } = useProgramData({
    initialDraft,
    fallbackFirstUserId: fallbackFirstUser.id,
    fallbackFirstWorkoutDayId: fallbackFirstWorkoutDay.id,
    createInitialLogs,
    setActiveExerciseIndex,
    setLogs,
    notify,
  })
  const [extraExercisesByDay, setExtraExercisesByDay] = useState<Record<string, ExercisePlan[]>>({})
  const [activeSessionWorkoutDay, setActiveSessionWorkoutDay] = useState<WorkoutDay | null>(null)
  const [workoutReadinessMode, setWorkoutReadinessMode] = useState<ReadinessMode>('normal')
  const [readinessCheckIn, setReadinessCheckIn] = useState<ReadinessCheckIn>(defaultReadinessCheckIn)
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false)
  const preliminaryNextTargets = buildNextTargets(history.filter((workout) => workout.userId === activeUserId))
  const preliminaryAllUserWorkoutDays = programData.workoutDaysByUser[activeUserId] ?? programData.workoutDays
  const preliminaryProfile = programData.profilesByUser?.[activeUserId]
  const preliminaryScheduledWorkoutDays = plannedWorkouts.length > 0
    ? plannedWorkouts.map((workout) => workout.workoutDay)
    : preliminaryAllUserWorkoutDays.slice(0, Math.min(preliminaryAllUserWorkoutDays.length, Math.max(1, preliminaryProfile?.workoutsPerWeek || 3)))
  const {
    extraWorkoutDays,
    coachTodayWorkoutDay,
    coachTodaySummary,
    extraDayPickerOpen,
    addExtraWorkoutDay,
    requestWorkoutToday,
    resetCoachTodayWorkout,
  } = useExtraWorkoutToday({
    activeUserId,
    allUserWorkoutDays: preliminaryAllUserWorkoutDays,
    scheduledWorkoutDays: preliminaryScheduledWorkoutDays,
    extraExercisesByDay,
    nextTargets: preliminaryNextTargets,
    setActiveWorkoutDayId,
    setActiveExerciseIndex,
    setLogs,
    notify,
  })
  const {
    users,
    allUserWorkoutDays,
    activeProfile,
    scheduledWorkoutDays,
    nextTargets,
    firstWorkoutDay,
    activeWorkoutDayBase,
    activeWorkoutDay,
    workoutDays,
    trainingCalendar,
    activeUser,
    activeExercise,
    createExerciseLog,
    activeLog,
    activeSetIndex,
    allSetsCompleted,
    nextExercise,
    nextPlannedWorkout,
    userHistory,
    progressDashboard,
    previousSetsSummary,
    progressionSummary,
    totalVolume,
  } = useActiveWorkoutContext({
    programData,
    activeUserId,
    activeWorkoutDayId,
    plannedWorkouts,
    history,
    extraWorkoutDays,
    coachTodayWorkoutDay,
    extraExercisesByDay,
    activeSessionWorkoutDay,
    activeExerciseIndex,
    logs,
  })

  const [sheetOpen, setSheetOpen] = useState(false)
  const [exerciseGuideOpen, setExerciseGuideOpen] = useState(false)
  const { restRemainingSeconds, setRestRemainingSeconds, clearRestTimer } = useRestTimer()
  const [manualWorkoutDaySelected, setManualWorkoutDaySelected] = useState(false)
  const {
    draftStatus,
    activeDraftId,
    persistWorkoutDraft,
    clearActiveWorkoutDraft,
  } = useDraftAutosave({
    initialDraft,
    activeUserId,
    workoutDayId: activeWorkoutDay.id,
    activeExerciseIndex,
    formatDateTime,
  })
  const previewWorkoutDay = adaptWorkoutDayForReadiness(activeWorkoutDayBase, workoutReadinessMode, readinessCheckIn)
  const exerciseAddSuggestion = screen === 'session'
    ? suggestExerciseToAdd({ workoutDay: activeWorkoutDay, exerciseLibrary: programData.exerciseLibrary })
    : null

  useEffect(() => {
    const nextWorkoutDay = nextPlannedWorkout?.workoutDay
    if (!nextWorkoutDay || manualWorkoutDaySelected || activeSessionWorkoutDay) return
    if (activeWorkoutDayId === nextWorkoutDay.id) return

    setActiveWorkoutDayId(nextWorkoutDay.id)
    setActiveExerciseIndex(0)
    setLogs(createInitialLogs(nextWorkoutDay, nextTargets))
  }, [
    activeSessionWorkoutDay,
    activeWorkoutDayId,
    manualWorkoutDaySelected,
    nextPlannedWorkout,
    nextTargets,
    setActiveExerciseIndex,
    setActiveWorkoutDayId,
    setLogs,
  ])

  function updateReadinessCheckIn(patch: Partial<ReadinessCheckIn>) {
    const next = { ...readinessCheckIn, ...patch }
    setReadinessCheckIn(next)
    setWorkoutReadinessMode(resolveReadinessMode(next))
  }

  const {
    editingExercise,
    editDraft,
    setEditingExercise,
    startEditExercise,
    updateEditDraft,
    saveProgramExercise,
  } = useProgramEditing({
    setProgramData,
    setActiveExerciseIndex,
    setLogs,
    notify,
  })


  const {
    setCoachNextSetHint,
    visibleNextSetRecommendation,
    getLocalNextSetRecommendation,
    requestServerNextSet,
    requestLiveStrategy,
  } = useCoachRecommendations({
    activeUserId,
    activeExercise,
    activeLog,
    activeWorkoutDayExercises: activeWorkoutDay.exercises,
    activeExerciseIndex,
    exerciseLibrary: programData.exerciseLibrary,
    availableMinutes: readinessCheckIn.availableMinutes,
    readinessCheckIn,
  })
  const {
    updateSet,
    updateSetWeight,
    updateSetReps,
    editCompletedSet,
    addSet,
    removeSet,
    markSetDone,
    adjustWeight,
    copyPrevious,
    markPain,
  } = useWorkoutSetActions({
    activeExercise,
    activeLog,
    activeSetIndex,
    logs,
    setLogs,
    nextTargets,
    setRestRemainingSeconds,
    setCoachNextSetHint,
    getLocalNextSetRecommendation,
    requestServerNextSet,
    requestLiveStrategy,
    persistWorkoutDraft,
    notify,
  })
  const {
    selectWorkoutDay,
            startWorkout,
            beginPreparedWorkout,
            addExerciseToCurrentWorkout,
            replaceCurrentExerciseInCurrentWorkout,
            removeCurrentExerciseFromWorkout,
            replaceNextExerciseInCurrentWorkout,
            acceptCoachDecision,
            goToNextExercise,
  } = useWorkoutNavigation({
    activeWorkoutDay,
    activeWorkoutDayBase,
    activeExerciseIndex,
    logs,
    nextExercise,
    nextTargets,
    draftStatus,
    hasActiveDraft: restoredDraftKey === activeDraftId(),
    previewWorkoutDay,
    manualWorkoutDaySelected,
    nextPlannedWorkout,
    trainingCalendar,
    extraExercisesByDay,
    setManualWorkoutDaySelected,
    setActiveSessionWorkoutDay,
    setWorkoutReadinessMode,
    setActiveWorkoutDayId,
    setActiveExerciseIndex,
    setRestRemainingSeconds,
    setCoachNextSetHint,
    setExerciseGuideOpen,
    setExtraExercisesByDay,
    setExercisePickerOpen,
    setLogs,
    createExerciseLog,
    persistWorkoutDraft,
    navigate,
    notify,
  })
  const {
    selectedWeekDates,
    editingPlannedWorkoutId,
    editingPlannedDate,
    setEditingPlannedWorkoutId,
    setEditingPlannedDate,
    weekDateOptions,
    toggleWeekDate,
    shiftPlanningWeek,
    savePlannedWorkoutDate,
    regeneratePlannedWorkout,
    cancelPlannedWorkout,
    resetPlanningStart,
  } = usePlannedWorkouts({
    activeUserId,
    plannedWorkouts,
    setPlannedWorkouts,
    scheduledWorkoutDays,
    firstWorkoutDay,
    selectWorkoutDay,
    notify,
  })

  function navigate(next: Screen, options?: { allowReviewExit?: boolean }) {
    if (screen === 'review' && !options?.allowReviewExit && !['review', 'session'].includes(next)) {
      notify('Сначала сохрани тренировку, чтобы прогресс попал в историю')
      setScreen('review')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setScreen(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const {
    updateQuestionnaire,
    saveQuestionnaire,
    reloadProgramDataForUser,
  } = useQuestionnaire({
    activeUserId,
    activeProfile,
    allUserWorkoutDays,
    activeWorkoutDayId,
    firstWorkoutDay,
    nextTargets,
    setProgramData,
    setActiveWorkoutDayId,
    setActiveExerciseIndex,
    setLogs,
    createInitialLogs,
    notify,
  })

  const { selectUser } = useUserSelection({
    programData,
    activeWorkoutDayId,
    activeWorkoutDay,
    history,
    users,
    setActiveUserId,
    setActiveWorkoutDayId,
    setActiveExerciseIndex,
    setLogs,
    resetCoachTodayWorkout,
    notify,
  })

  useEffect(() => {
    let cancelled = false
    loadCoachMemoryAndState(activeUserId)
      .then((result) => {
        if (!cancelled) {
          setCoachMemory(result.coachMemory)
          setCoachState(result.coachState)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCoachMemory(null)
          setCoachState(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeUserId, history.length, plannedWorkouts.length])

          const { saveWorkoutAndExit, isSavingWorkout } = useWorkoutSave({
    activeUserId,
    activeWorkoutDay,
    activeExerciseIndex,
    readinessCheckIn,
    logs,
    history,
    setHistory,
    clearActiveWorkoutDraft,
    reloadProgramDataForUser,
    setActiveExerciseIndex,
    setLogs,
    navigate,
    notify,
  })
  const reviewDebrief = useMemo(() => createWorkoutHistoryEntry({
    userId: activeUserId,
    workoutDayId: activeWorkoutDay.id,
    workoutDayName: activeWorkoutDay.name,
    exercises: activeWorkoutDay.exercises.slice(0, Math.max(1, activeExerciseIndex + 1)),
    logs,
    readinessCheckIn,
  }).debrief, [activeUserId, activeWorkoutDay, activeExerciseIndex, logs, readinessCheckIn])



  return (
    <>
      <AppShell mode={screen === 'session' ? 'gym' : 'default'}>
        {toast && <div className="toast show">{toast}</div>}

        {screen === 'home' && (
          <CoachHome
            users={users}
            activeUser={activeUser}
            activeUserId={activeUserId}
            activeWorkoutDay={activeWorkoutDay}
            manualWorkoutDaySelected={manualWorkoutDaySelected}
            workoutDays={workoutDays}
            plannedWorkouts={plannedWorkouts}
            scheduledWorkoutDays={scheduledWorkoutDays}
            allUserWorkoutDays={allUserWorkoutDays}
            extraExercisesByDay={extraExercisesByDay}
            extraDayPickerOpen={extraDayPickerOpen}
            coachTodaySummary={coachTodaySummary}
            userHistory={userHistory}
            nextTargets={nextTargets}
            coachMemory={coachMemory}
            coachState={coachState}
            onSelectUser={selectUser}
            onOpenProfile={() => navigate('profile')}
            onOpenLibrary={() => navigate('library')}
            onStartWorkout={startWorkout}
            onSelectWorkoutDay={selectWorkoutDay}
            onRequestWorkoutToday={() => requestWorkoutToday(selectWorkoutDay)}
            onAddExtraWorkoutDay={addExtraWorkoutDay}
            formatWeight={formatWeight}
            formatDateOnly={formatDateOnly}
            formatDateTime={formatDateTime}
            addDays={addDays}
            todayDateInputValue={todayDateInputValue}
          />
        )}

        {screen === 'preview' && (
          <PreWorkoutPreview
            workoutDay={previewWorkoutDay}
            readinessMode={workoutReadinessMode}
            readinessOptions={readinessOptions}
            readinessCheckIn={readinessCheckIn}
            onReadinessModeChange={setWorkoutReadinessMode}
            onReadinessCheckInChange={updateReadinessCheckIn}
            onBack={() => navigate('home')}
            onBegin={beginPreparedWorkout}
            estimateWorkoutMinutes={estimateWorkoutMinutes}
            formatWeight={formatWeight}
          />
        )}

        {screen === 'session' && (
          <GymScreen
            activeWorkoutDay={activeWorkoutDay}
            activeExercise={activeExercise}
            activeExerciseIndex={activeExerciseIndex}
            activeLog={activeLog}
            activeSetIndex={activeSetIndex}
            previousSetsSummary={previousSetsSummary}
            visibleNextSetRecommendation={visibleNextSetRecommendation}
            allSetsCompleted={allSetsCompleted}
            restRemainingSeconds={restRemainingSeconds}
            draftStatus={draftStatus}
            nextExercise={nextExercise}
            exerciseAddSuggestion={exerciseAddSuggestion}
            formatWeight={formatWeight}
            navigate={(nextScreen) => navigate(nextScreen)}
            openExerciseGuide={() => setExerciseGuideOpen(true)}
            openReplacementSheet={() => setSheetOpen(true)}
            openExercisePicker={() => setExercisePickerOpen(true)}
            copyPrevious={copyPrevious}
            adjustWeight={adjustWeight}
            markPain={markPain}
            clearRestTimer={clearRestTimer}
            editCompletedSet={editCompletedSet}
            removeSet={removeSet}
            updateSetWeight={updateSetWeight}
            updateSetReps={updateSetReps}
                    updateSet={updateSet}
                    markSetDone={markSetDone}
                    addSet={addSet}
                    removeCurrentExercise={removeCurrentExerciseFromWorkout}
                    addSuggestedExercise={() => {
              if (exerciseAddSuggestion) addExerciseToCurrentWorkout(exerciseAddSuggestion.exercise)
            }}
            applyCoachExerciseSuggestion={(recommendation) => {
              if (!recommendation.suggestedExercise) return
              if (recommendation.action === 'replace_next_exercise') {
                replaceNextExerciseInCurrentWorkout(recommendation.suggestedExercise)
                return
              }
              addExerciseToCurrentWorkout(recommendation.suggestedExercise)
            }}
            acceptCoachDecision={acceptCoachDecision}
            goToNextExercise={goToNextExercise}
          />
        )}

        {screen === 'review' && (
                  <WorkoutReviewScreen
                    progressionSummary={progressionSummary}
                    totalVolume={totalVolume}
                    debrief={reviewDebrief}
                    isSaving={isSavingWorkout}
                    onBackToWorkout={() => navigate('session')}
            onSaveAndExit={saveWorkoutAndExit}
          />
        )}

        {screen === 'progress' && (
          <ProgressScreen progressDashboard={progressDashboard} />
        )}

        {screen === 'profile' && (
          <UserProfileScreen
            users={users}
            activeUserId={activeUserId}
            activeUser={activeUser}
            activeProfile={activeProfile}
            exerciseLibrary={programData.exerciseLibrary}
            onSelectUser={selectUser}
            onUpdateQuestionnaire={updateQuestionnaire}
            onSaveQuestionnaire={saveQuestionnaire}
          />
        )}

        {screen === 'plan' && (
          <PlanCalendar
            activeProfile={activeProfile}
            selectedWeekDates={selectedWeekDates}
            weekDateOptions={weekDateOptions}
            plannedWorkouts={plannedWorkouts}
            userHistory={userHistory}
            trainingCalendar={trainingCalendar}
            activeUserId={activeUserId}
            activeWorkoutDay={activeWorkoutDay}
            editingPlannedWorkoutId={editingPlannedWorkoutId}
            editingPlannedDate={editingPlannedDate}
            onShiftPlanningWeek={shiftPlanningWeek}
            onResetPlanningStart={resetPlanningStart}
            onToggleWeekDate={toggleWeekDate}
            onSelectWorkoutDay={selectWorkoutDay}
            onStartWorkout={startWorkout}
            onBeginEditPlannedDate={(workoutId, date) => { setEditingPlannedWorkoutId(workoutId); setEditingPlannedDate(date) }}
            onSetEditingPlannedDate={setEditingPlannedDate}
            onCancelEditPlannedDate={() => setEditingPlannedWorkoutId(null)}
            onSavePlannedWorkoutDate={savePlannedWorkoutDate}
            onRegeneratePlannedWorkout={regeneratePlannedWorkout}
            onCancelPlannedWorkout={cancelPlannedWorkout}
            onStartEditExercise={startEditExercise}
            formatDateOnly={formatDateOnly}
            formatWeight={formatWeight}
            todayDateInputValue={todayDateInputValue}
          />
        )}

        {screen === 'library' && (
          <ExerciseLibraryScreen exerciseLibrary={programData.exerciseLibrary} />
        )}
      </AppShell>

      <BottomNav screen={screen} onNavigate={navigate} onStartWorkout={() => startWorkout()} />

      {editingExercise && editDraft && (
        <ProgramExerciseEditor
          exercise={editingExercise}
          draft={editDraft}
          onUpdateDraft={updateEditDraft}
          onSave={saveProgramExercise}
          onClose={() => setEditingExercise(null)}
        />
      )}

      {exercisePickerOpen && (
        <ExercisePickerSheet
          exerciseLibrary={programData.exerciseLibrary}
          activeExercises={activeWorkoutDay.exercises}
          onAddExercise={addExerciseToCurrentWorkout}
          onClose={() => setExercisePickerOpen(false)}
        />
      )}

      {exerciseGuideOpen && (
        <ExerciseGuideModal exercise={activeExercise} onClose={() => setExerciseGuideOpen(false)} />
      )}

      {sheetOpen && (
                <ReplacementSheet
                  exercise={activeExercise}
                  exerciseLibrary={programData.exerciseLibrary}
                  onClose={() => setSheetOpen(false)}
                  onChooseReplacement={(replacement) => {
                    replaceCurrentExerciseInCurrentWorkout(replacement)
                    setSheetOpen(false)
                  }}
                />
      )}
    </>
  )
}

export default App
