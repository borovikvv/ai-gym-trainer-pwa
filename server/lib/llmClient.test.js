import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestLlmJson, requestLlmText, resolveLlmModel, isLlmConfigured } from './llmClient.ts'

function okResponse(content, usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], usage }),
  }
}

describe('llmClient', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_MODEL', '')
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('LLM_MODEL_FAST', '')
    vi.stubEnv('LLM_MODEL_MID', '')
    vi.stubEnv('LLM_MODEL_SMART', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('resolveLlmModel', () => {
    it('falls back to gpt-4o-mini with no config', () => {
      expect(resolveLlmModel('fast')).toBe('gpt-4o-mini')
      expect(resolveLlmModel('mid')).toBe('gpt-4o-mini')
      expect(resolveLlmModel('smart')).toBe('gpt-4o-mini')
    })

    it('uses OPENAI_MODEL as base fallback for all tiers', () => {
      vi.stubEnv('OPENAI_MODEL', 'custom-model')
      expect(resolveLlmModel('fast')).toBe('custom-model')
      expect(resolveLlmModel('smart')).toBe('custom-model')
    })

    it('uses tier-specific env vars when set', () => {
      vi.stubEnv('OPENAI_MODEL', 'base-model')
      vi.stubEnv('LLM_MODEL_FAST', 'fast-model')
      vi.stubEnv('LLM_MODEL_SMART', 'smart-model')
      expect(resolveLlmModel('fast')).toBe('fast-model')
      expect(resolveLlmModel('mid')).toBe('base-model')
      expect(resolveLlmModel('smart')).toBe('smart-model')
    })
  })

  describe('isLlmConfigured', () => {
    it('true when OPENAI_API_KEY is set', () => {
      expect(isLlmConfigured()).toBe(true)
    })

    it('false without any API key', () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      vi.stubEnv('LLM_API_KEY', '')
      expect(isLlmConfigured()).toBe(false)
    })
  })

  describe('requestLlmJson', () => {
    it('returns parsed JSON on success', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('{"answer": 42}'))
      vi.stubGlobal('fetch', fetchMock)
      const result = await requestLlmJson({ tier: 'fast', system: 'sys', prompt: 'hi', caller: 'test' })
      expect(result).toEqual({ answer: 42 })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    })

    it('returns null without API key and does not fetch', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      vi.stubEnv('LLM_API_KEY', '')
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      expect(await requestLlmJson({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns null on malformed JSON content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('not json')))
      expect(await requestLlmJson({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })).toBeNull()
    })

    it('returns null on HTTP error', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      expect(await requestLlmJson({ tier: 'mid', system: 's', prompt: 'p', caller: 'test' })).toBeNull()
    })

    it('returns null on network failure/timeout abort', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
      expect(await requestLlmJson({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })).toBeNull()
    })

    it('sends tier-resolved model, temperature and max_tokens', async () => {
      vi.stubEnv('LLM_MODEL_SMART', 'smart-model')
      const fetchMock = vi.fn().mockResolvedValue(okResponse('{}'))
      vi.stubGlobal('fetch', fetchMock)
      await requestLlmJson({ tier: 'smart', system: 's', prompt: 'p', caller: 'test', temperature: 0.3, maxTokens: 500 })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.model).toBe('smart-model')
      expect(body.temperature).toBe(0.3)
      expect(body.max_tokens).toBe(500)
    })
  })

  describe('requestLlmText', () => {
    it('returns trimmed text without response_format', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('  Привет, тренер!  '))
      vi.stubGlobal('fetch', fetchMock)
      const result = await requestLlmText({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toBe('Привет, тренер!')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.response_format).toBeUndefined()
    })

    it('returns null on empty content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('   ')))
      expect(await requestLlmText({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })).toBeNull()
    })
  })
})
