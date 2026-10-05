// Issue #350: итог блока на разгрузочной неделе — что выросло, где застой,
// что меняем. Карточка только показывает готовую сводку с сервера; ошибка
// загрузки не роняет экран прогресса — карточка просто не появляется.

import { useEffect, useState } from 'react'
import type { BlockSummary } from '../../shared/types'
import { fetchBlockSummaryFromApi, isProgramApiConfigured } from '../data/programApi'
import { formatWeight, pluralRu } from '../lib/format'

function formatKg(value: number) {
  return `${formatWeight(value)} кг`
}

export function BlockSummaryView({ summary }: { summary: BlockSummary }) {
  return (
    <div className="card top-gap block-summary-card" data-testid="block-summary">
      <div className="ser" style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
        Итог блока
      </div>
      <div className="muted">{summary.weeks} {pluralRu(summary.weeks, 'неделя', 'недели', 'недель')}</div>

      <div data-testid="block-summary-goal" data-status={summary.goal.status}>
        <b>{summary.goal.title}</b>
        <div className="muted">по факту {formatKg(summary.goal.actual)} из {formatKg(summary.goal.target)}</div>
      </div>

      {summary.gains.length > 0 && (
        <div>
          <div className="muted">Выросло</div>
          {summary.gains.map((gain) => (
            <div key={gain.exerciseId} data-testid="block-summary-gain">
              <b>{gain.exerciseName}</b><span> +{formatKg(gain.delta)}</span>
            </div>
          ))}
        </div>
      )}

      {summary.stalled.length > 0 && (
        <div>
          <div className="muted">Застой</div>
          {summary.stalled.map((item) => (
            <div key={item.exerciseId} data-testid="block-summary-stalled">
              <b>{item.exerciseName}</b>
              <div className="muted">
                {item.weeks} нед без прироста{item.diagnosisNote ? ` · ${item.diagnosisNote}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div data-testid="block-summary-adherence">
        План соблюдён: {summary.adherence.done} из {summary.adherence.planned}
        {summary.adherence.skipped > 0 && <span className="muted"> · пропущено {summary.adherence.skipped}</span>}
      </div>

      <div data-testid="block-summary-next">
        <b>Следующий блок</b>
        {summary.next.goalTitle && <div>{summary.next.goalTitle}</div>}
        <div className="muted">{summary.next.why}</div>
      </div>
    </div>
  )
}

export function BlockSummaryCard({ userId }: { userId?: string }) {
  const [summary, setSummary] = useState<BlockSummary | null>(null)

  useEffect(() => {
    if (!userId || !isProgramApiConfigured) return
    let cancelled = false
    fetchBlockSummaryFromApi(userId)
      .then((result) => { if (!cancelled) setSummary(result) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  if (!summary) return null
  return <BlockSummaryView summary={summary} />
}
