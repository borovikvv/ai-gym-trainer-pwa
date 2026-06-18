export function buildCoachDecisionLogEntry({
  userId,
  sessionId = null,
  decisionType,
  source,
  inputs = {},
  decision = {},
}) {
  const coachState = inputs.coachState ?? {}
  return {
    userId,
    sessionId,
    decisionType,
    source,
    createdAt: new Date().toISOString(),
    inputSummary: {
      readinessScore: coachState.readinessScore ?? null,
      recoveryStatus: coachState.recoveryStatus ?? null,
      weeklyLoadStatus: coachState.weeklyLoadStatus ?? null,
      painWarnings: Array.isArray(coachState.warnings)
        ? coachState.warnings.filter((item) => String(item).includes('боль'))
        : [],
    },
    decisionSummary: String(decision.summary ?? '').slice(0, 500),
    payload: sanitizePayload({ inputs, decision }),
  }
}

export async function storeCoachDecisionLog(client, entry) {
  await client.query(
    `insert into public.recommendations (user_id, session_id, recommendation_type, title, body, source)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      entry.userId,
      entry.sessionId,
      'coach_decision_log',
      titleForDecision(entry.decisionType),
      JSON.stringify(entry.payload ?? entry),
      entry.source ?? 'rules',
    ],
  )
}

function titleForDecision(decisionType) {
  if (decisionType === 'live_strategy') return 'Решение тренера во время тренировки'
  if (decisionType === 'post_workout_plan') return 'Решение тренера после тренировки'
  return 'Решение тренера'
}

function sanitizePayload(value) {
  return JSON.parse(JSON.stringify(value, (key, nestedValue) => {
    if (/api[_-]?key|token|authorization|secret/i.test(key)) return '[redacted]'
    return nestedValue
  }))
}
