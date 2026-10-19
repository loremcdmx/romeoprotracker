import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const T = ' '
const DAY = 86400
const at = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h) / 1000
// Roboto Mono advance is 0.6em; the axis labels are 10.5-10.6px, so ~6.4 units.
const GLYPH = 6.4
let mobileViewport = false
let now = at(2026, 10, 14)

// sessions: [{ ts, br }] chronological; br is the bankroll after the session.
function makeData(sessions, { startBankroll = 10000 } = {}) {
  let previous = startBankroll
  const brHistory = sessions.map(({ ts, br }, index) => {
    const row = {
      id: String(index + 1), timestamp: ts, date: `Session ${index + 1}`, text: `Session ${index + 1}`,
      brBefore: previous, brAfter: br, sessionResult: br - previous,
      tournaments: 300, totalTournaments: (index + 1) * 300,
      url: `https://example.com/session/${index + 1}`,
    }
    previous = br
    return row
  })
  return {
    posts: brHistory.map(row => ({ ...row, author: 'Romeopro', likes: 10,
      rating: 25000, avatar: null, images: [], videos: [] })),
    meta: {
      startBankroll, targetBankroll: 10000000, bankroll: previous,
      totalTournaments: brHistory.length * 300, brHistory, day: 40, totalPosts: brHistory.length,
      lastUpdated: new Date(sessions.at(-1).ts * 1000).toISOString(),
    },
    leaderboards: null,
  }
}

// A long marathon: one session every `every` days from `from` to `to`, with a
// wobbling but positive bankroll.
function longMarathon(from, to, every = 9) {
  const sessions = []
  let br = 10000
  for (let ts = from, i = 0; ts <= to; ts += every * DAY, i++) {
    br += [1800, -700, 2600, 900, -1200][i % 5] * 3
    sessions.push({ ts, br })
  }
  return sessions
}

async function mount(data, { lang = 'ru', grouping = 'sessions' } = {}) {
  localStorage.setItem('rpt_lang', lang)
  localStorage.setItem('rpt_marathon_grouping', grouping)
  fetchPublicData.mockResolvedValue(data)
  const view = render(<App />)
  await screen.findByTestId('pace-widget')
  await waitFor(() => expect(view.container.querySelector('.marathon-chart')).toBeInTheDocument())
  return view
}

const sessionSvg = view => view.container.querySelector('.marathon-chart svg.mc-svg')
const texts = (root, selector) => [...root.querySelectorAll(selector)].map(node => node.textContent)

