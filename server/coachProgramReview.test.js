import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/llmClient.js', () => ({ requestLlmJsonDetailed: vi.fn() }))
vi.mock('./activityLog.js', () => ({ logLlmOutcome: vi.fn() }))

const { reviewProgram } = await import('./coachProgramReview.js')
const { requestLlmJsonDetailed } = await import('./lib/llmClient.js')

const baseInput = {
  userId: 'oleg',
  history: [],
  programDays: [{ name: 'День A', exercises: [{ name: 'Жим лёжа' }] }],
  coachState: null,
  coachMemory: null,
  profile: { goal: 'сила' },
  now: new Date('2026-07-09T12:00:00Z'),
}

function promptOf() {
  return vi.mocked(requestLlmJsonDetailed).mock.calls[0][0].prompt
}

afterEach(() => {
  vi.clearAllMocks()
})

// Issue #420: недельный агент читает личную модель (#418) и ответы атлета (#419).
describe('reviewProgram: контекст агента (#420)', () => {
  it('кладёт личную модель и ответы атлета в промпт', async () => {
    vi.mocked(requestLlmJsonDetailed).mockResolvedValue({ data: null, truncated: false, reason: 'not_configured' })

    await reviewProgram({
      ...baseInput,
      personalModelNote: 'Личная модель атлета: Жим лёжа −0.40',
      athleteSignalsNote: 'Ответы атлета: Присед — было легко',
    })

    expect(promptOf()).toContain('Личная модель атлета: Жим лёжа −0.40')
    expect(promptOf()).toContain('Ответы атлета: Присед — было легко')
  })

  it('без блоков промпт собирается как раньше', async () => {
    vi.mocked(requestLlmJsonDetailed).mockResolvedValue({ data: null, truncated: false, reason: 'not_configured' })

    await reviewProgram(baseInput)

    expect(promptOf()).not.toContain('Личная модель')
    expect(promptOf()).not.toContain('Ответы атлета')
  })
})
