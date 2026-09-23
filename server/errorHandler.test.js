import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from './errorHandler.js'

function createRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('errorHandler (issue #317)', () => {
  it('returns 500 with a generic message and hides the raw error when statusCode is missing', () => {
    const res = createRes()
    const rawMessage = 'column foo violates constraint'
    errorHandler(new Error(rawMessage), {}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    const body = res.json.mock.calls[0][0]
    expect(body).toEqual({ error: 'Internal server error' })
    expect(body.error).not.toContain(rawMessage)
  })

  it('keeps the original message for 4xx errors with explicit statusCode', () => {
    const res = createRes()
    const err = Object.assign(new Error('user is not allowed'), { statusCode: 403 })
    errorHandler(err, {}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'user is not allowed' })
  })

  it('treats invalid statusCode as 500 with a generic message', () => {
    const res = createRes()
    const err = Object.assign(new Error('boom'), { statusCode: 999 })
    errorHandler(err, {}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })
})