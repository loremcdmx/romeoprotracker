// Numbers at the data boundary: non-finite values inside a report (1e999 in the
// JSON text parses to Infinity), a sub-unit tournament count, and a bankroll of
// exactly 0. The page must keep rendering with the rows it can use, print no
// "Infinity"/"NaN", leak no bare "0" into the layout and log no console error
// (React reports every NaN attribute through console.error).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App, { buildPaceSegments } from './App.jsx'
import { fetchPublicData } from './storage.js'
import { warsawDayKey } from './utils.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// What JSON.parse makes of the text 1e999 in a data file.
const INF = JSON.parse('{"x":1e999}').x
const NEG_INF = JSON.parse('{"x":-1e999}').x

const row = (i, over = {}) => ({
  id: `r${i}`, timestamp: 1712500000 + i * 86400, date: `0${i}.04`, text: `Session ${i}`,
  brBefore: 10000 + (i - 1) * 1000, brAfter: 10000 + i * 1000, sessionResult: 1000,
  tournaments: 100, totalTournaments: i * 100,
  rooms: { before: { gg: 9000 + i * 1000, ps: 1000 }, after: { gg: 10000 + i * 1000, ps: 1000 } },
  ...over,
})

function dataWith(brHistory, metaOver = {}) {
  return {
    posts: [{
      id: 'p1', author: 'Romeopro', text: 'Day 5: marathon', likes: 42, timestamp: 1712500000,
      date: '07.04.26', avatar: null, rating: 5000, msgCount: 100, regData: '2020',
      brAfter: null, images: [], videos: [], url: 'https://forum.gipsyteam.ru/x',
    }],
    meta: {
      startBankroll: 10000, bankroll: 13000, totalTournaments: 300, brHistory,
      lastUpdated: '2026-04-19T02:00:00.000Z', ...metaOver,
    },
  }
}

async function mount(data, { lang = 'ru', grouping = 'sessions', width = 1280 } = {}) {
  localStorage.clear()
  localStorage.setItem('rpt_lang', lang)
  localStorage.setItem('rpt_marathon_grouping', grouping)
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  fetchPublicData.mockReset()
  fetchPublicData.mockResolvedValue(structuredClone(data))
  const view = render(<App />)
  await waitFor(() => expect(document.querySelector('.hero, [data-testid="pace-widget"]')).toBeTruthy())
  return view
}

// Every attribute of every element, plus the visible text.
function nonFiniteTraces() {
  const traces = []
  const bad = /\bNaN\b|Infinity|∞/
  if (bad.test(document.body.textContent)) traces.push(`text: ${document.body.textContent.match(/.{0,30}(NaN|Infinity|∞).{0,30}/)?.[0]}`)
  for (const el of document.body.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (bad.test(attr.value)) traces.push(`<${el.tagName.toLowerCase()} ${attr.name}="${attr.value.slice(0, 60)}">`)
    }
  }
  return traces
}

