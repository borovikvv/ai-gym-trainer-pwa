import type { ExercisePlan, WorkoutDay  } from '../../shared/types'
import type { ExerciseAddSuggestion } from '../domain/exerciseSuggestion'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'
import type { NextSetHint } from './gymTypes'
import { useEffect, useRef } from 'react'
import { isTimedExercise } from '../domain/exerciseMetrics'
import { NextSetCoachCard } from './NextSetCoachCard'
import { CurrentStepCard } from './CurrentStepCard'
import { WorkoutSetList } from './WorkoutSetList'
import { QuickActions } from './GymActions'
import { Plus, Trash2 } from 'lucide-react'

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
  extendRest: (seconds: number) => void
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
  extendRest,
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

  // Issue #114: один источник правды для «какой вес делать прямо сейчас».
  // Карточка «Цель» раньше всегда показывала статичный activeExercise.todayGoal
  // (план цикла), а поле ввода заполнялось живой рекомендацией тренера — веса
  // расходились и было непонятно, что поднимать. Теперь «Цель» показывает живую
  // рекомендацию (когда она есть), совпадая с инпутом; статичный план цикла
  // уходит в приглушённый подпись и виден только когда он отличается от того,
  // что тренер советует прямо сейчас.
  const liveGoal = isInlineRec && rec.weight > 0
    ? (timedExercise
        ? `${rec.reps || activeExercise.repMin} сек`
        : `${formatWeight(rec.weight)} кг × ${rec.reps || activeExercise.repMin}`)
    : null
  const plannedWeight = activeExercise.targetWeight
  const differsFromPlan = isInlineRec && rec.weight > 0 && !timedExercise
    && Math.abs(rec.weight - plannedWeight) >= 0.05
  const cyclePlanTrend = differsFromPlan
    ? `план цикла ${formatWeight(plannedWeight)} кг`
    : undefined

  // Issue #122: progress fraction for slim top bar
  const totalExercises = activeWorkoutDay.exercises.length
  const progressFraction = totalExercises > 0 ? (activeExerciseIndex + 1) / totalExercises : 0

  return (
    <section className="screen active session-screen">
      {/* Issue #122: slim top bar — ← Выйти · progress · i/N */}
      <div className="session-top-bar">
        <button className="session-top-bar__back" type="button" onClick={() => {
          if (window.confirm('Выйти из тренировки? Несохранённый прогресс будет потерян.')) {
            navigate('home')
          }
        }}>← Выйти</button>
        <div className="session-top-bar__progress" aria-hidden="true">
          <div className="session-top-bar__progress-fill" style={{ width: `${progressFraction * 100}%` }} />
        </div>
        <span className="session-top-bar__counter">{activeExerciseIndex + 1} / {totalExercises}</span>
      </div>
      <span className="sr-only">Вкладка «Зал» · {activeWorkoutDay.name}</span>
      <span className="sr-only">Сейчас · {activeExerciseIndex + 1} из {totalExercises}</span>

      {/* Issue #122: exercise header */}
      <div className="gym-exercise-head">
        <div className="gym-exercise-head__copy">
          <span className="eyebrow">{activeExercise.prescription}</span>
          <h2>{activeExercise.name}</h2>
        </div>
        <div className="gym-exercise-head__actions">
          <button className="secondary compact" type="button" onClick={openExerciseGuide} aria-label={`Открыть описание упражнения: ${activeExercise.name}`}>Техника</button>
          <button className="secondary compact" type="button" onClick={openReplacementSheet}>Замена</button>
        </div>
      </div>

      {/* Фаза 3.1: фокусная карточка «что сейчас делать» — работа или отдых.
          Логгер (степперы + RIR + Готово) — первым, как в прототипе. */}
      <CurrentStepCard
        exercise={activeExercise}
        activeLog={activeLog}
        activeSetIndex={activeSetIndex}
        allSetsCompleted={allSetsCompleted}
        recommendation={isInlineRec ? rec : null}
        restRemainingSeconds={restRemainingSeconds}
        timedExercise={timedExercise}
        formatWeight={formatWeight}
        updateSet={updateSet}
        markSetDone={markSetDone}
        extendRest={extendRest}
        skipRest={clearRestTimer}
      />

      {/* Compact "Прошлый раз / Цель" — инлайн, как в прототипе (не большие карточки).
          Issue #114: «Цель» отражает живого тренера; план цикла — приглушённо. */}
      <div className="gym-prevgoal">
        <div>
          <span className="gym-prevgoal__label">Прошлый раз</span>
          <b className="gym-prevgoal__value">{previousSetsSummary}</b>
        </div>
        <div>
          <span className="gym-prevgoal__label">Цель</span>
          <b className="gym-prevgoal__value gym-prevgoal__value--goal">{liveGoal ?? activeExercise.todayGoal}</b>
          {cyclePlanTrend && <span className="gym-prevgoal__trend">{cyclePlanTrend}</span>}
        </div>
      </div>

      {/* Issue #122: set chips row — done / current / upcoming */}
      <div className="set-chips" role="tablist" aria-label="Подходы">
        {activeLog.sets.map((set, i) => {
          const isDone = set.completed
          const isCurrent = i === activeSetIndex && !isDone && !allSetsCompleted
          const chipClass = isDone ? 'set-chip--done' : isCurrent ? 'set-chip--current' : 'set-chip--upcoming'
          const label = isDone
            ? (timedExercise ? `${set.reps} сек` : set.weight > 0 ? `${formatWeight(set.weight)}×${set.reps}` : `${set.reps}`)
            : isCurrent ? 'сейчас' : `${i + 1}`
          return (
            <button
              key={i}
              className={`set-chip ${chipClass}`}
              onClick={() => isDone && editCompletedSet(i)}
              aria-label={`Подход ${i + 1}${isDone ? ': выполнен' : isCurrent ? ': текущий' : ''}`}
            >
              <span className="set-chip__num">{i + 1}</span>
              <span className="set-chip__value">{label}</span>
            </button>
          )
        })}
      </div>

      {/* «Дальше» — только когда все подходы сделаны (как в прототипе). */}
      {allSetsCompleted && (
        <div className="next-card session-next-card">
          <div>
            <div className="muted">{nextExercise ? 'Дальше' : 'Финиш'}</div>
            <b>{nextExercise ? nextExercise.name : 'Все упражнения пройдены'}</b>
            {nextExercise && <div className="muted">{nextExercise.prescription}</div>}
          </div>
        </div>
      )}

      {/* Issue #122: dashed "Добавить упражнение" + danger "Удалить" */}
      <button className="gym-add-exercise-btn" type="button" onClick={openExercisePicker}>
        <Plus size={16} aria-hidden="true" /> Добавить упражнение
      </button>
      <button className="gym-remove-exercise-btn" type="button" onClick={removeCurrentExercise}>
        <Trash2 size={14} aria-hidden="true" /> Удалить текущее упражнение
      </button>

      {/* Coach card — only for stop/replace/skip/finish actions. */}
      {isCardRec && (
        <NextSetCoachCard
          recommendation={visibleNextSetRecommendation}
          allSetsCompleted={allSetsCompleted}
          formatWeight={formatWeight}
          onApplySuggestedExercise={applyCoachExerciseSuggestion}
          onAcceptCoachDecision={acceptCoachDecision}
        />
      )}

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

      {/* Мощные функции (ручная правка/боль/добавить подход) — свёрнуты, ниже
          основного потока. Правка выполненного подхода доступна и по тапу на
          чип, поэтому это резервный путь. */}
      <details className="all-sets-details">
        <summary>Все подходы и правки</summary>
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
      </details>

      {draftStatus && (
        <p className="autosave-line" role="status">{draftStatus}</p>
      )}
      <span className="sr-only">Прошлый раз: {previousSetsSummary}</span>

      {/* Issue #122: sticky action bar — one state-labeled primary
          (Пропустить → / Следующее → / К разбору →) + компактный Финиш,
          как в прототипе (nextCta + Финиш). */}
      <div className="gym-action-bar">
        <button
          className="primary"
          type="button"
          onClick={nextExercise ? goToNextExercise : () => navigate('review')}
          aria-label={
            !allSetsCompleted ? 'Пропустить упражнение'
              : nextExercise ? 'Перейти к следующему упражнению'
                : 'К разбору тренировки'
          }
        >
          {!allSetsCompleted ? 'Пропустить →' : nextExercise ? 'Следующее →' : 'К разбору →'}
        </button>
        <button className="gym-action-bar__finish" type="button" onClick={() => navigate('review')} aria-label="Завершить всю тренировку">
          Финиш
        </button>
      </div>
    </section>
  )
}
