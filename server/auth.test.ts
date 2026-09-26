import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { requireApiToken } from './auth.js'

const TOKEN = 'test-secret-token-123'

function makeReq(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as Request
}

function run(authorization: string | undefined, envValue: string | undefined): NextFunction {
  const next = vi.fn() as unknown as NextFunction
  const res = {} as Response
  requireApiToken(makeReq(authorization), res, next, envValue)
  return next
}

function errorStatus(next: NextFunction): number | undefined {
  const [error] = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
  return (error as { statusCode?: number } | undefined)?.statusCode
}

describe('requireApiToken', () => {
  it('rejects with 401 when the Authorization header is missing', () => {
    const next = run(undefined, TOKEN)
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1)
    expect(errorStatus(next)).toBe(401)
  })

  it('rejects with 401 when the Authorization header carries a wrong token', () => {
    const next = run('Bearer wrong-token', TOKEN)
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1)
    expect(errorStatus(next)).toBe(401)
  })

  it('calls next() without arguments for the matching token', () => {
    const next = run(`Bearer ${TOKEN}`, TOKEN)
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1)
    const [error] = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(error).toBeUndefined()
  })

  it('fails closed with 401 when the token env is not configured, even with a header', () => {
    const next = run(`Bearer ${TOKEN}`, undefined)
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1)
    expect(errorStatus(next)).toBe(401)
  })
})