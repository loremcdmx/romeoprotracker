import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import * as responsive from './hooks/useIsMobile.js'
import { fetchPublicData } from './storage.js'
import { todayMeta } from './reviewMarathonFixture.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// 2026-11-17, owner: «поработай над графиком (особенно в темной теме)». What can be checked without a layout
// engine: geometry from the SVG attributes, classes, structure. Colours and contrast are in cssCascade.test.js,
// tooltip placement in floating.test.js, pixels in the review ledger (evidence/CHART).

// The archive fixture plus the real record report of 16 Nov 2026 (+$67 325, best day, record, latest).
function recordMeta() {
  const meta = todayMeta()
  const prev = meta.brHistory.at(-1)
  meta.brHistory.push({
    id: 'record', date: 'R', timestamp: 1794866821, brAfter: prev.brAfter + 67325, sessionResult: 67325, tournaments: 156,
    totalTournaments: prev.totalTournaments + 156, text: 'Record',
    rooms: { before: prev.rooms.after, after: { ...prev.rooms.after, gg: prev.rooms.after.gg + 67325 } },
  })
  return cut(meta, meta.brHistory.length)
}
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
const segHitsRect = (a, b, r) => {
  const inside = p => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
  if (inside(a) || inside(b)) return true
  const ccw = (u, v, w) => (w.y - u.y) * (v.x - u.x) > (v.y - u.y) * (w.x - u.x)
  const cross = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  const c = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]
  return c.some((p, i) => cross(a, b, p, c[(i + 1) % 4]))
}

