// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const withoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
const fontLinks = (source) => source.match(/<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || []

describe('index.html web fonts', () => {
  it('does not load the Google Fonts stylesheet as a render-blocking link', () => {
    const links = fontLinks(withoutNoscript)

    expect(links).toHaveLength(1)
    // A plain rel="stylesheet" holds back first paint and the module script
    // for as long as fonts.googleapis.com takes to answer. media="print" keeps
    // it off the critical path until onload switches it on.
    expect(links[0]).toMatch(/rel="stylesheet"/)
    expect(links[0]).toMatch(/media="print"/)
    expect(links[0]).toMatch(/onload="[^"]*this\.media='all'/)
  })

  it('keeps a noscript fallback and font-display: swap', () => {
    const noscript = html.match(/<noscript>[\s\S]*?<\/noscript>/g) || []

    expect(noscript.flatMap(fontLinks)).toHaveLength(1)
    expect(fontLinks(html).every((link) => /display=swap/.test(link))).toBe(true)
  })

  it('still asks for exactly the loaded weights', () => {
    const [link] = fontLinks(withoutNoscript)

    expect(link).toContain('family=Inter:wght@400;500;600;700;800')
    expect(link).toContain('family=Roboto+Mono:wght@400;500;600;700')
  })
})
