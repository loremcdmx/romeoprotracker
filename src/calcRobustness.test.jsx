// Hostile / odd values on the way from the data files to the screen: the page
// must keep rendering with the rows it can use, and no calculation may hang.
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App, { buildPaceSegments } from './App.jsx'
import MonthlyMarathonChart from './components/MonthlyMarathonChart.jsx'
import { createTranslator, translate } from './i18n.js'
import { normalizeMarathonDistance } from './marathonMonths.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const digits = text => Number(String(text).replace(/\D/g, ''))
const heroBr = () => document.querySelector('.hstat-value.br-anim')?.textContent
const heroProfit = () => document.querySelector('.hstat-value.green, .hstat-value.red')?.textContent

const row = (i, over = {}) => ({
  id: `r${i}`, timestamp: 1712500000 + i * 86400, date: `0${i}.04`, text: `Session ${i}`,
  brBefore: 10000 + (i - 1) * 1000, brAfter: 10000 + i * 1000, sessionResult: 1000,
  tournaments: 100, totalTournaments: i * 100, ...over,
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

async function mount(data, { lang = 'ru' } = {}) {
  localStorage.clear()
  localStorage.setItem('rpt_lang', lang)
  fetchPublicData.mockReset()
  fetchPublicData.mockResolvedValue(structuredClone(data))
  const view = render(<App />)
  await waitFor(() => expect(document.querySelector('.hero, [data-testid="pace-widget"]')).toBeTruthy())
  return view
}

beforeEach(() => {
  // hero counters snap to the final value instead of easing toward it
  window.matchMedia = query => ({
    matches: /prefers-reduced-motion/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
})
afterEach(() => { vi.restoreAllMocks() })

// ─── a null / non-object row inside brHistory ────────────────────────────────
describe('brHistory with rows that are not objects', () => {
  const rows = () => [null, row(1), 7, 'row', row(2), undefined, [], row(3), true]

  it('renders the hero from the usable rows instead of failing to load', async () => {
    await mount(dataWith(rows()))
    expect(screen.queryByText(translate('ru', 'load_failed_title'))).toBeNull()
    await waitFor(() => expect(digits(heroBr())).toBe(13000))
    expect(digits(heroProfit())).toBe(3000)
    expect(screen.getByTestId('pace-widget')).toBeInTheDocument()
    expect(document.querySelector('.marathon-chart')).toBeTruthy()
  })

  it('renders the monthly view and the other widgets from the same rows', async () => {
    localStorage.setItem('rpt_marathon_grouping', 'months')
    await mount(dataWith(rows()))
    await waitFor(() => expect(document.querySelector('.marathon-chart')).toBeTruthy())
    expect(screen.queryByText(translate('ru', 'load_failed_title'))).toBeNull()
  })

  it.each([
    ['an object', {}],
    ['an object with a length', { length: 3 }],
    ['a string', 'abc'],
    ['a number', 5],
  ])('survives a brHistory that is %s (no reports at all)', async (_name, brHistory) => {
    await mount(dataWith(brHistory))
    expect(screen.queryByText(translate('ru', 'load_failed_title'))).toBeNull()
    expect(document.querySelector('.hero')).toBeTruthy()
  })
})

// ─── hostile per-report tournaments must never freeze the pace split ─────────
describe('pace segments with hostile per-report MTT', () => {
  const stamp = i => 1712500000 + i * 86400
  const sessions = () => [
    { timestamp: stamp(1), brAfter: 12000, sessionResult: 2000, tournaments: 1000, totalTournaments: 1000 },
    { timestamp: stamp(2), brAfter: 15000, sessionResult: 3000, tournaments: 2000, totalTournaments: 3000 },
    { timestamp: stamp(3), brAfter: 16000, sessionResult: 1000, tournaments: 1500, totalTournaments: 4500 },
  ]
  const hostile = tournaments => ({ timestamp: stamp(4), brAfter: 16700, sessionResult: 700, tournaments })
  // A synchronous infinite loop cannot be interrupted by a test timeout; the vm
  // watchdog turns "hangs forever" into a failing assertion instead.
  const guarded = fn => vm.runInNewContext('run()', { run: fn }, { timeout: 3000 })
  const build = (history, binSize) => guarded(() => buildPaceSegments(history, () => true, 10000, binSize))
  const summary = segments => ({
    mtt: segments.reduce((sum, seg) => sum + seg.tournaments, 0),
    profit: Math.round(segments.reduce((sum, seg) => sum + seg.profit, 0)),
  })

  it('matches the plain split for ordinary reports', () => {
    const segments = build(sessions(), 2000)
    expect(segments.map(seg => seg.label)).toEqual(['2k', '4k', '4.5k'])
    expect(summary(segments)).toEqual({ mtt: 4500, profit: 6000 })
  })

  it.each([
    ['Infinity', Infinity],
    ['1e999 from the JSON text', JSON.parse('{"x":1e999}').x],
    ['1e9', 1e9],
    ['1e308', 1e308],
    ['just above the cap', 100001],
    ['NaN', NaN],
    ['a negative count', -50],
    ['a numeric string', '500'],
  ])('ignores a last report with %s MTT and keeps its money in the open bin', (_name, tournaments) => {
    const history = [...sessions(), hostile(tournaments)]
    for (const binSize of [1000, 2000, 5000, 10000]) {
      const segments = build(history, binSize)
      expect(segments.every(seg => Number.isFinite(seg.rate) && Number.isFinite(seg.endMtt))).toBe(true)
      // the same bins as without the report; its +700 joined the open bin
      expect(summary(segments)).toEqual({ mtt: 4500, profit: 6700 })
      expect(segments).toHaveLength(build(sessions(), binSize).length)
    }
  })

  it('still splits a large but plausible session across the bins', () => {
    const segments = build([{ timestamp: stamp(1), brAfter: 20000, sessionResult: 10000, tournaments: 100000 }], 2000)
    expect(segments).toHaveLength(50)
    expect(summary(segments)).toEqual({ mtt: 100000, profit: 10000 })
  })

  it.each([0, -1, NaN, Infinity, 0.0001, 'big'])('falls back to the default step for an unusable step (%s)', binSize => {
    expect(build(sessions(), binSize)).toEqual(build(sessions(), 2000))
  })

  it('shows finite numbers in the page when a report carries 1e999 MTT', async () => {
    // the guard above fails first (instead of hanging the run) if the split regresses
    expect(build([...sessions(), hostile(Infinity)], 2000)).toHaveLength(3)
    const history = [row(1), row(2), { ...row(3), tournaments: JSON.parse('{"x":1e999}').x, totalTournaments: undefined }]
    await mount(dataWith(history))
    const widget = await screen.findByTestId('pace-widget')
    expect(widget.textContent).not.toMatch(/Infinity|NaN|∞/)
    expect(widget.querySelector('.pace-rate-item .mps-value').textContent).toMatch(/^[+-]?[\d.]+\$\/МТТ$/)
    expect(widget.querySelectorAll('.pace-segment').length).toBeGreaterThan(0)
    expect(document.querySelector('.marathon-progress').textContent).not.toMatch(/Infinity|NaN|∞/)
  })
})

// ─── the English / Spanish projection unit ───────────────────────────────────
describe('pace projection unit', () => {
  // one session to a bankroll just under $10M: finish = ceil(remaining / rate)
  const near = bankroll => dataWith([{
    id: 'one', timestamp: 1712500000, date: '07.04', text: 'Day 5', brBefore: 10000, brAfter: bankroll,
    sessionResult: bankroll - 10000, tournaments: 1000, totalTournaments: 1000,
  }], { bankroll, totalTournaments: 1000 })
  const projection = () => document.querySelector('.pace-projection-item .tempo-val')

  it.each([
    ['en', 9999900, '~1', 'MTT'],
    ['en', 9985000, '~2', 'MTTs'],
    ['es', 9999900, '~1', 'MTT'],
    ['es', 9985000, '~2', 'MTT'],
    ['ru', 9999900, '~1', 'турнир'],
    ['ru', 9985000, '~2', 'турнира'],
  ])('%s: %s reads "%s %s"', async (lang, bankroll, count, unit) => {
    await mount(near(bankroll), { lang })
    await waitFor(() => expect(projection()).toBeTruthy())
    expect(projection().textContent.replace(/\s/g, '')).toBe(`${count}${unit}`)
    expect(projection().querySelector('.tempo-unit').textContent.trim()).toBe(unit)
  })

  it('keeps the plural for the large projection of the real marathon (en)', async () => {
    await mount(dataWith([row(1), row(2), row(3)]), { lang: 'en' })
    await waitFor(() => expect(projection()).toBeTruthy())
    expect(projection().querySelector('.tempo-unit').textContent.trim()).toBe(translate('en', 'pace_projection_unit'))
  })
})

// ─── an invalid language tag must not throw while rendering the month names ──
describe('monthly chart month names', () => {
  const ts = iso => Date.parse(iso) / 1000
  const points = () => normalizeMarathonDistance([
    { id: 'a', timestamp: ts('2026-03-20T12:00:00Z'), br: 8000, brPrev: 10000, totalTournaments: 500 },
    { id: 'b', timestamp: ts('2026-04-20T12:00:00Z'), br: 20000, brPrev: 8000, totalTournaments: 1700 },
  ])
  const renderChart = lang => render(
    <MonthlyMarathonChart allPoints={points()} period="all" setPeriod={() => {}} grouping="months"
      setGrouping={() => {}} lang={lang} t={createTranslator('ru')} light={false}/>,
  )
  const monthLabels = container => [...container.querySelectorAll('.mc-month-mark')].map(el => el.getAttribute('aria-label').split(':')[0])
  const detailsHead = container => container.querySelector('.mc-month-details-head b').textContent

  it.each(['not a tag', 'ru_RU', 'x', '', 'en-', 123, {}])('renders with the invalid tag %j and names months in the default language', lang => {
    const reference = renderChart('ru')
    const expected = { labels: monthLabels(reference.container), head: detailsHead(reference.container) }
    reference.unmount()
    const { container } = renderChart(lang)
    expect(monthLabels(container)).toEqual(expected.labels)
    expect(detailsHead(container)).toBe(expected.head)
    expect(expected.head).toMatch(/2026/)
  })

  it('still uses the requested language when the tag is valid', () => {
    const { container } = renderChart('en')
    expect(detailsHead(container)).toBe('April 2026')
  })
})

// ─── hero bankroll next to the profit computed from it ───────────────────────
describe('hero bankroll fallback', () => {
  it('shows a reported bankroll of exactly 0 beside the profit computed from it, not meta.bankroll', async () => {
    await mount(dataWith([row(1, { brBefore: 10000, brAfter: 0, sessionResult: -10000 })], { bankroll: 5000 }))
    await waitFor(() => expect(heroBr()).toBeTruthy())
    expect(digits(heroBr())).toBe(0)
    expect(digits(heroProfit())).toBe(10000)
    expect(heroProfit()).toMatch(/^-/)
  })

  it('still falls back to meta.bankroll when there is no usable report and no bankroll in the posts', async () => {
    await mount(dataWith([row(1, { brAfter: null })], { bankroll: 448853 }))
    await waitFor(() => expect(digits(heroBr())).toBe(448853))
  })
})
