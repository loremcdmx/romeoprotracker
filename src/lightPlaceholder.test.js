import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The default placeholder colour (#757575) is 3.4:1 on the light input
// background. The two text inputs of the app get a themed placeholder instead.
const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8')

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const lightToken = (name) => {
  const block = CSS.match(/^\.light\s*\{([\s\S]*?)\n\}/m)[1]
  return block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1]
}

describe('light-theme input placeholders', () => {
  const RULE = /\.light \.ignore-input::placeholder,\.light \.feed-search::placeholder\{([^}]*)\}/

  it('both text inputs get a themed placeholder with opacity 1 (Firefox dims placeholders)', () => {
    const body = CSS.match(RULE)?.[1] ?? ''
    expect(body).toContain('color:var(--dim)')
    expect(body).toContain('opacity:1')
  })

  it('--dim on the input background (--bg3) is AA (4.5:1)', () => {
    expect(contrast(lightToken('--dim'), lightToken('--bg3'))).toBeGreaterThanOrEqual(4.5)
  })

  it('the old browser default would not have been', () => {
    expect(contrast('#757575', lightToken('--bg3'))).toBeLessThan(4.5)
  })

  it('does not touch the dark theme (no unscoped placeholder rule)', () => {
    const unscoped = CSS.split('\n').filter((l) => l.includes('::placeholder') && !l.includes('.light'))
    expect(unscoped).toEqual([])
  })
})
