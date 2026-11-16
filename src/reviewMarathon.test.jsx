import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import * as responsive from './hooks/useIsMobile.js'
import { fetchPublicData } from './storage.js'
import { todayMeta, peakSecondToLastMeta } from './reviewMarathonFixture.js'
import { REAL_HISTORY, replayMeta } from './realHistoryFixture.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Review wave 2026-11-16, cluster K3 (marathon chart). Geometry is read from the
// SVG attributes (the chart is authored in user units; jsdom has no layout).

const NOW = new Date('2026-11-16T12:00:00Z')

describe('K3 marathon chart review fixes', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.getElementById('root')?.remove()
  })

  async function mount(meta, { mobile = false, period = 'all', lang = 'ru' } = {}) {
    cleanup()
    vi.spyOn(responsive, 'useIsMobile').mockReturnValue(mobile)
    localStorage.setItem('rpt_chart_period', period)
    localStorage.setItem('rpt_lang', lang)
    fetchPublicData.mockResolvedValue({ posts: [], meta, leaderboards: null })
    render(<App />)
    await screen.findByTestId('pace-widget')
    return document.querySelector('.marathon-chart .mc-svg')
  }

  const num = (el, name) => +el.getAttribute(name)

  describe('NUM-2: range views get no false milestone note on START', () => {
    it.each(['week', 'month'])('%s: START carries no milestone', async period => {
      await mount(todayMeta(), { period })
      const first = document.querySelector('.mc-x-tick.range-start')
      expect(first).toBeTruthy()
      expect(first.className.baseVal).not.toMatch(/milestone/)
      expect(first.textContent).not.toMatch(/\$\d+k/i)
    })

    it('a window that really crosses $500k still shows the milestone', async () => {
      // 2026-11-16 minus 30 days starts on 2026-10-17: the 29 Oct report (501 187) crosses $500k.
      await mount(todayMeta(), { period: 'month' })
      const marks = [...document.querySelectorAll('.mc-x-tick.milestone')]
      expect(marks.some(m => /\$500k/.test(m.textContent))).toBe(true)
    })
  })

  describe('NUM-4 / NUM-P4: tooltip of a merged dot is one consistent group sum', () => {
    // the 1 Nov 2026 dot: six reports, +58 723 (6109 + 17005 + 10271 + 5956 + 13143 + 6239)
    const GROUP_END_TS = 1793505417
    const groupEl = () => [...document.querySelectorAll('.mc-svg g[data-count]')]
      .find(g => +g.getAttribute('data-count') > 1 && g.getAttribute('data-end') === String(
        todayMeta().brHistory.findIndex(r => r.timestamp === GROUP_END_TS)))

    it('room lines and the MTT line sum every report of the group (ru, desktop)', async () => {
      await mount(todayMeta())
      const group = groupEl()
      expect(group, 'the 1 Nov dot is a merged group').toBeTruthy()
      expect(+group.getAttribute('data-count')).toBe(6)
      fireEvent.mouseEnter(group)
      const tip = await waitFor(() => { const el = document.querySelector('.mc-tooltip'); expect(el).toBeTruthy(); return el })
      const text = tip.textContent.replace(/\u00a0/g, ' ')
      // pill (group sum) and the GG room line agree: both +58 723, not the last report's +6 239
      expect(within(tip).getByText(/58[.,]7k/, { selector: '.mc-pill' })).toBeTruthy()
      expect(text).toMatch(/GG:\s*[+−-]?\$?58[.,]7k/)
      expect(text).not.toMatch(/GG:\s*[+−-]?\$?6[.,]2k/)
      // honest wording: summed over the point, not "since the last report"
      expect(text).toContain('сыграно МТТ в этой точке')
      expect(text).not.toContain('с последнего отчёта')
      expect(text).toMatch(/в этой точке:\s*1\s?101/)
      // NUM-P4: the breakdown rows use the localized unit, never a hard-coded Latin MTT
      const rows = [...tip.querySelectorAll('.mc-session-mtt')].map(r => r.textContent)
      expect(rows).toHaveLength(6)
      rows.forEach(r => { expect(r).toMatch(/МТТ$/); expect(r).not.toMatch(/MTT/) })
    })

    it('a single report keeps the "since last report" wording', async () => {
      await mount(todayMeta())
      const single = [...document.querySelectorAll('.mc-svg g[data-count="1"]')].pop()
      fireEvent.mouseEnter(single)
      const tip = await waitFor(() => { const el = document.querySelector('.mc-tooltip'); expect(el).toBeTruthy(); return el })
      expect(tip.textContent).toContain('с последнего отчёта')
    })

    it('rooms missing in some reports of a group add nothing instead of NaN', async () => {
      const meta = todayMeta()
      const i = meta.brHistory.findIndex(r => r.timestamp === 1793242005)
      delete meta.brHistory[i].rooms
      await mount(meta)
      const group = groupEl()
      fireEvent.mouseEnter(group)
      const tip = await waitFor(() => { const el = document.querySelector('.mc-tooltip'); expect(el).toBeTruthy(); return el })
      expect(tip.textContent).not.toMatch(/NaN/)
      expect(tip.textContent).toMatch(/GG:/)
    })

    it('en uses MTT', async () => {
      await mount(todayMeta(), { lang: 'en' })
      fireEvent.mouseEnter(groupEl())
      const tip = await waitFor(() => { const el = document.querySelector('.mc-tooltip'); expect(el).toBeTruthy(); return el })
      expect(tip.textContent).toContain('MTTs played in this point')
      expect(tip.querySelector('.mc-session-mtt').textContent).toMatch(/MTT$/)
    })
  })

  describe('NUM-P1: range views do not call the window high a record', () => {
    it.each([['ru', 'МАКС'], ['en', 'HIGH'], ['es', 'MÁX']])(
      'week (%s): the window high $532k (15 Nov) is below the record $537k and says %s', async (lang, word) => {
        await mount(todayMeta(), { period: 'week', lang })
        const callout = document.querySelector('.mc-peak-callout')
        expect(callout).toBeTruthy()
        expect(callout.querySelector('.mc-peak-callout-value').textContent).toBe('$532k')
        expect(callout.querySelector('.mc-peak-callout-kicker').textContent).toBe(word)
      })

    it('month: the window contains the record (9 Nov), so it is still the peak', async () => {
      await mount(todayMeta(), { period: 'month' })
      const callout = document.querySelector('.mc-peak-callout')
      expect(callout.querySelector('.mc-peak-callout-value').textContent).toBe('$537k')
      expect(callout.querySelector('.mc-peak-callout-kicker').textContent).toBe('ПИК')
    })

    it('all-time view keeps ПИК', async () => {
      await mount(todayMeta())
      expect(document.querySelector('.mc-peak-callout-kicker').textContent).toBe('ПИК')
    })

    it('every language has the key', async () => {
      const { translate } = await import('./i18n.js')
      for (const lang of ['ru', 'en', 'es']) {
        expect(translate(lang, 'chart_peak_period')).not.toBe('chart_peak_period')
        expect(translate(lang, 'tip_mtt_in_point')).not.toBe('tip_mtt_in_point')
      }
    })
  })

  describe('UI-3: the peak plate sits near the peak and keeps every clearance rule', () => {
    const rectOf = el => ({ left: num(el, 'x'), top: num(el, 'y'), right: num(el, 'x') + num(el, 'width'), bottom: num(el, 'y') + num(el, 'height') })
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const inflate = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d })
    const segHitsRect = (a, b, r) => {
      const inside = p => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
      if (inside(a) || inside(b)) return true
      const ccw = (u, v, w) => (w.y - u.y) * (v.x - u.x) > (v.y - u.y) * (w.x - u.x)
      const cross = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
      const c = [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]
      return c.some((p, i) => cross(a, b, p, c[(i + 1) % 4]))
    }

    function read(svg) {
      const g = svg.querySelector('.mc-peak-callout')
      if (!g) return null
      const leader = g.querySelector('.mc-peak-callout-line')
      const plate = rectOf(g.querySelector('.mc-peak-callout-bg'))
      const peak = { x: num(leader, 'x1'), y: num(leader, 'y1') }
      const anchor = { x: num(leader, 'x2'), y: num(leader, 'y2') }
      const plotBg = rectOf(svg.querySelector('.mc-plot-bg'))
      const dots = [...svg.querySelectorAll('circle.mc-dot')].filter(c => !c.classList.contains('mc-dot-hidden'))
        .map(c => ({ x: num(c, 'cx'), y: num(c, 'cy'), r: num(c, 'r'), last: c.classList.contains('mc-dot-last') }))
      const segments = [...svg.querySelectorAll('.mc-line-segment')]
        .map(l => ({ a: { x: num(l, 'x1'), y: num(l, 'y1') }, b: { x: num(l, 'x2'), y: num(l, 'y2') } }))
      const ring = g.querySelector('.mc-peak-anchor')
      const plates = [...svg.querySelectorAll('.mc-milestone-plate')].map(rectOf)
      const vb = svg.getAttribute('viewBox').split(' ').map(Number)
      return { g, plate, peak, anchor, plotBg, dots, segments, ring, plates, vbW: vb[2],
        leaderLen: Math.hypot(anchor.x - peak.x, anchor.y - peak.y) }
    }

    // every rule the old chooser had, checked on the painted geometry
    function expectRules(m, label, { strict = true } = {}) {
      const { plate, plotBg, dots, segments, plates } = m
      expect(plate.left, `${label} inside plot (left)`).toBeGreaterThanOrEqual(plotBg.left)
      expect(plate.right, `${label} inside plot (right)`).toBeLessThanOrEqual(plotBg.right)
      expect(plate.top, `${label} inside plot (top)`).toBeGreaterThanOrEqual(plotBg.top)
      expect(plate.bottom, `${label} inside plot (bottom)`).toBeLessThanOrEqual(plotBg.bottom)
      for (const d of strict ? dots : []) {
        const near = { left: d.x - d.r, right: d.x + d.r, top: d.y - d.r, bottom: d.y + d.r }
        expect(overlap(plate, near), `${label}: plate covers a dot at ${d.x},${d.y}`).toBe(false)
      }
      for (const seg of strict ? segments : []) {
        if (seg.a.x === m.peak.x && seg.a.y === m.peak.y) continue
        expect(segHitsRect(seg.a, seg.b, inflate(plate, 1.5)), `${label}: plate covers the line ${JSON.stringify([plate, seg, m.peak, m.anchor])}`).toBe(false)
      }
      for (const r of plates) expect(overlap(inflate(plate, 2), r), `${label}: plate covers a milestone plate`).toBe(false)
    }

    // 1440 and 820 px wide desktop renders scale the 700-unit canvas by ~1.484 and ~1.094
    it('today (desktop): the leader is short, was 101 units', async () => {
      const svg = await mount(todayMeta())
      const m = read(svg)
      expect(m.leaderLen * 1.484, 'px at 1440').toBeLessThanOrEqual(72)
      expect(m.leaderLen * 1.094, 'px at 820').toBeLessThanOrEqual(54)
      expectRules(m, 'today desktop')
    })

    it('today (phone): the leader is short, was 58 units', async () => {
      const svg = await mount(todayMeta(), { mobile: true })
      const m = read(svg)
      expect(m.leaderLen * 0.989, 'px at 390').toBeLessThanOrEqual(40)
      expectRules(m, 'today phone')
    })

    it.each([[false, 45], [true, 25]])('peak on the second-to-last report (phone=%s): leader <= %s units', async (mobile, limit) => {
      const svg = await mount(peakSecondToLastMeta(), { mobile })
      const m = read(svg)
      expect(m.leaderLen).toBeLessThanOrEqual(limit)
      expectRules(m, `p2l mobile=${mobile}`)
    })

    it.each([[false], [true]])('peak ring and the latest dot never overlap (phone=%s)', async mobile => {
      for (const meta of [todayMeta(), peakSecondToLastMeta()]) {
        const svg = await mount(meta, { mobile })
        const m = read(svg)
        const last = m.dots.find(d => d.last)
        expect(last).toBeTruthy()
        if (!m.ring) continue // merged with the latest marker: no second ring is drawn
        const r = num(m.ring, 'r')
        const d = Math.hypot(num(m.ring, 'cx') - last.x, num(m.ring, 'cy') - last.y)
        expect(d, `ring r=${r} vs latest dot r=${last.r}`).toBeGreaterThan(r + last.r)
      }
    })

    it('the real fixture keeps every rule at many lengths, desktop and phone', async () => {
      for (const mobile of [false, true]) for (const count of [60, 83, 100, 130, 160, 189]) {
        const svg = await mount(replayMeta(count), { mobile })
        const m = read(svg)
        // the legacy last-resort tiers may still cover a minor dot (unchanged); painted plates and the plot edge are hard rules
        if (m) expectRules(m, `fixture ${count} mobile=${mobile}`, { strict: false })
      }
    })
  })

  describe('UI-5: phone month axis follows the real label width', () => {
    const labels = svg => [...svg.querySelectorAll('.mc-month-label-main')].map(t => ({ t: t.textContent, x: num(t, 'x') }))

    it('390 px today: five evenly spread labels, never overlapping', async () => {
      const svg = await mount(todayMeta(), { mobile: true })
      const ls = labels(svg)
      expect(ls.map(l => l.t)).toEqual(['МАР', 'МАЙ', 'ИЮЛ', 'СЕН', 'НОЯ'])
      for (let i = 1; i < ls.length; i++) expect(ls[i].x - ls[i - 1].x).toBeGreaterThanOrEqual(40)
    })

    it('desktop output is unchanged', async () => {
      const svg = await mount(todayMeta())
      expect(labels(svg).map(l => l.t)).toEqual(['МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ'])
    })

    it('the wider "МАР 27" form across a year boundary gets a wider gap and still never overlaps', async () => {
      const extra = [{ dt: 86400 * 60, result: 4000, tournaments: 200 }, { dt: 86400 * 40, result: 4000, tournaments: 200 },
        { dt: 86400 * 40, result: 4000, tournaments: 200 }, { dt: 86400 * 40, result: 4000, tournaments: 200 }]
      const svg = await mount(replayMeta(189, extra), { mobile: true })
      const ls = labels(svg)
      expect(ls.some(l => / 2\d$/.test(l.t))).toBe(true)
      for (let i = 1; i < ls.length; i++) {
        const need = ((ls[i].t.length + ls[i - 1].t.length) / 2) * 8.5 + 8
        expect(ls[i].x - ls[i - 1].x, `${ls[i - 1].t} -> ${ls[i].t}`).toBeGreaterThanOrEqual(need)
      }
    })
  })

  describe('UI-2: touching the chart no longer calls preventDefault on touchstart', () => {
    it('touchstart is not cancelled, the long-press tooltip still opens', async () => {
      const svg = await mount(todayMeta(), { mobile: true })
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 438 })
      const notCancelled = fireEvent.touchStart(svg, { touches: [{ clientX: 300, clientY: 400 }], cancelable: true })
      expect(notCancelled).toBe(true)
      await waitFor(() => expect(document.querySelector('.mc-tooltip')).toBeTruthy(), { timeout: 3000 })
    })

    it('the source holds no preventDefault inside the touchstart handler', () => {
      const src = fs.readFileSync('src/App.jsx', 'utf8')
      const body = src.slice(src.indexOf('const handleTouchStart = e =>'), src.indexOf('const handleTouchEnd = e =>'))
      expect(body.length).toBeGreaterThan(50)
      expect(body).not.toMatch(/preventDefault/)
    })
  })

  describe('UI-P7: the peak value is not upper-cased by CSS', () => {
    it('only the kicker is upper-cased', () => {
      const css = fs.readFileSync('src/app.css', 'utf8')
      const rule = name => css.match(new RegExp(`\\.${name}\\{([^}]*)\\}`))[1]
      expect(rule('mc-peak-callout-text')).not.toMatch(/text-transform/)
      expect(rule('mc-peak-callout-value')).not.toMatch(/text-transform/)
      expect(rule('mc-peak-callout-kicker')).toMatch(/text-transform:\s*uppercase/)
    })
  })
})
