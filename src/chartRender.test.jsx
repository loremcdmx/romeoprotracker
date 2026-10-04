import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'
import { translate } from './i18n.js'
import { buildGlobalAuthorCounts } from './activityAuthors.js'
import { fmtInt } from './utils.js'

const chartRenders = vi.hoisted(() => ({}))
vi.mock('react', async importOriginal => {
  const react = await importOriginal()
  return {
    ...react,
    memo(component, compare) {
      return react.memo(function TrackedMemo(props) {
        chartRenders[component.name] = (chartRenders[component.name] || 0) + 1
        return component(props)
      }, compare)
    },
  }
})
vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))
vi.mock('./activityAuthors.js', async importOriginal => {
  const authors = await importOriginal()
  return { ...authors, buildGlobalAuthorCounts: vi.fn(authors.buildGlobalAuthorCounts) }
})

const sessionCharts = ['MarathonChart', 'SessionMarathonChart', 'PaceWidget', 'SessionMttChart']
const monthlyCharts = ['MarathonChart', 'MonthlyMarathonChart', 'PaceWidget', 'SessionMttChart']
const counts = (names = sessionCharts) => Object.fromEntries(names.map(name => [name, chartRenders[name] || 0]))

async function settleSessionCharts() {
  await screen.findByTestId('pace-widget')
  // Path measurement belongs to the session renderer. Check the wrapper as
  // well so missing memo instrumentation cannot silently pass the invariant.
  await waitFor(() => expect(chartRenders.SessionMarathonChart).toBeGreaterThan(1))
  for (const name of sessionCharts) expect(chartRenders[name]).toBeGreaterThan(0)
}

async function chooseMonths() {
  fireEvent.change(screen.getByRole('combobox', { name: translate('ru', 'chart_grouping_label') }),
    { target: { value: 'months' } })
  await screen.findByTestId('marathon-monthly-chart')
  for (const name of monthlyCharts) expect(chartRenders[name]).toBeGreaterThan(0)
}

function makeData() {
  const now = Math.floor(Date.now() / 1000)
  return {
    posts: [{ id: '1', author: 'Romeopro', text: 'Session', likes: 10, rating: 25000,
      timestamp: now - 86400, date: '03.10', images: ['https://example.com/session.jpg'],
      url: 'https://example.com/1' }],
    meta: { startBankroll: 10000, totalTournaments: 6000, lastUpdated: '2026-10-04T00:00:00Z',
      brHistory: [2000, 4000, 6000].map((total, i) => ({ id: String(i),
        timestamp: now - (3 - i) * 86400, date: `0${i + 1}.10`, tournaments: 2000,
        totalTournaments: total, brAfter: 14000 + i * 4000, sessionResult: 4000 })) },
  }
}

function makeMonthlyData() {
  const data = makeData()
  // Keep every reference month stable even when this test runs near the
  // beginning of a calendar month. The all-history view does not filter it.
  data.meta.brHistory = data.meta.brHistory.map((row, index) => ({
    ...row, timestamp: Date.UTC(2026, 5, index + 1, 12) / 1000,
  }))
  return data
}

function correctedData(data = makeData()) {
  data.meta.lastUpdated = '2026-10-04T00:01:00Z'
  data.meta.totalTournaments = 8000
  data.meta.brHistory[2] = { ...data.meta.brHistory[2],
    totalTournaments: 8000, brAfter: 24000, sessionResult: 6000 }
  return data
}

function searchAndOpenLightbox() {
  fireEvent.click(screen.getByTitle(translate('ru', 'filter_search_title')))
  fireEvent.change(screen.getByPlaceholderText(translate('ru', 'filter_search_placeholder')),
    { target: { value: 'Session' } })
  fireEvent.keyDown(document.querySelector('.pc-img'), { key: 'Enter' })
  expect(document.querySelector('.lightbox')).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.querySelector('.lightbox')).toBeNull()
}

