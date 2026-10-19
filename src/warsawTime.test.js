import { describe, expect, it } from 'vitest'
import { fmtDateTimeLang, warsawDayKey, warsawParts } from './utils.js'

// Site policy: every timestamp is shown in Europe/Warsaw whatever the browser
// time zone is. These instants straddle the 2026-10-25 EU DST change (CEST,
// UTC+2 -> CET, UTC+1 at 01:00 UTC) and the 2026-03-29 one, and sit at 22:xx /
// 23:xx UTC where the UTC calendar day and the Warsaw day disagree. Noon
// instants would hide all of that, because UTC and Warsaw then share the day.
const at = iso => Date.parse(iso) / 1000

const CASES = [
  // [UTC instant, y, m, d, hour, minute, note]
  ['2026-10-24T21:59:00Z', 2026, 10, 24, 23, 59, 'CEST, last minute of the 24th'],
  ['2026-10-24T22:00:00Z', 2026, 10, 25, 0, 0, 'CEST midnight, the day is already the 25th'],
  ['2026-10-24T22:30:00Z', 2026, 10, 25, 0, 30, 'CEST, UTC day is still the 24th'],
  ['2026-10-24T23:30:00Z', 2026, 10, 25, 1, 30, 'CEST, UTC day is still the 24th'],
  ['2026-10-25T00:30:00Z', 2026, 10, 25, 2, 30, 'first 02:30, still CEST'],
  ['2026-10-25T01:00:00Z', 2026, 10, 25, 2, 0, 'clocks went back: 03:00 CEST -> 02:00 CET'],
  ['2026-10-25T01:30:00Z', 2026, 10, 25, 2, 30, 'second 02:30, now CET'],
  ['2026-10-25T22:30:00Z', 2026, 10, 25, 23, 30, 'CET, same day in UTC and Warsaw'],
  ['2026-10-25T23:00:00Z', 2026, 10, 26, 0, 0, 'CET midnight, UTC day is still the 25th'],
  ['2026-10-25T23:30:00Z', 2026, 10, 26, 0, 30, 'CET, UTC day is still the 25th'],
  ['2026-01-15T22:30:00Z', 2026, 1, 15, 23, 30, 'winter, 23:30 not 22:30'],
  ['2026-07-15T22:30:00Z', 2026, 7, 16, 0, 30, 'summer, next day'],
  ['2026-03-29T00:30:00Z', 2026, 3, 29, 1, 30, 'before spring forward, CET'],
  ['2026-03-29T01:30:00Z', 2026, 3, 29, 3, 30, 'after spring forward, 02:xx does not exist'],
]

// Compare numerically so the test pins the time, not the padding or the type.
function clockOf(text) {
  const match = String(text).match(/(\d{1,2}):(\d{2})/)
  expect(match, `no HH:MM in "${text}"`).not.toBeNull()
  return { hour: Number(match[1]), minute: Number(match[2]), rest: String(text).replace(match[0], ' ') }
}

describe('warsawParts', () => {
  it.each(CASES)('%s -> Warsaw local time (%#)', (iso, year, month, day, hour, minute) => {
    const parts = warsawParts(at(iso))
    expect({
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour: Number(parts.hour), minute: Number(parts.minute),
    }).toEqual({ year, month, day, hour, minute })
  })
})

describe('warsawDayKey', () => {
  it.each(CASES)('%s -> Warsaw calendar day (%#)', (iso, year, month, day) => {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    expect(warsawDayKey(at(iso))).toBe(key)
  })
})

describe('fmtDateTimeLang', () => {
  // Hour first, minute second, in Warsaw time, with the Warsaw day, for each
  // UI language. Exact wording around the time is not pinned.
  describe.each(['ru', 'en', 'es'])('%s', lang => {
    it.each(CASES)('%s shows the Warsaw clock and day (%#)', (iso, year, month, day, hour, minute) => {
      const text = fmtDateTimeLang(at(iso), lang)
      const clock = clockOf(text)
      expect({ hour: clock.hour, minute: clock.minute }).toEqual({ hour, minute })
      expect(clock.rest).toMatch(new RegExp(`(^|\\D)${day}(\\D|$)`))
    })
  })

  it('does not show the UTC calendar day or hour across midnight', () => {
    // 22:30 UTC on the 24th is 00:30 on the 25th in Warsaw (CEST).
    const text = fmtDateTimeLang(at('2026-10-24T22:30:00Z'), 'en')
    expect(text).not.toMatch(/(^|\D)24(\D|$)/)
    expect(text).not.toMatch(/22:30/)
  })
})
