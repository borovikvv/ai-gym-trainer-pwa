import type { ExercisePlan  } from '../../shared/types'

type ExercisePickerSheetProps = {
  exerciseLibrary: ExercisePlan[]
  activeExercises: ExercisePlan[]
  onAddExercise: (exercise: ExercisePlan) => void
  onClose: () => void
}

export function ExercisePickerSheet({ exerciseLibrary, activeExercises, onAddExercise, onClose }: ExercisePickerSheetProps) {
  return (
    <>
      <div className="overlay show" onClick={onClose} />
      <div className="sheet show">
        <div className="kicker">Добавить упражнение</div>
        <h2>Выбери упражнение на сегодня</h2>
        {exerciseLibrary
          .filter((exercise) => !activeExercises.some((currentExercise) => currentExercise.name === exercise.name))
          .slice(0, 30)
          .map((exercise) => (
            <div className="exercise" key={exercise.id}>
              <div><b>{exercise.name}</b><div className="muted">{exercise.muscleGroup} · {exercise.setsCount}×{exercise.repMin}–{exercise.repMax}</div></div>
              <button className="secondary compact" onClick={() => onAddExercise(exercise)} aria-label={`Добавить ${exercise.name}`}>добавить</button>
            </div>
          ))}
        <button className="secondary wide" onClick={onClose}>Отмена</button>
      </div>
    </>
  )
}
