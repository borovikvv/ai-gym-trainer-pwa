// Issue #66 (#36 decomposition): all `any` replaced with concrete types.
import type { CoachState } from '../shared/types.js'

interface BuildCoachDecisionLogEntryInput {
  userId: string
  sessionId?: string | null
  decisionType: string
  source: string
  inputs?: { coachState?: CoachState | Partial<CoachState> | null }
  // Issue #66: decision accepts any structured plan (SafeCoachPlan,
  // CoachDecision, LiveStrategyDecision). Kept as unknown to avoid coupling
  // this log module to the specific decision interfaces. The buildCoachDecisionLogEntry
  // only reads decision.summary.
  decision?: { summary?: string } | Record<string, unknown> | null
}

interface CoachDecisionLogEntry {
  userId: string
  sessionId: string | null
  decisionType: string
  source: string
  createdAt: string
  inputSummary: {
    readinessScore: number | null
    recoveryStatus: string | null
    weeklyLoadStatus: string | null
    painWarnings: string[]
  }
  decisionSummary: string
  payload: unknown
}

interface DbClient {
  query: (text: string, params: unknown[]) => Promise<unknown>
}

export function buildCoachDecisionLogEntry({
  userId,
  sessionId = null,
  decisionType,
  source,
  inputs = {},
  decision = {},
}: BuildCoachDecisionLogEntryInput): CoachDecisionLogEntry {
  const coachState = inputs.coachState ?? {}
  return {
    userId,
    sessionId,
    decisionType,
    source,
    createdAt: new Date().toISOString(),
    inputSummary: {
      readinessScore: (coachState as { readinessScore?: number }).readinessScore ?? null,
      recoveryStatus: (coachState as { recoveryStatus?: string }).recoveryStatus ?? null,
      weeklyLoadStatus: (coachState as { weeklyLoadStatus?: string }).weeklyLoadStatus ?? null,
      painWarnings: Array.isArray((coachState as { warnings?: unknown[] }).warnings)
        ? ((coachState as { warnings: string[] }).warnings).filter((item) => String(item).includes('боль'))
        : [],
    },
    decisionSummary: String((decision as { summary?: string }).summary ?? '').slice(0, 500),
    payload: sanitizePayload({ inputs, decision }),
  }
}

export async function storeCoachDecisionLog(client: DbClient, entry: CoachDecisionLogEntry): Promise<void> {
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

function titleForDecision(decisionType: string): string {
  if (decisionType === 'live_strategy') return 'Решение тренера во время тренировки'
  if (decisionType === 'post_workout_plan') return 'Решение тренера после тренировки'
  return 'Решение тренера'
}

function sanitizePayload(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, nestedValue) => {
    if (/api[_-]?key|token|authorization|secret/i.test(key)) return '[redacted]'
    return nestedValue
  }))
}
