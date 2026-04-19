import { describe, expect, it } from 'vitest'
import { parseScrapeOptions } from './lib/scrape-options.mjs'

describe('parseScrapeOptions', () => {
  it('uses environment defaults when no CLI overrides are present', () => {
    expect(parseScrapeOptions([], { SCRAPE_MODE: 'full' })).toEqual({
      mode: 'full',
      dryRun: false,
      noPush: false,
    })
  })

  it('accepts CLI mode and safety flags', () => {
    expect(parseScrapeOptions(['--mode=reextract', '--no-push'], {})).toEqual({
      mode: 'reextract',
      dryRun: false,
      noPush: true,
    })
  })

  it('treats dry-run as no-push implicitly', () => {
    expect(parseScrapeOptions(['--dry-run'], {})).toEqual({
      mode: 'normal',
      dryRun: true,
      noPush: true,
    })
  })

  it('lets CLI override environment mode', () => {
    expect(parseScrapeOptions(['--mode', 'translate'], { SCRAPE_MODE: 'full' })).toEqual({
      mode: 'translate',
      dryRun: false,
      noPush: false,
    })
  })

  it('rejects invalid modes', () => {
    expect(() => parseScrapeOptions(['--mode=weird'], {})).toThrow('Invalid scrape mode')
  })
})
