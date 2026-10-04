import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { requireApiToken } from './auth.ts'

const TOKEN = 'test-secret-token-123'

function run(headers: Request['headers'], envValue: string | undefined) {
  const next = vi.fn()
  requireApiToken({ headers } as unknown as Request, {} as Response, next, envValue)
  return next
}

describe('requireApiToken', () => {
  it('rejects with 401 when the X-API-Token header is missing', () => {
    const next = run({}, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })

  it('rejects with 401 when the X-API-Token header carries a wrong token', () => {
    const next = run({ 'x-api-token': 'wrong-token' }, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })

  it('calls next() without arguments for the matching token', () => {
    const next = run({ 'x-api-token': TOKEN }, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]).toHaveLength(0)
  })

  // Caddy basic_auth sends Basic credentials in Authorization; the API token
  // travels separately and must be accepted alongside them.
  it('accepts the token alongside Basic credentials in Authorization', () => {
    const next = run({ authorization: 'Basic dXNlcjpwYXNz', 'x-api-token': TOKEN }, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]).toHaveLength(0)
  })

  it('fails closed with 401 when the token env is not configured, even with a header', () => {
    const next = run({ 'x-api-token': TOKEN }, undefined)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })

  it('fails closed with 401 when the token env is not configured and no header is sent', () => {
    const next = run({}, undefined)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })
})
