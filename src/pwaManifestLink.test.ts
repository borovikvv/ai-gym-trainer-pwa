import { build } from 'vite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Манифест за авторизацией (Basic Auth или cookie-сессия) браузер запрашивает
// без учётных данных, если у <link rel="manifest"> нет crossorigin="use-credentials":
// получается второй запрос пароля (Basic) или редирект на логин (cookie).
describe('PWA manifest link', () => {
  it('requests the manifest with credentials', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pwa-build-'))
    try {
      await build({ configFile: 'vite.config.ts', logLevel: 'silent', mode: 'production', build: { outDir, emptyOutDir: true } })
      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      expect(html).toMatch(/<link rel="manifest"[^>]*crossorigin="use-credentials"/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
