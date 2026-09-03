import { describe, expect, it } from 'vitest'
import { groupSessionMttRows } from './sessionMtt.js'

const ts = iso => Date.parse(iso) / 1000
const row = (iso, mtt, profit = 0) => ({ timestamp:ts(iso), mtt, profit })

describe('groupSessionMttRows', () => {
  it('keeps each session and its reported value, including multiple sessions on one day', () => {
    const early = row('2026-08-03T08:00:00Z', 140, -200)
    const late = row('2026-08-03T18:00:00Z', 260, 600)
    const input = [late, early]
    const result = groupSessionMttRows(input)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      timestamp:early.timestamp, firstTimestamp:early.timestamp, lastTimestamp:early.timestamp,
      mtt:140, totalMtt:140, sessionCount:1, profit:-200,
      periodStartKey:'2026-08-03', periodEndKey:'2026-08-03',
    })
    expect(result[1]).toMatchObject({ mtt:260, totalMtt:260, sessionCount:1, profit:600 })
    expect(result[0].key).not.toBe(result[1].key)
    expect(input).toEqual([late, early])
    expect(early).not.toHaveProperty('sessionCount')
  })

  it('separates Sunday and Monday using Warsaw dates, not UTC dates', () => {
    const result = groupSessionMttRows([
      row('2026-08-02T21:59:00Z', 100), // Sunday 23:59 in Warsaw.
      row('2026-08-02T22:01:00Z', 300), // Monday 00:01 in Warsaw.
    ], 'week')

    expect(result.map(r => [r.periodStartKey, r.periodEndKey, r.mtt])).toEqual([
      ['2026-07-27', '2026-08-02', 100],
      ['2026-08-03', '2026-08-09', 300],
    ])
  })

  it('keeps the spring DST Sunday in its calendar week and moves Monday to the next', () => {
    const result = groupSessionMttRows([
      row('2026-03-29T00:30:00Z', 100), // 01:30 CET.
      row('2026-03-29T01:30:00Z', 200), // 03:30 CEST.
      row('2026-03-29T21:59:00Z', 300),
      row('2026-03-29T22:01:00Z', 400), // Monday after the offset changes.
    ], 'week')

    expect(result[0]).toMatchObject({ periodStartKey:'2026-03-23', periodEndKey:'2026-03-29', sessionCount:3, mtt:200 })
    expect(result[1]).toMatchObject({ periodStartKey:'2026-03-30', periodEndKey:'2026-04-05', sessionCount:1, mtt:400 })
  })

  it('handles the repeated autumn DST hour without collapsing sessions', () => {
    const result = groupSessionMttRows([
      row('2026-10-25T00:30:00Z', 100), // 02:30 CEST.
      row('2026-10-25T01:30:00Z', 200), // 02:30 CET.
      row('2026-10-25T22:59:00Z', 300),
      row('2026-10-25T23:01:00Z', 400), // Monday CET.
    ], 'week')

    expect(result[0]).toMatchObject({ periodStartKey:'2026-10-19', periodEndKey:'2026-10-25', sessionCount:3, mtt:200 })
    expect(result[1]).toMatchObject({ periodStartKey:'2026-10-26', periodEndKey:'2026-11-01', sessionCount:1 })
  })

  it('groups a Monday-Sunday week across a year boundary', () => {
    const result = groupSessionMttRows([
      row('2026-01-01T12:00:00Z', 300, -50),
      row('2025-12-29T12:00:00Z', 100, 150),
      row('2026-01-05T12:00:00Z', 200, 200),
    ], 'week')

    expect(result[0]).toMatchObject({ periodStartKey:'2025-12-29', periodEndKey:'2026-01-04', totalMtt:400, mtt:200, sessionCount:2, profit:100 })
    expect(result[1]).toMatchObject({ periodStartKey:'2026-01-05', periodEndKey:'2026-01-11', sessionCount:1 })
  })

  it('groups calendar months at Warsaw midnight and uses leap-year month ends', () => {
    const result = groupSessionMttRows([
      row('2024-01-31T22:59:00Z', 100),
      row('2024-01-31T23:01:00Z', 200),
      row('2024-02-29T22:59:00Z', 400),
      row('2024-02-29T23:01:00Z', 500),
    ], 'month')

    expect(result.map(r => [r.periodStartKey, r.periodEndKey, r.mtt])).toEqual([
      ['2024-01-01', '2024-01-31', 100],
      ['2024-02-01', '2024-02-29', 300],
      ['2024-03-01', '2024-03-31', 500],
    ])
  })

  it('uses the pooled session mean, not an unweighted average of daily averages', () => {
    const result = groupSessionMttRows([
      row('2026-08-03T08:00:00Z', 100, 10),
      row('2026-08-03T18:00:00Z', 200, 20),
      row('2026-08-04T08:00:00Z', 600, 30),
    ], 'week')

    expect(result[0]).toMatchObject({ totalMtt:900, sessionCount:3, mtt:300, profit:60 })
  })

  it.each(['session', 'week', 'month'])('preserves the total and count for %s grouping', grouping => {
    const input = [
      row('2026-07-01T08:00:00Z', 105, -50),
      row('2026-08-03T08:00:00Z', 215, 80),
      row('2026-08-03T18:00:00Z', 330, 120),
      row('2026-08-25T08:00:00Z', 410, -20),
    ]
    const result = groupSessionMttRows(input, grouping)

    expect(result.reduce((sum, r) => sum + r.totalMtt, 0)).toBe(1060)
    expect(result.reduce((sum, r) => sum + r.sessionCount, 0)).toBe(4)
    expect(result.reduce((sum, r) => sum + r.profit, 0)).toBe(130)
    expect(result.reduce((sum, r) => sum + r.mtt * r.sessionCount, 0)).toBeCloseTo(1060)
  })

  it('keeps the first and last actual session timestamps while omitting empty buckets', () => {
    const first = row('2026-06-10T08:00:00Z', 120)
    const last = row('2026-06-20T18:00:00Z', 240)
    const result = groupSessionMttRows([row('2026-08-12T08:00:00Z', 180), last, first], 'month')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      timestamp:first.timestamp, firstTimestamp:first.timestamp, lastTimestamp:last.timestamp,
      periodStartKey:'2026-06-01', periodEndKey:'2026-06-30',
    })
    expect(result[1].periodStartKey).toBe('2026-08-01')
  })

  it.each([null, undefined, NaN, Infinity])('does not claim a full profit total when a session profit is %s', missing => {
    const result = groupSessionMttRows([
      row('2026-08-03T08:00:00Z', 100, 50),
      { timestamp:ts('2026-08-04T08:00:00Z'), mtt:200, profit:missing },
      row('2026-08-05T08:00:00Z', 300, 70),
    ], 'week')

    expect(result[0]).toMatchObject({ mtt:200, totalMtt:600, sessionCount:3, profit:null })
  })

  it('returns empty output for no rows and preserves a single fractional-valued session', () => {
    expect(groupSessionMttRows([])).toEqual([])
    expect(groupSessionMttRows(null, 'week')).toEqual([])
    const result = groupSessionMttRows([row('2026-08-03T08:00:00Z', 123.5, 0)], 'month')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ mtt:123.5, totalMtt:123.5, sessionCount:1, profit:0 })
  })
})
