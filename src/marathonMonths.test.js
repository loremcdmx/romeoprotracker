import { describe, expect, it } from 'vitest'
import { groupMarathonMonths, normalizeMarathonDistance } from './marathonMonths.js'

const timestamp = date => Date.parse(date) / 1000
const point = (id, date, br, brPrev, totalTournaments = null, tournaments = null) => ({
  id, timestamp: timestamp(date), br, brPrev, totalTournaments, tournaments,
})
const distances = points => normalizeMarathonDistance(points).map(({ cumulativeMTT, distanceMTT }) => ({ cumulativeMTT, distanceMTT }))

describe('normalizeMarathonDistance', () => {
  it('uses cumulative totals from the initial zero baseline and keeps an unchanged cumulative delta at zero', () => {
    expect(distances([
      { totalTournaments: 6000, tournaments: 50 },
      { totalTournaments: 7000, tournaments: 1500 },
      { totalTournaments: 7000, tournaments: 250 },
      { totalTournaments: 7500, tournaments: null },
    ])).toEqual([
      { cumulativeMTT: 6000, distanceMTT: 6000 },
      { cumulativeMTT: 7000, distanceMTT: 1000 },
      { cumulativeMTT: 7000, distanceMTT: 0 },
      { cumulativeMTT: 7500, distanceMTT: 500 },
    ])
    expect(distances([{ totalTournaments: 0, tournaments: 300 }]))
      .toEqual([{ cumulativeMTT: 0, distanceMTT: 0 }])
  })

  it('uses reported MTT only for missing totals and deducts that fallback before the next official total', () => {
    expect(distances([
      { totalTournaments: 1000 },
      { totalTournaments: null, tournaments: 400 },
      { totalTournaments: 2000, tournaments: 500 },
      { tournaments: 0 },
    ])).toEqual([
      { cumulativeMTT: 1000, distanceMTT: 1000 },
      { cumulativeMTT: 1400, distanceMTT: 400 },
      { cumulativeMTT: 2000, distanceMTT: 600 },
      { cumulativeMTT: 2000, distanceMTT: 0 },
    ])
    expect(distances([{ tournaments: 300 }, { tournaments: 200 }, { totalTournaments: 700 }]))
      .toEqual([
        { cumulativeMTT: 300, distanceMTT: 300 },
        { cumulativeMTT: 500, distanceMTT: 200 },
        { cumulativeMTT: 700, distanceMTT: 200 },
      ])
  })

  it('does not attribute an unknown gap to the next session and restores the baseline from a later official total', () => {
    expect(distances([
      { totalTournaments: 1000 },
      { totalTournaments: null, tournaments: null },
      { tournaments: 200 },
      { totalTournaments: 1800, tournaments: 100 },
      { totalTournaments: 2100 },
    ])).toEqual([
      { cumulativeMTT: 1000, distanceMTT: 1000 },
      { cumulativeMTT: null, distanceMTT: null },
      { cumulativeMTT: null, distanceMTT: 200 },
      { cumulativeMTT: 1800, distanceMTT: null },
      { cumulativeMTT: 2100, distanceMTT: 300 },
    ])
  })

  it('marks a backwards cumulative delta unknown while retaining the authoritative total', () => {
    expect(distances([
      { totalTournaments: 3000 },
      { totalTournaments: 2800, tournaments: 200 },
      { totalTournaments: 3200, tournaments: 900 },
    ])).toEqual([
      { cumulativeMTT: 3000, distanceMTT: 3000 },
      { cumulativeMTT: 2800, distanceMTT: null },
      { cumulativeMTT: 3200, distanceMTT: 400 },
    ])
  })

  it('keeps malformed counts unknown instead of coercing or replacing them with reported counts', () => {
    for (const invalid of [-1, NaN, Infinity, '1000']) {
      expect(distances([{ totalTournaments: invalid, tournaments: 500 }]))
        .toEqual([{ cumulativeMTT: null, distanceMTT: null }])
      expect(distances([{ tournaments: invalid }]))
        .toEqual([{ cumulativeMTT: null, distanceMTT: null }])
    }
  })

  it('returns independent row copies and preserves its input and archive order', () => {
    const original = Object.freeze([
      Object.freeze(point('first', '2026-01-01T12:00:00Z', 11000, 10000, 1000)),
      Object.freeze(point('second', '2026-02-01T12:00:00Z', 12000, 11000, 1500)),
    ])
    const normalized = normalizeMarathonDistance(original)
    expect(normalized.map(row => row.id)).toEqual(['first', 'second'])
    normalized.forEach((row, index) => {
      expect(row).not.toBe(original[index])
      expect(row).toMatchObject(original[index])
      expect(original[index]).not.toHaveProperty('distanceMTT')
    })
    expect(normalizeMarathonDistance([])).toEqual([])
    expect(normalizeMarathonDistance()).toEqual([])
  })
})

