import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyMemoryUpdates,
  formatLongTermMemoryForPrompt,
  MAX_ACTIVE_FACTS,
} from './coachLongTermMemory.ts'

function makeFact(overrides = {}) {
  return {
    id: overrides.id ?? `fact-${Math.random().toString(36).slice(2, 8)}`,
    userId: 'vyacheslav',
    kind: 'preference',
    content: 'Любит базовые упражнения со штангой',
    status: 'active',
    source: 'llm',
    confidence: 0.8,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

function makeGoal(overrides = {}) {
  return {
    id: 'goal-1',
    userId: 'vyacheslav',
    title: 'Жим лёжа 80 кг × 1',
    exerciseId: 'bench-press',
    metric: 'e1rm',
    targetValue: 80,
    targetDate: '2026-09-01',
    status: 'active',
    progressNote: 'e1RM 72.5 кг, идём по графику',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

// Fake DB client: db rows live in `facts`, queries are pattern-matched.
function makeFakeClient(facts = []) {
  return {
    facts,
    query: vi.fn(async function (sql, params) {
      if (sql.includes('select id, user_id, kind')) {
        return { rows: facts.map((f) => ({
          id: f.id, user_id: f.userId, kind: f.kind, content: f.content,
          status: f.status, source: f.source, confidence: f.confidence,
          created_at: f.createdAt, updated_at: f.updatedAt,
        })) }
      }
      if (sql.includes('insert into public.coach_memory_facts')) {
        facts.push(makeFact({ id: `new-${facts.length}`, kind: params[1], content: params[2], source: params[3], confidence: params[4] }))
        return { rows: [] }
      }
      if (sql.includes("set status = 'archived'")) {
        const fact = facts.find((f) => f.id === params[0])
        if (fact) fact.status = 'archived'
        return { rows: [] }
      }
      if (sql.includes('set content =')) {
        const fact = facts.find((f) => f.id === params[0])
        if (fact) fact.content = params[2]
        return { rows: [] }
      }
      return { rows: [] }
    }),
  }
}

describe('formatLongTermMemoryForPrompt', () => {
  it('renders injuries first, goals with deadline and progress', () => {
    const facts = [
      makeFact({ id: 'f1', kind: 'preference', content: 'Любит штангу' }),
      makeFact({ id: 'f2', kind: 'injury', content: 'Правое плечо: дискомфорт при жиме над головой' }),
    ]
    // Query already orders injuries first — emulate that ordering here.
    const ordered = [facts[1], facts[0]]
    const block = formatLongTermMemoryForPrompt(ordered, [makeGoal()])
    expect(block).toContain('ПАМЯТЬ ТРЕНЕРА')
    expect(block.indexOf('плечо')).toBeLessThan(block.indexOf('штангу'))
    expect(block).toContain('ЦЕЛИ ПОЛЬЗОВАТЕЛЯ')
    expect(block).toContain('к 2026-09-01')
    expect(block).toContain('идём по графику')
  })

  it('returns empty string when there is nothing to tell', () => {
    expect(formatLongTermMemoryForPrompt([], [])).toBe('')
  })

  it('ignores archived facts and non-active goals', () => {
    const block = formatLongTermMemoryForPrompt(
      [makeFact({ status: 'archived' })],
      [makeGoal({ status: 'achieved' })],
    )
    expect(block).toBe('')
  })

  it('caps the block at the char budget (~500 tokens)', () => {
    const facts = Array.from({ length: 60 }, (_, i) =>
      makeFact({ id: `f${i}`, content: `Наблюдение номер ${i}: ${'детали '.repeat(10)}` }),
    )
    const block = formatLongTermMemoryForPrompt(facts, [])
    expect(block.length).toBeLessThanOrEqual(2000)
  })
})

describe('applyMemoryUpdates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds a valid fact', async () => {
    const client = makeFakeClient([])
    const result = await applyMemoryUpdates(client, 'vyacheslav', [
      { op: 'add', kind: 'load_response', content: 'Хорошо переносит высокий объём на спину', confidence: 0.7 },
    ])
    expect(result.added).toBe(1)
    expect(client.facts).toHaveLength(1)
  })

  it('rejects duplicates by normalized content', async () => {
    const client = makeFakeClient([makeFact({ content: 'Любит Штангу!' })])
    const result = await applyMemoryUpdates(client, 'vyacheslav', [
      { op: 'add', kind: 'preference', content: 'любит штангу' },
    ])
    expect(result.added).toBe(0)
    expect(result.rejected[0].reason).toContain('duplicate')
  })

  it('rejects adds beyond the active-facts cap', async () => {
    const client = makeFakeClient(
      Array.from({ length: MAX_ACTIVE_FACTS }, (_, i) => makeFact({ id: `f${i}`, content: `Факт ${i}` })),
    )
    const result = await applyMemoryUpdates(client, 'vyacheslav', [
      { op: 'add', kind: 'preference', content: 'Ещё один факт' },
    ])
    expect(result.added).toBe(0)
    expect(result.rejected[0].reason).toContain('cap')
  })

  it('LLM cannot archive an injury fact; user can', async () => {
    const injury = makeFact({ id: 'inj-1', kind: 'injury', content: 'Боль в плече' })
    const client = makeFakeClient([injury])

    const llmResult = await applyMemoryUpdates(client, 'vyacheslav', [{ op: 'archive', id: 'inj-1' }], 'llm')
    expect(llmResult.archived).toBe(0)
    expect(llmResult.rejected[0].reason).toContain('user')
    expect(client.facts[0].status).toBe('active')

    const userResult = await applyMemoryUpdates(client, 'vyacheslav', [{ op: 'archive', id: 'inj-1' }], 'user')
    expect(userResult.archived).toBe(1)
    expect(client.facts[0].status).toBe('archived')
  })

  it('rejects invalid kinds and too-short content', async () => {
    const client = makeFakeClient([])
    const result = await applyMemoryUpdates(client, 'vyacheslav', [
      { op: 'add', kind: 'nonsense', content: 'Валидный текст' },
      { op: 'add', kind: 'preference', content: 'а' },
    ])
    expect(result.added).toBe(0)
    expect(result.rejected).toHaveLength(2)
  })

  it('caps the number of operations processed per call at 10', async () => {
    const client = makeFakeClient([])
    const ops = Array.from({ length: 20 }, (_, i) => ({ op: 'add', kind: 'preference', content: `Факт номер ${i} уникальный` }))
    const result = await applyMemoryUpdates(client, 'vyacheslav', ops)
    expect(result.added).toBe(10)
  })

  it('updates an existing fact content', async () => {
    const client = makeFakeClient([makeFact({ id: 'f1' })])
    const result = await applyMemoryUpdates(client, 'vyacheslav', [
      { op: 'update', id: 'f1', content: 'Уточнённое наблюдение' },
    ])
    expect(result.updated).toBe(1)
    expect(client.facts[0].content).toBe('Уточнённое наблюдение')
  })
})
