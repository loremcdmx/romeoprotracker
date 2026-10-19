import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(resolve(root, path), 'utf8')

describe('public/robots.txt', () => {
  const text = read('public/robots.txt')

  it('is made of real lines, not escaped "\\n" text', () => {
    expect(text).not.toContain('\\')
    expect(text.split('\n').length).toBeGreaterThan(2)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('allows every crawler with one directive per line', () => {
    expect(text.split(/\r?\n/).filter(Boolean)).toEqual(['User-agent: *', 'Allow: /'])
  })

  it('names a sitemap only if the site ships one', () => {
    const sitemaps = text.split(/\r?\n/).filter(line => /^sitemap:/i.test(line))
    if (sitemaps.length > 0) expect(existsSync(resolve(root, 'public/sitemap.xml'))).toBe(true)
  })
})

describe('scraper failure alert wiring', () => {
  const ALERT_ENV = ['SCRAPE_ALERT_WEBHOOK', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']
  const workflow = read('.github/workflows/scrape.yml')
  // From the "Run scraper" step to the next step (or the end of the file).
  const stepStart = workflow.indexOf('- name: Run scraper')
  const rest = workflow.slice(stepStart + 1)
  const nextStep = rest.search(/\n\s*- (name|uses):/)
  const runStep = stepStart < 0 ? '' : workflow.slice(stepStart, nextStep < 0 ? undefined : stepStart + 1 + nextStep)

  it('has a "Run scraper" step that runs scripts/scrape.mjs', () => {
    expect(stepStart).toBeGreaterThanOrEqual(0)
    expect(runStep).toMatch(/run:\s*node scripts\/scrape\.mjs/)
  })

  it.each(ALERT_ENV)('passes %s from the repository secret to the scraper step', name => {
    expect(runStep).toMatch(new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.${name} \\}\\}\\s*$`, 'm'))
  })

  it.each(ALERT_ENV)('is still read by the scraper as process.env.%s', name => {
    expect(read('scripts/scrape.mjs')).toContain(`process.env.${name}`)
  })

  it('keeps the alert optional: the secrets only feed env, never gate a step', () => {
    for (const name of ALERT_ENV) {
      expect(workflow).not.toMatch(new RegExp(`if:[^\\n]*secrets\\.${name}`))
    }
  })
})
