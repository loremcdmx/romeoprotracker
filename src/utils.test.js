import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  timeAgo, fmtBR, fmtNum, fmtInt, fmtExact, extractDay, extractBR,
  fk, fkAbs, ROMEO_RE, autoCloseQuotes, stripQuoteTags, extractQuoteBody,
  makeBezierPath, makeBezierArea,
} from './utils.js'

// ─── timeAgo ─────────────────────────────────────────────────────────────────
describe('timeAgo', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-08T12:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  const now = () => Date.now() / 1000

  it('returns null for falsy input', () => {
    expect(timeAgo(null)).toBeNull()
    expect(timeAgo(0)).toBeNull()
    expect(timeAgo(undefined)).toBeNull()
  })

  it('returns "только что" for < 60s ago', () => {
    expect(timeAgo(now() - 30)).toBe('только что')
  })

  it('returns minutes', () => {
    expect(timeAgo(now() - 120)).toBe('2 мин назад')
    expect(timeAgo(now() - 3599)).toBe('59 мин назад')
  })

  it('returns hours', () => {
    expect(timeAgo(now() - 3600)).toBe('1 ч назад')
    expect(timeAgo(now() - 7200)).toBe('2 ч назад')
  })

  it('returns days', () => {
    expect(timeAgo(now() - 86400)).toBe('1 дн назад')
    expect(timeAgo(now() - 86400 * 5)).toBe('5 дн назад')
  })

  it('returns months', () => {
    expect(timeAgo(now() - 86400 * 45)).toBe('1 мес назад')
  })

  it('returns years', () => {
    expect(timeAgo(now() - 86400 * 400)).toBe('1 г назад')
  })
})

// ─── fmtBR ───────────────────────────────────────────────────────────────────
describe('fmtBR', () => {
  it('returns dash for null/undefined', () => {
    expect(fmtBR(null)).toBe('—')
    expect(fmtBR(undefined)).toBe('—')
  })

  it('formats zero', () => {
    expect(fmtBR(0)).toBe('$0')
  })

  it('formats positive values', () => {
    expect(fmtBR(500)).toBe('+$500')
    expect(fmtBR(1500)).toBe('+$1.5k')
    expect(fmtBR(1_500_000)).toBe('+$1.50M')
  })

  it('formats negative values', () => {
    expect(fmtBR(-500)).toBe('-$500')
    expect(fmtBR(-2000)).toBe('-$2.0k')
    expect(fmtBR(-1_000_000)).toBe('-$1.00M')
  })
})

// ─── fmtNum ──────────────────────────────────────────────────────────────────
describe('fmtNum', () => {
  it('returns dash for null/undefined', () => {
    expect(fmtNum(null)).toBe('—')
  })

  it('formats without sign', () => {
    expect(fmtNum(500)).toBe('$500')
    expect(fmtNum(1500)).toBe('$1.5k')
    expect(fmtNum(2_000_000)).toBe('$2.00M')
  })
})

// ─── fmtInt ──────────────────────────────────────────────────────────────────
describe('fmtInt', () => {
  it('returns dash for null/empty', () => {
    expect(fmtInt(null)).toBe('—')
    expect(fmtInt('')).toBe('—')
  })

  it('formats small numbers as-is', () => {
    expect(fmtInt(42)).toBe('42')
    expect(fmtInt(999)).toBe('999')
  })

  it('adds thin space separator for thousands', () => {
    expect(fmtInt(1000)).toBe('1\u202F000')
    expect(fmtInt(1234567)).toBe('1\u202F234\u202F567')
  })

  it('rounds floats', () => {
    expect(fmtInt(1234.7)).toBe('1\u202F235')
  })
})

// ─── fmtExact ────────────────────────────────────────────────────────────────
describe('fmtExact', () => {
  it('returns dash for null/undefined', () => {
    expect(fmtExact(null)).toBe('—')
  })

  it('formats small values', () => {
    expect(fmtExact(500)).toBe('$500')
  })

  it('formats thousands with thin space', () => {
    expect(fmtExact(9957)).toBe('$9\u202F957')
    expect(fmtExact(10000)).toBe('$10\u202F000')
  })
})

// ─── extractDay ──────────────────────────────────────────────────────────────
describe('extractDay', () => {
  it('returns null for no match', () => {
    expect(extractDay(null)).toBeNull()
    expect(extractDay('просто текст')).toBeNull()
  })

  it('extracts day number from various formats', () => {
    expect(extractDay('День #5 марафона')).toBe(5)
    expect(extractDay('день 12')).toBe(12)
    expect(extractDay('Day #3')).toBe(3)
    expect(extractDay('day 100')).toBe(100)
  })
})

// ─── extractBR ───────────────────────────────────────────────────────────────
describe('extractBR', () => {
  it('returns null for empty/no match', () => {
    expect(extractBR(null)).toBeNull()
    expect(extractBR('ничего нет')).toBeNull()
  })

  it('extracts from "после сессии" format', () => {
    expect(extractBR('после сессии: 9957')).toBe(9957)
  })

  it('extracts from dollar-k format', () => {
    expect(extractBR('банкролл $9.9k')).toBe(9900)
  })

  it('extracts from "банкролл" format', () => {
    expect(extractBR('банкролл 12345')).toBe(12345)
  })

  it('rejects values outside range', () => {
    expect(extractBR('после сессии: 100')).toBeNull() // too small
  })
})

