import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'
import { fmtInt } from './utils.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const GROUPING_LABEL = 'Детализация графика марафона'
const NOW = Date.UTC(2026, 5, 3, 12)

// Fixed numerical reference, independent of the chart's grouping helpers.
// Warsaw changes month at UTC 22:00 in these summer dates: both boundary
// updates below belong to the following month, despite their UTC date.
function makeMonthlyData({ lateJune = false } = {}) {
  const sessions = [
    ['apr-first', '2026-04-10T12:00:00Z', 4000, 2000],
    ['apr-last', '2026-04-30T20:30:00Z', 2000, 1000],
    ['may-first', '2026-04-30T22:30:00Z', -4000, 500],
    ['may-last', '2026-05-31T20:30:00Z', -2000, 1500],
    ['jun-first', '2026-05-31T22:30:00Z', 6000, 1000],
    ['jun-last', lateJune ? '2026-06-28T12:00:00Z' : '2026-06-03T10:00:00Z', 3000, 2000],
  ]
  let bankroll = 10000, total = 0
  const brHistory = sessions.map(([id, stamp, profit, tournaments]) => {
    const brBefore = bankroll
    bankroll += profit
    total += tournaments
    return {
      id, timestamp: Date.parse(stamp) / 1000, date: stamp.slice(0, 10),
      brBefore, brAfter: bankroll, sessionResult: profit, tournaments,
      totalTournaments: total, text: `Session ${id}`,
      url: `https://example.com/${id}`,
    }
  })
  return {
    posts: brHistory.map(row => ({ ...row, author: 'Romeopro', likes: 10,
      rating: 25000, avatar: null, images: [], videos: [] })),
    meta: { startBankroll: 10000, bankroll: 19000, totalTournaments: 8000,
      brHistory, lastUpdated: '2026-06-03T10:00:00Z', totalPosts: 6 },
  }
}

function groupingControl() {
  return screen.getByRole('combobox', { name: GROUPING_LABEL })
}

async function mount() {
  const view = render(<App />)
  await screen.findByTestId('pace-widget')
  return view
}

async function chooseMonths() {
  fireEvent.change(groupingControl(), { target: { value: 'months' } })
  return screen.findByTestId('marathon-monthly-chart')
}

function assertDetails(key, { br, profit, mtt, totalMtt }) {
  const panel = screen.getByTestId('marathon-month-details')
  expect(panel).toHaveAttribute('data-month-key', key)
  expect(Number(panel.dataset.br)).toBe(br)
  expect(Number(panel.dataset.profit)).toBe(profit)
  expect(Number(panel.dataset.mtt)).toBe(mtt)
  expect(Number(panel.dataset.totalMtt)).toBe(totalMtt)
  return panel
}

