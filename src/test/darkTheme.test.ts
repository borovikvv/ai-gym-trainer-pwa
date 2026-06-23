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
 * by parsing src/index.css and asserting that hero-bg ≠ hero-text in every
 * theme block.
 */

const cssPath = resolve(import.meta.dirname, '../index.css')
const css = readFileSync(cssPath, 'utf8')

function extractVar(block: string, name: string): string | null {
  const re = new RegExp(`--${name}:\\s*([^;]+);`)
  const m = block.match(re)
  return m ? m[1].trim() : null
}

function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const braceStart = source.indexOf('{', start)
  const braceEnd = source.indexOf('}', braceStart)
  return source.slice(braceStart + 1, braceEnd)
}

describe('Dark theme CSS variables (issue #7 regression)', () => {
  it('defines --hero-bg and --hero-text in :root (light theme)', () => {
    const lightBlock = extractBlock(css, ':root {')
    expect(extractVar(lightBlock, 'hero-bg')).not.toBeNull()
    expect(extractVar(lightBlock, 'hero-text')).not.toBeNull()
  })

  it('defines --hero-bg and --hero-text in [data-theme="dark"]', () => {
    const darkBlock = extractBlock(css, ':root[data-theme="dark"] {')
    expect(extractVar(darkBlock, 'hero-bg')).not.toBeNull()
    expect(extractVar(darkBlock, 'hero-text')).not.toBeNull()
  })

  it('light theme: hero-bg is dark (not white)', () => {
    const lightBlock = extractBlock(css, ':root {')
    const bg = extractVar(lightBlock, 'hero-bg') ?? ''
    // Light theme hero-bg should be a dark color (not #ffffff).
    expect(bg.toLowerCase()).not.toBe('#ffffff')
    expect(bg.toLowerCase()).not.toBe('#fff')
  })

  it('dark theme: hero-bg is dark (not white) — issue #7 fix', () => {
    const darkBlock = extractBlock(css, ':root[data-theme="dark"] {')
    const bg = extractVar(darkBlock, 'hero-bg') ?? ''
    // CRITICAL: in dark theme, hero-bg must NOT be white. Previously
    // background: var(--text-primary) made it #ffffff in dark mode.
    expect(bg.toLowerCase()).not.toBe('#ffffff')
    expect(bg.toLowerCase()).not.toBe('#fff')
  })

  it('light theme: hero-bg and hero-text are different colors', () => {
    const lightBlock = extractBlock(css, ':root {')
    const bg = extractVar(lightBlock, 'hero-bg') ?? ''
    const text = extractVar(lightBlock, 'hero-text') ?? ''
    expect(bg).not.toBe(text)
  })

  it('dark theme: hero-bg and hero-text are different colors', () => {
    const darkBlock = extractBlock(css, ':root[data-theme="dark"] {')
    const bg = extractVar(darkBlock, 'hero-bg') ?? ''
    const text = extractVar(darkBlock, 'hero-text') ?? ''
    expect(bg).not.toBe(text)
  })

  it('App.css uses var(--hero-bg) instead of var(--text-primary) for backgrounds', () => {
    const appCss = readFileSync(resolve(import.meta.dirname, '../App.css'), 'utf8')
    // No background declarations should use var(--text-primary) — that was
    // the root cause of issue #7.
    expect(appCss).not.toContain('background: var(--text-primary)')
    // Hero-bg should be used at least once (in .hero-status).
    expect(appCss).toContain('background: var(--hero-bg)')
  })
})
