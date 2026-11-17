// Review wave 2026-11-16, cluster K4 (pace and session widgets):
//   UI-4  the latest pace value label sits on its own dot, clear of the curve
//   NUM-3 a session bar that absorbs earlier reports shows their combined money
//   NUM-P2 one report in the week/month window is not a pace for any widget
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App, { buildSessionMttRows } from './App.jsx'
import { REAL_HISTORY, replayMeta } from './realHistoryFixture.js'
import { samplePacePath, segmentTouchesRect } from './paceLabels.js'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

let mobile = false
beforeAll(() => {
  // useIsMobile reads query.matches on every snapshot, so the flag can flip between renders.
  window.matchMedia = query => ({
    get matches() { return mobile && /max-width/.test(query) },
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); mobile = false; localStorage.clear() })

const DAY = 86400
function mockNow(seconds) { vi.spyOn(Date, 'now').mockReturnValue(seconds * 1000) }

async function mount(meta, ls = {}) {
  localStorage.clear()
  localStorage.setItem('rpt_lang', 'ru')
  for (const [key, value] of Object.entries(ls)) localStorage.setItem(key, value)
  fetchPublicData.mockReset()
  fetchPublicData.mockResolvedValue({ posts: [], meta: structuredClone(meta) })
  render(<App />)
  await waitFor(() => expect(document.querySelector('.marathon-chart')).toBeTruthy())
}

// ─── UI-4 ────────────────────────────────────────────────────────────────────
const GLYPH = 10.5 * .6 // Roboto Mono advance, wider than the component's own estimate
const box = (el, widthOf) => {
  const x = Number(el.getAttribute('x')), y = Number(el.getAttribute('y'))
  const w = widthOf(el.textContent)
  const cls = el.getAttribute('class') || ''
  const left = cls.includes('edge-start') ? x : cls.includes('edge') ? x - w : x - w / 2
  return { left, right: left + w, top: y - 9, bottom: y + 3 }
}
const touches = (a, b, pad = 0) => a.left - pad < b.right && b.left - pad < a.right && a.top - pad < b.bottom && b.top - pad < a.bottom
const gap = (b, p) => Math.hypot(Math.max(b.left - p.x, 0, p.x - b.right), Math.max(b.top - p.y, 0, p.y - b.bottom))

function latestLabelReport() {
  const svg = document.querySelector('[data-testid="pace-chart"] svg')
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number)
  const dots = [...svg.querySelectorAll('circle.pace-dot')].map(c => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }))
  const own = dots[dots.length - 1]
  const prev = dots[dots.length - 2]
  const text = svg.querySelector('.pace-segment.latest .pace-chart-value')
  const b = box(text, s => s.length * GLYPH)
  const problems = []
  if (b.left < 0 || b.right > vbW || b.top < 0 || b.bottom > vbH) problems.push('outside viewBox')
  for (const sel of ['path.pace-line', 'path.pace-line.partial', 'path.pace-trend-line']) {
    for (const path of svg.querySelectorAll(sel)) {
      const pts = samplePacePath(path.getAttribute('d'))
      for (let i = 0; i + 1 < pts.length; i++) if (segmentTouchesRect(pts[i], pts[i + 1], b, 1)) { problems.push(`curve crosses (${sel})`); break }
    }
  }
  if (touches(b, { left: own.x - 8.4, right: own.x + 8.4, top: own.y - 8.4, bottom: own.y + 8.4 })) problems.push('on its own marker')
  dots.slice(0, -1).forEach((d, i) => { if (touches(b, { left: d.x - 4, right: d.x + 4, top: d.y - 4, bottom: d.y + 4 })) problems.push(`covers dot ${i}`) })
  svg.querySelectorAll('.pace-chart-value, .pace-x-label').forEach(el => {
    if (el === text) return
    const o = box(el, s => s.length * (el.classList.contains('pace-x-label') ? 6 : GLYPH))
    if (touches(b, o)) problems.push(`overlaps ${el.textContent}`)
  })
  // Phone width at 1k step packs 30+ dots into ~1-2 units each: the curve fills the
  // whole edge and no crossing-free spot exists, so those checks are waived there.
  const packed = prev && Math.abs(own.x - prev.x) < 2
  const kept = packed ? problems.filter(p => !p.startsWith('curve crosses')) : problems
  problems.length = 0; problems.push(...kept)
  // (and which of two dots 1 unit apart a label belongs to is not decidable either)
  if (prev && !packed && gap(b, own) > gap(b, prev) + 3) problems.push('nearer the previous dot than its own')
  return { problems, box: b, own_pt: own, prev_pt: prev, xl: [...svg.querySelectorAll('.pace-x-label')].map(e => [e.textContent, e.getAttribute('x'), e.getAttribute('y')]).slice(-2), label: text.textContent, x: text.getAttribute('x'), y: text.getAttribute('y'), anchor: text.getAttribute('class'), own: gap(b, own), n: dots.length }
}