describe('marathon chart polish', () => {
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

  async function mount(meta, { mobile = false, period = 'all' } = {}) {
    cleanup()
    vi.setSystemTime(new Date((meta.brHistory.at(-1).timestamp + 3600) * 1000))
    vi.spyOn(responsive, 'useIsMobile').mockReturnValue(mobile)
    localStorage.setItem('rpt_chart_period', period)
    localStorage.setItem('rpt_lang', 'ru')
    fetchPublicData.mockResolvedValue({ posts: [], meta, leaderboards: null })
    render(<App />)
    await screen.findByTestId('pace-widget')
    return document.querySelector('.marathon-chart .mc-svg')
  }

  const segmentsOf = svg => [...svg.querySelectorAll('.mc-line-segment')]
    .map(l => ({ a: { x: num(l, 'x1'), y: num(l, 'y1') }, b: { x: num(l, 'x2'), y: num(l, 'y2') } }))
  const platesOf = svg => [...svg.querySelectorAll('.mc-milestone-callout')].flatMap(callout => {
    const plate = callout.querySelector('.mc-milestone-plate')
    return plate ? [{ type: callout.getAttribute('class').replace('mc-milestone-callout ', ''), callout, rect: rectOf(plate) }] : []
  })

  describe.each([[false, 'desktop'], [true, 'phone']])('phone=%s (%s)', mobile => {
    // Before: the best-day plate of 16 Nov lay on the final climb of the line (64 px of line and 3 dots under it
    // at 1440); over the archive a plate lay on the line in 93 of 400 states.
    it('no painted milestone plate lies on the line: 16 Nov 2026 and a sample of the archive', async () => {
      const full = recordMeta()
      let painted = 0
      for (const n of [24, 39, 47, 53, 60, 73, 87, 98, 120, 150, 180, 210, full.brHistory.length]) {
        const svg = await mount(cut(full, n), { mobile })
        const segments = segmentsOf(svg)
        const plot = rectOf(svg.querySelector('.mc-plot-bg'))
        for (const plate of platesOf(svg)) {
          painted++
          expect(segments.some(seg => segHitsRect(seg.a, seg.b, inflate(plate.rect, 1.6))), `n=${n}: the ${plate.type} plate on the line ${JSON.stringify(plate.rect)}`).toBe(false)
          expect(plate.rect.left >= plot.left && plate.rect.right <= plot.right && plate.rect.top >= plot.top && plate.rect.bottom <= plot.bottom, `n=${n}: the ${plate.type} plate inside the plot`).toBe(true)
        }
      }
      expect(painted).toBeGreaterThanOrEqual(13)
    }, 30000)

    it('a plate standing beside its point is joined from its side edge, not from its bottom edge', async () => {
      const svg = await mount(recordMeta(), { mobile })
      const best = platesOf(svg).find(plate => plate.type === 'best')
      const leader = best.callout.querySelector('.mc-milestone-leader')
      const point = { x: num(leader, 'x1'), y: num(leader, 'y1') }
      const end = { x: num(leader, 'x2'), y: num(leader, 'y2') }
      // the record is in the top-right corner: the plate is left of the dot, at the dot's height
      expect(point.x).toBeGreaterThan(best.rect.right)
      expect(point.y).toBeLessThan(best.rect.bottom + 2)
      expect(end.x, 'leader ends on the right edge').toBeCloseTo(best.rect.right, 5)
      expect(end.y).toBeGreaterThanOrEqual(best.rect.top + 6)
      expect(end.y).toBeLessThanOrEqual(best.rect.bottom - 6)
    })

    it('a plate above its point keeps the leader from its bottom edge', async () => {
      const svg = await mount(cut(recordMeta(), 150), { mobile })
      const plates = platesOf(svg)
      expect(plates.length).toBeGreaterThan(0)
      for (const plate of plates) {
        const leader = plate.callout.querySelector('.mc-milestone-leader')
        if (num(leader, 'y1') < plate.rect.bottom + 2) continue
        expect(num(leader, 'y2'), `${plate.type}: leader ends on the bottom edge`).toBeCloseTo(plate.rect.bottom, 5)
      }
    })

    it('dots take the colours of the line through classes', async () => {
      const svg = await mount(recordMeta(), { mobile })
      const dots = [...svg.querySelectorAll('circle.mc-dot')]
      expect(dots.length).toBeGreaterThan(20)
      for (const dot of dots) expect(dot.classList.contains('mc-pos') !== dot.classList.contains('mc-neg'), dot.getAttribute('class')).toBe(true)
      // a dot after a winning session is positive, after a losing one negative
      const segments = [...svg.querySelectorAll('.mc-line-segment')]
      expect(segments.some(seg => seg.classList.contains('positive'))).toBe(true)
      expect(segments.some(seg => seg.classList.contains('negative'))).toBe(true)
    })

    it('the START dot of a week is not a session: neither colour class', async () => {
      const svg = await mount(recordMeta(), { mobile, period: 'week' })
      const start = svg.querySelector('circle.mc-dot-baseline')
      expect(start).toBeTruthy()
      expect(start.classList.contains('mc-pos') || start.classList.contains('mc-neg')).toBe(false)
    })

    it('minor dots are small beads on the line', async () => {
      const svg = await mount(recordMeta(), { mobile })
      const minor = [...svg.querySelectorAll('circle.mc-dot-minor:not(.mc-dot-crowded):not(.mc-dot-hidden)')]
      expect(minor.length).toBeGreaterThan(5)
      for (const dot of minor) expect(num(dot, 'r')).toBe(mobile ? 2.4 : 2.5)
    })
  })

  // Two rules of the peak plate that only the whole-archive probe covered (independent re-audit, mutants m6 and m8).
  it('a record reached in short steps (the usual shape of a new high): the peak plate stands right beside the dot', async () => {
    // archive lengths 193-195: the line climbs to the record through points 3-5 units apart, so its last steps
    // run within 2 units of any leader beside the dot; before, no spot there was accepted (leader 61-101 units)
    for (const n of [193, 194, 195]) {
      const svg = await mount(cut(recordMeta(), n))
      const callout = svg.querySelector('.mc-peak-callout')
      const line = callout.querySelector('.mc-peak-callout-line')
      // the record's own marker: its ring, or the latest dot when the record is the latest report
      const dot = callout.querySelector('.mc-peak-anchor') || svg.querySelector('circle.mc-dot-last')
      expect(num(line, 'x1'), `n=${n}: the leader starts at the record dot`).toBeCloseTo(num(dot, 'cx'), 5)
      expect(num(line, 'y1')).toBeCloseTo(num(dot, 'cy'), 5)
      expect(Math.hypot(num(line, 'x2') - num(line, 'x1'), num(line, 'y2') - num(line, 'y1')), `n=${n}: leader length`).toBeLessThanOrEqual(30)
    }
  })

  it('the peak plate does not sit on the line while a spot off the line exists', async () => {
    // archive lengths where the plate used to lie on the line (desktop)
    for (const n of [25, 26, 41, 42, 67, 70]) {
      const svg = await mount(cut(recordMeta(), n))
      const badge = rectOf(svg.querySelector('.mc-peak-callout-bg'))
      expect(segmentsOf(svg).some(seg => segHitsRect(seg.a, seg.b, inflate(badge, 1.5))), `n=${n}: the peak plate on the line`).toBe(false)
    }
  })

  it('the step select sits in the title row, between the title and the period buttons', async () => {
    await mount(recordMeta())
    const head = document.querySelector('.marathon-chart .mc-chart-head')
    const children = [...head.children].map(el => el.className)
    expect(children).toEqual(['section-title', 'mc-group-control', 'mc-periods'])
    expect(head.querySelector('#marathon-grouping')).toBeTruthy()
    expect(document.querySelector('.mc-chart-controls')).toBeNull()
  })

  it('desktop: the plot got the height the select row used to take', async () => {
    const all = await mount(recordMeta())
    expect(all.getAttribute('viewBox')).toBe('0 0 700 300')
    const plotAll = rectOf(all.querySelector('.mc-plot-bg'))
    expect(plotAll.bottom - plotAll.top).toBe(210)
    const week = await mount(recordMeta(), { period: 'week' })
    expect(week.getAttribute('viewBox')).toBe('0 0 700 306')
    const plotWeek = rectOf(week.querySelector('.mc-plot-bg'))
    expect(plotWeek.bottom - plotWeek.top).toBe(204)
  })

  it('phones keep their canvas', async () => {
    const all = await mount(recordMeta(), { mobile: true })
    expect(all.getAttribute('viewBox')).toBe('0 0 360 438')
    const week = await mount(recordMeta(), { mobile: true, period: 'week' })
    expect(week.getAttribute('viewBox')).toBe('0 0 360 368')
  })

  it('desktop: the tooltip stays open while the pointer is on its action row and closes after the pointer leaves it', async () => {
    const svg = await mount(recordMeta())
    const marker = [...svg.querySelectorAll('g[data-start]')].at(-20)
    fireEvent.mouseEnter(marker)
    await waitFor(() => expect(document.querySelector('.mc-tooltip')).toBeTruthy())
    const actions = document.querySelector('.mc-tooltip .mc-tooltip-actions')
    expect(actions).toBeTruthy()
    // the pointer moves from the plot onto the action row: the svg loses it, the row gets it
    fireEvent.mouseLeave(svg)
    fireEvent.mouseEnter(actions)
    await new Promise(resolve => setTimeout(resolve, 320))
    expect(document.querySelector('.mc-tooltip'), 'still open 320 ms later (the close delay is 130 ms)').toBeTruthy()
    fireEvent.mouseLeave(actions)
    await waitFor(() => expect(document.querySelector('.mc-tooltip')).toBeNull())
  })
})
