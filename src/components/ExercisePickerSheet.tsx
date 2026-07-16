import { useMemo, useRef, useState } from 'react'
import type { ExercisePlan } from '../../shared/types'

type ExercisePickerSheetProps = {
  exerciseLibrary: ExercisePlan[]
  activeExercises: ExercisePlan[]
  onAddExercise: (exercise: ExercisePlan) => void
  onClose: () => void
}

// Icon SVG (прототип) — перекрестье
function ExIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.4 14.4 9.6 9.6M18.657 21.485l2.828-2.828M3.515 5.343 6.343 2.515M2.515 6.343 5.343 3.515M18.657 21.485 2.515 6.343" />
    </svg>
  )
}

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
  }, [exerciseLibrary, activeExercises, search, muscleFilter])

  return (
    <div className="lib-overlay" onClick={onClose}>
      <div className="lib-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Библиотека">
        {/* Header */}
        <div className="lib-sheet__header">
          <div className="lib-sheet__title">Библиотека</div>
          <button className="lib-sheet__close" type="button" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Search */}
        <input
          ref={searchInputRef}
          type="text"
          inputMode="text"
          className="lib-sheet__search"
          placeholder="Поиск упражнения..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        {/* Filter pills */}
        <div className="lib-sheet__filters">
          <button className={`lib-pill ${muscleFilter === null ? 'lib-pill--active' : ''}`} onClick={() => setMuscleFilter(null)}>Все</button>
          {muscleGroups.map((group) => (
            <button
              key={group}
              className={`lib-pill ${muscleFilter === group ? 'lib-pill--active' : ''}`}
              onClick={() => setMuscleFilter(muscleFilter === group ? null : group)}
            >
              {group}
            </button>
          ))}
        </div>

        {/* Exercise list */}
        <div className="lib-sheet__list">
          {filteredExercises.length === 0 ? (
            <div className="muted" style={{ padding: '1rem 0', textAlign: 'center' }}>Ничего не найдено</div>
          ) : (
            filteredExercises.map((exercise) => (
              <button key={exercise.id} className="lib-row" type="button" onClick={() => onAddExercise(exercise)} aria-label={`Добавить ${exercise.name}`}>
                <span className="lib-row__icon"><ExIcon /></span>
                <span className="lib-row__body">
                  <b className="lib-row__name">{exercise.name}</b>
                  <span className="lib-row__group">{exercise.muscleGroup}</span>
                </span>
                <span className="lib-row__action">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