describe('UI-4: the latest pace value label is attached to its own dot', () => {
  const cases = []
  for (const isMobile of [false, true]) for (const step of [1000, 2000, 5000, 10000]) for (const period of ['week', 'month', 'all']) {
    for (const count of [REAL_HISTORY.length, REAL_HISTORY.length - 11, REAL_HISTORY.length - 37]) cases.push([isMobile, step, period, count])
  }
  it.each(cases)('mobile=%s step=%s period=%s sessions=%s', async (isMobile, step, period, count) => {
    mobile = isMobile
    const meta = replayMeta(count)
    mockNow(meta.brHistory[meta.brHistory.length - 1].timestamp + DAY / 2)
    await mount(meta, { rpt_pace_bin_size: String(step), rpt_chart_period: period })
    if (!document.querySelector('[data-testid="pace-chart"]')) return // empty period card: nothing to place
    const report = latestLabelReport()
    expect(report.problems, JSON.stringify(report)).toEqual([])
  })
})

// ─── NUM-3 ───────────────────────────────────────────────────────────────────
// Frozen slice of data/meta.json (rows 196-202): [timestamp, brAfter, sessionResult, tournaments, totalTournaments].
// 31 Oct and 3 Nov leave the cumulative total unchanged: their tournaments are counted in the next report.
const SLICE = [
  [1793242005, 501187, 10271, 58, 42115], [1793332948, 507143, 5956, 214, 42329], [1793419283, 520286, 13143, 168, 42329],
  [1793505417, 526525, 6239, 208, 42705], [1793589749, 521352, -5173, 136, 42841], [1793682118, 521900, 548, 308, 42841],
  [1793771108, 508858, -13042, 332, 43481],
]
const sliceHistory = () => SLICE.map(([timestamp, brAfter, sessionResult, tournaments, totalTournaments], i) => ({
  id: `slice-${i}`, date: `D${i}`, timestamp, brAfter, sessionResult, tournaments, totalTournaments, text: `Session ${i}`,
}))

describe('NUM-3: a session bar that absorbs earlier reports carries their money', () => {
  const rows = buildSessionMttRows(sliceHistory())

  it('1 Nov: 168 + 208 MTT together with both reports\' profit', () => {
    const bar = rows.find(r => r.timestamp === 1793505417)
    expect(bar).toMatchObject({ mtt: 376, profit: 13143 + 6239, reports: 2 })
  })

  it('4 Nov: 640 MTT with the 3 Nov and 4 Nov reports together (-12.5k, not -13.0k)', () => {
    const bar = rows.find(r => r.timestamp === 1793771108)
    expect(bar).toMatchObject({ mtt: 640, profit: 548 - 13042, reports: 2 })
  })

  it('bars that cover one report are unchanged', () => {
    expect(rows.find(r => r.timestamp === 1793589749)).toMatchObject({ mtt: 136, profit: -5173, reports: 1 })
    expect(rows.find(r => r.timestamp === 1793332948)).toMatchObject({ mtt: 214, profit: 5956, reports: 1 })
  })

  it('the money of the bars adds up to the money of the reports', () => {
    const own = SLICE.slice(1).reduce((s, r) => s + r[2], 0)
    expect(rows.slice(1).reduce((s, r) => s + r.profit, 0)).toBe(own)
  })

  it('the tooltip shows the combined profit and says how many reports it covers', async () => {
    const meta = { startBankroll: 10000, bankroll: 508858, totalTournaments: 43481, brHistory: sliceHistory(), lastUpdated: '2026-11-04T06:00:00.000Z' }
    mockNow(1793771108 + DAY)
    await mount(meta)
    const capture = await screen.findByTestId('smtt-hover-capture')
    // 5 bars over the 596-unit plot starting at 34: the last bar is the 4th index
    fireEvent.mouseMove(capture, { clientX: 34 + 4.5 * (596 / 5) })
    const tip = document.querySelector('.smtt-tooltip')
    expect(tip.textContent).toContain('640')
    expect(tip.querySelector('.smtt-tooltip-profit').textContent).toMatch(/-12[.,]5k/)
    expect(tip.querySelector('.smtt-tooltip-reports').textContent).toBe(`2 ${translate('ru', 'smtt_reports_few')}`)
    // a single-report bar has no such line
    fireEvent.mouseMove(capture, { clientX: 34 + 1.5 * (596 / 5) })
    expect(document.querySelector('.smtt-tooltip-reports')).toBeNull()
  })

  it('reports wording exists in ru/en/es', () => {
    for (const lang of ['ru', 'en', 'es']) for (const key of ['smtt_reports_one', 'smtt_reports_few', 'smtt_reports_many', 'pace_empty_few']) {
      expect(translate(lang, key)).not.toBe(key)
    }
  })
})

