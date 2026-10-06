import { build } from 'vite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Issue #404: вход по cookie (Authelia) живёт на том же origin по пути /auth/.
// Service worker перехватывает навигации и отдаёт кэшированную оболочку
// приложения — без denylist страница входа на устройстве с установленной PWA
// не показывается вообще, и войти невозможно.
describe('PWA navigation fallback', () => {
  it('не перехватывает страницу входа /auth', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pwa-sw-'))
    try {
      await build({
        configFile: 'vite.config.ts',
        logLevel: 'silent',
        mode: 'production',
        build: { outDir, emptyOutDir: true },
      })
      const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
      // NavigationRoute — единственное место, где SW подменяет навигацию
      // оболочкой; denylist должен содержать /auth.
      const navigationRoute = sw.match(/NavigationRoute\([^;]{0,200}/)
      expect(navigationRoute, 'NavigationRoute отсутствует в sw.js').not.toBeNull()
      expect(navigationRoute?.[0]).toMatch(/denylist/)
      expect(navigationRoute?.[0]).toMatch(/auth/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
