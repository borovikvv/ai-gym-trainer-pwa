import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_PORTAL_PATH, redirectToAuthPortal } from '../data/authRedirect'
import { ProgramLoadGate } from './ProgramLoadGate'

vi.mock('../data/authRedirect', async () => {
  const actual = await vi.importActual<typeof import('../data/authRedirect')>('../data/authRedirect')
  return { ...actual, redirectToAuthPortal: vi.fn() }
})

afterEach(() => {
  vi.clearAllMocks()
})

// Issue #404: вход переехал на cookie-сессию (Authelia), портал — /auth/ на том
// же origin. При 401 приложение обязано увести пользователя на портал, а не
// показывать тупиковый экран: иначе после протухания сессии PWA мертва.
describe('ProgramLoadGate: реакция на 401', () => {
  it('уводит на портал входа при 401', () => {
    render(<ProgramLoadGate state={{ status: 'error', httpStatus: 401 }} onRetry={() => {}} />)

    expect(redirectToAuthPortal).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('program-load-auth-hint')).toBeInTheDocument()
  })

  it('не уводит на портал при других ошибках', () => {
    render(<ProgramLoadGate state={{ status: 'error', httpStatus: 500 }} onRetry={() => {}} />)

    expect(redirectToAuthPortal).not.toHaveBeenCalled()
    expect(screen.queryByTestId('program-load-auth-hint')).not.toBeInTheDocument()
  })

  it('во время загрузки портал не запрашивается', () => {
    render(<ProgramLoadGate state={{ status: 'loading' }} onRetry={() => {}} />)

    expect(redirectToAuthPortal).not.toHaveBeenCalled()
  })
})

describe('authRedirect', () => {
  it('портал — путь на том же origin (не отдельный поддомен)', () => {
    expect(AUTH_PORTAL_PATH).toBe('/auth/')
    expect(AUTH_PORTAL_PATH.startsWith('/')).toBe(true)
  })
})
