import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression test for issue #58: "Light theme: белый текст на белых карточках
 * не виден (календарь на вкладке «План», badge, sparkline-карточки)".
 *
 * Root cause: the light-theme :root block in src/index.css did NOT define
 * --text-primary, --surface, --surface-muted, --surface-solid, --separator,
 * --accent, --accent-pressed, --warning, --danger, --app-bg, --bg. These
 * were only declared inside the dark-theme overrides
 * (@media prefers-color-scheme: dark and :root[data-theme="dark"]). When the
 * user explicitly selected light theme via data-theme="light", every
 * var(--accent) / var(--surface) / etc. resolved to undefined → the property
 * was ignored → background collapsed to transparent. Hardcoded white text
 * (.week-day.active, .primary, .nav button.active, .dot.hot, .check,
 * .progress-orb span, .onboarding-actions .primary) then rendered
 * white-on-white through the transparent background onto the white card.
 *
 * Fix: explicitly declare every consumed CSS variable in :root with values
 * chosen so that:
 *   - white text on --accent has contrast ≥ 4.5:1 (WCAG AA)
 *   - --text-primary on --surface has contrast ≥ 4.5:1
 *
 * This test parses src/index.css and asserts:
 *   1. Every consumed variable is defined in :root.
 *   2. White-on-accent contrast ≥ 4.5:1.
 *   3. Text-primary-on-surface contrast ≥ 4.5:1.
 *   4. Dark theme values are unchanged (issue #7 regression guard).
 */

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

/** Convert a CSS color string to a relative luminance value (0..1).
 *  Supports #rgb, #rrggbb, #rrggbbaa, rgba()/rgb(). */
function parseColorToLuminance(input) {
  const s = input.trim().toLowerCase()
  let r, g, b
  if (s.startsWith('#')) {
    let hex = s.slice(1)
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('')
    }
    if (hex.length === 8) hex = hex.slice(0, 6) // drop alpha
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
    if (!m) return null
    r = parseFloat(m[1])
    g = parseFloat(m[2])
    b = parseFloat(m[3])
  }
  const lin = (c) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(fg, bg) {
  const l1 = parseColorToLuminance(fg)
  const l2 = parseColorToLuminance(bg)
  if (l1 == null || l2 == null) return null
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Light theme CSS variables (issue #58 regression)', () => {
  const lightBlock = extractBlock(indexCss, ':root {')

  it('defines every consumed CSS variable in :root (light theme)', () => {
    const required = [
      '--app-bg',
      '--bg',
      '--surface',
      '--surface-solid',
      '--surface-muted',
      '--border',
      '--separator',
      '--text-primary',
      '--text-secondary',
      '--text-tertiary',
      '--accent',
      '--accent-pressed',
      '--warning',
      '--danger',
    ]
    const missing = required.filter((name) => {
      const varName = name.slice(2)
      return extractVar(lightBlock, varName) == null
    })
    expect(missing).toEqual([])
  })

  it('white text on --accent passes WCAG AA (≥ 4.5:1)', () => {
    const accent = extractVar(lightBlock, 'accent')
    expect(accent).not.toBeNull()
    const ratio = contrastRatio('#ffffff', accent)
    expect(ratio).not.toBeNull()
    // Used by .primary, .week-day.active, .nav button.active, .dot.hot,
    // .check, .progress-orb span, .onboarding-actions .primary — all of
    // which pair color:#ffffff with background:var(--accent).
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('white text on --accent-pressed passes WCAG AA (≥ 4.5:1)', () => {
    const pressed = extractVar(lightBlock, 'accent-pressed')
    expect(pressed).not.toBeNull()
    const ratio = contrastRatio('#ffffff', pressed)
    expect(ratio).not.toBeNull()
    // .primary:active uses background:var(--accent-pressed) with color:#ffffff
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('--text-primary on --surface passes WCAG AA (≥ 4.5:1)', () => {
    const fg = extractVar(lightBlock, 'text-primary')
    const bg = extractVar(lightBlock, 'surface')
    expect(fg).not.toBeNull()
    expect(bg).not.toBeNull()
    const ratio = contrastRatio(fg, bg)
    expect(ratio).not.toBeNull()
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('--text-primary on --surface-solid passes WCAG AA (≥ 4.5:1)', () => {
    const fg = extractVar(lightBlock, 'text-primary')
    const bg = extractVar(lightBlock, 'surface-solid')
    const ratio = contrastRatio(fg, bg)
    expect(ratio).not.toBeNull()
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('--danger as text on white surface passes WCAG AA (≥ 4.5:1)', () => {
    const danger = extractVar(lightBlock, 'danger')
    expect(danger).not.toBeNull()
    const ratio = contrastRatio(danger, '#ffffff')
    expect(ratio).not.toBeNull()
    // .danger { color: var(--danger); } rendered on white cards
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('--accent-pressed as text on white surface passes WCAG AA (≥ 4.5:1)', () => {
    const pressed = extractVar(lightBlock, 'accent-pressed')
    const ratio = contrastRatio(pressed, '#ffffff')
    expect(ratio).not.toBeNull()
    // .recommended-weight, .mesocycle-indicator--deload, several other
    // components use color:var(--accent-pressed) on white card backgrounds.
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('App.css does not hardcode color:#ffffff paired with var(--accent) in .week-day.active', () => {
    // The primary reported bug: .week-day.active { color: #ffffff; background: var(--accent) }
    // should still exist and rely on --accent being defined in :root.
    expect(appCss).toContain('.week-day.active')
    expect(appCss).toMatch(/\.week-day\.active\s*\{[^}]*color:\s*#ffffff[^}]*background:\s*var\(--accent\)/)
  })

  it('dark theme accent is unchanged (issue #7 / #58 non-regression)', () => {
    const darkBlock = extractBlock(indexCss, ':root[data-theme="dark"] {')
    const accent = extractVar(darkBlock, 'accent')
    // The dark theme intentionally keeps the brighter Apple systemGreen-dark.
    expect(accent.toLowerCase()).toBe('#30d158')
  })
})
