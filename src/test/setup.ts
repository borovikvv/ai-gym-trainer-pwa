import '@testing-library/jest-dom/vitest'

function createStorageMock() {
  let store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store = new Map()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

const localStorageMock = createStorageMock()
const sessionStorageMock = createStorageMock()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  configurable: true,
})

Object.defineProperty(window, 'scrollTo', {
  value: () => undefined,
  writable: true,
})

// jsdom does not implement matchMedia — provide a minimal polyfill so
// useTheme and any other caller can run in tests.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})
