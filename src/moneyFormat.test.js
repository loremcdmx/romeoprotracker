import { describe, expect, it } from 'vitest'
import {
  fmtBR, fmtNum, fmtInt, fmtExact, fmtExactSigned, fk, fkAbs,
  fmtMoneyShort, fmtMoneyTick, fmtDateTimeLang, spansMultipleYears,
} from './utils.js'
import { fmtDateShortLang } from './i18n.js'

// Every expected string below is written out by hand (not derived from the
// formatter under test). T is the thin no-break space the exact formatters use.
const T = ' '

// ─── exact-dollar formatters: every thousand is grouped, any magnitude ───────
describe.each([
  ['fmtExact', fmtExact, {
    0: '0$', 1: '1$', 999: '999$', 1000: `1${T}000$`, 999949: `999${T}949$`, 999950: `999${T}950$`,
    999999: `999${T}999$`, 1e6: `1${T}000${T}000$`, 1234567: `1${T}234${T}567$`,
    12345678: `12${T}345${T}678$`, [-1]: '-1$', [-999]: '-999$', [-1000]: `-1${T}000$`,
    [-12345]: `-12${T}345$`, [-1234567]: `-1${T}234${T}567$`,
  }],
  ['fmtExactSigned', fmtExactSigned, {
    0: '0$', 1: '+1$', 999: '+999$', 1000: `+1${T}000$`, 999949: `+999${T}949$`, 999950: `+999${T}950$`,
    999999: `+999${T}999$`, 1e6: `+1${T}000${T}000$`, 1234567: `+1${T}234${T}567$`,
    12345678: `+12${T}345${T}678$`, [-1]: '-1$', [-999]: '-999$', [-1000]: `-1${T}000$`,
    [-12345]: `-12${T}345$`, [-1234567]: `-1${T}234${T}567$`,
  }],
])('%s', (_, fn, table) => {
  it.each(Object.entries(table))('formats %s', (input, expected) => {
    expect(fn(Number(input))).toBe(expected)
  })

  it('rounds to whole dollars and promotes carries into the next group', () => {
    expect(fn(999.6).replace(/^\+/, '')).toBe(`1${T}000$`)
    expect(fn(999999.5).replace(/^\+/, '')).toBe(`1${T}000${T}000$`)
    expect(fn(-0.4)).toBe('0$')
  })

  it('returns a dash for missing values', () => {
    expect(fn(null)).toBe('—')
    expect(fn(undefined)).toBe('—')
    expect(fn(NaN)).toBe('—')
  })

  it('never leaves an ungrouped run of four digits, whatever the magnitude', () => {
    for (let n = 0; n <= 25_000_000; n += n < 2_100_000 ? 997 : 99_991) {
      for (const value of [n, -n]) {
        const out = fn(value)
        expect(out).toMatch(/^[+-]?\d{1,3}( \d{3})*\$$/)
        expect(out.replace(/[^\d]/g, '')).toBe(String(n))
      }
    }
  })

  it('agrees with fmtInt on the digits', () => {
    for (const n of [1000, 12345, 999999, 1000000, 10000000, 123456789]) {
      expect(fn(n).replace(/^\+/, '')).toBe(`${fmtInt(n)}$`)
    }
  })
})