describe('groupMarathonMonths', () => {
  it('uses the preceding archive baseline after the caller filters to a month', () => {
    const normalized = normalizeMarathonDistance([
      point('jan', '2026-01-15T12:00:00Z', 12000, 10000, 1000),
      point('feb-first', '2026-02-01T12:00:00Z', 14000, 12000, 1500, 1000),
      point('feb-last', '2026-02-20T12:00:00Z', 13000, 14000, 1800, 1000),
    ])
    expect(groupMarathonMonths(normalized.slice(1))).toEqual([{
      key: '2026-02', year: 2026, month: 2, br: 13000, brPrev: 12000, profit: 1000,
      tournaments: 800, totalTournaments: 1800,
      firstTimestamp: timestamp('2026-02-01T12:00:00Z'),
      lastTimestamp: timestamp('2026-02-20T12:00:00Z'),
      timestamp: timestamp('2026-02-20T12:00:00Z'), count: 2,
      firstId: 'feb-first', lastId: 'feb-last',
    }])
  })

  it('assigns UTC month-boundary reports to calendar months in Europe/Warsaw', () => {
    const normalized = normalizeMarathonDistance([
      point('march', '2026-03-31T21:30:00Z', 11000, 10000, 1000),
      point('april', '2026-03-31T22:30:00Z', 12000, 11000, 1500),
    ])
    const months = groupMarathonMonths(normalized)
    expect(months.map(({ key, tournaments }) => ({ key, tournaments })))
      .toEqual([{ key: '2026-03', tournaments: 1000 }, { key: '2026-04', tournaments: 500 }])
    expect(months[1].firstId).toBe('april')
  })

  it('keeps January in different years separate and adds no missing calendar months', () => {
    const normalized = normalizeMarathonDistance([
      point('jan-2025', '2025-01-15T12:00:00Z', 11000, 10000, 1000),
      point('dec-2025', '2025-12-31T22:30:00Z', 12000, 11000, 2000),
      point('jan-2026', '2025-12-31T23:30:00Z', 12500, 12000, 2500),
    ])
    const months = groupMarathonMonths(normalized)
    expect(months.map(({ key, year, month, count }) => ({ key, year, month, count })))
      .toEqual([
        { key: '2025-01', year: 2025, month: 1, count: 1 },
        { key: '2025-12', year: 2025, month: 12, count: 1 },
        { key: '2026-01', year: 2026, month: 1, count: 1 },
      ])
  })

  it('preserves actual zero-distance bankroll reports and picks chronological month endpoints', () => {
    const normalized = normalizeMarathonDistance([
      point('first', '2026-03-01T12:00:00Z', 11000, 10000, 1000),
      point('zero-distance', '2026-03-20T12:00:00Z', 10500, 11000, 1000, 250),
    ])
    const [month] = groupMarathonMonths([...normalized].reverse())
    expect(month).toMatchObject({ key: '2026-03', br: 10500, brPrev: 10000, profit: 500,
      tournaments: 1000, totalTournaments: 1000, count: 2,
      firstId: 'first', lastId: 'zero-distance' })
    expect(month.firstTimestamp).toBe(normalized[0].timestamp)
    expect(month.lastTimestamp).toBe(normalized[1].timestamp)
    expect(normalized[1].distanceMTT).toBe(0)
  })

  it('marks monthly MTT unknown after missing distances or cumulative regressions, while keeping a known month-end total', () => {
    const withGap = normalizeMarathonDistance([
      point('known', '2026-04-01T12:00:00Z', 11000, 10000, 1000),
      point('missing', '2026-04-10T12:00:00Z', 12000, 11000),
      point('resumed', '2026-04-20T12:00:00Z', 13000, 12000, 2000, 500),
    ])
    expect(groupMarathonMonths(withGap)[0]).toMatchObject({ tournaments: null,
      totalTournaments: 2000, profit: 3000, count: 3 })
    const regressed = normalizeMarathonDistance([
      point('before', '2026-05-01T12:00:00Z', 11000, 10000, 3000),
      point('regressed', '2026-05-20T12:00:00Z', 10500, 11000, 2800, 200),
    ])
    expect(groupMarathonMonths(regressed)[0]).toMatchObject({ tournaments: null,
      totalTournaments: 2800, profit: 500, count: 2 })
  })

  it('does not mutate normalized rows or fabricate reports for empty and invalid input', () => {
    const normalized = normalizeMarathonDistance([
      point('actual', '2026-06-01T12:00:00Z', 10000, 10000, 0),
    ]).map(row => Object.freeze(row))
    expect(groupMarathonMonths(Object.freeze(normalized))[0])
      .toMatchObject({ count: 1, tournaments: 0, totalTournaments: 0, profit: 0 })
    expect(groupMarathonMonths([])).toEqual([])
    expect(groupMarathonMonths()).toEqual([])
    expect(groupMarathonMonths([{ timestamp: null }, { timestamp: NaN }, { timestamp: Infinity }])).toEqual([])
  })
})
