import { useMemo, useRef, useState } from 'react'
import type { ExercisePlan } from '../../shared/types'

type ExercisePickerSheetProps = {
  exerciseLibrary: ExercisePlan[]
  activeExercises: ExercisePlan[]
  onAddExercise: (exercise: ExercisePlan) => void
  onClose: () => void
}

// Issue #102: add search by name + filter by muscle group.
// Previously the sheet showed only the first 30 exercises with no way to
// find a specific one except scrolling.
export function ExercisePickerSheet({ exerciseLibrary, activeExercises, onAddExercise, onClose }: ExercisePickerSheetProps) {
  const [search, setSearch] = useState('')
  const [muscleFilter, setMuscleFilter] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Unique muscle groups from the library, sorted alphabetically (Russian)
  const muscleGroups = useMemo(() => {
    const groups = new Set(exerciseLibrary.map((e) => e.muscleGroup).filter(Boolean))
    return [...groups].sort((a, b) => a.localeCompare(b, 'ru'))
  }, [exerciseLibrary])

  const filteredExercises = useMemo(() => {
    const searchLower = search.trim().toLowerCase()
    return exerciseLibrary
      .filter((exercise) => !activeExercises.some((currentExercise) => currentExercise.name === exercise.name))
      .filter((exercise) => !searchLower || exercise.name.toLowerCase().includes(searchLower))
      .filter((exercise) => !muscleFilter || exercise.muscleGroup === muscleFilter)
    // Issue #102: removed .slice(0, 30) — filtering already limits the list,
    // and capping at 30 hid valid exercises from the user
  }, [exerciseLibrary, activeExercises, search, muscleFilter])

  return (
    <>
      <div className="overlay show" onClick={onClose} />
      <div className="sheet show">
        <div className="kicker">Добавить упражнение</div>
        <h2>Выбери упражнение на сегодня</h2>

        {/* Issue #102: search input with autofocus */}
        <input
          ref={searchInputRef}
          type="text"
          inputMode="text"
          className="search-input"
          placeholder="Поиск упражнения..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        {/* Issue #102: muscle group filter chips */}
        <div className="muscle-filter-chips">
          <button
            className={`chip ${muscleFilter === null ? 'active' : ''}`}
            onClick={() => setMuscleFilter(null)}
          >
            Все
          </button>
          {muscleGroups.map((group) => (
            <button
              key={group}
              className={`chip ${muscleFilter === group ? 'active' : ''}`}
              onClick={() => setMuscleFilter(muscleFilter === group ? null : group)}
            >
              {group}
            </button>
          ))}
        </div>

        {/* Result count when filtered */}
        {filteredExercises.length === 0 ? (
          <div className="muted" style={{ padding: '1rem 0', textAlign: 'center' }}>
            Ничего не найдено
          </div>
        ) : (
          filteredExercises.map((exercise) => (
            <div className="exercise" key={exercise.id}>
              <div><b>{exercise.name}</b><div className="muted">{exercise.muscleGroup} · {exercise.setsCount}×{exercise.repMin}–{exercise.repMax}</div></div>
              <button className="secondary compact" onClick={() => onAddExercise(exercise)} aria-label={`Добавить ${exercise.name}`}>добавить</button>
            </div>
          ))
        )}
        <button className="secondary wide" onClick={onClose}>Отмена</button>
      </div>
    </>
  )
}