// ─── fk ──────────────────────────────────────────────────────────────────────
describe('fk', () => {
  it('formats with sign by default', () => {
    expect(fk(500)).toBe('+$500')
    expect(fk(-500)).toBe('-$500')
    expect(fk(0)).toBe('$0')
  })

  it('formats thousands', () => {
    expect(fk(1500)).toBe('+$1.5k')
    expect(fk(-2000)).toBe('-$2.0k')
  })

  it('can omit sign', () => {
    expect(fk(500, false)).toBe('$500')
    expect(fk(-1500, false)).toBe('$1.5k')
  })
})

// ─── fkAbs ───────────────────────────────────────────────────────────────────
describe('fkAbs', () => {
  it('formats small values', () => {
    expect(fkAbs(500)).toBe('$500')
  })

  it('formats thousands', () => {
    expect(fkAbs(1500)).toBe('$1.5k')
    expect(fkAbs(10000)).toBe('$10.0k')
  })
})

// ─── ROMEO_RE ────────────────────────────────────────────────────────────────
describe('ROMEO_RE', () => {
  it('matches romeopro case-insensitively', () => {
    expect(ROMEO_RE.test('Romeopro')).toBe(true)
    expect(ROMEO_RE.test('ROMEOPRO')).toBe(true)
    expect(ROMEO_RE.test('romeopro')).toBe(true)
    expect(ROMEO_RE.test('somebody')).toBe(false)
  })
})

// ─── autoCloseQuotes ─────────────────────────────────────────────────────────
describe('autoCloseQuotes', () => {
  it('returns text as-is if balanced', () => {
    expect(autoCloseQuotes('[QUOTE]hi[/QUOTE]')).toBe('[QUOTE]hi[/QUOTE]')
  })

  it('closes unclosed quotes', () => {
    expect(autoCloseQuotes('[QUOTE]hi')).toBe('[QUOTE]hi[/QUOTE]')
  })

  it('closes multiple unclosed quotes', () => {
    expect(autoCloseQuotes('[QUOTE][QUOTE]hi')).toBe('[QUOTE][QUOTE]hi[/QUOTE][/QUOTE]')
  })
})

// ─── stripQuoteTags ──────────────────────────────────────────────────────────
describe('stripQuoteTags', () => {
  it('returns empty for null', () => {
    expect(stripQuoteTags(null)).toBe('')
  })

  it('strips matched quotes', () => {
    expect(stripQuoteTags('hello [QUOTE]cited text[/QUOTE] world')).toBe('hello  world')
  })

  it('returns text without quotes unchanged', () => {
    expect(stripQuoteTags('just text')).toBe('just text')
  })

  it('handles unclosed quote by trimming from it', () => {
    expect(stripQuoteTags('before [QUOTE]unclosed')).toBe('before')
  })
})

// ─── extractQuoteBody ────────────────────────────────────────────────────────
describe('extractQuoteBody', () => {
  it('returns empty for null', () => {
    expect(extractQuoteBody(null)).toBe('')
  })

  it('returns empty if no quote', () => {
    expect(extractQuoteBody('no quotes here')).toBe('')
  })

  it('extracts quote body after newline', () => {
    expect(extractQuoteBody('[QUOTE]Author\nbody text[/QUOTE]')).toBe('body text')
  })

  it('handles quote without newline', () => {
    expect(extractQuoteBody('[QUOTE]just body[/QUOTE]')).toBe('just body')
  })
})

// ─── makeBezierPath ──────────────────────────────────────────────────────────
describe('makeBezierPath', () => {
  it('returns empty for < 2 points', () => {
    expect(makeBezierPath([])).toBe('')
    expect(makeBezierPath([{x:0,y:0}])).toBe('')
  })

  it('starts with M and contains C commands', () => {
    const coords = [{x:0,y:0},{x:10,y:5},{x:20,y:10}]
    const path = makeBezierPath(coords)
    expect(path).toMatch(/^M /)
    expect(path).toContain(' C ')
  })

  it('produces valid path for 2 points', () => {
    const coords = [{x:0,y:0},{x:100,y:50}]
    const path = makeBezierPath(coords)
    expect(path).toMatch(/^M 0\.0 0\.0 L /)
  })
})

// ─── makeBezierArea ──────────────────────────────────────────────────────────
describe('makeBezierArea', () => {
  it('returns empty for < 2 points', () => {
    expect(makeBezierArea([], 100)).toBe('')
  })

  it('closes path with Z', () => {
    const coords = [{x:0,y:10},{x:50,y:5},{x:100,y:20}]
    const path = makeBezierArea(coords, 100)
    expect(path).toMatch(/Z$/)
  })

  it('includes baseline coordinates', () => {
    const coords = [{x:0,y:10},{x:100,y:20}]
    const path = makeBezierArea(coords, 200)
    expect(path).toContain('M 0.0 200')
    expect(path).toContain('L 100.0 200 Z')
  })
})
