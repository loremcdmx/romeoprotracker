import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'
import { translate } from './i18n.js'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// The animated bankroll in the hero tile and the mobile strip used to carry a
// hard-coded #66bb6a inline colour, which no stylesheet rule can re-tune for the
// light theme (1.9:1 on the cream hero card). It must come from the theme token.
const data = {
  posts: [{
    id: '1', author: 'Romeopro', text: 'Day #5 marathon. After session: 11000', likes: 42,
    timestamp: 1712500000, date: '07.04.26', avatar: null, rating: 5000, msgCount: 100, regData: '2020',
    brAfter: 11000, images: [], url: 'https://forum.gipsyteam.ru/test1',
  }],
  meta: {
    startBankroll: 10000,
    totalTournaments: 3565,
    brHistory: [{ brAfter: 11000, date: '07.04', timestamp: 1712500000, sessionResult: 1000, text: 'Day #5' }],
    lastUpdated: '2026-04-19T02:00:00.000Z',
  },
}

describe('bankroll value colour', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    fetchPublicData.mockResolvedValue(data)
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
  })

  it('uses the --green-hi token (not a hex) for an up bankroll in the hero tile and the mobile strip', async () => {
    render(<App />)
    await screen.findByText(translate('ru', 'hs_br'))
    const spans = [
      document.querySelector('.hstat-value.br-anim span'),
      document.querySelector('.mobile-stat-value span'),
    ]
    for (const span of spans) {
      expect(span).toBeTruthy()
      expect(span.getAttribute('style')).toMatch(/(^|;\s*)color:\s*var\(--green-hi\)/)
    }
  })
})
