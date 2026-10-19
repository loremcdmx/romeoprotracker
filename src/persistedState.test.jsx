import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { fetchPublicData } from './storage.js'

vi.mock('./storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

function post(id, author, likes, timestamp) {
  return {
    id,
    author,
    text: `post ${id}`,
    likes,
    timestamp,
    date: '18.10.26',
    avatar: null,
    rating: 5000,
    msgCount: 10,
    regData: '2020',
    brAfter: author === 'Romeopro' ? 11000 : null,
    images: [],
    url: `https://forum.gipsyteam.ru/${id}`,
  }
}

function makePayload() {
  return {
    posts: [post('1', 'Romeopro', 42, 1712500000), post('2', 'TestUser', 10, 1712400000)],
    meta: {
      startBankroll: 10000,
      totalTournaments: 100,
      lastUpdated: '2026-10-18T10:00:00.000Z',
      brHistory: [
        { id: 'b1', brAfter: 11000, date: '17.10', timestamp: 1712500000, sessionResult: 1000, text: 'Day 1' },
      ],
    },
  }
}

// Two App roots in one document stand in for two open tabs of the site. Their
// ids collide, so cards are looked up with attribute selectors.
const card = (container, id) => container.querySelector(`[id="post-${id}"]`)
const starButton = (container, id) => card(container, id).querySelector('button.pc-action[aria-pressed]')

describe('persisted preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchPublicData.mockReset()
    fetchPublicData.mockImplementation(async () => makePayload())
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('two tabs', () => {
    it('a tab that changed nothing does not overwrite favourites saved by another tab', async () => {
      const tabA = render(<App />)
      const tabB = render(<App />)
      await waitFor(() => expect(card(tabA.container, 2)).toBeTruthy())
      await waitFor(() => expect(card(tabB.container, 2)).toBeTruthy())

      fireEvent.click(starButton(tabA.container, 2))
      await waitFor(() => expect(localStorage.getItem('rpt_fav_authors')).toBe('["TestUser"]'))

      // Tab B only re-renders (opens Settings); it never touched the favourites.
      const settings = [...tabB.container.querySelectorAll('button, a')].find((b) => /Настройки/.test(b.textContent))
      await act(async () => { fireEvent.click(settings) })

      expect(localStorage.getItem('rpt_fav_authors')).toBe('["TestUser"]')
      expect(localStorage.getItem('rpt_minlikes')).toBeNull()
    })

    it('shows another tab\'s favourite after the storage event and builds on it', async () => {
      const tabA = render(<App />)
      const tabB = render(<App />)
      await waitFor(() => expect(card(tabB.container, 2)).toBeTruthy())
      expect(starButton(tabB.container, 2)).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(starButton(tabA.container, 2))
      await waitFor(() => expect(localStorage.getItem('rpt_fav_authors')).toBe('["TestUser"]'))
      // Browsers deliver this to every other tab; here both roots hear it.
      act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'rpt_fav_authors' })) })
      await waitFor(() => expect(starButton(tabB.container, 2)).toHaveAttribute('aria-pressed', 'true'))

      // Starring another author in tab B keeps the first one.
      fireEvent.click(starButton(tabB.container, 1))
      await waitFor(() => expect(JSON.parse(localStorage.getItem('rpt_fav_authors')).sort()).toEqual(['Romeopro', 'TestUser']))
    })
  })

  describe('blocked storage', () => {
    it('renders the app when reading window.localStorage throws', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError')
        },
      })
      try {
        const { container } = render(<App />)
        await waitFor(() => expect(card(container, 2)).toBeTruthy())
        // Preferences still work in memory.
        fireEvent.click(starButton(container, 2))
        await waitFor(() => expect(starButton(container, 2)).toHaveAttribute('aria-pressed', 'true'))
      } finally {
        if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
      }
    })
  })

  describe('corrupted stored values', () => {
    it.each(['ru_RU', 'undefined', 'xx', 'constructor', ''])('falls back to ru for rpt_lang=%j in the monthly chart', async (bad) => {
      localStorage.setItem('rpt_lang', bad)
      localStorage.setItem('rpt_marathon_grouping', 'months')

      render(<App />)

      expect(await screen.findByTestId('marathon-monthly-chart')).toBeInTheDocument()
      expect(document.documentElement.lang).toBe('ru')
    })

    it('keeps a supported rpt_lang', async () => {
      localStorage.setItem('rpt_lang', 'en')

      render(<App />)

      await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    })

    it.each(['null', '5', '"x"', '[1]', '{broken'])('renders with rpt_readpos=%s', async (bad) => {
      localStorage.setItem('rpt_readpos', bad)

      const { container } = render(<App />)

      await waitFor(() => expect(card(container, 2)).toBeTruthy())
    })

    it('replaces unknown theme, sort and chart period values with the defaults', async () => {
      localStorage.setItem('rpt_theme', 'sepia')
      localStorage.setItem('rpt_sortby_v2', 'bogus')
      localStorage.setItem('rpt_chart_period', 'decade')

      const { container } = render(<App />)

      await waitFor(() => expect(card(container, 2)).toBeTruthy())
      expect(document.documentElement.classList.contains('light')).toBe(false)
      expect(container.querySelector('#feed-sort').value).toBe('date_desc')
      // The marathon chart and the pace widget each show a period switch.
      const pressed = [...container.querySelectorAll('.mc-period')].filter((b) => b.getAttribute('aria-pressed') === 'true')
      expect(pressed.length).toBeGreaterThan(0)
      pressed.forEach((button) => expect(button.textContent).toMatch(/Всё|Все|All/i))
    })
  })
})