describe('chart render invalidation', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.keys(chartRenders).forEach(name => delete chartRenders[name])
    fetchPublicData.mockReset()
    buildGlobalAuthorCounts.mockClear()
    fetchPublicData.mockResolvedValue(makeData())
  })

  it('keeps static chart renders stable during search and lightbox interactions', async () => {
    render(<App />)
    await settleSessionCharts()
    const before = counts()

    searchAndOpenLightbox()
    expect(counts()).toEqual(before)
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(1)
  })

  it('updates chart periods, theme and translated labels when their inputs change', async () => {
    render(<App />)
    await settleSessionCharts()
    let before = counts()

    fireEvent.click(within(screen.getByTestId('pace-widget')).getByText(translate('ru', 'period_week')))
    for (const name of sessionCharts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    expect(within(screen.getByTestId('pace-widget')).getByText(translate('ru', 'period_week')))
      .toHaveAttribute('aria-pressed', 'true')

    before = counts()
    fireEvent.click(screen.getByTitle(new RegExp(translate('ru', 'theme_light'), 'i')))
    expect(chartRenders.MarathonChart).toBeGreaterThan(before.MarathonChart)
    expect(chartRenders.SessionMarathonChart).toBeGreaterThan(before.SessionMarathonChart)
    expect(chartRenders.PaceWidget).toBeGreaterThan(before.PaceWidget)

    before = counts()
    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0])
    for (const name of sessionCharts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    expect(within(screen.getByTestId('pace-widget')).getByRole('heading',
      { name: translate('en', 'pace_title') })).toBeInTheDocument()
    expect(within(screen.getByTestId('session-mtt-widget')).getByRole('heading',
      { name: translate('en', 'smtt_title') })).toBeInTheDocument()
  })

  it('reuses the archive author index when the activity period changes', async () => {
    const { container } = render(<App />)
    await screen.findByTestId('pace-widget')
    const activity = [...container.querySelectorAll('.chart-wrap')].find(element =>
      element.querySelector('h2')?.textContent === translate('ru', 'chart_activity'))
    expect(activity).toBeTruthy()
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(1)
    for (const key of ['period_week', 'period_all_marathon', 'period_month']) {
      fireEvent.click(within(activity).getByText(translate('ru', key)))
    }
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(1)
  })

  it('updates charts after a data correction with the same post count', async () => {
    const { container } = render(<App />)
    await settleSessionCharts()
    const before = counts()
    fetchPublicData.mockResolvedValue(correctedData())
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => {
      for (const name of sessionCharts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    })
    expect(container.querySelector('.smtt-last-chip').textContent).toContain(fmtInt(4000))
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(2)
  })

  it('keeps the wrapper and monthly charts stable during search and lightbox interactions', async () => {
    fetchPublicData.mockResolvedValue(makeMonthlyData())
    render(<App />)
    await settleSessionCharts()
    await chooseMonths()
    const before = counts(monthlyCharts)
    const sessionRenders = chartRenders.SessionMarathonChart

    searchAndOpenLightbox()

    expect(counts(monthlyCharts)).toEqual(before)
    expect(chartRenders.SessionMarathonChart).toBe(sessionRenders)
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(1)
  })

  it('updates the monthly balance and volume after a correction with the same archive size', async () => {
    fetchPublicData.mockResolvedValue(makeMonthlyData())
    render(<App />)
    await settleSessionCharts()
    await chooseMonths()
    const before = counts(monthlyCharts)
    const sessionRenders = chartRenders.SessionMarathonChart
    const panel = screen.getByTestId('marathon-month-details')
    expect(panel).toHaveAttribute('data-br', '22000')
    expect(panel).toHaveAttribute('data-mtt', '6000')

    fetchPublicData.mockResolvedValue(correctedData(makeMonthlyData()))
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => {
      for (const name of monthlyCharts) expect(chartRenders[name]).toBeGreaterThan(before[name])
      expect(screen.getByTestId('marathon-month-details')).toHaveAttribute('data-br', '24000')
    })
    expect(screen.getByTestId('marathon-month-details')).toHaveAttribute('data-mtt', '8000')
    expect(screen.getByTestId('marathon-month-details')).toHaveAttribute('data-total-mtt', '8000')
    expect(screen.getByTestId('marathon-monthly-chart').querySelector('.mc-month-volume'))
      .toHaveAttribute('data-mtt', '8000')
    expect(chartRenders.SessionMarathonChart).toBe(sessionRenders)
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(2)
  })

  it('updates monthly colors and translations while the session renderer stays unmounted', async () => {
    fetchPublicData.mockResolvedValue(makeMonthlyData())
    render(<App />)
    await settleSessionCharts()
    await chooseMonths()
    let before = counts(monthlyCharts)
    const sessionRenders = chartRenders.SessionMarathonChart
    const firstSegment = () => screen.getByTestId('marathon-monthly-chart').querySelector('.mc-month-line-segment')
    const darkColor = firstSegment().getAttribute('stroke')

    fireEvent.click(screen.getByTitle(new RegExp(translate('ru', 'theme_light'), 'i')))
    expect(chartRenders.MarathonChart).toBeGreaterThan(before.MarathonChart)
    expect(chartRenders.MonthlyMarathonChart).toBeGreaterThan(before.MonthlyMarathonChart)
    expect(firstSegment().getAttribute('stroke')).not.toBe(darkColor)

    before = counts(monthlyCharts)
    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0])
    for (const name of monthlyCharts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    expect(within(screen.getByTestId('marathon-monthly-chart')).getByRole('combobox',
      { name: translate('en', 'chart_grouping_label') })).toHaveValue('months')
    expect(chartRenders.SessionMarathonChart).toBe(sessionRenders)
  })
})
