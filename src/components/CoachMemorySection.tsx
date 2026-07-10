// Фаза 2.5 (план развития): «Память тренера» — управление долгосрочными
// фактами. Пользователь — хозяин памяти: добавляет, правит, архивирует
// (в том числе травмы, которые LLM архивировать не может), подтверждает
// то, что тренер «заметил» сам.
import { useCallback, useEffect, useState } from 'react'
import {
  addMemoryFactToApi,
  fetchMemoryFactsFromApi,
  isProgramApiConfigured,
  patchMemoryFactInApi,
  type CoachMemoryFact,
  type MemoryFactKind,
} from '../data/programApi'

const KIND_LABELS: Record<MemoryFactKind, string> = {
  injury: 'Травма/боль',
  load_response: 'Реакция на нагрузку',
  preference: 'Предпочтение',
  constraint: 'Ограничение',
  milestone: 'Веха',
}

const KIND_ICONS: Record<MemoryFactKind, string> = {
  injury: '⚠',
  load_response: '↺',
  preference: '★',
  constraint: '⛔',
  milestone: '◆',
}

type CoachMemorySectionProps = {
  userId: string
}

export function CoachMemorySection({ userId }: CoachMemorySectionProps) {
  const [facts, setFacts] = useState<CoachMemoryFact[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newKind, setNewKind] = useState<MemoryFactKind>('preference')
  const [newContent, setNewContent] = useState('')

  const reload = useCallback(() => {
    if (!isProgramApiConfigured) return
    fetchMemoryFactsFromApi(userId)
      .then((loadedFacts) => {
        setFacts(loadedFacts)
        setLoaded(true)
        setError(null)
      })
      .catch(() => setError('Не удалось загрузить память тренера'))
  }, [userId])

  useEffect(() => {
    reload()
  }, [reload])

  if (!isProgramApiConfigured) return null

  async function addFact() {
    const content = newContent.trim()
    if (content.length < 3) return
    try {
      setFacts(await addMemoryFactToApi(userId, { kind: newKind, content }))
      setNewContent('')
      setAdding(false)
      setError(null)
    } catch {
      setError('Не удалось сохранить факт')
    }
  }

  async function archiveFact(fact: CoachMemoryFact) {
    try {
      setFacts(await patchMemoryFactInApi(userId, fact.id, { status: 'archived' }))
    } catch {
      setError('Не удалось заархивировать факт')
    }
  }

  async function confirmFact(fact: CoachMemoryFact) {
    try {
      setFacts(await patchMemoryFactInApi(userId, fact.id, { confirm: true }))
    } catch {
      setError('Не удалось подтвердить факт')
    }
  }

  return (
    <div className="card top-gap coach-memory-section">
      <b>Память тренера</b>
      <div className="muted">Что тренер помнит о тебе долгосрочно и учитывает в каждом решении.</div>
      {error && <div className="muted coach-memory-error">{error}</div>}
      {loaded && facts.length === 0 && (
        <div className="muted top-gap">Память пока пуста — тренер начнёт запоминать после тренировок, или добавь факт сам.</div>
      )}
      <ul className="coach-memory-list">
        {facts.map((fact) => (
          <li key={fact.id} className="coach-memory-fact">
            <span className="coach-memory-kind" title={KIND_LABELS[fact.kind]} aria-label={KIND_LABELS[fact.kind]}>
              {KIND_ICONS[fact.kind]}
            </span>
            <span className="coach-memory-content">
              {fact.content}
              {fact.source === 'llm' && (
                <span className="muted coach-memory-source"> — тренер заметил сам</span>
              )}
            </span>
            <span className="coach-memory-actions">
              {fact.source === 'llm' && (
                <button className="secondary compact" onClick={() => confirmFact(fact)} aria-label={`Подтвердить: ${fact.content}`}>
                  верно
                </button>
              )}
              <button className="secondary compact" onClick={() => archiveFact(fact)} aria-label={`Архивировать: ${fact.content}`}>
                убрать
              </button>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="coach-memory-add top-gap">
          <select aria-label="Тип факта" value={newKind} onChange={(event) => setNewKind(event.target.value as MemoryFactKind)}>
            {Object.entries(KIND_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>{label}</option>
            ))}
          </select>
          <textarea
            aria-label="Текст факта"
            value={newContent}
            onChange={(event) => setNewContent(event.target.value)}
            placeholder="Например: правое колено — старая травма, приседания только с малым весом"
          />
          <div className="coach-memory-add-actions">
            <button className="primary compact" onClick={addFact} disabled={newContent.trim().length < 3}>Сохранить</button>
            <button className="secondary compact" onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <button className="secondary compact top-gap" onClick={() => setAdding(true)}>+ Добавить факт</button>
      )}
    </div>
  )
}
