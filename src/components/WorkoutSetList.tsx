import type { ExercisePlan  } from '../../shared/types'
import type { ExerciseLog } from '../domain/workoutHistory'
import type { WorkoutSetInput } from '../domain/progression'
import { effortUnitLabel, isTimedExercise } from '../domain/exerciseMetrics'
import { difficultyLabel, difficultyOptions, type SetDraft } from './gymTypes'

type WorkoutSetListProps = {
  activeExercise: ExercisePlan
  activeLog: ExerciseLog
  activeSetIndex: number
  allSetsCompleted: boolean
  formatWeight: (weight: number) => string
  editCompletedSet: (setIndex: number) => void
  removeSet: (setIndex: number) => void
  updateSetWeight: (setIndex: number, value: string) => void
  updateSetReps: (setIndex: number, value: string) => void
  updateSet: (setIndex: number, patch: Partial<WorkoutSetInput>) => void
  markSetDone: (setIndex: number) => void
}

export function WorkoutSetList({
  activeExercise,
  activeLog,
  activeSetIndex,
  allSetsCompleted,
  formatWeight,
  editCompletedSet,
  removeSet,
  updateSetWeight,
  updateSetReps,
  updateSet,
  markSetDone,
}: WorkoutSetListProps) {
  return (
    <>
      {activeLog.sets.map((set, index) => {
        const isCurrentSet = index === activeSetIndex
        const setNumber = index + 1

        if (set.completed) {
          return (
            <CompletedSetCard
              key={`${activeExercise.id}-${index}`}
              setNumber={setNumber}
              weight={set.weight}
              reps={set.reps}
              rpe={set.rpe}
              timed={isTimedExercise(activeExercise)}
              canRemove={activeLog.sets.length > 1}
              formatWeight={formatWeight}
              editCompletedSet={() => editCompletedSet(index)}
              removeSet={() => removeSet(index)}
            />
          )
        }

        if (!isCurrentSet) {
          return (
            <UpcomingSetCard
              key={`${activeExercise.id}-${index}`}
              setNumber={setNumber}
              repMin={activeExercise.repMin}
              repMax={activeExercise.repMax}
              timed={isTimedExercise(activeExercise)}
              canRemove={activeLog.sets.length > 1}
              removeSet={() => removeSet(index)}
            />
          )
        }

        return (
          <CurrentSetEditor
            key={`${activeExercise.id}-${index}`}
            activeExercise={activeExercise}
            set={set as SetDraft}
            setNumber={setNumber}
            totalSets={activeLog.sets.length}
            formatWeight={formatWeight}
            updateSetWeight={(value) => updateSetWeight(index, value)}
            updateSetReps={(value) => updateSetReps(index, value)}
            updateSet={(patch) => updateSet(index, patch)}
            markSetDone={() => markSetDone(index)}
          />
        )
      })}

      {allSetsCompleted && (
        <div className="set set-collapsed completed">
          <div className="set-head">
            <b>Все подходы упражнения записаны</b>
            <span className="muted">можно переходить дальше</span>
          </div>
        </div>
      )}
    </>
  )
}

type CompletedSetCardProps = {
  setNumber: number
  weight: number
  reps: number
  rpe: number
  timed: boolean
  canRemove: boolean
  formatWeight: (weight: number) => string
  editCompletedSet: () => void
  removeSet: () => void
}

function CompletedSetCard({
  setNumber,
  weight,
  reps,
  rpe,
  timed,
  canRemove,
  formatWeight,
  editCompletedSet,
  removeSet,
}: CompletedSetCardProps) {
  return (
    <div className="set set-collapsed completed">
      <div className="set-head">
        <b>Подход {setNumber} · {timed ? `${reps} сек` : weight > 0 ? `${formatWeight(weight)}×${reps}` : `${reps} повт.`} · {difficultyLabel(rpe).toLowerCase()}</b>
        <div className="set-actions">
          <button className="secondary compact" onClick={editCompletedSet} aria-label={`Редактировать подход ${setNumber}`}>править</button>
          {canRemove && <button className="secondary compact" onClick={removeSet} aria-label={`Удалить подход ${setNumber}`}>удалить</button>}
        </div>
      </div>
    </div>
  )
}

