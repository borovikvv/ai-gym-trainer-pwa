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
}

type GoalsCardProps = {
  userId: string
  exerciseOptions: GoalExerciseOption[]
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
  const achievedGoals = goals.filter((goal) => goal.status === 'achieved')

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
      <div className="card top-gap goals-card">
        <b>Цели</b>
        <div className="muted">Поставь цель — тренер построит путь к ней и будет отслеживать прогресс каждую неделю.</div>
        <button className="secondary compact top-gap" onClick={() => setAdding(true)}>+ Поставить цель</button>
      </div>
    )
  }

  return (
    <div className="card top-gap goals-card">
      <b>Цели</b>
      {error && <div className="muted">{error}</div>}
      <ul className="goals-list">
        {activeGoals.map((goal) => (
          <li key={goal.id} className="goal-item">
            <div className="goal-title-row">
              <span className="goal-title">{goal.title}</span>
              <button className="secondary compact" onClick={() => dropGoal(goal)} aria-label={`Убрать цель ${goal.title}`}>убрать</button>
            </div>
            <div className="muted goal-meta">
              {goal.targetDate ? `к ${goal.targetDate}` : 'без срока'}
              {goal.progressNote ? ` · ${goal.progressNote}` : ' · тренер оценит прогресс после ближайших тренировок'}
            </div>
          </li>
        ))}
        {achievedGoals.map((goal) => (
          <li key={goal.id} className="goal-item goal-achieved">
            <div className="goal-title-row">
              <span className="goal-title">✓ {goal.title}</span>
            </div>
            {goal.progressNote && <div className="muted goal-meta">{goal.progressNote}</div>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="goal-add top-gap">
          <select aria-label="Упражнение цели" value={draftExerciseId} onChange={(event) => setDraftExerciseId(event.target.value)}>
            <option value="">Упражнение (для e1RM-цели)</option>
            {exerciseOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
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
              className="primary compact"
              onClick={addGoal}
              disabled={draftTitle.trim().length < 3 && !(draftExerciseId && Number(draftTarget.replace(',', '.')) > 0)}
            >
              Сохранить цель
            </button>
            <button className="secondary compact" onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <button className="secondary compact top-gap" onClick={() => setAdding(true)}>+ Поставить цель</button>
      )}
    </div>
  )
}
