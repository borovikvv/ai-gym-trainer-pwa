// Unified LLM client (plan: Фаза 0). Single place for OpenAI-compatible
// chat/completions calls (OpenRouter in production) with per-task model tiers,
// consistent AbortController timeouts and usage logging.
//
// Tiers map to env vars so each task can run on the most cost-effective model:
//   fast  → LLM_MODEL_FAST  (per-set advisor, narrator)
//   mid   → LLM_MODEL_MID   (post-workout planning, memory reflection)
//   smart → LLM_MODEL_SMART (weekly program review, progress analysis)
// Every tier falls back to OPENAI_MODEL || LLM_MODEL || 'gpt-4o-mini', so an
// existing single-model deployment keeps working with zero config changes.
import { logActivity } from '../activityLog.js'

export type LlmTier = 'fast' | 'mid' | 'smart'

export interface LlmRequestOptions {
  tier: LlmTier
  system: string
  prompt: string
  /** Identifies the call site in llm.call activity logs, e.g. 'coachNarrator'. */
  caller: string
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
}

interface LlmResponseBody {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const DEFAULT_TIMEOUT_MS: Record<LlmTier, number> = {
  fast: 6000,
  mid: 8000,
  smart: 12000,
}

function baseModel(): string {
  return process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
}

export function resolveLlmModel(tier: LlmTier): string {
  switch (tier) {
    case 'fast':
      return process.env.LLM_MODEL_FAST || baseModel()
    case 'mid':
      return process.env.LLM_MODEL_MID || baseModel()
    case 'smart':
      return process.env.LLM_MODEL_SMART || baseModel()
  }
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY)
}

/**
 * Request a plain-text completion. Returns null when the LLM is not
 * configured, times out, errors, or returns an empty message — callers keep
 * their rules fallback.
 */
export async function requestLlmText(options: LlmRequestOptions): Promise<string | null> {
  const content = await requestLlmContent(options, false)
  const trimmed = content?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Request a JSON completion (response_format: json_object). Returns the parsed
 * object or null on any failure — never throws, so callers keep their rules
 * fallback.
 */
export async function requestLlmJson<T = unknown>(options: LlmRequestOptions): Promise<T | null> {
  const content = await requestLlmContent(options, true)
  if (!content) return null
  try {
    return JSON.parse(content) as T
  } catch {
    logActivity('llm.call', { caller: options.caller, tier: options.tier, ok: false, error: 'invalid_json' })
    return null
  }
}

async function requestLlmContent(options: LlmRequestOptions, json: boolean): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = resolveLlmModel(options.tier)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[options.tier]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.prompt },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const body = (await response.json()) as LlmResponseBody
    const content = body?.choices?.[0]?.message?.content
    logActivity('llm.call', {
      caller: options.caller,
      tier: options.tier,
      model,
      promptTokens: body?.usage?.prompt_tokens ?? null,
      completionTokens: body?.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - startedAt,
      ok: Boolean(content),
    })
    return content ?? null
  } catch (error) {
    clearTimeout(timeout)
    logActivity('llm.call', {
      caller: options.caller,
      tier: options.tier,
      model,
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    console.warn(`${options.caller} LLM failed:`, error instanceof Error ? error.message : error)
    return null
  }
}