// ─── compact formatters: k below $999 950, M from there, never "1000.0k" ─────
describe.each([
  ['fmtBR', fmtBR, {
    0: '0$', 1: '+1$', 999: '+999$', 1000: '+1.0k$', 999949: '+999.9k$', 999950: '+1.00M$',
    999999: '+1.00M$', 1e6: '+1.00M$', 1234567: '+1.23M$', 12345678: '+12.35M$',
    [-1]: '-1$', [-999]: '-999$', [-1000]: '-1.0k$', [-999949]: '-999.9k$', [-999950]: '-1.00M$',
    [-1234567]: '-1.23M$',
  }],
  ['fk', fk, {
    0: '0$', 1: '+1$', 999: '+999$', 1000: '+1.0k$', 999949: '+999.9k$', 999950: '+1.00M$',
    999999: '+1.00M$', 1e6: '+1.00M$', 1234567: '+1.23M$', 12345678: '+12.35M$',
    [-1]: '-1$', [-999]: '-999$', [-1000]: '-1.0k$', [-999949]: '-999.9k$', [-999950]: '-1.00M$',
    [-1234567]: '-1.23M$',
  }],
  ['fmtNum', fmtNum, {
    0: '0$', 1: '1$', 999: '999$', 1000: '1.0k$', 999949: '999.9k$', 999950: '1.00M$',
    999999: '1.00M$', 1e6: '1.00M$', 1234567: '1.23M$', 12345678: '12.35M$',
  }],
  ['fkAbs', fkAbs, {
    0: '0$', 1: '1$', 999: '999$', 1000: '1.0k$', 999949: '999.9k$', 999950: '1.00M$',
    999999: '1.00M$', 1e6: '1.00M$', 1234567: '1.23M$', 12345678: '12.35M$',
    [-1]: '-1$', [-999]: '-999$', [-1000]: '-1.0k$', [-999950]: '-1.00M$', [-1234567]: '-1.23M$',
  }],
])('%s', (_, fn, table) => {
  it.each(Object.entries(table))('formats %s', (input, expected) => {
    expect(fn(Number(input))).toBe(expected)
  })

  it('never prints a four-digit k or M amount', () => {
    // Dense around the $1M boundary, coarse elsewhere.
    const bad = []
    const check = n => {
      for (const value of [n, -n]) {
        const out = fn(value)
        if (/\d{4}(\.\d)?k|\d{4}(\.\d+)?M/.test(out)) bad.push(`${value} -> ${out}`)
      }
    }
    for (let n = 990_000; n <= 1_010_000; n++) check(n)
    for (let n = 0; n <= 30_000_000; n += 997) check(n)
    expect(bad).toEqual([])
  })
})

describe('fk without sign', () => {
  it('drops the sign but keeps the M tier', () => {
    expect(fk(-999950, false)).toBe('1.00M$')
    expect(fk(-1234567, false)).toBe('1.23M$')
    expect(fk(500, false)).toBe('500$')
  })
})

