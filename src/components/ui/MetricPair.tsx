type Metric = {
  label: string
  value: string
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
          <b>{metric.value}</b>
          {metric.trend && <small>{metric.trend}</small>}
        </div>
      ))}
    </div>
  )
}
