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

const charts = ['MarathonChart', 'PaceWidget', 'SessionMttChart']
const counts = () => Object.fromEntries(charts.map(name => [name, chartRenders[name] || 0]))

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
    await screen.findByTestId('pace-widget')
    // Marathon runs one local render after measuring its path on mount.
    await waitFor(() => expect(chartRenders.MarathonChart).toBeGreaterThan(1))
    const before = counts()

    fireEvent.click(screen.getByTitle(translate('ru', 'filter_search_title')))
    fireEvent.change(screen.getByPlaceholderText(translate('ru', 'filter_search_placeholder')),
      { target: { value: 'Session' } })
    fireEvent.keyDown(document.querySelector('.pc-img'), { key: 'Enter' })
    expect(document.querySelector('.lightbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.lightbox')).toBeNull()
    expect(counts()).toEqual(before)
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(1)
  })

  it('updates chart periods, theme and translated labels when their inputs change', async () => {
    render(<App />)
    await screen.findByTestId('pace-widget')
    await waitFor(() => expect(chartRenders.MarathonChart).toBeGreaterThan(1))
    let before = counts()

    fireEvent.click(within(screen.getByTestId('pace-widget')).getByText(translate('ru', 'period_week')))
    for (const name of charts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    expect(within(screen.getByTestId('pace-widget')).getByText(translate('ru', 'period_week')))
      .toHaveAttribute('aria-pressed', 'true')

    before = counts()
    fireEvent.click(screen.getByTitle(new RegExp(translate('ru', 'theme_light'), 'i')))
    expect(chartRenders.MarathonChart).toBeGreaterThan(before.MarathonChart)
    expect(chartRenders.PaceWidget).toBeGreaterThan(before.PaceWidget)

    before = counts()
    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0])
    for (const name of charts) expect(chartRenders[name]).toBeGreaterThan(before[name])
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
    await screen.findByTestId('pace-widget')
    await waitFor(() => expect(chartRenders.MarathonChart).toBeGreaterThan(1))
    const before = counts()
    const corrected = makeData()
    corrected.meta.lastUpdated = '2026-10-04T00:01:00Z'
    corrected.meta.totalTournaments = 8000
    corrected.meta.brHistory[2] = { ...corrected.meta.brHistory[2],
      totalTournaments: 8000, brAfter: 24000, sessionResult: 6000 }
    fetchPublicData.mockResolvedValue(corrected)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => {
      for (const name of charts) expect(chartRenders[name]).toBeGreaterThan(before[name])
    })
    expect(container.querySelector('.smtt-last-chip').textContent).toContain(fmtInt(4000))
    expect(buildGlobalAuthorCounts).toHaveBeenCalledTimes(2)
  })
})
