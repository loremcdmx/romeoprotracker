import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// 2026-10-25 11:00 in Warsaw (CET, the clocks went back at 01:00 UTC).
const NOW = Date.UTC(2026, 9, 25, 10, 0)

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function makeData(timestampMs) {
  const iso = new Date(timestampMs).toISOString()
  const brHistory = [{
    id: '1', timestamp: timestampMs / 1000, date: 'Session 1', text: 'Session 1',
    brBefore: 10000, brAfter: 14000, sessionResult: 4000, tournaments: 2000,
    totalTournaments: 2000, url: 'https://example.com/session/1',
  }]
  return {
    posts: [{ ...brHistory[0], author: 'Romeopro', likes: 10, rating: 25000,
      avatar: null, images: [], videos: [] }],
    meta: {
      startBankroll: 10000, targetBankroll: 10000000, bankroll: 14000,
      totalTournaments: 2000, brHistory, day: 1, totalPosts: 1,
      lastUpdated: iso, lastScrapeRun: iso,
    },
    leaderboards: null,
  }
}

function clockOf(text) {
  const match = String(text).match(/(\d{1,2}):(\d{2})/)
  expect(match, `no HH:MM in "${text}"`).not.toBeNull()
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

// The footer prints "today at <time>" only when the timestamp falls on the
// current Europe/Warsaw calendar day; everything else gets a date. Each case
// gives the UTC instant, its Warsaw time and whether it is "today" in Warsaw.
const CASES = [
  ['00:05 Warsaw today, but the previous day in UTC', '2026-10-24T22:05:00Z', 0, 5, true],
  ['ten minutes ago', '2026-10-25T09:50:00Z', 10, 50, true],
  ['23:55 yesterday in Warsaw, the same UTC day as now', '2026-10-24T21:55:00Z', 23, 55, false],
  ['the same day number in the previous month', '2026-09-25T09:50:00Z', 11, 50, false],
  ['the same day and month a year ago', '2025-10-25T09:50:00Z', 11, 50, false],
]

describe.each(['ru', 'en'])('footer freshness lines (%s)', lang => {
  const t = key => translate(lang, key)

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('rpt_lang', lang)
    fetchPublicData.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(CASES)('%s', async (_, iso, hour, minute, isToday) => {
    fetchPublicData.mockResolvedValue(makeData(Date.parse(iso)))
    const { container } = render(<App />)
    await screen.findByText(new RegExp(`^${escapeRe(t('footer_scraper_ran'))}:`))

    const lines = [
      container.querySelector('.footer-fresh'),
      screen.getByText(new RegExp(`^${escapeRe(t('footer_freshest_post'))}:`)),
    ]
    for (const line of lines) {
      expect(clockOf(line.textContent)).toEqual({ hour, minute })
      expect(clockOf(line.getAttribute('title'))).toEqual({ hour, minute })
      if (isToday) expect(line.textContent).toContain(t('footer_today_at'))
      else expect(line.textContent).not.toContain(t('footer_today_at'))
    }
  })
})
