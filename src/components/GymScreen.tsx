import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import type { ExerciseAddSuggestion } from '../domain/exerciseSuggestion'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'
import type { NextSetHint } from './gymTypes'
import { useEffect, useRef } from 'react'
import { isTimedExercise } from '../domain/exerciseMetrics'
import { SessionActions, QuickActions } from './GymActions'
import { NextSetCoachCard } from './NextSetCoachCard'
import { RestTimer } from './RestTimer'
import { WorkoutSetList } from './WorkoutSetList'
import { HeroStatus, MetricPair, ScreenHeader, SectionList } from './ui'

type GymScreenProps = {
  activeWorkoutDay: WorkoutDay
  activeExercise: ExercisePlan
  activeExerciseIndex: number
  activeLog: ExerciseLog
  activeSetIndex: number
  previousSetsSummary: string
  visibleNextSetRecommendation: NextSetHint | null
  allSetsCompleted: boolean
  restRemainingSeconds: number
  draftStatus: string
  nextExercise?: ExercisePlan
  exerciseAddSuggestion: ExerciseAddSuggestion | null
  formatWeight: (weight: number) => string
  navigate: (screen: 'home' | 'review') => void
  openExerciseGuide: () => void
  openReplacementSheet: () => void
  openExercisePicker: () => void
  copyPrevious: () => void
  adjustWeight: (delta: number) => void
  markPain: () => void
  clearRestTimer: () => void
  editCompletedSet: (setIndex: number) => void
  removeSet: (setIndex: number) => void
  updateSetWeight: (setIndex: number, value: string) => void
  updateSetReps: (setIndex: number, value: string) => void
  updateSet: (setIndex: number, patch: Partial<WorkoutSetInput>) => void
        markSetDone: (setIndex: number) => void
        addSet: () => void
        removeCurrentExercise: () => void
        addSuggestedExercise: () => void
        applyCoachExerciseSuggestion: (recommendation: NextSetHint) => void
        acceptCoachDecision: (recommendation: NextSetHint) => void
        goToNextExercise: () => void
}