describe('marathon chart grouping and distance', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('rpt_lang', 'ru')
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(makeMonthlyData())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to the session chart and displays cumulative tournament distance', async () => {
    await mount()
    expect(groupingControl()).toHaveValue('sessions')
    expect([...groupingControl().options].map(option => option.value)).toEqual(['sessions', 'months'])
    expect(screen.queryByTestId('marathon-monthly-chart')).toBeNull()
    expect(document.querySelector('.mc-line-main')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="mc-hover-capture"]')).toBeInTheDocument()
    const distanceAxis = document.querySelector('.mc-distance-axis')
    expect(distanceAxis).toBeInTheDocument()
    expect(distanceAxis.textContent).toContain(fmtInt(8000))
    expect(screen.getByTestId('marathon-distance').textContent).toContain(fmtInt(8000))
  })

  it('uses Warsaw months, exact monthly balances and volumes that sum to the cumulative total', async () => {
    await mount()
    const chart = await chooseMonths()
    const buttons = [...chart.querySelectorAll('[role="button"][data-month-key]')]
    expect(buttons.map(button => button.dataset.monthKey)).toEqual(['2026-04', '2026-05', '2026-06'])
    const volumes = [...chart.querySelectorAll('.mc-month-volume')]
    expect(volumes.map(bar => Number(bar.dataset.mtt))).toEqual([3000, 2000, 3000])
    expect(volumes.reduce((total, bar) => total + Number(bar.dataset.mtt), 0)).toBe(8000)

    const segments = [...chart.querySelectorAll('.mc-month-line-segment')]
    expect(segments.map(segment => [Number(segment.dataset.startBr), Number(segment.dataset.endBr)]))
      .toEqual([[10000, 16000], [16000, 10000], [10000, 19000]])
    expect(Number(segments[0].getAttribute('y1'))).toBeGreaterThan(Number(segments[0].getAttribute('y2')))
    expect(Number(segments[1].getAttribute('y2'))).toBeGreaterThan(Number(segments[1].getAttribute('y1')))
    expect(Number(segments[2].getAttribute('y1'))).toBeGreaterThan(Number(segments[2].getAttribute('y2')))
    for (let i = 1; i < segments.length; i++) {
      expect(Number(segments[i].getAttribute('x1'))).toBeCloseTo(Number(segments[i - 1].getAttribute('x2')), 4)
      expect(Number(segments[i].getAttribute('y1'))).toBeCloseTo(Number(segments[i - 1].getAttribute('y2')), 4)
    }
    assertDetails('2026-06', { br: 19000, profit: 9000, mtt: 3000, totalMtt: 8000 })
  })

  it('lets the reader select each month, including the negative May result', async () => {
    await mount()
    const chart = await chooseMonths()
    const may = within(chart).getByRole('button', { name: /май|мая/i })
    expect(may).toHaveAttribute('data-month-key', '2026-05')
    fireEvent.click(may)
    assertDetails('2026-05', { br: 10000, profit: -6000, mtt: 2000, totalMtt: 5000 })
    fireEvent.click(chart.querySelector('[role="button"][data-month-key="2026-04"]'))
    assertDetails('2026-04', { br: 16000, profit: 6000, mtt: 3000, totalMtt: 3000 })
  })

  it.each(['period_week', 'period_month'])('keeps one partial bucket for %s without falling back to all history', async periodKey => {
    // Both windows contain only the final June update. The opening bankroll
    // is therefore 16k, and this bucket has 2k MTT / +3k, rather than June's
    // full 3k MTT / +9k or the marathon's 8k MTT.
    Date.now.mockReturnValue(Date.UTC(2026, 6, 1, 12))
    fetchPublicData.mockResolvedValue(makeMonthlyData({ lateJune: true }))
    await mount()
    const chart = await chooseMonths()
    const wrapper = chart.closest('.marathon-chart')
    fireEvent.click(within(wrapper).getByRole('button', { name: translate('ru', periodKey), exact: true }))
    const buttons = [...chart.querySelectorAll('[role="button"][data-month-key]')]
    expect(buttons.map(button => button.dataset.monthKey)).toEqual(['2026-06'])
    expect([...chart.querySelectorAll('.mc-month-volume')].map(bar => Number(bar.dataset.mtt))).toEqual([2000])
    const segment = chart.querySelector('.mc-month-line-segment')
    expect(Number(segment.dataset.startBr)).toBe(16000)
    expect(Number(segment.dataset.endBr)).toBe(19000)
    assertDetails('2026-06', { br: 19000, profit: 3000, mtt: 2000, totalMtt: 8000 })

    fireEvent.change(groupingControl(), { target: { value: 'sessions' } })
    // The legacy session plot may use all six updates to keep a line visible;
    // the period distance must still report only the one selected update.
    expect(document.querySelectorAll('.marathon-chart .mc-line-segment')).toHaveLength(5)
    expect(screen.getByTestId('marathon-period-distance').textContent).toContain(fmtInt(2000))
    expect(screen.getByTestId('marathon-total-distance').textContent).toContain(fmtInt(8000))
  })

  it('persists the grouping across unmount and remount', async () => {
    const view = await mount()
    await chooseMonths()
    await waitFor(() => expect(localStorage.getItem('rpt_marathon_grouping')).toBe('months'))
    view.unmount()
    await mount()
    expect(groupingControl()).toHaveValue('months')
    expect(screen.getByTestId('marathon-monthly-chart')).toBeInTheDocument()
  })

  it('preserves focus on the grouping control when replacing either chart view', async () => {
    await mount()
    groupingControl().focus()
    expect(groupingControl()).toHaveFocus()
    await chooseMonths()
    expect(groupingControl()).toHaveValue('months')
    expect(groupingControl()).toHaveFocus()
    fireEvent.change(groupingControl(), { target: { value: 'sessions' } })
    expect(groupingControl()).toHaveValue('sessions')
    expect(groupingControl()).toHaveFocus()
    expect(document.querySelector('.mc-line-main')).toBeInTheDocument()
  })

  it('restores the original session path and popup without changing the pace step', async () => {
    await mount()
    const path = document.querySelector('.mc-line-main').getAttribute('d')
    const pace = screen.getByTestId('pace-widget')
    const paceSelector = within(pace).getByRole('combobox', { name: translate('ru', 'pace_chart_step_label') })
    expect([...paceSelector.options].map(option => option.value)).toEqual(['1000', '2000', '5000', '10000'])
    fireEvent.change(paceSelector, { target: { value: '5000' } })
    await chooseMonths()
    expect(paceSelector).toHaveValue('5000')
    fireEvent.change(groupingControl(), { target: { value: 'sessions' } })
    expect(document.querySelector('.mc-line-main').getAttribute('d')).toBe(path)
    expect(document.querySelector('[data-testid="mc-hover-capture"]')).toBeInTheDocument()
    expect(paceSelector).toHaveValue('5000')
    expect(localStorage.getItem('rpt_pace_bin_size')).toBe('5000')
    const lastMarker = document.querySelector('.marathon-chart [data-start="5"][data-end="5"]')
    expect(lastMarker).toBeTruthy()
    fireEvent.mouseEnter(lastMarker)
    expect(document.querySelector('.mc-tooltip')).toBeInTheDocument()
    expect(document.querySelector('.mc-tooltip').textContent).toContain(fmtInt(8000))
  })

  it('falls back to sessions for an unsupported saved grouping', async () => {
    localStorage.setItem('rpt_marathon_grouping', 'unsupported')
    await mount()
    expect(groupingControl()).toHaveValue('sessions')
    expect(document.querySelector('.mc-line-main')).toBeInTheDocument()
    expect(screen.queryByTestId('marathon-monthly-chart')).toBeNull()
    expect(localStorage.getItem('rpt_marathon_grouping')).toBe('sessions')
  })
})
