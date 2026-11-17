import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App.jsx'
import * as responsive from './hooks/useIsMobile.js'
import { fetchPublicData } from './storage.js'
import { todayMeta, peakSecondToLastMeta } from './reviewMarathonFixture.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// 2026-11-17, owner report: after the record day of 16 Nov (+$67.3k, a new all-time high and the
// latest report at once) the gold leader of the "ПИК" plate ran straight through the best-day
// plate "+$67.3k / 16 ноя". The best-day plate is clamped beside its dot in the top-right corner,
// so every straight leader from the left crossed it. Same class: a best-day plate of the PREVIOUS
// report right beside a newer record. Geometry is read from the SVG attributes (jsdom has no layout).

// The real report 8330435 on top of the archive fixture, plus optional later reports (result per day).
function recordMeta(later = []) {
  const meta = todayMeta()
  const add = (timestamp, result, tournaments) => {
    const prev = meta.brHistory.at(-1)
    meta.brHistory.push({
      id: `after-${meta.brHistory.length}`, date: 'R', timestamp, brAfter: prev.brAfter + result, sessionResult: result,
      tournaments, totalTournaments: prev.totalTournaments + tournaments, text: 'Report',
      rooms: { before: prev.rooms.after, after: { ...prev.rooms.after, gg: prev.rooms.after.gg + result } },
    })
  }
  add(1794866821, 67325, 156)
  later.forEach(result => add(meta.brHistory.at(-1).timestamp + 86400, result, 150))
  return cut(meta, meta.brHistory.length)
}

// The archive as it stood after its first n reports.
function cut(meta, n) {
  const brHistory = meta.brHistory.slice(0, n)
  const last = brHistory.at(-1)
  const totalTournaments = brHistory.reduce((total, row) => row.totalTournaments ?? total, null)
  return { ...meta, brHistory, bankroll: last.brAfter, day: n, totalTournaments,
    lastUpdated: new Date((last.timestamp + 1800) * 1000).toISOString() }
}

const num = (el, name) => +el.getAttribute(name)
const rectOf = el => ({ left: num(el, 'x'), top: num(el, 'y'), right: num(el, 'x') + num(el, 'width'), bottom: num(el, 'y') + num(el, 'height') })
const inflate = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d })
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const covers = (outer, inner) => outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom
const segHitsRect = (a, b, r) => {
  const inside = p => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
  if (inside(a) || inside(b)) return true
  const ccw = (u, v, w) => (w.y - u.y) * (v.x - u.x) > (v.y - u.y) * (w.x - u.x)
  const cross = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  const c = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]
  return c.some((p, i) => cross(a, b, p, c[(i + 1) % 4]))
}
const onBorder = (p, r) => {
  const within = (v, lo, hi) => v >= lo - 0.01 && v <= hi + 0.01
  const onX = (Math.abs(p.x - r.left) < 0.01 || Math.abs(p.x - r.right) < 0.01) && within(p.y, r.top, r.bottom)
  const onY = (Math.abs(p.y - r.top) < 0.01 || Math.abs(p.y - r.bottom) < 0.01) && within(p.x, r.left, r.right)
  return onX || onY
}