export function GymScreen({
  activeWorkoutDay,
  activeExercise,
  activeExerciseIndex,
  activeLog,
  activeSetIndex,
  previousSetsSummary,
  visibleNextSetRecommendation,
  allSetsCompleted,
  restRemainingSeconds,
  draftStatus,
  nextExercise,
  exerciseAddSuggestion,
  formatWeight,
  navigate,
  openExerciseGuide,
  openReplacementSheet,
  openExercisePicker,
  copyPrevious,
  adjustWeight,
  markPain,
  clearRestTimer,
  editCompletedSet,
  removeSet,
  updateSetWeight,
  updateSetReps,
        updateSet,
        markSetDone,
        addSet,
        removeCurrentExercise,
        addSuggestedExercise,
        applyCoachExerciseSuggestion,
        acceptCoachDecision,
        goToNextExercise,
}: GymScreenProps) {
  const timedExercise = isTimedExercise(activeExercise)

  // Coach recommendation autofill: when the coach recommends a weight/reps
  // for the next set, automatically fill the active set's input fields.
  // Only applies to 'continue', 'hold_load', 'reduce_load' actions (not
  // stop/replace/skip/finish — those need user interaction).
  const lastAppliedRecKey = useRef<string | null>(null)
  useEffect(() => {
    if (!visibleNextSetRecommendation) return
    const rec = visibleNextSetRecommendation
    const isAutofillAction = ['continue', 'hold_load', 'reduce_load'].includes(rec.action)
    if (!isAutofillAction) return
    if (allSetsCompleted) return
    if (activeSetIndex < 0) return

    // Avoid re-applying the same recommendation (would override user edits)
    const recKey = `${activeExercise.id}:${activeSetIndex}:${rec.weight}:${rec.reps}`
    if (lastAppliedRecKey.current === recKey) return
    lastAppliedRecKey.current = recKey

    // Check if the set already has the recommended values (user may have
    // already entered them manually)
    const currentSet = activeLog.sets[activeSetIndex]
    if (currentSet && currentSet.weight === rec.weight && currentSet.reps === rec.reps) return

    // Apply recommendation
    updateSetWeight(activeSetIndex, String(rec.weight))
    updateSetReps(activeSetIndex, String(rec.reps))
  }, [visibleNextSetRecommendation, activeSetIndex, activeExercise.id, allSetsCompleted, activeLog.sets, updateSetWeight, updateSetReps])

  // Separate: is this a "continue/hold/reduce" recommendation (show inline)
  // or a "stop/replace/skip/finish" (show as separate card)?
  const rec = visibleNextSetRecommendation
  const isInlineRec = rec && ['continue', 'hold_load', 'reduce_load'].includes(rec.action) && !allSetsCompleted
  const isCardRec = rec && !['continue', 'hold_load', 'reduce_load'].includes(rec.action)

  return (
    <section className="screen active session-screen">
      {/* 1. session-header */}
      <div className="session-header">
        <span className="sr-only">Вкладка «Зал» · {activeWorkoutDay.name}</span>
        <span className="sr-only">Сейчас · {activeExerciseIndex + 1} из {activeWorkoutDay.exercises.length}</span>
        <ScreenHeader
          eyebrow={activeWorkoutDay.name}
          title="Зал"
          trailing={<span className="badge">{activeExerciseIndex + 1} из {activeWorkoutDay.exercises.length}</span>}
          variant="compact"
        />
        <button className="back" type="button" onClick={() => {
          if (window.confirm('Выйти из тренировки? Несохранённый прогресс будет потерян.')) {
            navigate('home')
          }
        }}>← Выйти</button>
      </div>

      {/* 2. SectionList "Подходы" — large stepper + inline coach hint */}
      <SectionList title="Подходы">
        {/* Inline coach recommendation — shown right above the set inputs */}
        {isInlineRec && rec && (
          <div className="coach-inline-hint">
            <span className="coach-inline-hint__label">
              {rec.action === 'reduce_load' ? '↓ Снизить' : rec.action === 'hold_load' ? '→ Держать' : '▶ Тренер'}
            </span>
            <b>{formatWeight(rec.weight)} кг × {rec.reps}</b>
            <span className="muted">{rec.reason}</span>
          </div>
        )}
        {!timedExercise && (
          <QuickActions
            weightStep={activeExercise.weightStep}
            hasPain={activeLog.pain}
            copyPrevious={copyPrevious}
            adjustWeight={adjustWeight}
            markPain={markPain}
          />
        )}
        {timedExercise && (
          <div className="quick-actions compact-readiness-actions">
            <button className="secondary compact" type="button" onClick={copyPrevious}>Повторить</button>
            <button className={activeLog.pain ? 'secondary compact danger active' : 'secondary compact danger'} type="button" onClick={markPain}>Боль</button>
          </div>
        )}

        <RestTimer restRemainingSeconds={restRemainingSeconds} clearRestTimer={clearRestTimer} />

        <WorkoutSetList
          activeExercise={activeExercise}
          activeLog={activeLog}
          activeSetIndex={activeSetIndex}
          allSetsCompleted={allSetsCompleted}
          formatWeight={formatWeight}
          editCompletedSet={editCompletedSet}
          removeSet={removeSet}
          updateSetWeight={updateSetWeight}
          updateSetReps={updateSetReps}
          updateSet={updateSet}
          markSetDone={markSetDone}
        />

        <button className="secondary wide" type="button" onClick={addSet}>Добавить подход</button>
      </SectionList>

      {/* 3. Compact header — exercise name + prescription + small action buttons */}
      <HeroStatus
        eyebrow={activeExercise.prescription}
        title={activeExercise.name}
        primaryAction={(
          <button
            type="button"
            className="primary compact-action"
            onClick={openExerciseGuide}
            aria-label={`Открыть описание упражнения: ${activeExercise.name}`}
          >
            Техника
          </button>
        )}
        secondaryAction={(
          <button className="secondary compact" type="button" onClick={openReplacementSheet}>
            Замена
          </button>
        )}
      />

      {/* 4. Compact "Прошлый раз / Цель" */}
      <MetricPair
        metrics={[
          { label: 'Прошлый раз', value: previousSetsSummary },
          { label: 'Цель', value: activeExercise.todayGoal },
        ]}
      />
      <span className="sr-only">Прошлый раз: {previousSetsSummary}</span>

      {/* 5. Session actions, coach cards, next card, action bar */}
      <SessionActions activeExerciseName={activeExercise.name} openReplacementSheet={openReplacementSheet} openExercisePicker={openExercisePicker} removeCurrentExercise={removeCurrentExercise} />

      {exerciseAddSuggestion && (
        <div className="card coach-add-exercise">
          <div>
            <div className="label">Тренер предлагает добавить</div>
            <b>{exerciseAddSuggestion.exercise.name}</b>
            <div className="muted">{exerciseAddSuggestion.reason}</div>
          </div>
          <button
            className="secondary compact"
            onClick={addSuggestedExercise}
            aria-label={`Добавить предложенное упражнение: ${exerciseAddSuggestion.exercise.name}`}
          >
            добавить
          </button>
        </div>
      )}

      {draftStatus && (
        <div className="autosave-status" role="status">
          <b>Прогресс защищён</b>
          <span>{draftStatus}</span>
          <small>После обновления страницы тренировка восстановится.</small>
        </div>
      )}

      {/* Coach card — only for stop/replace/skip/finish actions.
          For continue/hold/reduce, the recommendation is shown inline
          in the "Подходы" section + auto-filled into inputs. */}
      {isCardRec && (
        <NextSetCoachCard
          recommendation={visibleNextSetRecommendation}
          allSetsCompleted={allSetsCompleted}
          formatWeight={formatWeight}
          onApplySuggestedExercise={applyCoachExerciseSuggestion}
          onAcceptCoachDecision={acceptCoachDecision}
        />
      )}

      <div className="next-card session-next-card">
        <div>
          <div className="muted">{nextExercise ? 'Дальше' : 'Финиш'}</div>
          <b>{nextExercise ? nextExercise.name : 'Все упражнения пройдены'}</b>
          {nextExercise && <div className="muted">{nextExercise.prescription}</div>}
        </div>
      </div>

      {/* Sticky action bar — always visible during workout */}
      <div className="gym-action-bar">
        {nextExercise && (
          <button
            className="primary"
            type="button"
            onClick={goToNextExercise}
            aria-label="Перейти к следующему упражнению"
          >
            Следующее →
          </button>
        )}
        <button
          className="finish"
          type="button"
          onClick={() => navigate('review')}
          aria-label="Завершить всю тренировку"
        >
          Завершить тренировку
        </button>
      </div>
    </section>
  )
}
