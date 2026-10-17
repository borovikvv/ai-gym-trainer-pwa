import { describe, expect, it, vi } from 'vitest'
import {
  isModuleLoadError,
  recoverFromModuleLoadError,
  type RecoveryDeps,
} from './pwaRecovery'

// Issue #473: решение «пора восстанавливаться» принимается по тексту ошибки
// загрузки модуля, а не по факту «что-то упало».

describe('isModuleLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://trainer/assets/index-abc.js',
    'Importing a module script failed.',
    "Uncaught SyntaxError: Unexpected token '<'",
    'Uncaught SyntaxError: Unexpected token < (at index-abc.js:1:1)',
    'some prefix Failed to fetch dynamically imported module suffix',
  ])('распознаёт формулировку: %s', (message) => {
    expect(isModuleLoadError(message)).toBe(true)
  })

  it('не срабатывает на произвольную ошибку рантайма', () => {
    expect(isModuleLoadError('TypeError: x is not a function')).toBe(false)
  })

  it('устойчив к пустым значениям', () => {
    expect(isModuleLoadError(undefined)).toBe(false)
    expect(isModuleLoadError(null)).toBe(false)
    expect(isModuleLoadError('')).toBe(false)
  })
})

function makeDeps(over: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return {
    hasRecovered: () => false,
    markRecovered: vi.fn(),
    unregisterServiceWorker: vi.fn(async () => {}),
    clearCaches: vi.fn(async () => {}),
    reload: vi.fn(),
    ...over,
  }
}

describe('recoverFromModuleLoadError', () => {
  it('при первой ошибке снимает SW, чистит кэши и перезагружает', async () => {
    const deps = makeDeps()

    await recoverFromModuleLoadError(deps)

    expect(deps.markRecovered).toHaveBeenCalledTimes(1)
    expect(deps.unregisterServiceWorker).toHaveBeenCalledTimes(1)
    expect(deps.clearCaches).toHaveBeenCalledTimes(1)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('не повторяет восстановление дважды за сессию', async () => {
    let recovered = false
    const deps = makeDeps({
      hasRecovered: () => recovered,
      markRecovered: () => {
        recovered = true
      },
    })

    await recoverFromModuleLoadError(deps)
    await recoverFromModuleLoadError(deps)

    expect(deps.unregisterServiceWorker).toHaveBeenCalledTimes(1)
    expect(deps.clearCaches).toHaveBeenCalledTimes(1)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })
})