beforeEach(() => {
  localStorage.clear()
  mobileViewport = false
  now = at(2026, 10, 14)
  window.matchMedia = query => ({
    get matches() {
      if (/prefers-reduced-motion/.test(query)) return true // hero counters snap to the final value
      return mobileViewport && /max-width/.test(query)
    },
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  })
  vi.spyOn(Date, 'now').mockImplementation(() => now * 1000)
  fetchPublicData.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── money at and above $1M ──────────────────────────────────────────────────
describe('bankroll past $1M', () => {
  const million = () => makeData([
    { ts: at(2026, 8, 1), br: 400000 },
    { ts: at(2026, 9, 1), br: 800000 },
    { ts: at(2026, 9, 20), br: 1150000 },
    { ts: at(2026, 10, 12), br: 1234567 },
  ])

  it('groups every thousand in the hero bankroll, start bankroll and profit', async () => {
    const view = await mount(million())
    await waitFor(() => expect(view.container.querySelector('.hstat-value.br-anim').textContent)
      .toBe(`1${T}234${T}567$`))
    expect(view.container.querySelector('.hstat-sub').textContent).toContain(`10${T}000$`)
    expect(view.container.querySelector('.hstat-value.green').textContent).toBe(`+1${T}224${T}567$`)
  })

  it('writes the peak badge, the Y axis and the tooltip in M, never in four-digit k', async () => {
    const view = await mount(million())
    const svg = sessionSvg(view)
    expect(svg.querySelector('.mc-peak-callout-value').textContent).toBe('$1.23M')
    const axis = texts(svg, '.mc-yaxis-label')
    expect(axis.some(label => label.endsWith('M'))).toBe(true)
    expect(svg.textContent).not.toMatch(/\d{4,}k|1000\.0k/)

    const lastMarker = [...view.container.querySelectorAll('.marathon-chart g[data-start][data-end]')].at(-1)
    fireEvent.mouseEnter(lastMarker)
    const tooltip = document.querySelector('.mc-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip.textContent).toContain('1.23M$')
    expect(tooltip.textContent).not.toMatch(/\d{4}(\.\d)?k\$/)
  })

  it('promotes the 999 950 .. 999 999 band to M instead of printing 1000.0k', async () => {
    const view = await mount(makeData([
      { ts: at(2026, 9, 1), br: 600000 },
      { ts: at(2026, 10, 12), br: 999960 },
    ]))
    const lastMarker = [...view.container.querySelectorAll('.marathon-chart g[data-start][data-end]')].at(-1)
    fireEvent.mouseEnter(lastMarker)
    const tooltip = document.querySelector('.mc-tooltip').textContent
    expect(tooltip).toContain('1.00M$')
    expect(tooltip).not.toContain('1000.0k')
    expect(sessionSvg(view).querySelector('.mc-peak-callout-value').textContent).toBe('$1M')
  })

  it('writes the best-day plate and the range-start label in M', async () => {
    const view = await mount(makeData([
      { ts: at(2026, 9, 1), br: 1100000 },
      { ts: at(2026, 10, 10), br: 1400000 },
      { ts: at(2026, 10, 12), br: 1420000 },
    ]))
    const plate = view.container.querySelector('.mc-milestone-callout.best')
    expect(plate.textContent).toContain('+$1.09M')
    expect(plate.textContent).not.toMatch(/\d{4}k/)

    fireEvent.click(within(view.container.querySelector('.marathon-chart'))
      .getByRole('button', { name: translate('ru', 'period_week'), exact: true }))
    const labels = texts(sessionSvg(view), '.mc-xaxis-label-main')
    // The window opens at +$1.09M of profit made before it.
    expect(labels.join(' ')).toContain('+1.09M$')
    expect(labels.join(' ')).not.toMatch(/\d{4}(\.\d)?k/)
  })

  it('shows monthly axis labels, month details and aria-labels in M with full grouping', async () => {
    const view = await mount(million(), { grouping: 'months' })
    const chart = screen.getByTestId('marathon-monthly-chart')
    const axis = texts(chart, '.mc-yaxis-label')
    expect(axis.some(label => label.endsWith('M'))).toBe(true)
    expect(axis.join(' ')).not.toMatch(/\d{4,}k/)
    const values = texts(screen.getByTestId('marathon-month-details'), 'dd')
    expect(values[0]).toBe(`1${T}234${T}567$`)
    expect(values[1]).toBe(`+84${T}567$`)
    const buttons = [...chart.querySelectorAll('[role="button"][data-month-key]')]
    expect(buttons.at(-1).getAttribute('aria-label')).toContain(`1${T}234${T}567$`)
    view.unmount()
  })
})

// ─── monthly chart: gutter sized from the longest Y label ────────────────────
describe.each([
  ['phone', true],
  ['desktop', false],
])('monthly chart Y axis on %s', (_, mobile) => {
  beforeEach(() => { mobileViewport = mobile })

  // brPrev 402.2k -> 403.3k inside the last week: the tick step drops to $500
  // and the labels become '$402.5k' / '$403k'.
  const narrowWeek = () => makeData([
    { ts: at(2026, 9, 1), br: 380000 },
    { ts: at(2026, 10, 1), br: 402200 },
    { ts: at(2026, 10, 11), br: 402800 },
    { ts: at(2026, 10, 13), br: 403300 },
  ])

  async function openWeek(data) {
    await mount(data, { grouping: 'months' })
    const chart = screen.getByTestId('marathon-monthly-chart')
    fireEvent.click(within(chart).getByRole('button', { name: translate('ru', 'period_week'), exact: true }))
    return screen.getByTestId('marathon-monthly-chart')
  }

  const assertLabelsInside = chart => {
    const svg = chart.querySelector('svg.mc-svg')
    const plotLeft = Number(svg.querySelector('.mc-plot-bg').getAttribute('x'))
    const labels = [...svg.querySelectorAll('.mc-yaxis-label')]
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      const right = Number(label.getAttribute('x'))
      expect(right).toBe(plotLeft - 10)
      // text-anchor: end, so the left edge is x - width. It must stay inside the SVG.
      expect(right - label.textContent.length * GLYPH).toBeGreaterThanOrEqual(0)
    }
    return labels.map(label => label.textContent)
  }

  it('keeps 7-character labels inside the SVG', async () => {
    const chart = await openWeek(narrowWeek())
    const labels = assertLabelsInside(chart)
    expect(labels).toEqual(expect.arrayContaining(['$402.5k', '$403k']))
    expect(Math.max(...labels.map(label => label.length))).toBeGreaterThanOrEqual(7)
  })

  it('keeps $M labels inside the SVG and prints them as $1.0005M-style text', async () => {
    const chart = await openWeek(makeData([
      { ts: at(2026, 9, 1), br: 900000 },
      { ts: at(2026, 10, 1), br: 1000200 },
      { ts: at(2026, 10, 13), br: 1001300 },
    ]))
    const labels = assertLabelsInside(chart)
    expect(labels.every(label => /^\$[\d.]+M$/.test(label))).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
    expect(Math.max(...labels.map(label => label.length))).toBeGreaterThanOrEqual(7)
  })

  it('leaves the gutter at its old width for ordinary labels', async () => {
    await mount(makeData([
      { ts: at(2026, 3, 11), br: 12000 },
      { ts: at(2026, 6, 1), br: 90000 },
      { ts: at(2026, 10, 12), br: 436927 },
    ]), { grouping: 'months' })
    const svg = screen.getByTestId('marathon-monthly-chart').querySelector('svg.mc-svg')
    expect(Number(svg.querySelector('.mc-plot-bg').getAttribute('x'))).toBe(mobile ? 48 : 58)
  })
})

// ─── year on month ticks and date tags ───────────────────────────────────────
describe.each([
  ['ru', /^[А-Я]{3}( \d{2})?$/u, 'МАР'],
  ['en', /^[A-Z]{3}( \d{2})?$/, 'MAR'],
  ['es', /^[A-Z]{3}( \d{2})?$/, 'MAR'],
])('all-time month ticks in %s', (lang, shape, march) => {
  const monthTicks = view => texts(sessionSvg(view), '.mc-month-label-main')

  it('keeps bare month names while the marathon is inside one calendar year', async () => {
    now = at(2026, 12, 20)
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), now)), { lang })
    const labels = monthTicks(view)
    expect(labels.length).toBeGreaterThan(3)
    expect(labels[0]).toBe(march)
    for (const label of labels) expect(label).toMatch(/^[^\d]+$/)
  })

  it.each([
    ['January 2027 (year changes, no month repeats yet)', at(2027, 1, 20), ['26', '27']],
    ['April 2027 (March and April repeat)', at(2027, 4, 15), ['26', '27']],
    ['February 2028 (crosses into 2028)', at(2028, 2, 20), ['26', '27', '28']],
  ])('adds a two-digit year to every tick by %s', async (_, end, years) => {
    now = end
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), end)), { lang })
    const labels = monthTicks(view)
    expect(labels.length).toBeGreaterThan(3)
    for (const label of labels) expect(label).toMatch(shape)
    for (const label of labels) expect(label).toMatch(/ \d{2}$/)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toBe(`${march} 26`)
    for (const year of years) expect(labels.some(label => label.endsWith(` ${year}`))).toBe(true)
  })

  it('keeps year labels from overlapping on the phone canvas as well', async () => {
    mobileViewport = true
    now = at(2027, 1, 20)
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), now)), { lang })
    const labels = monthTicks(view)
    expect(labels.length).toBeGreaterThan(1)
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) expect(label).toMatch(/ \d{2}$/)
    const xs = [...sessionSvg(view).querySelectorAll('.mc-month-label-main')].map(node => Number(node.getAttribute('x')))
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(58)
  })
})

