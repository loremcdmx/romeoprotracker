import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasUsableBankroll, sanitizeBrHistory, sanitizeMeta, trustedCumulativeTotals } from './historyGuards.js'
import { dedupBrHistory } from './utils.js'

const REAL_META = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/meta.json'), 'utf8'))
const rowsWithTotals = totals => totals.map((totalTournaments, i) => ({ id: `r${i}`, timestamp: 1000 + i, brAfter: 10000 + i, totalTournaments }))

describe('sanitizeBrHistory', () => {
  it('drops reports without a finite bankroll and keeps the rest in order', () => {
    const good = { id: 'a', brAfter: 11000 }
    const input = [good, { id: 'b', brAfter: null }, { id: 'c' }, { id: 'd', brAfter: NaN },
      { id: 'e', brAfter: '436 927' }, { id: 'f', brAfter: Infinity }, { id: 'g', brAfter: 0 }, null]
    expect(sanitizeBrHistory(input).map(row => row?.id)).toEqual(['a', 'g'])
    expect(hasUsableBankroll(good)).toBe(true)
    expect(hasUsableBankroll({ brAfter: '11000' })).toBe(false)
  })

  it('returns the very same array and meta object when nothing is dropped', () => {
    const clean = [{ brAfter: 1 }, { brAfter: 2 }]
    expect(sanitizeBrHistory(clean)).toBe(clean)
    const meta = { startBankroll: 10000, brHistory: clean }
    expect(sanitizeMeta(meta)).toBe(meta)
    expect(sanitizeMeta(null)).toBe(null)
    expect(sanitizeMeta({ totalTournaments: 5 })).toEqual({ totalTournaments: 5 })
  })

  it('does not mutate the input meta when it filters', () => {
    const meta = { brHistory: [{ brAfter: 1 }, { brAfter: null }], bankroll: 1 }
    const next = sanitizeMeta(meta)
    expect(next.brHistory).toHaveLength(1)
    expect(next.bankroll).toBe(1)
    expect(meta.brHistory).toHaveLength(2)
  })

  it('keeps every row of the real archive, including its flat transitions', () => {
    const raw = REAL_META.brHistory
    expect(sanitizeBrHistory(raw)).toBe(raw)
    const flat = raw.filter((row, i) => i > 0 && row.totalTournaments === raw[i - 1].totalTournaments)
    expect(flat).toHaveLength(4)
    for (const history of [raw, dedupBrHistory(raw)]) {
      const sorted = history.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      // no real total is distrusted, flat (equal) totals stay as they are
      expect(trustedCumulativeTotals(sorted)).toEqual(sorted.map(row => row.totalTournaments))
    }
  })
})

describe('trustedCumulativeTotals', () => {
  it('keeps a clean, flat and null-bearing series untouched', () => {
    const rows = rowsWithTotals([100, 200, 200, null, 350, 350, 500])
    expect(trustedCumulativeTotals(rows)).toEqual([100, 200, 200, null, 350, 350, 500])
  })

  it('does not let a too-low total become the baseline', () => {
    const rows = rowsWithTotals([100, 200, 300, 40, 500, 600])
    expect(trustedCumulativeTotals(rows)).toEqual([100, 200, 300, null, 500, 600])
  })

  it('does not let a too-high total swallow the following rows', () => {
    const rows = rowsWithTotals([100, 200, 300, 50000, 500, 600])
    expect(trustedCumulativeTotals(rows)).toEqual([100, 200, 300, null, 500, 600])
  })

  it('ignores non-finite, negative and non-numeric totals', () => {
    const rows = rowsWithTotals([100, Infinity, NaN, '300', -5, 0, undefined, 400])
    expect(trustedCumulativeTotals(rows)).toEqual([100, null, null, null, null, null, null, 400])
  })

  it('handles empty input and caches per array', () => {
    expect(trustedCumulativeTotals([])).toEqual([])
    const rows = rowsWithTotals([1, 2])
    expect(trustedCumulativeTotals(rows)).toBe(trustedCumulativeTotals(rows))
  })
})
