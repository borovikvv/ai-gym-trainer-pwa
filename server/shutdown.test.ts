import { describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { createShutdownHandler } from './shutdown.js'

describe('createShutdownHandler (issue #324)', () => {
  it('закрывает server, затем pool, затем exit(0)', async () => {
    const calls: string[] = []
    const server = {
      close: vi.fn((cb: () => void) => {
        calls.push('close')
        cb()
      }),
    }
    const pool = {
      end: vi.fn(() => {
        calls.push('end')
        return Promise.resolve()
      }),
    }
    const exit = vi.fn((code: number) => calls.push(`exit(${code})`))

    createShutdownHandler(server as unknown as Server, pool as unknown as Pool, exit)()
    await new Promise((resolve) => process.nextTick(resolve))

    expect(calls).toEqual(['close', 'end', 'exit(0)'])
  })

  it('вызывает exit(1) при ошибке pool.end', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: string[] = []
    const server = {
      close: vi.fn((cb: () => void) => {
        calls.push('close')
        cb()
      }),
    }
    const pool = {
      end: vi.fn(() => {
        calls.push('end')
        return Promise.reject(new Error('connection error'))
      }),
    }
    const exit = vi.fn((code: number) => calls.push(`exit(${code})`))

    createShutdownHandler(server as unknown as Server, pool as unknown as Pool, exit)()
    await new Promise((resolve) => process.nextTick(resolve))

    expect(calls).toEqual(['close', 'end', 'exit(1)'])
  })
})