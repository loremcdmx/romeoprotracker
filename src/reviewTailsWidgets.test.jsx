// Review tails 2026-11-16, package tail-b (pace and session widgets):
//   ASM-T1 / K4-2  a session bar that absorbs two flat-total reports sums both
//   K4-4           the latest pace label goes below a losing dot, above a winning one
//   K4-5 / K4-6    pure label geometry helpers
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App, { buildSessionMttRows } from './App.jsx'
import { paceLabelBox, segmentTouchesRect } from './paceLabels.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

beforeAll(() => {
  window.matchMedia = query => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('ASM-T1 (K4-2): two absorbed flat-total reports carry both results', () => {
  const t = 1790000000
  it('a: 500, b: 100 (flat), c: 200 (flat), d: 300 counted -> the d bar shows 600 and 3 reports', () => {
    const rows = [
      { id: 'a', timestamp: t, brAfter: 11000, sessionResult: 500, tournaments: 300, totalTournaments: 1000 },
      { id: 'b', timestamp: t + 3600, brAfter: 11100, sessionResult: 100, tournaments: 0, totalTournaments: 1000 },
      { id: 'c', timestamp: t + 7200, brAfter: 11300, sessionResult: 200, tournaments: 0, totalTournaments: 1000 },
      { id: 'd', timestamp: t + 10800, brAfter: 11600, sessionResult: 300, tournaments: 300, totalTournaments: 1300 },
    ]
    const out = buildSessionMttRows(rows)
    expect(out.map(r => r.profit)).toEqual([500, 600])
    expect(out.map(r => r.reports)).toEqual([1, 3])
    // the money of the bars adds up to the money of the reports
    expect(out.reduce((s, r) => s + r.profit, 0)).toBe(500 + 100 + 200 + 300)
  })
})

describe('K4-5 / K4-6: label geometry helpers', () => {
  it('K4-5: a start-anchored label grows to the right of x, an end-anchored one to the left, a middle one both ways', () => {
    expect(paceLabelBox({ x: 100, anchor: 'start', width: 40 }, 50)).toMatchObject({ left: 100, right: 140 })
    expect(paceLabelBox({ x: 100, anchor: 'end', width: 40 }, 50)).toMatchObject({ left: 60, right: 100 })
    expect(paceLabelBox({ x: 100, anchor: 'middle', width: 40 }, 50)).toMatchObject({ left: 80, right: 120 })
  })

  it('K4-6: a segment parallel to a rect side and lying exactly on that side touches it; one outside does not', () => {
    const rect = { left: 10, right: 20, top: 10, bottom: 20 }
    // vertical segment on x = rect.left (parallel case, q === 0)
    expect(segmentTouchesRect({ x: 10, y: 0 }, { x: 10, y: 30 }, rect)).toBe(true)
    // same on the right, top and bottom sides
    expect(segmentTouchesRect({ x: 20, y: 0 }, { x: 20, y: 30 }, rect)).toBe(true)
    expect(segmentTouchesRect({ x: 0, y: 10 }, { x: 30, y: 10 }, rect)).toBe(true)
    expect(segmentTouchesRect({ x: 0, y: 20 }, { x: 30, y: 20 }, rect)).toBe(true)
    // one unit outside: no touch
    expect(segmentTouchesRect({ x: 9, y: 0 }, { x: 9, y: 30 }, rect)).toBe(false)
    expect(segmentTouchesRect({ x: 0, y: 21 }, { x: 30, y: 21 }, rect)).toBe(false)
    // ...unless padding grows the rect to it
    expect(segmentTouchesRect({ x: 9, y: 0 }, { x: 9, y: 30 }, rect, 1)).toBe(true)
  })
})

describe('K4-4: the latest pace value label sits below a losing dot and above a winning one', () => {
  async function latest(result) {
    // Sessions of 1000 tournaments: a flat pace line, so above and below the last dot are both free.
    const T0 = 1790000000
    // 11 sessions, the middle one far worse (or better): the plot has room on both sides of the flat tail and the
    // trend line (a regression, level at the centre) stays near the last dot instead of crossing above or below it.
    const results = Array.from({ length: 11 }, (_, i) => (i === 5 ? result * 6 : result))
    let br = 10000
    const brHistory = results.map((own, i) => ({
      id: `flat-${i}`, date: `F${i + 1}`, timestamp: T0 + i * 86400, brAfter: (br += own),
      sessionResult: own, tournaments: 1000, totalTournaments: 1000 * (i + 1), text: `Flat ${i + 1}`,
    }))
    const last = brHistory.at(-1)
    const meta = {
      startBankroll: 10000, targetBankroll: 10000000, bankroll: last.brAfter, day: 11, totalTournaments: 11000,
      brHistory, lastUpdated: new Date((last.timestamp + 1800) * 1000).toISOString(),
    }
    vi.spyOn(Date, 'now').mockReturnValue((meta.brHistory.at(-1).timestamp + 1800) * 1000)
    localStorage.clear()
    localStorage.setItem('rpt_lang', 'en')
    localStorage.setItem('rpt_chart_period', 'all')
    localStorage.setItem('rpt_pace_bin_size', '1000')
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue({ posts: [], meta: structuredClone(meta) })
    render(<App />)
    await waitFor(() => expect(document.querySelector('[data-testid="pace-chart"] svg')).toBeTruthy())
    const svg = document.querySelector('[data-testid="pace-chart"] svg')
    const dots = [...svg.querySelectorAll('circle.pace-dot')]
    const dotY = Number(dots.at(-1).getAttribute('cy'))
    const text = svg.querySelector('.pace-segment.latest .pace-chart-value')
    const out = { dotY, textY: Number(text.getAttribute('y')), textX: text.getAttribute('x'), dotX: dots.at(-1).getAttribute('cx'), cls: text.getAttribute('class') }
    return out
  }
  it('loss: label baseline below the dot', async () => {
    const r = await latest(-1000)
    expect(r.textY, JSON.stringify(r)).toBeGreaterThan(r.dotY)
  })
  it('win: label baseline above the dot', async () => {
    const r = await latest(1000)
    expect(r.textY, JSON.stringify(r)).toBeLessThan(r.dotY)
  })
})