type UpcomingSetCardProps = {
  setNumber: number
  repMin: number
  repMax: number
  timed: boolean
  canRemove: boolean
  removeSet: () => void
}

function UpcomingSetCard({ setNumber, repMin, repMax, timed, canRemove, removeSet }: UpcomingSetCardProps) {
  return (
    <div className="set set-collapsed upcoming">
      <div className="set-head">
        <b>Подход {setNumber}</b>
        <div className="set-actions">
          <span className="muted">впереди · цель {repMin}–{repMax}{timed ? ' сек' : ''}</span>
          {canRemove && <button className="secondary compact" onClick={removeSet} aria-label={`Удалить подход ${setNumber}`}>удалить</button>}
        </div>
      </div>
    </div>
  )
}

type CurrentSetEditorProps = {
  activeExercise: ExercisePlan
  set: SetDraft
  setNumber: number
  totalSets: number
  formatWeight: (weight: number) => string
  updateSetWeight: (value: string) => void
  updateSetReps: (value: string) => void
  updateSet: (patch: Partial<WorkoutSetInput>) => void
  markSetDone: () => void
}

function CurrentSetEditor({
  activeExercise,
  set,
  setNumber,
  totalSets,
  formatWeight,
  updateSetWeight,
  updateSetReps,
  updateSet,
  markSetDone,
}: CurrentSetEditorProps) {
  const unitLabel = effortUnitLabel(activeExercise)
  const timed = isTimedExercise(activeExercise)
  const canSaveSet = set.reps > 0
  const step = activeExercise.weightStep || 2.5
  const currentWeight = set.weightInput != null ? Number(set.weightInput) || set.weight : set.weight
  const currentReps = set.repsInput != null ? Number(set.repsInput) || set.reps : set.reps
  return (
    <div className="set current-set">
      <div className="set-head">
        <b>Подход {setNumber} из {totalSets}</b>
        <span className="muted">цель {activeExercise.repMin}–{activeExercise.repMax}{timed ? ' сек' : ''} · {difficultyLabel(set.rpe).toLowerCase()}</span>
      </div>

      {!timed && (
        <div className="big-stepper">
          <span className="big-stepper__label">кг</span>
          <div className="big-stepper__row">
            <button type="button" className="big-stepper__btn" aria-label="Меньше вес"
              onClick={() => updateSetWeight(String(Math.max(0, currentWeight - step)))}>−</button>
            <input
              className="big-stepper__value"
              aria-label={`Вес, подход ${setNumber}`}
              value={set.weightInput ?? formatWeight(set.weight)}
              inputMode="decimal"
              onChange={(event) => updateSetWeight(event.target.value)}
            />
            <button type="button" className="big-stepper__btn big-stepper__btn--plus" aria-label="Больше вес"
              onClick={() => updateSetWeight(String(currentWeight + step))}>+</button>
          </div>
        </div>
      )}

      <div className="big-stepper">
        <span className="big-stepper__label">{unitLabel}</span>
        <div className="big-stepper__row">
          <button type="button" className="big-stepper__btn" aria-label="Меньше повторов"
            onClick={() => updateSetReps(String(Math.max(0, currentReps - 1)))}>−</button>
          <input
            className="big-stepper__value"
            aria-label={`Повторы, подход ${setNumber}`}
            value={set.repsInput ?? (set.reps || '')}
            placeholder={unitLabel === 'сек' ? 'сек' : 'повт.'}
            inputMode="numeric"
            onChange={(event) => updateSetReps(event.target.value)}
          />
          <button type="button" className="big-stepper__btn big-stepper__btn--plus" aria-label="Больше повторов"
            onClick={() => updateSetReps(String(currentReps + 1))}>+</button>
        </div>
      </div>

      <button className="check check--wide" aria-label={`Записать подход ${setNumber}`} disabled={!canSaveSet} onClick={markSetDone}>Готово ✓</button>

      <div className="difficulty" aria-label={`Сложность подхода ${setNumber}`}>
        {difficultyOptions.map((option) => (
          <button key={option.label} type="button"
            className={set.rpe === option.value ? 'active' : ''}
            aria-label={`Сложность: ${option.label}, подход ${setNumber}`}
            title={option.hint} onClick={() => updateSet({ rpe: option.value })}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
