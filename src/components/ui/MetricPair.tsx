import type { ReactNode } from 'react'

type Metric = {
  label: string
  value: string | ReactNode
  trend?: string
}

type MetricPairProps = {
  metrics: [Metric, Metric]
}

export function MetricPair({ metrics }: MetricPairProps) {
  return (
    <div className="metric-pair">
      {metrics.map((metric, index) => (
        <div className="metric-card" key={`${metric.label}-${index}`}>
          <span>{metric.label}</span>
          {typeof metric.value === 'string'
            ? <b>{metric.value}</b>
            : <b>{metric.value}</b>}
          {metric.trend && <small>{metric.trend}</small>}
        </div>
      ))}
    </div>
  )
}
