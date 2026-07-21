// Issue #123: Gym logger with ± steppers + RIR scale + coach hint.
//
// The card now shows:
// 1. Two ± steppers for weight (by weightStep) and reps (by 1)
// 2. RIR scale: 4 dots (4+/3/1-2/0) — user taps one to select difficulty
// 3. "Готово · подход N" button — disabled until RIR is chosen
// 4. Coach hint line with green left border (tag / value / note)
//
// Rest mode is unchanged (hero-bg timer card from #122).
import { useEffect, useState } from 'react'
import type { ExercisePlan } from '../../shared/types'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'
import { formatRestSeconds, type NextSetHint } from './gymTypes'
import { Stepper } from './ui'

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
  markSetDone: (setIndex: number, patch?: Partial<WorkoutSetInput>) => void
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
  formatWeight: _formatWeight,
  updateSet,
  markSetDone,
  extendRest,
  skipRest,
}: CurrentStepCardProps) {
  const [selectedRir, setSelectedRir] = useState<number | null>(null)
  const resting = restRemainingSeconds > 0

  // Пульсация цифр цели, когда LLM-ответ обновил их посреди отдыха.
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

  // Смена упражнения/подхода сбрасывает RIR выбор.
  const stepKey = `${exercise.id}:${activeSetIndex}`
  const [seenStepKey, setSeenStepKey] = useState(stepKey)
  if (seenStepKey !== stepKey) {
    setSeenStepKey(stepKey)
    setSelectedRir(null)
  }

  if (allSetsCompleted) return null

  const activeSet = activeLog.sets[activeSetIndex]
  const setNumber = activeSetIndex + 1
  const totalSets = activeLog.sets.length

  function pickRir(rpe: number) {
    setSelectedRir(rpe)
  }

  function handleDone() {
    if (selectedRir === null) return
    // Issue #133: RPE передаётся прямо в markSetDone, чтобы попасть в тот же
    // setLogs, что и completed. Отдельный updateSet затирался staleSnapshot'ом.
    markSetDone(activeSetIndex, { rpe: selectedRir })
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
              : `${targetWeight !== null ? `${targetWeight} кг` : ''}${targetReps !== null ? ` × ${targetReps}` : ''}`}
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

  const currentWeight = activeSet?.weight ?? exercise.targetWeight ?? 0
  const currentReps = activeSet?.reps ?? exercise.repMin ?? 0
  const weightStep = exercise.weightStep > 0 ? exercise.weightStep : 2.5

  // RIR dots: short labels + tone for the 4 options (запас → отказ)
  const rirDots = [
    { rpe: 6, label: '4+', hint: 'Легко', tone: 'success' },
    { rpe: 7, label: '3', hint: 'Норм', tone: 'success' },
    { rpe: 8, label: '1–2', hint: 'Тяж', tone: 'warning' },
    { rpe: 10, label: '0', hint: 'Макс', tone: 'danger' },
  ]

  return (
    <div className="card current-step current-step--logger">
      <div className="current-step__eyebrow">Подход {setNumber} из {totalSets}</div>

      {/* Issue #123: ± steppers for weight and reps */}
      <div className="current-step__steppers">
        {!timedExercise && (
          <Stepper
            value={currentWeight}
            step={weightStep}
            min={0}
            onChange={(v) => updateSet(activeSetIndex, { weight: v })}
            label="Вес (кг)"
            variant="big"
            aria-label="Вес"
          />
        )}
        <Stepper
          value={currentReps}
          step={1}
          min={0}
          onChange={(v) => updateSet(activeSetIndex, { reps: v })}
          label={timedExercise ? 'Секунды' : 'Повторы'}
          variant="big"
          aria-label="Повторы"
        />
      </div>

      {/* Issue #123: RIR scale — dots on a line (запас → отказ), как в прототипе */}
      <div className="rir-scale" role="group" aria-label="Сколько ещё сделаешь?">
        <span className="rir-scale__label">Сколько ещё сделаешь?</span>
        <div className="rir-track">
          <div className="rir-track__line" aria-hidden="true" />
          <div className="rir-track__dots">
            {rirDots.map((dot) => (
              <button
                key={dot.rpe}
                type="button"
                className={`rir-dot rir-dot--${dot.tone} ${selectedRir === dot.rpe ? 'rir-dot--active' : ''}`}
                onClick={() => pickRir(dot.rpe)}
                aria-label={`${dot.hint} — ${dot.label} в запасе`}
                aria-pressed={selectedRir === dot.rpe}
              >
                <span className="rir-dot__circle"><span className="rir-dot__inner" /></span>
                <span className="rir-dot__value">{dot.label}</span>
              </button>
            ))}
          </div>
          <div className="rir-track__ends">
            <span>запас</span>
            <span>отказ</span>
          </div>
        </div>
      </div>

      {/* Issue #123: coach hint line (green left border) */}
      {recommendation?.reason && (
        <div className="coach-hint">
          {recommendation.source === 'llm' && <span className="coach-hint__tag">ИИ</span>}
          <span className="coach-hint__text">{recommendation.reason}</span>
        </div>
      )}

      {/* Issue #123: Готово — disabled until RIR chosen */}
      <button
        className="primary current-step__done"
        type="button"
        onClick={handleDone}
        disabled={selectedRir === null}
        aria-label={`Подход ${setNumber} выполнен`}
      >
        {selectedRir !== null ? `Готово · подход ${setNumber}` : 'Выбери остаток повторов'}
      </button>
    </div>
  )
}

