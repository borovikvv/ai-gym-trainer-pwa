// Issue #350: итог блока на разгрузочной неделе — что выросло, где застой,
// что меняем. Карточка только показывает готовую сводку с сервера; ошибка
// загрузки не роняет экран прогресса — карточка просто не появляется.

import { useEffect, useState } from 'react'
import type { BlockSummary } from '../../shared/types'
import { fetchBlockSummaryFromApi, isProgramApiConfigured } from '../data/programApi'
import { formatWeight, pluralRu } from '../lib/format'
import { SectionList } from './ui'

function formatKg(value: number) {
  return `${formatWeight(value)} кг`
}

export function BlockSummaryView({ summary }: { summary: BlockSummary }) {
  const goalDot = summary.goal.status === 'achieved' ? 'review-card__dot--low' : 'review-card__dot--medium'

  return (
    <SectionList title="Итог блока">
      <div className="review-card block-summary-card" data-testid="block-summary">
        <div className="muted block-summary-card__subtitle">
          {summary.weeks} {pluralRu(summary.weeks, 'неделя', 'недели', 'недель')}
        </div>

        <div
          className="review-card__row review-card__row--static"
          data-testid="block-summary-goal"
          data-status={summary.goal.status}
        >
          <span className={`review-card__dot ${goalDot}`} aria-hidden="true" />
          <div className="review-card__body">
            <div className="review-card__title">{summary.goal.title}</div>
            <div className="review-card__meta">
              по факту {formatKg(summary.goal.actual)} из {formatKg(summary.goal.target)}
            </div>
          </div>
        </div>

        {summary.gains.length > 0 && (
          <div>
            <div className="block-summary-card__group-label">Выросло</div>
            {summary.gains.map((gain) => (
              <div
                key={gain.exerciseId}
                className="review-card__row review-card__row--static"
                data-testid="block-summary-gain"
              >
                <span className="review-card__dot review-card__dot--low" aria-hidden="true" />
                <div className="review-card__body">
                  <div className="review-card__title">{gain.exerciseName}</div>
                </div>
                <span className="review-card__value review-card__value--success">+{formatKg(gain.delta)}</span>
              </div>
            ))}
          </div>
        )}

        {summary.stalled.length > 0 && (
          <div>
            <div className="block-summary-card__group-label">Застой</div>
            {summary.stalled.map((item) => (
              <div
                key={item.exerciseId}
                className="review-card__row review-card__row--static"
                data-testid="block-summary-stalled"
              >
                <span className="review-card__dot review-card__dot--medium" aria-hidden="true" />
                <div className="review-card__body">
                  <div className="review-card__title">{item.exerciseName}</div>
                  <div className="review-card__meta">
                    {item.weeks} нед без прироста{item.diagnosisNote ? ` · ${item.diagnosisNote}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="review-card__row review-card__row--static" data-testid="block-summary-adherence">
          <div className="review-card__body">
            <div className="review-card__title">Соблюдение плана</div>
            {summary.adherence.skipped > 0 && (
              <div className="review-card__meta">пропущено {summary.adherence.skipped}</div>
            )}
          </div>
          <div className="review-card__value">
            {summary.adherence.done} из {summary.adherence.planned}
          </div>
        </div>

        <div className="review-card__row review-card__row--static" data-testid="block-summary-next">
          <div className="review-card__body">
            <div className="review-card__title">Следующий блок</div>
            {summary.next.goalTitle && <div className="review-card__meta">{summary.next.goalTitle}</div>}
            <div className="review-card__meta">{summary.next.why}</div>
          </div>
        </div>
      </div>
    </SectionList>
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
