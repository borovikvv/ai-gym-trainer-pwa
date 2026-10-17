import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_EXPIRED_MESSAGE } from '../sw/assetGateHandler'
import { redirectToAuthPortal } from './authRedirect'
import { listenForSessionExpired, type SessionExpiredSource } from './sessionExpiredListener'

vi.mock('./authRedirect', async () => {
  const actual = await vi.importActual<typeof import('./authRedirect')>('./authRedirect')
  return { ...actual, redirectToAuthPortal: vi.fn() }
})

afterEach(() => vi.clearAllMocks())

// Issue #474: сигнал SW «сессия истекла» должен уводить на портал входа.
function makeContainer() {
  let listener: ((event: MessageEvent) => void) | undefined
  const container: SessionExpiredSource = {
    addEventListener: (_type, l) => {
      listener = l
    },
  }
  return { container, dispatch: (data: unknown) => listener?.({ data } as MessageEvent) }
}

describe('listenForSessionExpired', () => {
  it('уводит на портал при сообщении о смерти сессии', () => {
    const { container, dispatch } = makeContainer()
    listenForSessionExpired(container)
    dispatch({ type: SESSION_EXPIRED_MESSAGE, url: 'https://x/assets/a.js' })
    expect(redirectToAuthPortal).toHaveBeenCalledTimes(1)
  })

  it('игнорирует посторонние сообщения', () => {
    const { container, dispatch } = makeContainer()
    listenForSessionExpired(container)
    dispatch({ type: 'other' })
    dispatch({ url: 'https://x/assets/a.js' })
    dispatch(null)
    dispatch(undefined)
    dispatch('session-expired')
    expect(redirectToAuthPortal).not.toHaveBeenCalled()
  })
})