// ─── "$"-prefixed labels for axes and badges ─────────────────────────────────
describe('fmtMoneyShort', () => {
  it.each([
    [0, '$0'], [1, '$1'], [999, '$999'], [1000, '$1k'], [436927, '$437k'], [999499, '$999k'],
    [999500, '$1M'], [999949, '$1M'], [999950, '$1M'], [999999, '$1M'], [1e6, '$1M'],
    [1234567, '$1.23M'], [1200000, '$1.2M'], [12345678, '$12.35M'],
    [-1, '-$1'], [-999, '-$999'], [-1500, '-$2k'], [-999950, '-$1M'], [-1234567, '-$1.23M'],
  ])('formats %s', (input, expected) => {
    expect(fmtMoneyShort(input)).toBe(expected)
  })

  it('honours the requested decimals', () => {
    expect(fmtMoneyShort(402500, 1)).toBe('$402.5k')
    expect(fmtMoneyShort(1_025_000, 0, 3)).toBe('$1.025M')
    expect(fmtMoneyShort(1_050_000, 0, 3)).toBe('$1.05M')
    expect(fmtMoneyShort(1_234_567, 0, 1)).toBe('$1.2M')
  })

  it('returns a dash for missing or non-finite values', () => {
    for (const value of [null, undefined, NaN, Infinity, '1000']) expect(fmtMoneyShort(value)).toBe('—')
  })

  it('never prints a four-digit k amount', () => {
    const bad = []
    for (let n = 0; n <= 12_000_000; n += n < 1_100_000 ? 13 : 999) {
      for (const out of [fmtMoneyShort(n), fmtMoneyShort(n, 1), fmtMoneyShort(n, 0, 3)]) {
        if (/\d{4}(\.\d)?k/.test(out)) bad.push(`${n} -> ${out}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('fmtMoneyTick', () => {
  it.each([
    [0, '$0'], [500, '$500'], [1000, '$1k'], [2000, '$2k'], [402500, '$402.5k'], [403000, '$403k'],
    [999000, '$999k'], [1e6, '$1M'], [1_002_000, '$1.002M'], [1_000_500, '$1.0005M'],
    [1_500_000, '$1.5M'], [10_000_000, '$10M'], [10_500_000, '$10.5M'], [12_000_000, '$12M'],
  ])('formats %s', (input, expected) => {
    expect(fmtMoneyTick(input)).toBe(expected)
  })

  it('gives different tick values different text', () => {
    const labels = []
    for (let v = 1_000_000; v <= 1_004_000; v += 500) labels.push(fmtMoneyTick(v))
    expect(new Set(labels).size).toBe(labels.length)
  })
})

// ─── year-aware date labels ──────────────────────────────────────────────────
const MARCH_2027 = Date.UTC(2027, 2, 10, 12) / 1000 // 13:00 in Warsaw (CET)

describe('fmtDateShortLang with a year', () => {
  it.each([
    ['ru', '10 мар 27'],
    ['en', '10 Mar 27'],
    ['es', '10 mar 27'],
  ])('appends a two-digit year in %s', (lang, expected) => {
    expect(fmtDateShortLang(MARCH_2027, lang, true)).toBe(expected)
  })

  it('keeps the old text when no year is requested', () => {
    expect(fmtDateShortLang(MARCH_2027, 'ru')).toBe('10 мар')
    expect(fmtDateShortLang(MARCH_2027, 'en', false)).toBe('10 Mar')
    expect(fmtDateShortLang(MARCH_2027, 'es', false)).toBe('10 mar')
  })

  it('takes the year from the Warsaw calendar, not UTC', () => {
    // 31 Dec 23:30 UTC is already 1 Jan 00:30 in Warsaw.
    const newYear = Date.UTC(2026, 11, 31, 23, 30) / 1000
    expect(fmtDateShortLang(newYear, 'ru', true)).toBe('1 янв 27')
    expect(fmtDateShortLang(newYear, 'en', true)).toBe('1 Jan 27')
  })

  it('does not treat the array index of a .map callback as the year flag', () => {
    expect([MARCH_2027].map(ts => fmtDateShortLang(ts, 'ru'))).toEqual(['10 мар'])
  })
})

describe('fmtDateTimeLang with a year', () => {
  it.each([
    ['ru', '10 марта 2027, 13:00'],
    ['en', '10 March 2027, 13:00'],
    ['es', '10 de marzo de 2027, 13:00'],
  ])('adds the full year in %s', (lang, expected) => {
    expect(fmtDateTimeLang(MARCH_2027, lang, true)).toBe(expected)
  })

  it('is unchanged without the flag', () => {
    expect(fmtDateTimeLang(MARCH_2027, 'ru')).toBe('10 марта, 13:00')
    expect(fmtDateTimeLang(MARCH_2027, 'en')).toBe('10 March, 13:00')
    expect(fmtDateTimeLang(MARCH_2027, 'es')).toBe('10 de marzo, 13:00')
  })
})

describe('spansMultipleYears', () => {
  const at = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h) / 1000

  it('is false for no data, bad timestamps and a single year', () => {
    expect(spansMultipleYears([])).toBe(false)
    expect(spansMultipleYears([null, undefined, 0, NaN])).toBe(false)
    expect(spansMultipleYears([at(2026, 3, 11), at(2026, 10, 18)])).toBe(false)
    expect(spansMultipleYears([at(2026, 3, 11)])).toBe(false)
  })

  it('is true as soon as the range crosses a calendar year', () => {
    expect(spansMultipleYears([at(2026, 12, 31), at(2027, 1, 1)])).toBe(true)
    expect(spansMultipleYears([at(2026, 3, 11), at(2027, 4, 2), at(2028, 2, 1)])).toBe(true)
  })

  it('does not depend on the order of the timestamps', () => {
    expect(spansMultipleYears([at(2027, 5, 1), at(2026, 3, 11), at(2026, 9, 1)])).toBe(true)
  })

  it('uses Warsaw time for the year boundary', () => {
    // 31 Dec 23:30 UTC is 1 Jan in Warsaw: same Warsaw year as 1 Jan noon.
    expect(spansMultipleYears([Date.UTC(2026, 11, 31, 23, 30) / 1000, at(2027, 1, 1)])).toBe(false)
    // 31 Dec 22:30 UTC is 31 Dec 23:30 in Warsaw: still 2026.
    expect(spansMultipleYears([Date.UTC(2026, 11, 31, 22, 30) / 1000, at(2027, 1, 1)])).toBe(true)
  })
})
