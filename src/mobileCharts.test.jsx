import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// `useIsMobile` builds its media query lazily on first render, so installing a
// mobile-reporting matchMedia here is enough to render the phone layout.
beforeAll(() => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
})

function makeMobileData() {
  const now = Math.floor(Date.now() / 1000)
  let br = 10000
  const brHistory = [2000, 4000, 6000, 8000, 10000, 12000].map((total, i) => {
    const brPrev = br
    br += 4000
    return {
      id: String(i),
      brBefore: brPrev,
      brAfter: br,
      sessionResult: br - brPrev,
      date: `D${i + 1}`,
      timestamp: now - (6 - i) * 86400,
      tournaments: 2000,
      totalTournaments: total,
      text: `Session ${i + 1}`,
    }
  })
  return {
    posts: [{
      id: '1', author: 'Romeopro', text: 'session', likes: 3,
      timestamp: now - 86400, date: '01.01.26', avatar: null, rating: 5000,
      msgCount: 10, regData: '2020', brAfter: br, images: [], url: 'https://example.com/1',
    }],
    meta: {
      startBankroll: 10000, targetBankroll: 10000000, bankroll: br, day: 7,
      totalTournaments: 12000, brHistory, lastUpdated: '2026-07-01T00:00:00.000Z',
    },
    leaderboards: null,
  }
}

// The charts are authored in SVG user units and scaled to the column width.
// A canvas far wider than the phone column (the old 520 / 920) shrank every
// axis label with it, so the mobile canvases must stay near the real width.
const MAX_MOBILE_CANVAS = 400

describe('mobile chart geometry', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(makeMobileData())
  })

  it('authors the marathon chart near the phone column width', async () => {
    const { container } = render(<App />)
    await screen.findByTestId('pace-widget')

    const svg = container.querySelector('.marathon-chart svg')
    expect(svg).not.toBeNull()
    const [, , width] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
    expect(width).toBeLessThanOrEqual(MAX_MOBILE_CANVAS)
  })

  it('authors the pace chart near the phone column width', async () => {
    const { container } = render(<App />)
    await screen.findByTestId('pace-widget')

    const svg = container.querySelector('.pace-chart')
    expect(svg).not.toBeNull()
    const [, , width] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
    expect(width).toBeLessThanOrEqual(MAX_MOBILE_CANVAS)
  })

  it('leaves room for the pace Y tick labels inside the canvas', async () => {
    const { container } = render(<App />)
    await screen.findByTestId('pace-widget')

    const svg = container.querySelector('.pace-chart')
    const label = svg.querySelector('.pace-y-label')
    expect(label).not.toBeNull()
    // Y ticks are right-aligned at gridLeft - 13; keep that anchor on-canvas.
    expect(Number(label.getAttribute('x'))).toBeGreaterThan(0)
  })
})
