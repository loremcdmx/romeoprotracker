import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Four accents were hard-coded as inline colours in App.jsx (#4caf50 / #ff5252 on the
// author rating link, #4caf50 and #ffb74d in the activity tooltip, #66bb6a / #ff5252 on the
// marathon tooltip pill). No stylesheet rule can re-tune an inline colour, so they measured
// 1.7-3.2:1 on the light theme's near-white panels. They now carry a class and the colour
// comes from app.css (guarded in cssCascade.test.js: dark values unchanged, AA in light).
// These tests pin the markup half of that contract on the real components.
const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)

function makeData() {
  const t = now()
  // likes: 5 because the feed hides posts under 3 likes by default
  const post = (id, author, extra = {}) => ({
    id, author, text: `post ${id}`, likes: 5, timestamp: t - 2 * DAY, date: '01.01.26', avatar: null,
    rating: 100, msgCount: 10, regData: '2020', images: [], url: `https://forum.gipsyteam.ru/${id}`, ...extra,
  })
  return {
    posts: [
      post('1', 'Romeopro', { brAfter: 10500, rating: 5000 }),
      // rating >= 15000 and likes > 0: listed in the activity tooltip with both rows
      post('2', 'GoodAuthor', { rating: 20000, likes: 7 }),
      post('3', 'NegativeAuthor', { rating: -40, timestamp: t - 3 * DAY }),
    ],
    meta: {
      startBankroll: 10000,
      totalTournaments: 3000,
      brHistory: [
        { id: 's0', timestamp: t - 6 * DAY, date: 'D0', brPrev: 10000, brAfter: 10600, sessionResult: 600, tournaments: 1000, totalTournaments: 1000, text: 'win' },
        { id: 's1', timestamp: t - 4 * DAY, date: 'D1', brPrev: 10600, brAfter: 10200, sessionResult: -400, tournaments: 1000, totalTournaments: 2000, text: 'loss' },
        { id: 's2', timestamp: t - 2 * DAY, date: 'D2', brPrev: 10200, brAfter: 10500, sessionResult: 300, tournaments: 1000, totalTournaments: 3000, text: 'win again' },
      ],
      lastUpdated: new Date().toISOString(),
    },
  }
}

describe('hard-coded accents moved off inline styles', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(makeData())
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('the author rating link takes pos/neg from a class, with no inline colour or fill', async () => {
    render(<App />)
    await screen.findByText(translate('ru', 'hs_br'))
    const links = [...document.querySelectorAll('.post-card .pc-author-meta a')]
    const pos = links.find((a) => a.classList.contains('pos'))
    const neg = links.find((a) => a.classList.contains('neg'))
    expect(pos, 'a link for a non-negative rating').toBeTruthy()
    expect(neg, 'a link for a negative rating').toBeTruthy()
    expect(neg.textContent).toContain('-40')
    for (const a of [pos, neg]) {
      expect(a.classList.contains('pc-rating')).toBe(true)
      expect(a.style.color).toBe('')
      // the icon follows the link colour, so one class re-tunes both
      expect(a.querySelector('svg').style.fill).toBe('currentcolor')
    }
  })

  it('the marathon tooltip pill carries the sign as a class, not an inline colour', async () => {
    render(<App />)
    await screen.findByTestId('mc-hover-capture')
    const seen = new Map()
    for (const marker of document.querySelectorAll('.marathon-chart g[data-start][data-end]')) {
      fireEvent.mouseEnter(marker)
      const pill = document.querySelector('.mc-tooltip .mc-pill')
      expect(pill).toBeTruthy()
      const negative = pill.textContent.trim().startsWith('-')
      expect(pill.classList.contains(negative ? 'neg' : 'pos'), pill.textContent).toBe(true)
      expect(pill.classList.contains(negative ? 'pos' : 'neg')).toBe(false)
      expect(pill.style.color).toBe('')
      expect(pill.style.borderColor).toBe('')
      seen.set(negative ? 'neg' : 'pos', true)
    }
    expect([...seen.keys()].sort()).toEqual(['neg', 'pos'])
  })

  it('the activity tooltip author rows use classes for the rating and the best-likes colours', async () => {
    render(<App />)
    await screen.findByTestId('mc-hover-capture')
    let tooltip = null
    for (const bar of document.querySelectorAll('.activity-bar')) {
      fireEvent.mouseEnter(bar)
      try {
        await waitFor(() => { expect(document.querySelector('.chart-tooltip .ac-rating')).toBeTruthy() }, { timeout: 400 })
        tooltip = document.querySelector('.chart-tooltip')
        break
      } catch { /* this day lists no qualifying author */ }
    }
    expect(tooltip, 'a day whose tooltip lists GoodAuthor').toBeTruthy()
    const rating = tooltip.querySelector('.ac-rating')
    const likes = tooltip.querySelector('.ac-likes')
    expect(likes?.textContent).toContain('+7')
    expect(rating.textContent).toContain('20')
    for (const el of [rating, likes]) expect(el.style.color).toBe('')
    expect(rating.querySelector('svg').style.fill).toBe('currentcolor')
  })
})
