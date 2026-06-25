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
import { CoachHomePage } from './pages/CoachHomePage'
import { GymScreen } from './components/GymScreen'
import { WorkoutReviewScreen } from './components/WorkoutReviewScreen'
import { ExerciseLibraryScreen } from './components/ExerciseLibraryScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { NavigationProvider, CoachProvider, ProgramProvider } from './contexts'
import { AppShell } from './components/ui'
import './App.css'
import type { ExercisePlan, WorkoutDay } from './data/mockProgram'
import { fallbackProgramData, loadCoachMemoryAndState, type CoachMemory, type CoachState } from './data/programApi'
import { loadHistory, useProgramData } from './hooks/useProgramData'
import { loadActiveWorkoutDraft, useDraftAutosave } from './hooks/useDraftAutosave'
import { useCoachRecommendations } from './hooks/useCoachRecommendations'
import { createInitialLogs, useWorkoutNavigation, useWorkoutSession, useWorkoutSetActions } from './hooks/useWorkoutSession'
import { formatWeight, formatDateTime } from './lib/format'
import { useWorkoutSave } from './hooks/useWorkoutSave'
import { formatDateOnly, todayDateInputValue, usePlannedWorkouts } from './hooks/usePlannedWorkouts'
import { useProgramEditing } from './hooks/useProgramEditing'
import { useQuestionnaire } from './hooks/useQuestionnaire'
import { useActiveWorkoutContext } from './hooks/useActiveWorkoutContext'
import { useUserSelection } from './hooks/useUserSelection'
import { useRestTimer } from './hooks/useRestTimer'
import { createWorkoutHistoryEntry } from './domain/workoutHistory'
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

type Screen = 'home' | 'preview' | 'session' | 'review' | 'progress' | 'plan' | 'profile' | 'library' | 'onboarding'

const ONBOARDING_STORAGE_KEY = 'ai-gym-trainer:v0.1:onboarding-completed'

const fallbackFirstWorkoutDay = fallbackProgramData.workoutDays[0]
const fallbackFirstUser = fallbackProgramData.users[0]

