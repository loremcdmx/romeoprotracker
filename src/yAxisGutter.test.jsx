import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'
import { labelLeftEdge } from './test-label-bounds.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Y tick labels are right-aligned in a left gutter. If the gutter is narrower
// than the widest label the text is cut off at the canvas edge (PR #91 fixed
// that for labels such as "$1.002M"). A bare `x > 0` check cannot see it, so
// these tests compare the estimated left edge of every label with the canvas.

const NOW = Date.UTC(2026, 9, 7, 12)
let mobileViewport = false

function makeData(balances, { startBankroll = 10000, perSession = 2000 } = {}) {
  const ages = [40, 35, 6, 1]
  const brHistory = balances.map((brAfter, index) => {
    const brBefore = index === 0 ? startBankroll : balances[index - 1]
    return {
      id: String(index + 1), timestamp: NOW / 1000 - ages[index] * 86400,
      date: `Session ${index + 1}`, text: `Session ${index + 1}`,
      brBefore, brAfter, sessionResult: brAfter - brBefore,
      tournaments: perSession, totalTournaments: (index + 1) * perSession,
      url: `https://example.com/session/${index + 1}`,
    }
  })
  return {
    posts: brHistory.map(row => ({ ...row, author: 'Romeopro', likes: 10,
      rating: 25000, avatar: null, images: [], videos: [] })),
    meta: {
      startBankroll, targetBankroll: 10000000, bankroll: balances.at(-1),
      totalTournaments: 4 * perSession, brHistory, day: 40, totalPosts: 4,
      lastUpdated: '2026-10-07T12:00:00Z',
    },
    leaderboards: null,
  }
}

async function mount(data) {
  fetchPublicData.mockResolvedValue(data)
  const view = render(<App />)
  await screen.findByTestId('pace-widget')
  return view
}

function expectInsideCanvas(labels) {
  expect(labels.length).toBeGreaterThan(0)
  labels.forEach(label => {
    expect(
      labelLeftEdge(label),
      `"${label.textContent}" at x=${label.getAttribute('x')} is clipped by the canvas edge`,
    ).toBeGreaterThanOrEqual(0)
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('rpt_lang', 'ru')
  mobileViewport = false
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
  ['desktop', false],
  ['phone', true],
])('Y axis label gutters on %s', (_, mobile) => {
  beforeEach(() => { mobileViewport = mobile })

  it.each([
    ['six-digit bankroll', 'period_all', [14000, 190000, 380000, 406000]],
    ['the $10M goal', 'period_all', [14000, 5000000, 9000000, 10000000]],
    // Week zoom at about $1M needs labels like "$1.004M", the widest ones.
    ['a narrow zoom near $1M', 'period_week', [900000, 950000, 1004000, 1010000]],
  ])('keeps every marathon tick label on the canvas: %s', async (_, period, balances) => {
    const { container } = await mount(makeData(balances))
    const chart = container.querySelector('.marathon-chart')
    if (period !== 'period_all') {
      fireEvent.click(within(chart).getByRole('button', { name: translate('ru', period), exact: true }))
    }
    const labels = [...chart.querySelectorAll('svg.mc-svg .mc-yaxis-label')]
    if (period === 'period_week') {
      // Guard the fixture: the zoom really produces the wide million labels.
      expect(labels.some(label => /^\$1\.\d{3}M$/.test(label.textContent))).toBe(true)
    }
    expectInsideCanvas(labels)
  })

  it('keeps every pace chart tick label on the canvas', async () => {
    const { container } = await mount(makeData([14000, 190000, 380000, 406000]))
    const labels = [...container.querySelectorAll('svg.pace-chart:not(.smtt-chart) .pace-y-label')]
    expectInsideCanvas(labels)
  })

  it('keeps every tournaments-per-session tick label on the canvas', async () => {
    // Under 1000 per session: a thousands separator is not a monospace glyph,
    // so the width estimate is only exact for plain digits.
    await mount(makeData([14000, 190000, 380000, 406000], { perSession: 554 }))
    const widget = await screen.findByTestId('session-mtt-widget')
    expectInsideCanvas([...widget.querySelectorAll('svg .pace-y-label')])
  })
})
