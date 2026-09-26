import { describe, expect, it, vi } from 'vitest'
import { requireApiToken } from './auth.ts'

const TOKEN = 'test-secret-token-123'

function run(authorization, envValue) {
  const next = vi.fn()
  const req = { headers: authorization ? { authorization } : {} }
  requireApiToken(req, {}, next, envValue)
  return next
}

describe('requireApiToken', () => {
  it('rejects with 401 when the Authorization header is missing', () => {
    const next = run(undefined, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })

  it('rejects with 401 when the Authorization header carries a wrong token', () => {
    const next = run('Bearer wrong-token', TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })

  it('calls next() without arguments for the matching token', () => {
    const next = run(`Bearer ${TOKEN}`, TOKEN)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]).toHaveLength(0)
  })

  it('fails closed with 401 when the token env is not configured, even with a header', () => {
    const next = run(`Bearer ${TOKEN}`, undefined)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })
  it('fails closed with 401 when the token env is not configured and no header is sent', () => {
    const next = run(undefined, undefined)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]?.statusCode).toBe(401)
  })
})
