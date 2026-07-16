import { useMemo, useState } from 'react'
import type { ExercisePlan  } from '../../shared/types'
import { ExerciseGuideModal } from './ExerciseGuideModal'

type ExerciseLibraryScreenProps = {
  exerciseLibrary: ExercisePlan[]
}

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

// Группировка конкретных групп мышц в основные категории
const MUSCLE_GROUP_MAP: Record<string, string> = {
  'Грудь': 'Грудь',
  'Грудь/плечи': 'Грудь',
  'Спина': 'Спина',
  'Ноги': 'Ноги',
  'Ноги · квадрицепс': 'Ноги',
  'Ноги/ягодицы': 'Ноги',
  'Задняя поверхность бедра': 'Ноги',
  'Ягодицы/задняя цепь': 'Ноги',
  'Икры': 'Ноги',
  'Плечи': 'Плечи',
  'Плечи · задняя дельта': 'Плечи',
  'Плечи · средняя дельта': 'Плечи',
  'Задняя дельта': 'Плечи',
  'Руки': 'Руки',
  'Руки · бицепс': 'Руки',
  'Руки · трицепс': 'Руки',
  'Руки · трицепс / Грудь': 'Руки',
  'Кор': 'Кор',
  'Пресс': 'Кор',
}

function simplifyMuscleGroup(group: string | undefined): string {
  return MUSCLE_GROUP_MAP[group ?? ''] || group || 'Другое'
}

export function ExerciseLibraryScreen({ exerciseLibrary }: ExerciseLibraryScreenProps) {
  const [query, setQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState('all')
  const [selectedExercise, setSelectedExercise] = useState<ExercisePlan | null>(null)

  const muscleGroups = useMemo(() => {
    const groups = Array.from(new Set(exerciseLibrary.map((e) => simplifyMuscleGroup(e.muscleGroup)).filter(Boolean)))
    return groups.sort((a, b) => a.localeCompare(b, 'ru'))
  }, [exerciseLibrary])

  const filteredExercises = useMemo(() => {
    const normalizedQuery = normalize(query)
    return exerciseLibrary.filter((exercise) => {
      const searchText = normalize(`${exercise.name} ${exercise.muscleGroup} ${exercise.instruction}`)
      const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery)
      const matchesMuscle = muscleFilter === 'all' || simplifyMuscleGroup(exercise.muscleGroup) === muscleFilter
      return matchesQuery && matchesMuscle
    })
  }, [exerciseLibrary, muscleFilter, query])

  return (
    <section className="screen active library-screen">
      <div className="library-screen__header">
        <div className="library-screen__title">Библиотека</div>
        <input
          className="library-screen__search"
          aria-label="Поиск упражнения"
          type="search"
          value={query}
          placeholder="Поиск упражнения..."
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="library-screen__filters">
        <button className={`lib-pill ${muscleFilter === 'all' ? 'lib-pill--active' : ''}`} onClick={() => setMuscleFilter('all')}>Все</button>
        {muscleGroups.map((group) => (
          <button
            key={group}
            className={`lib-pill ${muscleFilter === group ? 'lib-pill--active' : ''}`}
            onClick={() => setMuscleFilter(group)}
          >
            {group}
          </button>
        ))}
      </div>

      <div className="library-screen__count">{countLabel(filteredExercises.length)}</div>

      <div className="library-screen__list">
        {filteredExercises.length === 0 ? (
          <div className="muted" style={{ padding: '1rem 0', textAlign: 'center' }}>Ничего не найдено</div>
        ) : (
          filteredExercises.map((exercise) => (
            <button key={exercise.id} className="library-screen__row" type="button" onClick={() => setSelectedExercise(exercise)} aria-label={`Открыть ${exercise.name}`}>
              <b className="library-screen__row-name">{exercise.name}</b>
              <span className="library-screen__row-group">{exercise.muscleGroup}</span>
              <span className="library-screen__row-arrow" aria-hidden="true">›</span>
            </button>
          ))
        )}
      </div>

      {selectedExercise && (
        <ExerciseGuideModal exercise={selectedExercise} onClose={() => setSelectedExercise(null)} />
      )}
    </section>
  )
}
