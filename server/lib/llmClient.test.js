import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestLlmJson, requestLlmJsonDetailed, requestLlmText, requestLlmTextDetailed, resolveLlmModel, isLlmConfigured } from './llmClient.ts'

function okResponse(content, usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], usage }),
  }
}

function responseWithFinish(content, finishReason) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  }
}

// Issue #412: headers resolve immediately but the body arrives after delayMs;
// an abort before that rejects json() — mirroring fetch (undici) in Node.
function slowBodyFetch(delayMs, content = '{"a":1}') {
  return vi.fn(async (_url, init) => ({
    ok: true,
    json: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ choices: [{ message: { content } }] }), delayMs)
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('This operation was aborted', 'AbortError'))
        })
      }),
  }))
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

    // Issue #412: the timeout must cover reading the body, not just headers.
    it('aborts reading the body on timeout, not just the headers', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.stubGlobal('fetch', slowBodyFetch(200))
      const result = await requestLlmJson({ tier: 'fast', system: 's', prompt: 'p', caller: 'test', timeoutMs: 50 })
      expect(result).toBeNull()
      const event = logSpy.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.startsWith('TRAINER_EVENT '))
        .map((line) => JSON.parse(line.slice('TRAINER_EVENT '.length)))
        .find((body) => body.event === 'llm.call')
      expect(event).toBeDefined()
      expect(event.ok).toBe(false)
      expect(event.error).toMatch(/abort/i)
    })

    it('reads a fast body within the timeout', async () => {
      vi.stubGlobal('fetch', slowBodyFetch(10))
      const result = await requestLlmJson({ tier: 'fast', system: 's', prompt: 'p', caller: 'test', timeoutMs: 500 })
      expect(result).toEqual({ a: 1 })
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

  describe('requestLlmJsonDetailed', () => {
    it('reports truncated=true and reason=truncated when finish_reason is length', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithFinish('{"a":1}', 'length')))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: { a: 1 }, truncated: true, reason: 'truncated' })
    })

    it('reports truncated=false and reason=null when finish_reason is stop', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithFinish('{"a":1}', 'stop')))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: { a: 1 }, truncated: false, reason: null })
    })

    it('reports truncated=false and reason=null when finish_reason is absent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"a":1}')))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: { a: 1 }, truncated: false, reason: null })
    })

    // Issue #426: closed set of failure reasons surfaced to callers.
    it('reason=not_configured without an API key and does not fetch', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      vi.stubEnv('LLM_API_KEY', '')
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: null, truncated: false, reason: 'not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reason=empty when the model returns no content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('')))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: null, truncated: false, reason: 'empty' })
    })

    it('reason=invalid_json when the content is not parseable JSON', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('not json at all')))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: null, truncated: false, reason: 'invalid_json' })
    })

    it('reason=http_error on a non-ok response', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: null, truncated: false, reason: 'http_error' })
    })

    it('reason=timeout when the request aborts', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
      const result = await requestLlmJsonDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ data: null, truncated: false, reason: 'timeout' })
    })

    it('logs truncated and maxTokens in the llm.call activity event', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithFinish('{"a":1}', 'length')))
      await requestLlmJsonDetailed({ tier: 'smart', system: 's', prompt: 'p', caller: 'test', maxTokens: 6000 })
      const event = logSpy.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.startsWith('TRAINER_EVENT '))
        .map((line) => JSON.parse(line.slice('TRAINER_EVENT '.length)))
        .find((body) => body.event === 'llm.call')
      expect(event).toBeDefined()
      expect(event.truncated).toBe(true)
      expect(event.maxTokens).toBe(6000)
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

  describe('requestLlmTextDetailed', () => {
    it('returns trimmed text and reason=null on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('  Привет, тренер!  ')))
      const result = await requestLlmTextDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ content: 'Привет, тренер!', reason: null })
    })

    it('reason=empty when the model returns blank content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('   ')))
      const result = await requestLlmTextDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ content: null, reason: 'empty' })
    })

    it('reason=not_configured without an API key', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      vi.stubEnv('LLM_API_KEY', '')
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const result = await requestLlmTextDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ content: null, reason: 'not_configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reason=http_error on a non-ok response', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      const result = await requestLlmTextDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ content: null, reason: 'http_error' })
    })

    it('reason=timeout when the request aborts', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
      const result = await requestLlmTextDetailed({ tier: 'fast', system: 's', prompt: 'p', caller: 'test' })
      expect(result).toEqual({ content: null, reason: 'timeout' })
    })
  })
})