let consoleError
beforeEach(() => {
  // hero counters snap to the final value instead of easing toward it
  window.matchMedia = query => ({
    matches: /prefers-reduced-motion/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

const logged = () => consoleError.mock.calls.map(args => String(args[0]).slice(0, 120))

// ─── (a) non-finite numbers inside a report ──────────────────────────────────
describe('non-finite numbers in the last report', () => {
  const history = over => [row(1), row(2), row(3, over)]

  it.each([
    ['tournaments = 1e999', { tournaments: INF }],
    ['tournaments = -1e999', { tournaments: NEG_INF }],
    ['totalTournaments = 1e999', { totalTournaments: INF }],
    ['tournaments and totalTournaments = 1e999', { tournaments: INF, totalTournaments: INF }],
    ['tournaments = 1e999 and no total', { tournaments: INF, totalTournaments: undefined }],
    ['sessionResult = 1e999', { sessionResult: INF }],
    ['sessionResult = -1e999', { sessionResult: NEG_INF }],
    ['brBefore = 1e999', { brBefore: INF }],
    ['a room value = 1e999', { rooms: { before: { gg: 11000, ps: INF }, after: { gg: INF, ps: 1000 } } }],
  ])('%s: no NaN/Infinity on the page, no console error (sessions chart)', async (_name, over) => {
    await mount(dataWith(history(over)))
    await screen.findByTestId('pace-widget')
    expect(document.querySelector('.marathon-chart svg')).toBeTruthy()
    expect(nonFiniteTraces()).toEqual([])
    expect(logged()).toEqual([])
  })

  it.each([
    ['tournaments', { tournaments: INF }],
    ['totalTournaments', { totalTournaments: INF }],
    ['sessionResult', { sessionResult: INF }],
  ])('%s = 1e999: the same on the monthly view and on a phone', async (_name, over) => {
    for (const [grouping, width] of [['months', 1280], ['sessions', 375], ['months', 375]]) {
      const view = await mount(dataWith(history(over)), { grouping, width })
      await screen.findByTestId('pace-widget')
      expect(nonFiniteTraces()).toEqual([])
      expect(logged()).toEqual([])
      view.unmount()
    }
  })

  it('a hostile report in the middle of the history is handled just the same', async () => {
    await mount(dataWith([row(1), row(2, { tournaments: INF, sessionResult: INF }), row(3), row(4)]))
    await screen.findByTestId('pace-widget')
    expect(nonFiniteTraces()).toEqual([])
    expect(logged()).toEqual([])
  })

  it('the clean part of a hostile report still counts (its bankroll reaches the hero)', async () => {
    await mount(dataWith(history({ tournaments: INF, sessionResult: INF })))
    await waitFor(() => expect(document.querySelector('.hstat-value.br-anim')?.textContent.replace(/\D/g, '')).toBe('13000'))
    // the session result is derived from the bankroll step instead: 13000 - 12000
    expect(document.querySelector('.hstat-value.green, .hstat-value.red')?.textContent.replace(/\D/g, '')).toBe('3000')
  })
})

// Hovering every marker opens the tooltip with the raw report values.
function hoverEveryMarker() {
  const texts = []
  for (const marker of document.querySelectorAll('.marathon-chart g[data-end]')) {
    fireEvent.mouseEnter(marker)
    const tip = document.querySelector('.mc-tooltip')
    if (tip) texts.push(tip.textContent)
  }
  return texts
}

describe('the chart tooltip with non-finite report values', () => {
  it.each([
    ['tournaments', { tournaments: INF, totalTournaments: undefined }],
    ['totalTournaments', { totalTournaments: INF }],
    ['sessionResult', { sessionResult: INF }],
    ['a room value', { rooms: { before: { gg: 11000, ps: INF }, after: { gg: INF, ps: 1000 } } }],
  ])('%s = 1e999: the tooltip of every marker shows no NaN/Infinity', async (_name, over) => {
    await mount(dataWith([row(1), row(2), row(3, over)]))
    await screen.findByTestId('pace-widget')
    const tips = hoverEveryMarker()
    expect(tips.length).toBeGreaterThan(0)
    expect(tips.filter(text => /NaN|Infinity|∞/.test(text))).toEqual([])
    expect(nonFiniteTraces()).toEqual([])
    expect(logged()).toEqual([])
  })

  it('a rooms value of the wrong shape neither crashes the tooltip nor shows room lines', async () => {
    await mount(dataWith([row(1), row(2, { rooms: { before: { gg: 1 } } }), row(3, { rooms: 'gg' }), row(4, { rooms: [] })]))
    await screen.findByTestId('pace-widget')
    expect(hoverEveryMarker().length).toBeGreaterThan(0)
    expect(logged()).toEqual([])
  })
})

// ─── (b) a sliver of a tournament is not a count ─────────────────────────────
describe('a positive but sub-unit tournament count', () => {
  const only = tournaments => [{ timestamp: 1712500000, brAfter: 9300, sessionResult: -700, tournaments }]
  const segmentsOf = history => buildPaceSegments(history, () => true, 10000, 2000)

  it.each([5e-324, 1e-300, 0.5, 0.999])('%s MTT is "no data": no infinite rate for a lone losing report', tournaments => {
    expect(segmentsOf(only(tournaments))).toEqual([])
  })

  it('a count of exactly 1 still counts', () => {
    const segments = segmentsOf(only(1))
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ tournaments: 1, profit: -700, rate: -700 })
  })

  it('the lone report of a window gives the page a finite, honest pace', async () => {
    await mount(dataWith([row(1, { brBefore: 10000, brAfter: 9300, sessionResult: -700, tournaments: 5e-324, totalTournaments: undefined })]))
    const widget = await screen.findByTestId('pace-widget')
    expect(widget.textContent).not.toMatch(/NaN|Infinity|∞/)
    expect(nonFiniteTraces()).toEqual([])
    expect(logged()).toEqual([])
  })
})

// ─── (c) numeric render guards: a 0 must not leak into the page as text ──────
const directText = (el, data) => [...el.childNodes].some(node => node.nodeType === 3 && node.data === data)
const strayText = container => [...container.childNodes].filter(node => node.nodeType === 3 && node.data.trim() !== '').map(node => node.data)

describe('a bankroll of exactly 0 (bust)', () => {
  const bust = () => dataWith([row(1), row(2), row(3, { brBefore: 12000, brAfter: 0, sessionResult: -12000 })], { bankroll: 0 })

  it('prints no stray "0" between the header and the page', async () => {
    const { container } = await mount(bust())
    await waitFor(() => expect(document.querySelector('.hstat-value.br-anim')).toBeTruthy())
    expect(strayText(container)).toEqual([])
  })

  it('keeps the hero honest: 0$ next to the -10 000$ it was computed from, no NaN, no console error', async () => {
    await mount(bust())
    await waitFor(() => expect(document.querySelector('.hstat-value.br-anim')).toBeTruthy())
    expect(document.querySelector('.hstat-value.br-anim').textContent.replace(/\D/g, '')).toBe('0')
    expect(document.querySelector('.hstat-value.red').textContent).toMatch(/^-/)
    expect(document.querySelector('.hstat-value.red').textContent.replace(/\D/g, '')).toBe('10000')
    expect(document.querySelector('.marathon-chart svg')).toBeTruthy()
    expect(nonFiniteTraces()).toEqual([])
    expect(logged()).toEqual([])
  })

  it('shows no progress bar and no pace widget at 0 (there is no pace to project from a bust)', async () => {
    await mount(bust())
    await waitFor(() => expect(document.querySelector('.hstat-value.br-anim')).toBeTruthy())
    expect(document.querySelector('.marathon-progress')).toBeNull()
    expect(screen.queryByTestId('pace-widget')).toBeNull()
  })

  it.each(['en', 'es'])('the same in %s', async lang => {
    const { container } = await mount(bust(), { lang })
    await waitFor(() => expect(document.querySelector('.hstat-value.br-anim')).toBeTruthy())
    expect(strayText(container)).toEqual([])
    expect(logged()).toEqual([])
  })

  it('a non-bust history still shows the progress bar (the guard only drops the 0)', async () => {
    await mount(dataWith([row(1), row(2), row(3)]))
    await screen.findByTestId('pace-widget')
    expect(document.querySelector('.marathon-progress')).toBeTruthy()
  })
})

describe('other numeric && guards render nothing for 0', () => {
  it('a report time of 0 adds no "0" after the hero description', async () => {
    await mount(dataWith([row(1, { timestamp: 0 })]))
    await waitFor(() => expect(document.querySelector('.hero-desc')).toBeTruthy())
    expect(directText(document.querySelector('.hero-desc'), '0')).toBe(false)
  })

  it('a post with 0 messages and a 0 bankroll adds no bare "0" to its card', async () => {
    const data = dataWith([row(1), row(2), row(3)])
    data.posts[0] = { ...data.posts[0], msgCount: 0, brAfter: 0 }
    await mount(data)
    await waitFor(() => expect(document.querySelector('.post-card')).toBeTruthy())
    expect(directText(document.querySelector('.pc-author-meta'), '0')).toBe(false)
    expect(directText(document.querySelector('.pc-foot'), '0')).toBe(false)
  })

  it('a report with 0 tournaments adds no bare "0" to the chart tooltip', async () => {
    await mount(dataWith([row(1), row(2), row(3, { tournaments: 0, totalTournaments: 300 })]))
    await screen.findByTestId('pace-widget')
    const tips = []
    for (const marker of document.querySelectorAll('.marathon-chart g[data-end]')) {
      fireEvent.mouseEnter(marker)
      const tip = document.querySelector('.mc-tooltip')
      if (tip) tips.push(directText(tip, '0'))
    }
    expect(tips.length).toBeGreaterThan(0)
    expect(tips).not.toContain(true)
  })

  it('a day summary of a bust report (bankroll 0) adds no bare "0" to the day tooltip', async () => {
    const dayTs = Math.floor(Date.now() / 1000) - 3600
    const data = dataWith([row(1), row(2), row(3)])
    data.posts.push({ id: 'r9', author: 'Romeopro', text: 'Bust', likes: 12, timestamp: dayTs, date: 'x', rating: 1,
      brAfter: 0, sessionResult: -12000, images: [], videos: [], url: 'https://forum.gipsyteam.ru/r9' })
    await mount(data)
    const bar = [...document.querySelectorAll('[role="button"][aria-label]')]
      .find(el => el.getAttribute('aria-label').startsWith(`${warsawDayKey(dayTs)}:`))
    expect(bar).toBeTruthy()
    fireEvent.mouseEnter(bar)
    await waitFor(() => expect(document.querySelector('.chart-tooltip .day-event-body')).toBeTruthy())
    expect(directText(document.querySelector('.chart-tooltip .day-event-body'), '0')).toBe(false)
  })
})