describe('date tags once the range crosses a year', () => {
  it('shows the year in the hover tag, the tooltip title and the session-MTT widget', async () => {
    now = at(2027, 6, 11)
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), now)))
    const lastMarker = [...view.container.querySelectorAll('.marathon-chart g[data-start][data-end]')].at(-1)
    fireEvent.mouseEnter(lastMarker)
    expect(view.container.querySelector('.mc-hover-tag text').textContent).toMatch(/^\d{1,2} [а-я]+ 27$/u)
    expect(document.querySelector('.mc-tooltip').textContent).toMatch(/\d{1,2} [а-я]+ 2027, \d{2}:\d{2}/u)

    const smttTicks = texts(view.container, '.smtt-x-label')
    expect(smttTicks.length).toBeGreaterThan(1)
    for (const tick of smttTicks) expect(tick).toMatch(/ \d{2}$/)
  })

  it('leaves the tags untouched while everything happened in one year', async () => {
    now = at(2026, 10, 14)
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), now)))
    const lastMarker = [...view.container.querySelectorAll('.marathon-chart g[data-start][data-end]')].at(-1)
    fireEvent.mouseEnter(lastMarker)
    expect(view.container.querySelector('.mc-hover-tag text').textContent).toMatch(/^\d{1,2} [а-я]+$/u)
    expect(document.querySelector('.mc-tooltip').textContent).not.toMatch(/ 202\d, \d{2}:\d{2}/)
    for (const tick of texts(view.container, '.smtt-x-label')) expect(tick).toMatch(/^\d{1,2} [а-я]+$/u)
  })

  it('does not add a year to a week window that sits wholly inside one year', async () => {
    now = at(2027, 6, 11)
    const view = await mount(makeData(longMarathon(at(2026, 3, 11), now, 1)))
    fireEvent.click(within(view.container.querySelector('.marathon-chart'))
      .getByRole('button', { name: translate('ru', 'period_week'), exact: true }))
    const lastMarker = [...view.container.querySelectorAll('.marathon-chart g[data-start][data-end]')].at(-1)
    fireEvent.mouseEnter(lastMarker)
    expect(view.container.querySelector('.mc-hover-tag text').textContent).toMatch(/^\d{1,2} [а-я]+$/u)
  })
})
