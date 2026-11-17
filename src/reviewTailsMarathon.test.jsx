import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import * as responsive from './hooks/useIsMobile.js'
import { fetchPublicData } from './storage.js'
import { todayMeta, peakSecondToLastMeta } from './reviewMarathonFixture.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Review tails 2026-11-16, marathon chart (ASM-REPRO-1, ASM-T2, ASM-T3, mutant K3-5).
// Geometry is read from the SVG attributes (jsdom has no layout).

const NOW = new Date('2026-11-16T12:00:00Z')

describe('marathon chart review tails', () => {
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
  const hover = async el => {
    fireEvent.mouseEnter(el)
    return waitFor(() => { const t = document.querySelector('.mc-tooltip'); expect(t).toBeTruthy(); return t })
  }

  describe('ASM-REPRO-1: the class that keeps the START money value out of the uppercase sub-line rule', () => {
    // sub lines of the other ticks hold dates ("2 НОЯ") and notes ("ПИК", "перелом"): uppercase by design
    it.each([['week'], ['month']])('%s on a phone: the class is on the START value and on no other sub line', async period => {
      await mount(todayMeta(), { period, mobile: true })
      const money = [...document.querySelectorAll('.mc-xaxis-label-money')]
      expect(money).toHaveLength(1)
      const start = document.querySelector('.mc-x-tick.range-start .mc-xaxis-label-sub')
      expect(money[0]).toBe(start)
      expect(start.textContent).toMatch(/^[+−-]\$?\d[\d.,]*k\$?$/) // the value alone, no MTT note, no date
      expect(start.textContent).toMatch(/k/)
      const others = [...document.querySelectorAll('.mc-xaxis-label-sub')].filter(el => el !== start)
      expect(others.length).toBeGreaterThan(0)
      others.forEach(el => expect(el.classList.contains('mc-xaxis-label-money')).toBe(false))
    })

    it.each([['ru'], ['en'], ['es']])('%s: week on a phone: still exactly one money sub line', async lang => {
      await mount(todayMeta(), { period: 'week', mobile: true, lang })
      expect(document.querySelectorAll('.mc-xaxis-label-money')).toHaveLength(1)
    })

    it.each([['week'], ['month'], ['all']])('%s on desktop: no sub line carries it (START keeps its MTT note and date there)', async period => {
      await mount(todayMeta(), { period })
      expect(document.querySelectorAll('.mc-xaxis-label-money')).toHaveLength(0)
    })

    it('the all-time view on a phone has none either', async () => {
      await mount(todayMeta(), { period: 'all', mobile: true })
      expect(document.querySelectorAll('.mc-xaxis-label-money')).toHaveLength(0)
    })
  })

  describe('ASM-T2: tooltip of a merged dot of 2 and of 3 reports is the group sum', () => {
    const fmtK = v => `${v < 0 ? '[-−]' : '[+]'}\\$?${(Math.abs(v) / 1000).toFixed(1).replace('.', '[.,]')}k`
    it.each([[2], [3]])('a merged dot of %i reports: pill, room line and MTT line against the sum', async n => {
      // find a merged dot of exactly n reports on the unchanged fixture, then give its reports room deltas
      let svg = await mount(todayMeta())
      const found = [...svg.querySelectorAll('g[data-count]')].find(g => +g.getAttribute('data-count') === n)
      expect(found, `a merged dot of ${n}`).toBeTruthy()
      const end = +found.getAttribute('data-end')
      const meta = todayMeta()
      const first = end - n + 1
      let gg = 100000
      let roomSum = 0
      for (let k = 0; k < n; k++) {
        const d = 1100 * (k + 1)
        meta.brHistory[first + k].rooms = { before: { gg }, after: { gg: gg + d } }
        gg += d
        roomSum += d
      }
      const reports = meta.brHistory.slice(first, end + 1)
      const mttSum = reports.reduce((s, r) => s + r.tournaments, 0)
      const profit = meta.brHistory[end].brAfter - meta.brHistory[first - 1].brAfter
      const lastRoom = 1100 * n
      expect(mttSum).toBeLessThan(1000) // keeps the thousands separator out of the pattern below
      svg = await mount(meta)
      const group = [...svg.querySelectorAll('g[data-count]')].find(g => +g.getAttribute('data-count') === n && +g.getAttribute('data-end') === end)
      expect(group, 'the same dot after adding rooms').toBeTruthy()
      const tip = await hover(group)
      const text = tip.textContent.replace(/ /g, ' ')
      expect(tip.querySelector('.mc-pill').textContent).toMatch(new RegExp(fmtK(profit)))
      expect(text).toMatch(new RegExp(`GG:\\s*${fmtK(roomSum)}`))
      expect(text).not.toMatch(new RegExp(`GG:\\s*${fmtK(lastRoom)}`))
      expect(text).toMatch(new RegExp(`в этой точке:\\s*${mttSum}(?!\\d)`))
      expect(text).not.toContain('с последнего отчёта')
      expect(tip.querySelectorAll('.mc-session-row')).toHaveLength(n)
    })
  })

  describe('ASM-T3: the chart aria-label counts the reports of the window', () => {
    const inWindow = (meta, days) => meta.brHistory.filter(r => r.timestamp >= NOW.getTime() / 1000 - days * 86400).length
    it.each([['week', 7, 'ru', /: 3 BR-апдейта$/], ['month', 30, 'ru', /: 22 BR-апдейта$/], ['week', 7, 'en', /: 3 BR updates$/], ['month', 30, 'en', /: 22 BR updates$/]])(
      '%s (%s days, %s): the synthetic START point is not a report', async (period, days, lang, re) => {
        const meta = todayMeta()
        const n = inWindow(meta, days)
        const svg = await mount(meta, { period, lang })
        expect(svg.getAttribute('aria-label')).toMatch(re)
        expect(svg.getAttribute('aria-label')).toContain(`: ${n} `)
        // the chart really has one more point than that: the START point
        expect(svg.querySelector('.mc-x-tick.range-start')).toBeTruthy()
      })

    it('all: every report', async () => {
      const meta = todayMeta()
      const svg = await mount(meta, { lang: 'en' })
      expect(svg.getAttribute('aria-label')).toContain(`: ${meta.brHistory.length} BR updates`)
    })
  })

  describe('K3-5: the peak ring beside the latest dot', () => {
    // peak is the second-to-last report; the latest dot (r 6) is about 9 units away, so the room left for the ring is about 3:
    // too small for a ring, so it is the small 2.2 dot (room < 4), not a ring of room - 2.4 (about 0.6 and shrinking to nothing)
    const run = async (mobile, drop) => {
      const meta = peakSecondToLastMeta()
      const last = meta.brHistory.at(-1)
      const peak = meta.brHistory.at(-2)
      last.brAfter = peak.brAfter - drop
      last.sessionResult = -drop
      const svg = await mount(meta, { mobile })
      const ring = svg.querySelector('.mc-peak-anchor')
      const dot = svg.querySelector('.mc-dot-last circle, circle.mc-dot-last') || svg.querySelector('.mc-dot-last')
      return { ring, dot, dist: Math.hypot(num(ring, 'cx') - num(dot, 'cx'), num(ring, 'cy') - num(dot, 'cy')) }
    }
    // The drops are tuned to the plot height: the desktop plot grew from 182 to 210 units on 2026-11-17 (the step
    // select moved into the title row), so the same 9-unit distance needs a smaller drop there (27000 -> 23500).
    it.each([[true, 17000], [false, 23500]])('mobile=%s: a gap of about 3 units keeps the small gold dot (r 2.2)', async (mobile, drop) => {
      const { ring, dist } = await run(mobile, drop)
      expect(dist - 6, 'room beside the latest dot').toBeGreaterThan(2.5)
      expect(dist - 6).toBeLessThan(3.5)
      expect(num(ring, 'r')).toBe(2.2)
      expect(ring.getAttribute('class')).toContain('mc-peak-anchor-small')
    })

    it('a wider gap keeps a ring that fits beside the latest dot (the rule is not "always small")', async () => {
      const { ring, dist } = await run(true, 27000)
      expect(dist - 6).toBeGreaterThan(6)
      expect(num(ring, 'r')).toBeCloseTo(dist - 6 - 2.4, 5)
      expect(num(ring, 'r')).toBeGreaterThan(2.2)
    })
  })
})