describe('the peak plate next to a milestone plate', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function mount(meta, mobile) {
    cleanup()
    vi.setSystemTime(new Date((meta.brHistory.at(-1).timestamp + 3600) * 1000))
    vi.spyOn(responsive, 'useIsMobile').mockReturnValue(mobile)
    localStorage.setItem('rpt_chart_period', 'all')
    localStorage.setItem('rpt_lang', 'ru')
    fetchPublicData.mockResolvedValue({ posts: [], meta, leaderboards: null })
    render(<App />)
    await screen.findByTestId('pace-widget')
    return read(document.querySelector('.marathon-chart .mc-svg'))
  }

  function read(svg) {
    const g = svg.querySelector('.mc-peak-callout')
    const line = g.querySelector('.mc-peak-callout-line')
    const idx = num(g, 'data-idx')
    const plates = [...svg.querySelectorAll('.mc-milestone-callout')].flatMap(callout => {
      const plate = callout.querySelector('.mc-milestone-plate')
      return plate ? [{ type: callout.getAttribute('class').replace('mc-milestone-callout ', ''), own: num(callout, 'data-source-index') === idx, rect: rectOf(plate) }] : []
    })
    const cuts = [...svg.querySelectorAll('#mcPeakLeaderMask .mc-peak-leader-cut')].map(rectOf)
    const from = { x: num(line, 'x1'), y: num(line, 'y1') }
    const to = { x: num(line, 'x2'), y: num(line, 'y2') }
    // The inside of a plate, where its text is: the leader may touch the border (a dock) but not go in.
    const inner = plate => inflate(plate.rect, -0.75)
    const entered = plates.filter(plate => segHitsRect(from, to, inner(plate)))
    const hidden = plate => line.parentNode.getAttribute('mask') === 'url(#mcPeakLeaderMask)' && cuts.some(cut => covers(cut, plate.rect))
    const ring = g.querySelector('.mc-peak-anchor')
    const lastDot = svg.querySelector('circle.mc-dot-last')
    const marker = ring || lastDot
    return {
      docked: g.getAttribute('data-docked') === 'true', text: g.textContent, from, to, plates,
      badge: rectOf(g.querySelector('.mc-peak-callout-bg')),
      plotBg: rectOf(svg.querySelector('.mc-plot-bg')),
      dot: { x: num(marker, 'cx'), y: num(marker, 'cy') },
      dots: [...svg.querySelectorAll('circle.mc-dot')].filter(c => !c.classList.contains('mc-dot-hidden'))
        .map(c => ({ x: num(c, 'cx'), y: num(c, 'cy'), r: num(c, 'r') })),
      segments: [...svg.querySelectorAll('.mc-line-segment')]
        .map(l => ({ a: { x: num(l, 'x1'), y: num(l, 'y1') }, b: { x: num(l, 'x2'), y: num(l, 'y2') } })),
      length: Math.hypot(to.x - from.x, to.y - from.y),
      struckThrough: entered.filter(plate => !hidden(plate)),
      behind: entered.filter(hidden),
    }
  }

  function expectBadgeClear(m, label) {
    expect(m.badge.left, `${label}: inside the plot`).toBeGreaterThanOrEqual(m.plotBg.left)
    expect(m.badge.right, `${label}: inside the plot`).toBeLessThanOrEqual(m.plotBg.right)
    expect(m.badge.top, `${label}: inside the plot`).toBeGreaterThanOrEqual(m.plotBg.top)
    expect(m.badge.bottom, `${label}: inside the plot`).toBeLessThanOrEqual(m.plotBg.bottom)
    for (const plate of m.plates) expect(overlap(inflate(m.badge, 2), plate.rect), `${label}: badge on the ${plate.type} plate`).toBe(false)
    for (const d of m.dots) {
      expect(overlap(m.badge, { left: d.x - d.r, right: d.x + d.r, top: d.y - d.r, bottom: d.y + d.r }), `${label}: badge on a dot`).toBe(false)
    }
    for (const seg of m.segments) expect(segHitsRect(seg.a, seg.b, inflate(m.badge, 1.5)), `${label}: badge on the line`).toBe(false)
  }

  function expectDocked(m, label) {
    const own = m.plates.filter(plate => plate.own)
    expect(own.map(plate => plate.type), `${label}: the record report has the best-day plate`).toEqual(['best'])
    expect(m.docked, `${label}: docked`).toBe(true)
    expect(m.struckThrough.map(plate => plate.type), `${label}: leader through a plate`).toEqual([])
    // a short straight connector from the plate's edge to the badge's edge
    expect(onBorder(m.from, own[0].rect), `${label}: connector starts on the plate edge ${JSON.stringify([m.from, own[0].rect])}`).toBe(true)
    expect(onBorder(m.to, m.badge), `${label}: connector ends on the badge edge ${JSON.stringify([m.to, m.badge])}`).toBe(true)
    expect(m.from.x === m.to.x || m.from.y === m.to.y, `${label}: connector is straight`).toBe(true)
    expect(m.length, `${label}: connector length`).toBeGreaterThanOrEqual(6)
    expect(m.length, `${label}: connector length`).toBeLessThanOrEqual(9)
    for (const seg of m.segments) {
      expect(segHitsRect(seg.a, seg.b, inflate({ left: Math.min(m.from.x, m.to.x), right: Math.max(m.from.x, m.to.x), top: Math.min(m.from.y, m.to.y), bottom: Math.max(m.from.y, m.to.y) }, 2)),
        `${label}: connector on the line`).toBe(false)
    }
    expectBadgeClear(m, label)
  }

  describe.each([[false, 'desktop'], [true, 'phone']])('phone=%s (%s)', mobile => {
    it('16 Nov 2026, record day = record high = latest report: the peak plate docks to the best-day plate', async () => {
      const m = await mount(recordMeta(), mobile)
      expect(m.text).toBe('ПИК$599k')
      expectDocked(m, 'record day')
    })

    it('a loss the day after: the record is no longer the latest report and stays docked', async () => {
      const m = await mount(recordMeta([-9000]), mobile)
      expect(m.text).toBe('ПИК$599k')
      expectDocked(m, 'day after, loss')
    })

    it('a small win the day after: the best-day plate belongs to the previous report, the leader is hidden behind it', async () => {
      const m = await mount(recordMeta([5000]), mobile)
      expect(m.text).toBe('ПИК$604k')
      expect(m.plates.some(plate => plate.own), 'no plate at the new record').toBe(false)
      expect(m.docked).toBe(false)
      // a straight leader from the record dot, as before
      expect(m.from.x).toBeCloseTo(m.dot.x, 5)
      expect(m.from.y).toBeCloseTo(m.dot.y, 5)
      expect(m.behind.map(plate => plate.type), 'the leader passes the best-day plate').toEqual(['best'])
      expect(m.struckThrough.map(plate => plate.type), 'leader through a plate').toEqual([])
      for (const plate of m.plates) expect(overlap(inflate(m.badge, 2), plate.rect), `badge on the ${plate.type} plate`).toBe(false)
    })

    it('no plate at the record: a straight leader from the record dot, nothing docked', async () => {
      for (const meta of [todayMeta(), peakSecondToLastMeta()]) {
        const m = await mount(meta, mobile)
        expect(m.plates.some(plate => plate.own)).toBe(false)
        expect(m.docked).toBe(false)
        expect(m.from.x).toBeCloseTo(m.dot.x, 5)
        expect(m.from.y).toBeCloseTo(m.dot.y, 5)
        expect(m.struckThrough).toEqual([])
      }
    })
  })

  // Old code struck through a plate in 96 of the 400 states (every length of the archive, desktop and
  // phone). A sample of them, with every kind: a plate of the record itself (best day, $200k) and a
  // plate of a neighbouring report.
  it('history sample: the visible leader never runs through a plate', async () => {
    const full = recordMeta()
    const lengths = [12, 16, 18, 21, 24, 27, 39, 40, 47, 53, 60, 73, 84, 87, 91, 98, 120, 150, 180, 210]
    const seen = { docked: 0, behind: 0, own: 0 }
    for (const mobile of [false, true]) {
      for (const n of lengths) {
        const m = await mount(cut(full, n), mobile)
        expect(m.struckThrough.map(plate => plate.type), `n=${n} phone=${mobile}: leader through a plate`).toEqual([])
        for (const plate of m.plates) expect(overlap(inflate(m.badge, 2), plate.rect), `n=${n} phone=${mobile}: badge on the ${plate.type} plate`).toBe(false)
        if (m.docked) seen.docked++
        if (m.behind.length) seen.behind++
        if (m.plates.some(plate => plate.own)) seen.own++
      }
    }
    // the sample really contains each kind
    expect(seen.own).toBeGreaterThanOrEqual(10)
    expect(seen.docked).toBeGreaterThanOrEqual(6)
    expect(seen.behind).toBeGreaterThanOrEqual(6)
  }, 60000)
})
