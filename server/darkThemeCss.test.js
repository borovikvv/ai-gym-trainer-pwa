import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression test for issue #7: 'Dark theme: hero cards text invisible on
 * dark background'.
 *
 * Root cause: .hero-status used `background: var(--text-primary)`. In dark
 * theme --text-primary becomes #ffffff (white), so the card had a white
 * background with white text — invisible.
 *
 * Fix: introduced --hero-bg / --hero-text variables that stay dark/white
 * respectively in BOTH themes. This test guards against future regressions
 * by parsing src/index.css and src/App.css and asserting that hero-bg ≠
 * hero-text in every theme block.
 *
 * Lives under server/ so Node.js fs APIs are available (the frontend test
 * environment uses jsdom which doesn't support ?raw CSS imports).
 */

// process.cwd() is the repo root when tests run via 'npm test' from the
// project root. This avoids import.meta.url scheme issues in Vitest.
const repoRoot = process.cwd()
const indexCss = readFileSync(resolve(repoRoot, 'src/index.css'), 'utf8')
const appCss = readFileSync(resolve(repoRoot, 'src/App.css'), 'utf8')

function extractVar(block, name) {
  const re = new RegExp(`--${name}:\\s*([^;]+);`)
  const m = block.match(re)
  return m ? m[1].trim() : null
}

function extractBlock(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const braceStart = source.indexOf('{', start)
  const braceEnd = source.indexOf('}', braceStart)
  return source.slice(braceStart + 1, braceEnd)
}

describe('Dark theme CSS variables (issue #7 regression)', () => {
  it('defines --hero-bg and --hero-text in :root (light theme)', () => {
    const lightBlock = extractBlock(indexCss, ':root {')
    expect(extractVar(lightBlock, 'hero-bg')).not.toBeNull()
    expect(extractVar(lightBlock, 'hero-text')).not.toBeNull()
  })

  it('defines --hero-bg and --hero-text in [data-theme="dark"]', () => {
    const darkBlock = extractBlock(indexCss, ':root[data-theme="dark"] {')
    expect(extractVar(darkBlock, 'hero-bg')).not.toBeNull()
    expect(extractVar(darkBlock, 'hero-text')).not.toBeNull()
  })

  it('light theme: hero-bg is dark (not white)', () => {
    const lightBlock = extractBlock(indexCss, ':root {')
    const bg = extractVar(lightBlock, 'hero-bg') ?? ''
    expect(bg.toLowerCase()).not.toBe('#ffffff')
    expect(bg.toLowerCase()).not.toBe('#fff')
  })

  it('dark theme: hero-bg is dark (not white) — issue #7 fix', () => {
    const darkBlock = extractBlock(indexCss, ':root[data-theme="dark"] {')
    const bg = extractVar(darkBlock, 'hero-bg') ?? ''
    // CRITICAL: in dark theme, hero-bg must NOT be white. Previously
    // background: var(--text-primary) made it #ffffff in dark mode.
    expect(bg.toLowerCase()).not.toBe('#ffffff')
    expect(bg.toLowerCase()).not.toBe('#fff')
  })

  it('light theme: hero-bg and hero-text are different colors', () => {
    const lightBlock = extractBlock(indexCss, ':root {')
    const bg = extractVar(lightBlock, 'hero-bg') ?? ''
    const text = extractVar(lightBlock, 'hero-text') ?? ''
    expect(bg).not.toBe(text)
  })

  it('dark theme: hero-bg and hero-text are different colors', () => {
    const darkBlock = extractBlock(indexCss, ':root[data-theme="dark"] {')
    const bg = extractVar(darkBlock, 'hero-bg') ?? ''
    const text = extractVar(darkBlock, 'hero-text') ?? ''
    expect(bg).not.toBe(text)
  })

  it('App.css uses var(--hero-bg) instead of var(--text-primary) for backgrounds', () => {
    // No background declarations should use var(--text-primary) — that was
    // the root cause of issue #7.
    expect(appCss).not.toContain('background: var(--text-primary)')
    // Hero-bg should be used at least once (in .hero-status).
    expect(appCss).toContain('background: var(--hero-bg)')
  })
})
