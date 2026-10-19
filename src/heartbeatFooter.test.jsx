import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { CACHE_KEY } from './cacheConfig.js'
import App from './App.jsx'
import { usePostsData } from './hooks/usePostsData.js'

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))

// Real storage.js and hook; only fetch is stubbed. The scraper commits a
// heartbeat (meta.lastScrapeRun) every ~30 minutes even when nothing else on
// the site changed, and the footer shows that time.
const MIN = 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

function contentMeta(lastChange) {
  return {
    startBankroll: 10000,
    bankroll: 15000,
    totalTournaments: 200,
    totalPosts: 1,
    day: 2,
    brHistory: [],
    lastUpdated: lastChange,
    postsChangedAt: lastChange,
  }
}

const compact = (timestamp) => ({
  avatars: [],
  posts: [{ i: '1', a: 'Romeopro', t: timestamp, l: 5, x: 'Day 2', d: '18.10.26', r: 25000, ba: 15000 }],
})

function respond(body) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body })
}

describe('footer follows scraper heartbeat-only commits', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('rpt_lang', 'en')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a returning visitor sees the new heartbeat, not the cached one', async () => {
    const lastChange = iso(Date.now() - 200 * MIN)
    const timestamp = Math.floor(Date.now() / 1000) - 200 * 60
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * MIN,
      compact: compact(timestamp),
      meta: { ...contentMeta(lastChange), lastScrapeRun: lastChange },
      source: 'cache',
    }))
    const requests = []
    vi.stubGlobal('fetch', vi.fn((url) => {
      requests.push(String(url))
      return respond(String(url).endsWith('/meta.json')
        ? { ...contentMeta(lastChange), lastScrapeRun: iso(Date.now() - 5 * MIN) }
        : compact(timestamp))
    }))

    const { container } = render(<App />)

    await waitFor(() => expect(container.querySelector('.footer-fresh')).toBeTruthy())
    expect(container.querySelector('.footer-fresh').className).toContain('ok')
    expect(requests.every((url) => url.endsWith('/meta.json'))).toBe(true)
  })

  it('an open tab keeps following the heartbeat through quiet polls', async () => {
    const T0 = Date.parse('2026-10-18T21:30:00Z')
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], now: T0 })
    const heartbeat = () => iso(Math.floor(Date.now() / (30 * MIN)) * 30 * MIN)
    const frozen = iso(T0 - 60 * MIN)
    const fetchSpy = vi.fn((url) => respond(String(url).endsWith('/meta.json')
      ? { ...contentMeta(frozen), lastScrapeRun: heartbeat() }
      : compact(T0 / 1000 - 3600)))
    vi.stubGlobal('fetch', fetchSpy)

    function Probe() {
      const { meta } = usePostsData()
      return <output data-testid="heartbeat">{meta?.lastScrapeRun || ''}</output>
    }
    render(<Probe />)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(screen.getByTestId('heartbeat')).toHaveTextContent(iso(T0))
    const postsDownloads = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/posts.min.json')).length
    const afterFirstLoad = postsDownloads()

    // Three hours of 2-minute polls; only the heartbeat moves upstream.
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * MIN) })

    expect(screen.getByTestId('heartbeat')).toHaveTextContent(heartbeat())
    expect(heartbeat()).not.toBe(iso(T0))
    // None of those polls downloaded the posts again.
    expect(postsDownloads()).toBe(afterFirstLoad)
  })
})
