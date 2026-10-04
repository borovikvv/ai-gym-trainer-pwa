import { describe, expect, it } from 'vitest'
import {
  assertAllowedRowOwner,
  assertAllowedUserId,
  getAllowedUserIds,
} from './privateUsers.js'

describe('private user access guard', () => {
  it('allows only Vyacheslav and Oleg by default', () => {
    expect(getAllowedUserIds()).toEqual(['vyacheslav', 'oleg'])
    expect(assertAllowedUserId('vyacheslav')).toBe('vyacheslav')
    expect(assertAllowedUserId('oleg')).toBe('oleg')
  })

  it('rejects writes without a user id', () => {
    expect(() => assertAllowedUserId('')).toThrowError(expect.objectContaining({
      message: 'userId is required',
      statusCode: 400,
    }))
  })

  it('rejects writes for users outside ALLOWED_USER_IDS', () => {
    expect(() => assertAllowedUserId('demo')).toThrowError(expect.objectContaining({
      message: 'userId is not allowed',
      statusCode: 403,
    }))
  })

  it('supports explicit ALLOWED_USER_IDS overrides', () => {
    expect(getAllowedUserIds('alpha, beta ,,')).toEqual(['alpha', 'beta'])
    expect(assertAllowedUserId('alpha', 'alpha,beta')).toBe('alpha')
    expect(() => assertAllowedUserId('oleg', 'alpha,beta')).toThrowError(expect.objectContaining({
      statusCode: 403,
    }))
  })

  it('rejects id-only writes when the row owner is not private', () => {
    expect(assertAllowedRowOwner({ user_id: 'oleg' })).toBe('oleg')
    expect(() => assertAllowedRowOwner({ user_id: 'demo' })).toThrowError(expect.objectContaining({
      message: 'row owner is not allowed',
      statusCode: 403,
    }))
  })
})
