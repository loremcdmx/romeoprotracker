import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROMEO_AUTHOR_RE, extractMarathonDay, isRomeoAuthor } from './lib/romeo-identity.mjs'
import { computeMarathonDay, validateMarathonIntegrity } from './lib/marathon-integrity.mjs'

describe('author identity (SCR-2 / DL-1 / DL-6)', () => {
  it('accepts exactly the Romeopro account, any letter case', () => {
    for (const nick of ['Romeopro', 'romeopro', 'ROMEOPRO', ' Romeopro ', 'Romeopro\n']) {
      expect(isRomeoAuthor(nick), JSON.stringify(nick)).toBe(true)
      expect(ROMEO_AUTHOR_RE.test(nick)).toBe(true)
    }
  })

  it('rejects nicks that merely contain or imitate it', () => {
    for (const nick of [
      'Romeopro_fan', 'NotRomeopro', 'romeopro2', 'xxRoMeOpRo', 'Romeo pro', 'Romeo_pro', 'Romeopr0',
      'Romeopro​',            // zero-width suffix
      'ｒomeopro',             // full-width r
      'Rоmeopro',                  // Cyrillic о
      '', 'Someone',
    ]) {
      expect(isRomeoAuthor(nick), JSON.stringify(nick)).toBe(false)
    }
    expect(isRomeoAuthor(undefined)).toBe(false)
    expect(isRomeoAuthor(null)).toBe(false)
    expect(isRomeoAuthor(42)).toBe(false)
  })

  it('the configured marathon author in the dataset is recognised', () => {
    const meta = JSON.parse(readFileSync(resolve(process.cwd(), 'data/meta.json'), 'utf8'))
    expect(isRomeoAuthor(meta.authorName)).toBe(true)
  })

  it('marathon integrity ignores a look-alike when it picks the latest day', () => {
    const posts = [
      { id: '1', author: 'Romeopro', timestamp: 10, text: 'Day 187:' },
      { id: '2', author: 'RomeoPro_fan', timestamp: 20, text: 'Day 999: fake' },
    ]
    expect(computeMarathonDay(posts, [])).toBe(187)
    const result = validateMarathonIntegrity({ posts, meta: { day: 187, brHistory: [] } })
    expect(result.report.latestDay).toBe(187)
    expect(result.errors).toEqual([])
  })
})

describe('marathon day header (SCR-7 / DL-2)', () => {
  it('extracts every report-header form Romeo has used', () => {
    expect(extractMarathonDay('Day 187:')).toBe(187)
    expect(extractMarathonDay('Day 96')).toBe(96)
    expect(extractMarathonDay('Day 15*\nрезультат')).toBe(15)
    expect(extractMarathonDay('День #5 марафона')).toBe(5)
    expect(extractMarathonDay('день 12')).toBe(12)
    expect(extractMarathonDay('Day #3')).toBe(3)
    expect(extractMarathonDay('day 100')).toBe(100)
    expect(extractMarathonDay('  \nDay 7:')).toBe(7)
  })

  it('does not take a number from casual wording', () => {
    for (const text of [
      'Сейчас играю каждый день 2 сессии по 6 часов.',
      'Сегодня весь день 2 стола играл, отчёт будет позже',
      'Sunday 3 bet pot',
      'Roman day 15 of 30',
      'today 5 final tables',
      'Привет! Day 190 будет позже',
      'Day',
      'Day abc',
      'Day 12ab',
      'День 3х',
      '',
      null,
      undefined,
    ]) {
      expect(extractMarathonDay(text), String(text)).toBeNull()
    }
  })

  it('ignores [QUOTE] bodies', () => {
    expect(extractMarathonDay('[QUOTE]Romeopro|вчера\nDay 99: old report[/QUOTE]Согласен, день 3 был тяжёлый')).toBeNull()
    expect(extractMarathonDay('[QUOTE]Romeopro|вчера\nDay 99[/QUOTE]\nDay 100:')).toBe(100)
    expect(extractMarathonDay('[QUOTE]x|y\nDay 5 cut off by the length cap')).toBeNull()
  })

  it('a later casual Romeo comment no longer flips the day', () => {
    const posts = [
      { id: '1', author: 'Romeopro', timestamp: 10, text: 'Day 187:' },
      { id: '2', author: 'Romeopro', timestamp: 20, text: 'Сегодня весь день 2 стола играл, отчёт будет позже' },
    ]
    expect(computeMarathonDay(posts, [])).toBe(187)
    expect(validateMarathonIntegrity({ posts, meta: { day: 187, brHistory: [] } }).errors).toEqual([])
  })
})
