import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

const NOW = Date.UTC(2026, 9, 7, 12)
let mobileViewport = false

function makeData({ balances = [14000, 190000, 380000, 406000], startBankroll = 10000 } = {}) {
  // The two oldest reports fall outside both zoomed windows. Both recent
  // reports remain visible, so week/month exercise the actual zoomed domain.
  const ages = [40, 35, 6, 1]
  const brHistory = balances.map((brAfter, index) => {
    const brBefore = index === 0 ? startBankroll : balances[index - 1]
    return {
      id: String(index + 1), timestamp: NOW / 1000 - ages[index] * 86400,
      date: `Session ${index + 1}`, text: `Session ${index + 1}`,
      brBefore, brAfter, sessionResult: brAfter - brBefore,
      tournaments: 2000, totalTournaments: (index + 1) * 2000,
      url: `https://example.com/session/${index + 1}`,
    }
  })
  return {
    posts: brHistory.map(row => ({ ...row, author: 'Romeopro', likes: 10,
      rating: 25000, avatar: null, images: [], videos: [] })),
    meta: {
      startBankroll, targetBankroll: 10000000, bankroll: balances.at(-1),
      totalTournaments: 8000, brHistory, day: 40, totalPosts: 4,
      lastUpdated: '2026-10-07T12:00:00Z',
    },
    leaderboards: null,
  }
}

async function mount(data) {
  fetchPublicData.mockResolvedValue(data)
  const view = render(<App />)
  await screen.findByTestId('pace-widget')
  const chart = view.container.querySelector('.marathon-chart')
  expect(chart.querySelector('.mc-line-main')).toBeInTheDocument()
  return chart
}

function tickValue(label) {
  const match = label.textContent.match(/^\$([\d.]+)([kM])?$/)
  expect(match).not.toBeNull()
  return Number(match[1]) * ({ k: 1000, M: 1000000 }[match[2]] || 1)
}

function assertReadableAxis(chart) {
  const svg = chart.querySelector('svg.mc-svg')
  const plot = svg.querySelector('.mc-plot-bg')
  const top = Number(plot.getAttribute('y'))
  const bottom = top + Number(plot.getAttribute('height'))
  const labels = [...svg.querySelectorAll('.mc-yaxis-label')]
  const grid = [...svg.querySelectorAll('.mc-y-tick .mc-grid')]
  expect(labels.length).toBeGreaterThan(0)
  expect(labels.length).toBeLessThanOrEqual(8)
  expect(grid).toHaveLength(labels.length)

  const values = labels.map(tickValue)
  const positions = grid.map(line => Number(line.getAttribute('y1')))
  labels.forEach(label => {
    expect(Number.isFinite(Number(label.getAttribute('x')))).toBe(true)
    expect(Number.isFinite(Number(label.getAttribute('y')))).toBe(true)
    expect(Number(label.getAttribute('x'))).toBeGreaterThan(0)
  })
  positions.forEach((position, index) => {
    expect(Number.isFinite(position)).toBe(true)
    expect(position).toBeGreaterThanOrEqual(top)
    expect(position).toBeLessThanOrEqual(bottom)
    expect(Number.isFinite(values[index])).toBe(true)
    if (index > 0) {
      expect(values[index]).toBeGreaterThan(values[index - 1])
      expect(positions[index - 1] - position).toBeGreaterThanOrEqual(mobileViewport ? 30 : 20)
    }
  })
  return { labels, values, top, height: bottom - top }
}

function pathPoints(chart) {
  const path = chart.querySelector('.mc-line-main').getAttribute('d')
  expect(path).not.toMatch(/NaN|Infinity/)
  return [...path.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
    .map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('rpt_lang', 'ru')
  mobileViewport = false
  // useIsMobile caches each MediaQueryList. Its matches getter must read the
  // current test's viewport even when the cached query came from an earlier one.
  window.matchMedia = query => ({
    get matches() { return mobileViewport && /max-width/.test(query) },
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  })
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  fetchPublicData.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each([
  ['desktop', false, 700],
  ['phone', true, 360],
])('session marathon Y axis on %s', (_, mobile, canvasWidth) => {
  beforeEach(() => { mobileViewport = mobile })

  it.each([
    ['current bankroll', 406000],
    ['marathon goal', 10000000],
  ])('keeps readable ticks at the %s', async (_, bankroll) => {
    const chart = await mount(makeData({ balances: [14000, bankroll / 2, bankroll * 0.9, bankroll] }))
    const { labels, values } = assertReadableAxis(chart)
    const [, , width] = chart.querySelector('svg.mc-svg').getAttribute('viewBox').split(/\s+/).map(Number)
    expect(width).toBe(canvasWidth)
    expect(values.at(-1)).toBeGreaterThan(bankroll * 0.7)
    expect(values.at(-1)).toBeLessThan(bankroll * 1.05)
    // Compact million labels must fit the same left gutter as the existing
    // $100k labels; $10000k would extend beyond the phone canvas.
    if (bankroll >= 1000000) {
      expect(labels.some(label => label.textContent.includes('M'))).toBe(true)
      expect(labels.every(label => label.textContent.length <= 6)).toBe(true)
    }
  })

  it.each([399999, 400000, 400001])('keeps the $400k range transition readable at %s', async range => {
    // startBR=1 anchors minV at zero; the final report's 5% headroom makes
    // the displayed domain exactly the requested range. This is the boundary
    // where the old finite step list suddenly fell back to $2000.
    const chart = await mount(makeData({ startBankroll: 1,
      balances: [10000, 50000, 100000, range / 1.05] }))
    const { values, top, height } = assertReadableAxis(chart)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBeLessThan(range)
    const points = pathPoints(chart)
    expect(points).toHaveLength(4)
    // The correction changes only ticks, retaining the 5% line headroom.
    expect(Math.abs(points.at(-1).y - (top + height / 21))).toBeLessThanOrEqual(0.06)
  })

  it.each([
    ['period_week', 'small change', [15000, 20000, 21400, 21800], 22000, 1 / 3],
    ['period_month', 'small change', [15000, 20000, 21400, 21800], 22000, 1 / 3],
    ['period_week', 'flat balance', [15000, 20000, 22000, 22000], 22000, 2 / 7],
    ['period_month', 'flat balance', [15000, 20000, 22000, 22000], 22000, 2 / 7],
  ])('preserves the zoomed %s axis for a %s', async (period, _, balances, expectedTick, finalHeightFraction) => {
    const chart = await mount(makeData({ balances }))
    fireEvent.click(within(chart).getByRole('button', { name: translate('ru', period), exact: true }))
    const { values, top, height } = assertReadableAxis(chart)
    // Independent numerical reference for the existing narrow-domain scale:
    // these fixtures keep the single $22k tick and exclude the old reports.
    expect(values).toEqual([expectedTick])
    const points = pathPoints(chart)
    expect(points).toHaveLength(2)
    expect(Math.abs(points.at(-1).y - (top + height * finalHeightFraction))).toBeLessThanOrEqual(0.06)
    if (balances.at(-1) === balances.at(-2)) expect(points[0].y).toBe(points[1].y)
  })
})
