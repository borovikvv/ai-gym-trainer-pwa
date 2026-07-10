// Фаза 3.1 (план развития): фокусная карточка «текущий шаг».
//
// Экран тренировки должен отвечать на один вопрос — «что сейчас делать».
// Режим работы: гигантские «60 кг × 8», счётчик подходов, одна кнопка
// «Готово» → быстрый выбор ощущений (RPE). Режим отдыха: карточка
// становится таймером с целью следующего подхода и коротким словом тренера
// («почему?» — за раскрывашкой). Когда ответ LLM приходит посреди отдыха,
// цифры цели обновляются на месте с лёгкой пульсацией.
import { useEffect, useState } from 'react'
import type { ExercisePlan } from '../../shared/types'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'
import { difficultyOptions, formatRestSeconds, type NextSetHint } from './gymTypes'

type CurrentStepCardProps = {
  exercise: ExercisePlan
  activeLog: ExerciseLog
  activeSetIndex: number
  allSetsCompleted: boolean
  recommendation: NextSetHint | null
  restRemainingSeconds: number
  timedExercise: boolean
  formatWeight: (weight: number) => string
  updateSet: (setIndex: number, patch: Partial<WorkoutSetInput>) => void
  markSetDone: (setIndex: number) => void
  extendRest: (seconds: number) => void
  skipRest: () => void
}

export function CurrentStepCard({
  exercise,
  activeLog,
  activeSetIndex,
  allSetsCompleted,
  recommendation,
  restRemainingSeconds,
  timedExercise,
  formatWeight,
  updateSet,
  markSetDone,
  extendRest,
  skipRest,
}: CurrentStepCardProps) {
  const [rpePickerOpen, setRpePickerOpen] = useState(false)
  const resting = restRemainingSeconds > 0

  // Пульсация цифр цели, когда LLM-ответ обновил их посреди отдыха.
  // Сравнение «во время рендера» — рекомендованный React паттерн вместо
  // синхронного setState в эффекте.
  const targetWeight = recommendation && recommendation.weight > 0 ? recommendation.weight : null
  const targetReps = recommendation && recommendation.reps > 0 ? recommendation.reps : null
  const targetKey = `${targetWeight}:${targetReps}`
  const [seenTargetKey, setSeenTargetKey] = useState(targetKey)
  const [pulse, setPulse] = useState(false)
  if (seenTargetKey !== targetKey) {
    setSeenTargetKey(targetKey)
    setPulse(true)
  }
  useEffect(() => {
    if (!pulse) return
    const timeout = window.setTimeout(() => setPulse(false), 700)
    return () => window.clearTimeout(timeout)
  }, [pulse])

  // Смена упражнения/подхода закрывает выбор RPE (сравнение в рендере).
  const stepKey = `${exercise.id}:${activeSetIndex}`
  const [seenStepKey, setSeenStepKey] = useState(stepKey)
  if (seenStepKey !== stepKey) {
    setSeenStepKey(stepKey)
    setRpePickerOpen(false)
  }

  if (allSetsCompleted) return null

  const activeSet = activeLog.sets[activeSetIndex]
  const setNumber = activeSetIndex + 1
  const totalSets = activeLog.sets.length

  function pickRpe(rpe: number) {
    updateSet(activeSetIndex, { rpe })
    setRpePickerOpen(false)
    markSetDone(activeSetIndex)
  }

  if (resting) {
    return (
      <div className="card current-step current-step--rest" role="status">
        <div className="current-step__eyebrow">Отдых</div>
        <div className="current-step__value current-step__timer">{formatRestSeconds(restRemainingSeconds)}</div>
        {(targetWeight !== null || targetReps !== null) && (
          <div className={pulse ? 'current-step__next current-step__next--pulse' : 'current-step__next'}>
            Следующий: {timedExercise
              ? `${targetReps ?? ''} сек`
              : `${targetWeight !== null ? `${formatWeight(targetWeight)} кг` : ''}${targetReps !== null ? ` × ${targetReps}` : ''}`}
          </div>
        )}
        {recommendation?.reason && <div className="muted current-step__reason">{recommendation.reason}</div>}
        {recommendation?.pending && <div className="muted coach-thinking" aria-live="polite">Тренер думает…</div>}
        {recommendation?.detail && !recommendation.pending && (
          <details className="coach-detail">
            <summary>почему?</summary>
            <div className="muted">{recommendation.detail}</div>
          </details>
        )}
        <div className="current-step__actions">
          <button className="secondary" type="button" onClick={() => extendRest(30)}>+30 с</button>
          <button className="secondary" type="button" onClick={skipRest}>Пропустить</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card current-step">
      <div className="current-step__eyebrow">Сейчас · подход {setNumber} из {totalSets}</div>
      <div className="current-step__value">
        {timedExercise
          ? `${activeSet?.reps || exercise.repMin} сек`
          : `${formatWeight(activeSet?.weight ?? 0)} кг × ${activeSet?.reps || exercise.repMin}`}
      </div>
      {recommendation?.reason && !rpePickerOpen && (
        <div className="muted current-step__reason">{recommendation.reason}</div>
      )}
      {rpePickerOpen ? (
        <div className="current-step__rpe" role="group" aria-label="Как прошёл подход?">
          <div className="muted">Как прошёл подход?</div>
          <div className="current-step__rpe-options">
            {difficultyOptions.map((option) => (
              <button
                key={option.value}
                className="secondary"
                type="button"
                onClick={() => pickRpe(option.value)}
                aria-label={`${option.label} — ${option.hint}`}
              >
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
          <button className="secondary compact" type="button" onClick={() => setRpePickerOpen(false)}>Назад</button>
        </div>
      ) : (
        <button
          className="primary current-step__done"
          type="button"
          onClick={() => setRpePickerOpen(true)}
          aria-label={`Подход ${setNumber} выполнен`}
        >
          Готово
        </button>
      )}
    </div>
  )
}
