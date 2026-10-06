import { build } from 'vite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Issue #406: приложение закрыто входом по cookie (Authelia, портал на /auth/
// того же origin). Раньше SW регистрировал NavigationRoute и отдавал на любую
// навигацию кэшированную оболочку: без сессии браузер не видел редирект на
// портал, а чанки оболочки собирались в несовместимый набор — пустой экран.
describe('service worker: навигации за входом', () => {
  it('не подменяет навигации оболочкой из прекеша и обходит портал входа', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pwa-sw-'))
    try {
      await build({
        configFile: 'vite.config.ts',
        logLevel: 'silent',
        mode: 'production',
        build: { outDir, emptyOutDir: true },
      })
      const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')

      // Прекеш-фолбэк навигации убран — иначе редирект на вход не доходит до
      // браузера.
      expect(sw, 'NavigationRoute всё ещё регистрируется').not.toMatch(/NavigationRoute/)

      // Навигации обслуживает собственный обработчик: сеть, редирект насквозь.
      expect(sw).toMatch(/mode===`navigate`|mode==='navigate'/)
      expect(sw).toMatch(/redirect:`manual`|redirect:'manual'/)

      // Портал входа не подменяется оболочкой приложения.
      expect(sw).toMatch(/\/auth\//)

      // Обновление SW встаёт в строй сразу: без этого исправление навигации
      // доедет до установленной PWA только после перезапуска приложения.
      expect(sw).toMatch(/skipWaiting/)
      expect(sw).toMatch(/clientsClaim|clients\.claim/)

      // Офлайн-режим сохранён: оболочка в прекеше.
      expect(sw).toMatch(/"url":"index\.html"/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})
