import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasUsableBankroll, isHistoryRow, sanitizeBrHistory, sanitizeHistoryRow, sanitizeMeta, trustedCumulativeTotals } from './historyGuards.js'
import { REAL_HISTORY } from './realHistoryFixture.js'
import { dedupBrHistory } from './utils.js'

const REAL_META = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/meta.json'), 'utf8'))
const rowsWithTotals = totals => totals.map((totalTournaments, i) => ({ id: `r${i}`, timestamp: 1000 + i, brAfter: 10000 + i, totalTournaments }))
// '1508/60 1887/379': total/reported count per report; 'x' = no reported count
const rowsFrom = spec => spec.split(' ').map((item, i) => {
  const [total, count] = item.split('/')
  return { id: `r${i}`, timestamp: 1000 + i, brAfter: 10000 + i, totalTournaments: Number(total), tournaments: count === 'x' ? null : Number(count) }
})
const trustedOf = spec => trustedCumulativeTotals(rowsFrom(spec))
// what JSON.parse makes of the text 1e999 / -1e999
const INF = JSON.parse('{"x":1e999}').x
const NEG_INF = JSON.parse('{"x":-1e999}').x

describe('sanitizeBrHistory', () => {
  it('drops reports without a finite bankroll and keeps the rest in order', () => {
    const good = { id: 'a', brAfter: 11000 }
    const input = [good, { id: 'b', brAfter: null }, { id: 'c' }, { id: 'd', brAfter: NaN },
      { id: 'e', brAfter: '436 927' }, { id: 'f', brAfter: Infinity }, { id: 'g', brAfter: 0 }, null]
    expect(sanitizeBrHistory(input).map(row => row?.id)).toEqual(['a', 'g'])
    expect(hasUsableBankroll(good)).toBe(true)
    expect(hasUsableBankroll({ brAfter: '11000' })).toBe(false)
  })

  it('drops null and non-object rows, and treats a history that is not an array as empty', () => {
    const good = { id: 'a', brAfter: 11000 }
    const mixed = [null, good, undefined, 5, 'x', [], [good], true]
    expect(sanitizeBrHistory(mixed)).toEqual([good])
    expect([null, good, 5, 'x', [], undefined, {}].map(isHistoryRow)).toEqual([false, true, false, false, false, false, true])
    for (const notAList of [{}, { length: 2 }, 'abc', 5, true]) {
      expect(sanitizeBrHistory(notAList)).toEqual([])
      expect(sanitizeMeta({ bankroll: 1, brHistory: notAList })).toEqual({ bankroll: 1, brHistory: [] })
    }
    expect(sanitizeBrHistory(undefined)).toBeUndefined()
    expect(sanitizeBrHistory(null)).toBeNull()
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

describe('sanitizeHistoryRow / non-finite numbers inside a report', () => {
  const fields = ['tournaments', 'totalTournaments', 'sessionResult', 'brBefore']
  const clean = { id: 'a', timestamp: 1000, brBefore: 10000, brAfter: 11000, sessionResult: 1000, tournaments: 100, totalTournaments: 500,
    rooms: { before: { gg: 9000, ps: 1000 }, after: { gg: 10000, ps: 1000 } } }

  it.each(fields)('drops a non-finite or non-numeric %s and keeps everything else', field => {
    for (const bad of [INF, NEG_INF, NaN, '12', {}, [], true]) {
      const input = { ...clean, [field]: bad }
      const [row] = sanitizeBrHistory([input])
      expect(field in row).toBe(false)
      expect(row).toEqual({ ...clean, [field]: undefined })
      expect(Object.keys(row)).not.toContain(field)
      expect(input[field]).toBe(bad) // the input is not mutated
    }
  })

  it('keeps a report whose bankroll is usable even when every other number is hostile', () => {
    const hostile = { id: 'h', brAfter: 11000, brBefore: INF, sessionResult: NEG_INF, tournaments: INF, totalTournaments: NaN,
      rooms: { before: { gg: INF }, after: { gg: NaN, ps: 5 } } }
    expect(sanitizeBrHistory([hostile])).toEqual([{ id: 'h', brAfter: 11000, rooms: { before: {}, after: { ps: 5 } } }])
  })

  it('leaves null, undefined, zero and negative finite values alone (and returns the very same row)', () => {
    for (const row of [
      { brAfter: 1, tournaments: null },
      { brAfter: 1, tournaments: 0, sessionResult: 0, brBefore: 0, totalTournaments: 0 },
      { brAfter: 1, sessionResult: -5000, brBefore: -1 },
      { brAfter: 1, rooms: null },
      clean,
    ]) {
      expect(sanitizeHistoryRow(row)).toBe(row)
    }
    const history = [clean, { brAfter: 1, tournaments: null }]
    expect(sanitizeBrHistory(history)).toBe(history)
    expect(sanitizeMeta({ brHistory: history })).toEqual({ brHistory: history })
  })

  it('keeps the same objects for the rows that are fine when another row is fixed', () => {
    const fine = { brAfter: 1, tournaments: 5 }
    const next = sanitizeBrHistory([fine, { brAfter: 2, tournaments: INF }])
    expect(next[0]).toBe(fine)
    expect(next[1]).toEqual({ brAfter: 2 })
  })

  it('drops room values that are not finite numbers, and rooms that are not before/after objects', () => {
    const rooms = { before: { gg: 100, ps: INF, king: '5' }, after: { gg: NEG_INF, ps: 3, coin: 0 } }
    expect(sanitizeHistoryRow({ brAfter: 1, rooms }).rooms).toEqual({ before: { gg: 100 }, after: { ps: 3, coin: 0 } })
    expect(rooms.before.ps).toBe(INF)
    for (const wrong of ['gg', 5, [], { before: { gg: 1 } }, { after: { gg: 1 } }, { before: 5, after: {} }, { before: [], after: {} }]) {
      expect('rooms' in sanitizeHistoryRow({ brAfter: 1, rooms: wrong })).toBe(false)
    }
    const fine = { before: { gg: 1 }, after: { gg: 2 } }
    expect(sanitizeHistoryRow({ brAfter: 1, rooms: fine }).rooms).toBe(fine)
  })

  it('does not change a single row of the real archive (same objects, same array, same meta)', () => {
    const raw = REAL_META.brHistory
    expect(raw.every(row => sanitizeHistoryRow(row) === row)).toBe(true)
    expect(sanitizeBrHistory(raw)).toBe(raw)
    expect(sanitizeMeta(REAL_META)).toBe(REAL_META)
    // the one real report without a count keeps its null
    expect(raw.filter(row => row.tournaments === null)).toHaveLength(1)
  })
})

describe('trustedCumulativeTotals: equal runs are told apart by the reported counts', () => {
  it('a too-low total between the two previous totals loses to the report its count confirms', () => {
    // 1626 is a mis-read 2116 (1887 + 229): the runs [1508, 1887, 2613] and [1508, 1626, 2613] are equally long
    expect(trustedOf('1508/60 1887/379 1626/229 2613/497')).toEqual([1508, 1887, null, 2613])
    expect(trustedOf('1922/405 2320/398 2011/354 2818/144 3042/224')).toEqual([1922, 2320, null, 2818, 3042])
  })

  it('works at the end of the series, where the later report would otherwise win', () => {
    expect(trustedOf('1000/100 1500/500 1200/300')).toEqual([1000, 1500, null])
  })

  it('works one report later in the series', () => {
    // 1350 is a mis-read 1850 (1500 + 350)
    expect(trustedOf('1000/100 1500/500 1350/350 2400/550')).toEqual([1000, 1500, null, 2400])
    // a too-high total is settled by the longer run, with or without counts
    expect(trustedOf('1000/100 1500/500 5000/350 2400/550')).toEqual([1000, 1500, null, 2400])
  })

  it('falls back to the later report when no count can tell them apart', () => {
    // no counts, or counts that confirm nothing: the old rule (later report) stays
    expect(trustedOf('1508/x 1887/x 1626/x 2613/x')).toEqual([1508, null, 1626, 2613])
    expect(trustedOf('1508/1 1887/2 1626/3 2613/4')).toEqual([1508, null, 1626, 2613])
    expect(trustedCumulativeTotals(rowsWithTotals([1508, 1887, 1626, 2613]))).toEqual([1508, null, 1626, 2613])
  })

  it('a step is only confirmed when every count in between is known', () => {
    // no count to confirm anything with: the later report wins, as before
    expect(trustedOf('1508/60 1887/x 1626/x 2613/497')).toEqual([1508, null, 1626, 2613])
    // 1508 -> 1887 is still confirmed by its own count, 1887 -> 2613 is not needed
    expect(trustedOf('1508/60 1887/379 1626/x 2613/497')).toEqual([1508, 1887, null, 2613])
  })

  it('never trades a longer run for a better confirmed shorter one', () => {
    // [100, 5000] is the better confirmed run (its step equals the reported 4900, while
    // the counts of 200/300/400 are unknown), but [100, 200, 300, 400] is strictly longer
    expect(trustedOf('100/100 5000/4900 200/x 300/x 400/x')).toEqual([100, null, 200, 300, 400])
    // the same when the longer run is only partly unconfirmed
    expect(trustedOf('100/100 5000/4900 200/x 300/100 400/100')).toEqual([100, null, 200, 300, 400])
  })

  it('on equal length, the better confirmed run wins over the later one', () => {
    // [100, 400] and [100, 300] are equally long; only 100 -> 400 equals the reported 300
    expect(trustedOf('100/100 400/300 300/100')).toEqual([100, 400, null])
  })

  it('does not look at counts that are not plain non-negative numbers', () => {
    const rows = rowsFrom('1508/60 1887/379 1626/229 2613/497')
    rows[1].tournaments = '379'
    rows[2].tournaments = INF
    expect(trustedCumulativeTotals(rows)).toEqual([1508, null, 1626, 2613])
  })

  it('keeps every total of the real archive, with the real counts and its lagging reports', () => {
    const real = REAL_META.brHistory.slice().sort((a, b) => a.timestamp - b.timestamp)
    expect(trustedCumulativeTotals(real)).toEqual(real.map(row => row.totalTournaments))
  })

  // One mis-read total in the real archive (its own totals and counts, lagging
  // reports included). The old rule picked the outlier in about 1.4% of these
  // (the later report always won a tie); the counts settle every one of them.
  describe('single mis-read total injected into the real archive', () => {
    const base = REAL_HISTORY.map(([timestamp, brAfter, sessionResult, tournaments, totalTournaments]) =>
      ({ timestamp, brAfter, sessionResult, tournaments, totalTournaments }))
    const good = base.map(row => row.totalTournaments)
    const outcome = (k, bad) => {
      const rows = base.map((row, i) => i === k ? { ...row, totalTournaments: bad } : { ...row })
      const trusted = trustedCumulativeTotals(rows)
      return trusted[k] === null && trusted.every((total, i) => i === k || total === good[i])
    }

    it('too low, landing between the totals of the two reports before it (the tie)', () => {
      const missed = []
      for (let k = 2; k < base.length; k++) {
        const lo = good[k - 2], hi = good[k - 1]
        for (const bad of [lo + 1, Math.floor((lo * 3 + hi) / 4), Math.floor((lo + hi) / 2), Math.floor((lo + hi * 3) / 4)]) {
          if (bad > lo && bad < hi && !outcome(k, bad)) missed.push([k, bad])
        }
      }
      expect(missed).toEqual([])
    })

    it('2 400 seeded random positions and values, too low and too high', () => {
      let seed = 20261019
      const random = () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1))
      let tried = 0
      const missed = []
      for (let n = 0; n < 2400; n++) {
        const k = between(1, base.length - 1)
        const bad = random() < 0.5 ? good[k] + between(1, 6000) : between(1, good[k] - 1)
        const next = k < base.length - 1 ? good[k + 1] : Infinity
        // consistent with its neighbours = not a mis-read; a too-high last report cannot be seen
        if ((bad >= good[k - 1] && bad <= next) || (k === base.length - 1 && bad > good[k])) continue
        tried++
        if (!outcome(k, bad)) missed.push([k, bad])
      }
      expect(tried).toBeGreaterThan(2000)
      expect(missed).toEqual([])
    })
  })
})
