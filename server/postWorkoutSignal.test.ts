import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Паттерн как в server/coachSetAdvisor.test.js: мок модуля llmClient, чтобы не
// ходить в сеть и явно задавать исход разбора.
vi.mock('./lib/llmClient.ts', () => ({
  requestLlmJson: vi.fn(),
}))

import { buildPostWorkoutSignal } from './postWorkoutSignal.ts'
import { requestLlmJson } from './lib/llmClient.ts'

const mockedRequestLlmJson = vi.mocked(requestLlmJson)

const INPUT = {
  exerciseId: 'bench-press',
  exerciseName: 'Жим лёжа',
  assignedWeight: 77.5,
  actualWeight: 80,
  deviation: 2.5,
  responseText: 'было легко, взял побольше',
}

describe('buildPostWorkoutSignal (#419)', () => {
  beforeEach(() => {
    mockedRequestLlmJson.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('null на входе → null, LLM не вызывается', async () => {
    const result = await buildPostWorkoutSignal(null)

    expect(result).toBeNull()
    expect(mockedRequestLlmJson).not.toHaveBeenCalled()
  })

  it('ответ из одних пробелов → null, LLM не вызывается', async () => {
    const result = await buildPostWorkoutSignal({ ...INPUT, responseText: '   ' })

    expect(result).toBeNull()
    expect(mockedRequestLlmJson).not.toHaveBeenCalled()
  })

  it('разбор «легко» → тип easy и источник athlete_response', async () => {
    mockedRequestLlmJson.mockResolvedValue({ type: 'easy', confidence: 0.8 })

    const result = await buildPostWorkoutSignal(INPUT)

    expect(result?.signalType).toBe('easy')
    expect(result?.source).toBe('athlete_response')
    expect(result?.confidence).toBe(0.8)
    expect(result?.trigger.exerciseId).toBe('bench-press')
    expect(result?.trigger.actualWeight).toBe(80)
    expect(result?.parsedAt).not.toBeNull()
  })

  it('регресс #246: сбой LLM → служебный «unparsed», текст ответа сохранён как есть', async () => {
    mockedRequestLlmJson.mockResolvedValue(null)

    const result = await buildPostWorkoutSignal(INPUT)

    expect(result?.signalType).toBe('unparsed')
    expect(result?.confidence).toBeNull()
    expect(result?.parsedAt).toBeNull()
    expect(result?.responseText).toBe(INPUT.responseText)
    expect(result?.trigger.actualWeight).toBe(80)
  })

  it('неизвестный тип от LLM → служебный «unparsed»', async () => {
    mockedRequestLlmJson.mockResolvedValue({ type: 'нечто', confidence: 0.5 })

    const result = await buildPostWorkoutSignal(INPUT)

    expect(result?.signalType).toBe('unparsed')
  })
})
