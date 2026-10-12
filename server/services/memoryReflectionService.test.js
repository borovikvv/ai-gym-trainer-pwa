import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMemoryReflection } from './memoryReflectionService.js'

function llmOutcomes(logSpy) {
  return logSpy.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.startsWith('TRAINER_EVENT '))
    .map((line) => JSON.parse(line.slice('TRAINER_EVENT '.length)))
    .filter((body) => body.event === 'llm.outcome')
}

const ENTRY = {
  userId: 'vyacheslav',
  exercises: [
    { exerciseId: 'bench-press', exerciseName: 'Жим лёжа', sets: [{ weight: 60, reps: 8, rpe: 7, completed: true }] },
  ],
  totalVolume: 480,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('memoryReflectionService — issue #426 outcomes', () => {
  it('fallback/not_configured when the LLM is not configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await runMemoryReflection({ client, entry: ENTRY })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(llmOutcomes(logSpy)).toEqual([
      expect.objectContaining({ caller: 'memoryReflectionService', outcome: 'fallback', reason: 'not_configured' }),
    ])
  })

  it('ok/null when the LLM returns an empty operation list (valid decision to change nothing)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://llm.example/v1')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ factOperations: [], goalNotes: [] }) } }],
      }),
    }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await runMemoryReflection({ client, entry: ENTRY })

    expect(llmOutcomes(logSpy)).toEqual([
      expect.objectContaining({ caller: 'memoryReflectionService', outcome: 'ok', reason: null }),
    ])
  })

  it('does not log an outcome when there is no userId', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await runMemoryReflection({ client, entry: { ...ENTRY, userId: '' } })

    expect(llmOutcomes(logSpy)).toEqual([])
  })
})
