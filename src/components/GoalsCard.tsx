// Фаза 2.5 (план развития): карточка «Цели» на главной — многонедельные цели,
// к которым тренер ведёт через макроцикл. Прогресс-заметка обновляется
// недельным обзором по фактическим трендам e1RM.
import { useCallback, useEffect, useState } from 'react'
import {
  addGoalToApi,
  fetchGoalsFromApi,
  isProgramApiConfigured,
  patchGoalInApi,
  type CoachGoal,
} from '../data/programApi'

type GoalExerciseOption = {
  id: string
  name: string
  muscleGroup?: string
}

type GoalsCardProps = {
  userId: string
  exerciseOptions: GoalExerciseOption[]
}

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function humanDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`
  } catch {
    return dateStr
  }
}

function shortNote(note: string | null | undefined): string {
  if (!note) return ''
  // Классифицируем AI-прогресс в короткий статус для пользователя
  if (note.includes('цель достигнута')) return 'достигнуто'
  if (note.includes('отстаём') || note.includes('срок прошёл')) return 'отстаём'
  if (note.includes('в графике') || note.includes('опережаем')) return 'по плану'
  if (note.startsWith('e1RM')) return 'по плану'
  return note.length > 40 ? note.slice(0, 40) + '…' : note
}

export function GoalsCard({ userId, exerciseOptions }: GoalsCardProps) {
  const [goals, setGoals] = useState<CoachGoal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftExerciseId, setDraftExerciseId] = useState('')
  const [draftTarget, setDraftTarget] = useState('')
  const [draftDate, setDraftDate] = useState('')

  const reload = useCallback(() => {
    if (!isProgramApiConfigured) return
    fetchGoalsFromApi(userId, 'all')
      .then((loadedGoals) => {
        setGoals(loadedGoals)
        setError(null)
      })
      .catch(() => setError('Не удалось загрузить цели'))
  }, [userId])

  useEffect(() => {
    reload()
  }, [reload])

  if (!isProgramApiConfigured) return null

  const activeGoals = goals.filter((goal) => goal.status === 'active')

  async function addGoal() {
    const exercise = exerciseOptions.find((option) => option.id === draftExerciseId)
    const targetValue = Number(draftTarget.replace(',', '.'))
    const title = draftTitle.trim() || (exercise && Number.isFinite(targetValue) && targetValue > 0
      ? `${exercise.name} ${targetValue} кг`
      : '')
    if (title.length < 3) return
    try {
      setGoals(await addGoalToApi(userId, {
        title,
        metric: 'e1rm',
        exerciseId: draftExerciseId || null,
        targetValue: Number.isFinite(targetValue) && targetValue > 0 ? targetValue : null,
        targetDate: draftDate || null,
      }))
      setAdding(false)
      setDraftTitle('')
      setDraftExerciseId('')
      setDraftTarget('')
      setDraftDate('')
      setError(null)
    } catch {
      setError('Не удалось сохранить цель')
    }
  }

  async function dropGoal(goal: CoachGoal) {
    try {
      setGoals(await patchGoalInApi(userId, goal.id, { status: 'dropped' }))
    } catch {
      setError('Не удалось убрать цель')
    }
  }

  if (!adding && goals.length === 0 && !error) {
    return (
      <div className="goals-section">
        <div className="goals-header">
          <h2 className="goals-title">Цели</h2>
        </div>
        <div className="goals-empty">
          <p className="muted">Поставь цель — тренер построит путь к ней и будет отслеживать прогресс каждую неделю.</p>
          <button className="goals-add-btn" onClick={() => setAdding(true)}>+ Поставить цель</button>
        </div>
      </div>
    )
  }

  return (
    <div className="goals-section">
      <div className="goals-header">
        <h2 className="goals-title">Цели</h2>
        {!adding && (
          <button className="goals-header-add" onClick={() => setAdding(true)}>+ Поставить</button>
        )}
      </div>

      {error && <p className="muted">{error}</p>}

      {activeGoals.length > 0 && (
        <div className="goals-list">
          {activeGoals.map((goal) => (
            <div key={goal.id} className="goal-card">
              <div className="goal-card__body">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="goal-card__icon" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="12" cy="12" r="0.6" fill="var(--accent)" />
                </svg>
                <div className="goal-card__info">
                  <div className="goal-card__title">{goal.title}</div>
                  <div className="goal-card__meta">
                    {goal.targetDate ? `к ${humanDate(goal.targetDate)}` : ''}
                    {goal.progressNote ? ` · ${shortNote(goal.progressNote)}` : ''}
                  </div>
                </div>
                <button className="goal-card__remove" onClick={() => dropGoal(goal)} aria-label={`Убрать цель ${goal.title}`}>убрать</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="goal-add">
          <select aria-label="Упражнение цели" value={draftExerciseId} onChange={(event) => setDraftExerciseId(event.target.value)}>
            <option value="">Упражнение (для e1RM-цели)</option>
            {groupByMuscle(exerciseOptions).map(([muscleGroup, options]) => (
              <optgroup key={muscleGroup} label={muscleGroup}>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            aria-label="Целевой вес"
            inputMode="decimal"
            placeholder="Целевой вес, кг (например 80)"
            value={draftTarget}
            onChange={(event) => setDraftTarget(event.target.value)}
          />
          <input
            aria-label="Срок цели"
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
          />
          <input
            aria-label="Название цели"
            placeholder="Название (необязательно — соберётся само)"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
          />
          <div className="goal-add-actions">
            <button
              className="primary compact-action"
              onClick={addGoal}
              disabled={draftTitle.trim().length < 3 && !(draftExerciseId && Number(draftTarget.replace(',', '.')) > 0)}
            >
              Сохранить цель
            </button>
            <button className="secondary compact" onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function groupByMuscle(options: GoalExerciseOption[]): Array<[string, GoalExerciseOption[]]> {
  const groups = new Map<string, GoalExerciseOption[]>()
  for (const option of options) {
    const key = option.muscleGroup ?? 'Другое'
    const list = groups.get(key) ?? []
    list.push(option)
    groups.set(key, list)
  }
  return [...groups.entries()]
}