function App() {
  const initialDraft = loadActiveWorkoutDraft()
  // Show onboarding on first ever launch; user can skip or finish it.
  // Subsequent launches go straight to 'home'. The onboarding can also be
  // re-opened from UserProfileScreen.
  const [screen, setScreen] = useState<Screen>(() => {
    if (typeof localStorage === 'undefined') return 'home'
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1' ? 'home' : 'onboarding'
  })
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
    setRestoredDraftKey,
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
  // Issue #69: lifted state for useExtraWorkoutToday (hook moved to CoachHomePage)
  const [coachTodayWorkoutDay, setCoachTodayWorkoutDay] = useState<WorkoutDay | null>(null)
  const [coachTodaySummary, setCoachTodaySummary] = useState('')
  const [extraWorkoutDayIds, setExtraWorkoutDayIds] = useState<string[]>([])
  const preliminaryAllUserWorkoutDays = programData.workoutDaysByUser[activeUserId] ?? programData.workoutDays
  const preliminaryProfile = programData.profilesByUser?.[activeUserId]
  const preliminaryScheduledWorkoutDays = plannedWorkouts.length > 0
    ? plannedWorkouts.map((workout) => workout.workoutDay)
    : preliminaryAllUserWorkoutDays.slice(0, Math.min(preliminaryAllUserWorkoutDays.length, Math.max(1, preliminaryProfile?.workoutsPerWeek || 3)))
  // Compute extraWorkoutDays from lifted state (was previously inside useExtraWorkoutToday)
  const extraWorkoutDays = extraWorkoutDayIds
    .map((dayId) => preliminaryAllUserWorkoutDays.find((day) => day.id === dayId))
    .filter((day): day is WorkoutDay => {
      if (!day) return false
      return !preliminaryScheduledWorkoutDays.some((scheduledDay) => scheduledDay.id === day.id)
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
    clearActiveWorkoutDraft: clearDraftOriginal,
  } = useDraftAutosave({
    initialDraft,
    activeUserId,
    workoutDayId: activeWorkoutDay.id,
    activeExerciseIndex,
    formatDateTime,
  })
  // Wrap clearActiveWorkoutDraft to also reset restoredDraftKey.
  // Without this, hasActiveDraft stays true after workout save (because
  // restoredDraftKey is never cleared), causing startWorkout() to skip
  // the readiness check-in screen and go straight to 'session'.
  const clearActiveWorkoutDraft = () => {
    clearDraftOriginal()
    setRestoredDraftKey(null)
  }
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
    resetCoachTodayWorkout: () => { setCoachTodayWorkoutDay(null); setCoachTodaySummary("") },
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

  // Issue #39: replay offline-queued requests when connectivity returns.
  // Also checks on app startup (in case the user was offline when they
  // saved a workout and reopened the app with internet).
  useEffect(() => {
    let cancelled = false
    async function tryReplay() {
      const { replayQueuedRequests, getQueuedCount } = await import('./lib/offlineQueue')
      const count = await getQueuedCount()
      if (count === 0) return
      const sent = await replayQueuedRequests()
      if (!cancelled && sent > 0) {
        notify(`Отправлено в базу: ${sent} отложенн${sent === 1 ? 'ая' : 'ых'} трениров${sent === 1 ? 'ка' : 'ок'}`)
        // Reload history from server to reflect the synced data.
        try {
          const { loadWorkoutHistoryFromApi } = await import('./data/workoutApi')
          const remoteHistory = await loadWorkoutHistoryFromApi()
          setHistory(remoteHistory)
        } catch { /* non-fatal */ }
      }
    }
    // Try on startup.
    tryReplay()
    // Listen for 'online' event.
    window.addEventListener('online', tryReplay)
    return () => {
      cancelled = true
      window.removeEventListener('online', tryReplay)
    }
  }, [])

          const { saveWorkoutAndExit, isSavingWorkout } = useWorkoutSave({
    activeUserId,
    activeWorkoutDay,
    activeExerciseIndex,
    readinessCheckIn,
    logs,
    history,
    setHistory,
    setPlannedWorkouts,
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
    <NavigationProvider screen={screen} navigate={navigate}>
      <CoachProvider
        coachMemory={coachMemory}
        coachState={coachState}
        setCoachMemory={setCoachMemory}
        setCoachState={setCoachState}
      >
        <ProgramProvider value={{
          users,
          activeUser,
          activeUserId,
          workoutDays,
          exerciseLibrary: programData.exerciseLibrary,
          plannedWorkouts,
          userHistory,
          nextTargets,
          coachTodaySummary,
        }}>
          <>
            <AppShell mode={screen === 'session' ? 'gym' : 'default'}>
              {toast && <div className="toast show">{toast}</div>}

              {screen === 'home' && (
                <CoachHomePage
                  activeWorkoutDay={activeWorkoutDay}
                  manualWorkoutDaySelected={manualWorkoutDaySelected}
                  scheduledWorkoutDays={scheduledWorkoutDays}
                  allUserWorkoutDays={allUserWorkoutDays}
                  extraExercisesByDay={extraExercisesByDay}
                  coachTodayWorkoutDay={coachTodayWorkoutDay}
                  setCoachTodayWorkoutDay={setCoachTodayWorkoutDay}
                  coachTodaySummary={coachTodaySummary}
                  setCoachTodaySummary={setCoachTodaySummary}
                  extraWorkoutDayIds={extraWorkoutDayIds}
                  setExtraWorkoutDayIds={setExtraWorkoutDayIds}
                  setActiveWorkoutDayId={setActiveWorkoutDayId}
                  setActiveExerciseIndex={setActiveExerciseIndex}
                  setLogs={setLogs}
                  onSelectUser={selectUser}
                  onNavigate={navigate}
                  onStartWorkout={startWorkout}
                  onSelectWorkoutDay={selectWorkoutDay}
                  notify={notify}
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

        {screen === 'onboarding' && (
          <OnboardingScreen
            onFinish={() => {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
              }
              setScreen('home')
            }}
            onSkip={() => {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
              }
              setScreen('home')
            }}
          />
        )}
      </AppShell>

      {screen !== 'onboarding' && (
        <BottomNav screen={screen} onNavigate={navigate} onStartWorkout={() => startWorkout()} />
      )}

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
        </ProgramProvider>
      </CoachProvider>
    </NavigationProvider>
  )
}

export default App
