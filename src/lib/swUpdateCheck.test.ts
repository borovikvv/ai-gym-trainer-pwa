import { describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, scheduleUpdateChecks } from './swUpdateCheck'

// Issue #473: проверка обновления SW и при возврате в приложение, и по таймеру.

describe('scheduleUpdateChecks', () => {
  it('проверяет обновление при возврате в приложение и по таймеру', () => {
    let visibilityListener: (() => void) | undefined
    const setIntervalMock = vi.fn()
    const update = vi.fn()

    scheduleUpdateChecks(update, {
      addVisibilityListener: (listener) => {
        visibilityListener = listener
      },
      setInterval: setIntervalMock,
    })

    expect(setIntervalMock).toHaveBeenCalledWith(update, 15 * 60 * 1000)
    expect(visibilityListener).toBeTypeOf('function')

    visibilityListener?.()
    expect(update).toHaveBeenCalledTimes(1)

    const intervalCallback = setIntervalMock.mock.calls[0][0] as () => void
    intervalCallback()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('интервал проверки равен 15 минутам', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(15 * 60 * 1000)
  })
})
