import { build } from 'vite'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface WebManifestIcon {
  src: string
  sizes?: string
  type?: string
  purpose?: string
}

interface WebManifest {
  icons: WebManifestIcon[]
}

// iOS (apple-touch-icon) and a number of Android launchers ignore SVG icons, so
// an installed PWA ended up with a default/cropped icon. The manifest must
// declare raster PNG icons (including a maskable one) and index.html must link
// an apple-touch-icon (#333).
describe('PWA manifest icons', () => {
  it('declares PNG icons that exist, a maskable icon and apple-touch-icon', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pwa-icons-'))
    try {
      await build({ configFile: 'vite.config.ts', logLevel: 'silent', mode: 'production', build: { outDir, emptyOutDir: true } })

      const manifest = JSON.parse(
        readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8'),
      ) as WebManifest

      expect(manifest.icons.length).toBeGreaterThan(0)
      for (const icon of manifest.icons) {
        expect(existsSync(join(outDir, icon.src)), `missing icon file ${icon.src}`).toBe(true)
      }
      expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)

      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      expect(html).toMatch(/<link rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/)
      expect(existsSync(join(outDir, 'apple-touch-icon.png'))).toBe(true)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
