import { useMemo, useState } from 'react'
import type { ExercisePlan  } from '../../shared/types'
import { ExerciseGuideModal } from './ExerciseGuideModal'

type ExerciseLibraryScreenProps = {
  exerciseLibrary: ExercisePlan[]
}

type EquipmentFilter = 'all' | 'barbell' | 'dumbbells' | 'machine' | 'bodyweight'

const equipmentFilters: { id: EquipmentFilter; label: string }[] = [
  { id: 'all', label: 'Всё оборудование' },
  { id: 'barbell', label: 'Штанга' },
  { id: 'dumbbells', label: 'Гантели' },
  { id: 'machine', label: 'Тренажёры/блоки' },
  { id: 'bodyweight', label: 'Вес тела' },
]

function normalize(value: string) {
  return value.toLocaleLowerCase('ru-RU').trim()
}

function countLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} упражнение`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} упражнения`
  return `${count} упражнений`
}

function exerciseMatchesEquipment(exercise: ExercisePlan, equipment: EquipmentFilter) {
  if (equipment === 'all') return true
  const haystack = normalize(`${exercise.name} ${exercise.instruction} ${exercise.prescription} ${exercise.coachFocus}`)
  if (equipment === 'barbell') return /штанг|гриф/.test(haystack)
  if (equipment === 'dumbbells') return /гантел/.test(haystack)
  if (equipment === 'machine') return /тренаж|блок|кроссовер|смита|гравитрон/.test(haystack)
  if (equipment === 'bodyweight') return /вес тела|планка|отжим|подтяг|брусь/.test(haystack)
  return true
}

export function ExerciseLibraryScreen({ exerciseLibrary }: ExerciseLibraryScreenProps) {
  const [query, setQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState('all')
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all')
  const [selectedExercise, setSelectedExercise] = useState<ExercisePlan | null>(null)

  const muscleGroups = useMemo(() => {
    const groups = Array.from(new Set(exerciseLibrary.map((exercise) => exercise.muscleGroup).filter(Boolean)))
    return groups.sort((a, b) => a.localeCompare(b, 'ru'))
  }, [exerciseLibrary])

  const filteredExercises = useMemo(() => {
    const normalizedQuery = normalize(query)
    return exerciseLibrary.filter((exercise) => {
      const searchText = normalize(`${exercise.name} ${exercise.muscleGroup} ${exercise.instruction}`)
      const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery)
      const matchesMuscle = muscleFilter === 'all' || exercise.muscleGroup === muscleFilter
      return matchesQuery && matchesMuscle && exerciseMatchesEquipment(exercise, equipmentFilter)
    })
  }, [equipmentFilter, exerciseLibrary, muscleFilter, query])

  return (
    <section className="screen active library-screen">
      <div className="top">
        <div>
          <div className="kicker">Библиотека</div>
          <div className="title">Упражнения</div>
        </div>
      </div>

      <div className="card library-controls">
        <label className="field-label">
          <span>Поиск упражнения</span>
          <input
            aria-label="Поиск упражнения"
            type="search"
            value={query}
            placeholder="Жим, тяга, бицепс..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="muted">{countLabel(filteredExercises.length)}</div>
      </div>

      <div className="library-filter-block" aria-label="Фильтр по группе мышц">
        <button
          className={`filter-chip ${muscleFilter === 'all' ? 'active' : ''}`}
          type="button"
          onClick={() => setMuscleFilter('all')}
        >
          Все группы
        </button>
        {muscleGroups.map((group) => (
          <button
            className={`filter-chip ${muscleFilter === group ? 'active' : ''}`}
            key={group}
            type="button"
            onClick={() => setMuscleFilter(group)}
          >
            {group}
          </button>
        ))}
      </div>

      <div className="library-filter-block" aria-label="Фильтр по оборудованию">
        {equipmentFilters.map((filter) => (
          <button
            className={`filter-chip ${equipmentFilter === filter.id ? 'active' : ''}`}
            key={filter.id}
            type="button"
            onClick={() => setEquipmentFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="library-results">
        {filteredExercises.length === 0 ? (
          <div className="card empty-state">
            <b>Ничего не найдено</b>
            <div className="muted">Попробуй другой запрос или сбрось фильтры.</div>
          </div>
        ) : (
          filteredExercises.map((exercise) => (
            <article className="exercise library-exercise-card" key={exercise.id} aria-label={exercise.name}>
              <button
                className="library-exercise-card-button"
                type="button"
                aria-label={`Открыть описание упражнения ${exercise.name}`}
                onClick={() => setSelectedExercise(exercise)}
              >
                <div>
                  <b>{exercise.name}</b>
                  <div className="muted">{exercise.instruction}</div>
                </div>
                <span className="badge">{exercise.muscleGroup}</span>
              </button>
            </article>
          ))
        )}
      </div>

      {selectedExercise && (
        <ExerciseGuideModal exercise={selectedExercise} onClose={() => setSelectedExercise(null)} />
      )}
    </section>
  )
}
