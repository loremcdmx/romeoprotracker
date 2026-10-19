import { describe, expect, it } from 'vitest'
import { parseScrapeOptions } from './lib/scrape-options.mjs'

describe('parseScrapeOptions', () => {
  it('uses environment defaults when no CLI overrides are present', () => {
    expect(parseScrapeOptions([], { SCRAPE_MODE: 'full' })).toEqual({
      mode: 'full',
      dryRun: false,
      noPush: false,
      pruneForce: false,
    })
  })

  it('accepts CLI mode and safety flags', () => {
    expect(parseScrapeOptions(['--mode=reextract', '--no-push'], {})).toEqual({
      mode: 'reextract',
      dryRun: false,
      noPush: true,
      pruneForce: false,
    })
  })

  it('treats dry-run as no-push implicitly', () => {
    expect(parseScrapeOptions(['--dry-run'], {})).toEqual({
      mode: 'normal',
      dryRun: true,
      noPush: true,
      pruneForce: false,
    })
  })

  it('lets CLI override environment mode', () => {
    expect(parseScrapeOptions(['--mode', 'translate'], { SCRAPE_MODE: 'full' })).toEqual({
      mode: 'translate',
      dryRun: false,
      noPush: false,
      pruneForce: false,
    })
  })

  it('accepts --prune-force and SCRAPE_PRUNE_FORCE, off by default', () => {
    expect(parseScrapeOptions(['--mode=full'], {}).pruneForce).toBe(false)
    expect(parseScrapeOptions(['--mode=full', '--prune-force'], {}).pruneForce).toBe(true)
    expect(parseScrapeOptions([], { SCRAPE_PRUNE_FORCE: '1' }).pruneForce).toBe(true)
  })

  it('rejects invalid modes', () => {
    expect(() => parseScrapeOptions(['--mode=weird'], {})).toThrow('Invalid scrape mode')
  })
})