// ─── NUM-P2 ──────────────────────────────────────────────────────────────────
function historyWithWindow(daysAgoList, now) {
  // old reports (always outside a 7-day window) followed by the given ones, newest last
  const rows = [[40, 120, 200], [34, -80, 150], ...daysAgoList.map(d => [d, 90, 180])].map(([daysAgo, result, tournaments]) => ({ daysAgo, result, tournaments }))
  let br = 10000
  let total = 0
  const brHistory = rows.map((r, i) => {
    br += r.result
    total += r.tournaments
    return { id: `w${i}`, date: `D${i}`, timestamp: now - r.daysAgo * DAY, brAfter: br, sessionResult: r.result, tournaments: r.tournaments, totalTournaments: total, text: `S${i}` }
  })
  return { startBankroll: 10000, bankroll: br, totalTournaments: total, brHistory, lastUpdated: '2026-11-21T10:00:00.000Z' }
}

describe('NUM-P2: week with a single report is the same story in every widget', () => {
  const NOW = Date.UTC(2026, 10, 21, 12) / 1000

  it('one report in the week: pace card says too few reports, the tempo slot shows a placeholder', async () => {
    mockNow(NOW)
    await mount(historyWithWindow([2], NOW), { rpt_chart_period: 'week' })
    const widget = await screen.findByTestId('pace-widget')
    expect(widget).toHaveAttribute('data-empty', 'true')
    expect(widget.textContent).toContain(translate('ru', 'pace_empty_few'))
    expect(widget.querySelector('.pace-rate-item')).toBeNull()
    const bar = document.querySelector('.marathon-progress')
    expect(bar.querySelector('.tempo-val')).toBeNull()
    expect(bar.querySelector('.mps-rate-inline')).toBeNull()
    expect(bar.textContent).toContain('—')
    // the marathon chart agrees: it falls back to the whole archive and says so
    expect(document.querySelector('.mc-view-hint').textContent).toContain(translate('ru', 'chart_session_fallback'))
  })

  it('two reports in the week: a real pace again', async () => {
    mockNow(NOW)
    await mount(historyWithWindow([3, 1], NOW), { rpt_chart_period: 'week' })
    const widget = await screen.findByTestId('pace-widget')
    expect(widget).not.toHaveAttribute('data-empty')
    expect(widget.querySelector('.pace-rate-item')).toBeTruthy()
    expect(document.querySelector('.marathon-progress .tempo-val')).toBeTruthy()
  })

  it('no report in the week keeps its own wording', async () => {
    mockNow(NOW)
    await mount(historyWithWindow([], NOW), { rpt_chart_period: 'week' })
    const widget = await screen.findByTestId('pace-widget')
    expect(widget.textContent).toContain(translate('ru', 'pace_empty_period'))
  })

  it('all time with a single recent report is not affected', async () => {
    mockNow(NOW)
    await mount(historyWithWindow([2], NOW), { rpt_chart_period: 'all' })
    const widget = await screen.findByTestId('pace-widget')
    expect(widget).not.toHaveAttribute('data-empty')
  })
})
