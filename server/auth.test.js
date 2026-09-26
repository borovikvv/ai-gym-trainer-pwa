import { describe, expect, it, vi } from 'vitest'
import { requireApiToken } from './auth.ts'

const TOKEN = 'test-secret-token-123'

function run(headers, envValue) {
  const next = vi.fn()
  requireApiToken({ headers }, {}, next, envValue)
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
