import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'

// These tests run the loader with its production timeouts (the module switches
// them off in MODE=test) against fake timers, so stalls and slow downloads can
// be replayed in virtual time.

const MIN = 60 * 1000
const compact = (id, extra = {}) => ({ avatars: [], posts: [{ i: id, a: 'Romeopro', t: 1, ...extra }] })

async function loadStorage(mode = 'production') {
  vi.resetModules()
  vi.stubEnv('MODE', mode)
  return import('./storage.js')
}

function respond(body) {
  return { ok: true, status: 200, json: async () => body }
}

// fetch stub with a per-request latency. Honors AbortSignal like a real fetch.
function slowFetch(route) {
  const log = []
  const fetchSpy = vi.fn((url, init) => {
    const href = String(url)
    const entry = { href, aborted: false, done: false }
    log.push(entry)
    const { delay = 0, body, hang = false } = route(href)
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        entry.aborted = true
        reject(new DOMException('aborted', 'AbortError'))
      })
      if (hang) return
      setTimeout(() => {
        entry.done = true
        resolve(respond(body))
      }, delay)
    })
  })
  return { fetchSpy, log }
}

const isRaw = (href) => href.includes('raw.githubusercontent.com')
const isMeta = (href) => href.endsWith('/meta.json')

// Drives virtual time until the promise settles; returns how long it took.
async function settle(promise, limitMs = 120_000) {
  let outcome = null
  promise.then((value) => { outcome = { ok: true, value } }, (error) => { outcome = { ok: false, error } })
  const startedAt = Date.now()
  while (!outcome && Date.now() - startedAt < limitMs) {
    await vi.advanceTimersByTimeAsync(50)
  }
  return { outcome, elapsed: Date.now() - startedAt }
}

describe('storage robustness', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('cache stamped by a clock that was ahead', () => {
    async function setupFutureCache(skewMs) {
      const { fetchPublicData } = await loadStorage('test')
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: Date.now() + skewMs,
        compact: compact('old'),
        meta: { lastUpdated: '2026-10-01T00:00:00.000Z' },
        source: 'cache',
      }))
      const fetchSpy = vi.fn((url) => Promise.resolve(respond(isMeta(String(url))
        ? { lastUpdated: '2026-10-18T00:00:00.000Z' }
        : compact('new'))))
      vi.stubGlobal('fetch', fetchSpy)
      return { fetchPublicData, fetchSpy }
    }

    it.each([['10 minutes', 10 * MIN], ['2 days', 2 * 24 * 60 * MIN], ['a year', 365 * 24 * 60 * MIN]])(
      'treats a record %s in the future as stale and fetches newer data', async (_label, skew) => {
        const { fetchPublicData, fetchSpy } = await setupFutureCache(skew)

        const result = await fetchPublicData()

        expect(fetchSpy).toHaveBeenCalled()
        expect(result.posts[0].id).toBe('new')
      })

    it('still trusts a record that is only a few seconds ahead (small clock skew)', async () => {
      const { fetchPublicData, fetchSpy } = await setupFutureCache(2000)

      const result = await fetchPublicData()

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.posts[0].id).toBe('old')
    })

    it('treats a record with a missing or invalid ts as stale', async () => {
      const { fetchPublicData, fetchSpy } = await setupFutureCache(0)
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: 'yesterday',
        compact: compact('old'),
        meta: { lastUpdated: '2026-10-01T00:00:00.000Z' },
      }))

      const result = await fetchPublicData()

      expect(fetchSpy).toHaveBeenCalled()
      expect(result.posts[0].id).toBe('new')
    })
  })

  describe('cache entry of the wrong shape', () => {
    it.each(['123', 'true', '"text"', 'null', '[]', '[1,2]'])(
      'treats %s in the cache key as no cache and still loads from the network', async (raw) => {
        const { fetchPublicData } = await loadStorage('test')
        localStorage.setItem(CACHE_KEY, raw)
        const fetchSpy = vi.fn((url) => Promise.resolve(respond(isMeta(String(url))
          ? { lastUpdated: '2026-10-18T00:00:00.000Z' }
          : compact('net'))))
        vi.stubGlobal('fetch', fetchSpy)

        const result = await fetchPublicData()

        expect(fetchSpy).toHaveBeenCalled()
        expect(result.posts[0].id).toBe('net')
      })
  })

  describe('response body stalls', () => {
    it('gives up on a body that never finishes, and the next call starts a new attempt', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      // Headers arrive, the body never does (connection stalls mid-download).
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })))

      const first = fetchPublicData()
      const stalled = await settle(first)

      expect(stalled.outcome).not.toBeNull()
      expect(stalled.outcome.ok).toBe(false)
      expect(stalled.outcome.error.message).toMatch(/Timeout/)
      expect(stalled.elapsed).toBeLessThan(15_000)

      // Connectivity is back: a poll or Retry must not join the stuck promise.
      vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(respond(isMeta(String(url))
        ? { lastUpdated: '2026-10-18T00:00:00.000Z' }
        : compact('ok')))))
      const second = fetchPublicData()
      expect(second).not.toBe(first)
      const healthy = await settle(second)
      expect(healthy.outcome.ok).toBe(true)
      expect(healthy.outcome.value.posts[0].id).toBe('ok')
    })

    it('allows a long body once the headers are in', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      vi.stubGlobal('fetch', vi.fn((url) => {
        const href = String(url)
        const body = isMeta(href) ? { lastUpdated: '2026-10-18T00:00:00.000Z' } : compact('streamed')
        // Headers immediately; the posts body takes 20s to download.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise((resolve) => setTimeout(() => resolve(body), isMeta(href) ? 10 : 20_000)),
        })
      }))

      const { outcome, elapsed } = await settle(fetchPublicData())

      expect(outcome.ok).toBe(true)
      expect(outcome.value.posts[0].id).toBe('streamed')
      expect(elapsed).toBeGreaterThanOrEqual(20_000)
    })
  })

  describe('a slower but fresher source', () => {
    const v1 = { lastUpdated: '2026-10-18T10:00:00.000Z', postsChangedAt: '2026-10-18T10:00:00.000Z' }
    const v2 = { lastUpdated: '2026-10-18T10:00:00.000Z', postsChangedAt: '2026-10-18T16:40:00.000Z' }

    function twoSources({ rawPostsDelay, rawMeta = v2, rawPostsHang = false }) {
      return slowFetch((href) => {
        const raw = isRaw(href)
        if (isMeta(href)) return { delay: raw ? 300 : 100, body: raw ? rawMeta : v1 }
        if (raw) return { delay: rawPostsDelay, body: compact('v2-FRESH'), hang: rawPostsHang }
        return { delay: 100, body: compact('v1-STALE') }
      })
    }

    async function poll(fetchPublicData) {
      const { outcome, elapsed } = await settle(fetchPublicData())
      expect(outcome?.ok).toBe(true)
      return { result: outcome.value, elapsed }
    }

    it('wins over a stale first responder instead of being aborted after the settle window', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('v1-STALE'), meta: v1, source: 'cached' }))
      const { fetchSpy } = twoSources({ rawPostsDelay: 2500 })
      vi.stubGlobal('fetch', fetchSpy)

      const { result } = await poll(fetchPublicData)

      expect(result.posts[0].id).toBe('v2-FRESH')
      expect(result.meta.postsChangedAt).toBe(v2.postsChangedAt)
    })

    it('does the same on a cold load with no cache', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      vi.stubGlobal('fetch', twoSources({ rawPostsDelay: 3000 }).fetchSpy)

      const { result } = await poll(fetchPublicData)

      expect(result.posts[0].id).toBe('v2-FRESH')
    })

    it('does not wait for a slow source whose meta is not newer, and aborts it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      const { fetchSpy, log } = twoSources({ rawPostsDelay: 20_000, rawMeta: v1 })
      vi.stubGlobal('fetch', fetchSpy)

      const { result, elapsed } = await poll(fetchPublicData)

      expect(result.posts[0].id).toBe('v1-STALE')
      expect(elapsed).toBeLessThan(2000)
      expect(log.find((entry) => isRaw(entry.href) && entry.href.endsWith('/posts.min.json')).aborted).toBe(true)
    })

    it('stops waiting at the cap when the fresher source never delivers its posts', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      vi.stubGlobal('fetch', twoSources({ rawPostsHang: true }).fetchSpy)

      const { result, elapsed } = await poll(fetchPublicData)

      expect(result.posts[0].id).toBe('v1-STALE')
      expect(elapsed).toBeGreaterThanOrEqual(1400)
      expect(elapsed).toBeLessThanOrEqual(9000)
    })
  })

  describe('warm revalidation', () => {
    it('does not wait for a hanging source when the answering one reports no change', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      const meta = { lastUpdated: '2026-10-18T00:00:00.000Z' }
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta, source: 'x' }))
      const { fetchSpy, log } = slowFetch((href) => (isRaw(href) ? { hang: true } : { delay: 20, body: meta }))
      vi.stubGlobal('fetch', fetchSpy)

      const { outcome, elapsed } = await settle(fetchPublicData())

      expect(outcome.ok).toBe(true)
      expect(outcome.value.posts[0].id).toBe('cached')
      expect(elapsed).toBeLessThan(2500)
      expect(log.some((entry) => entry.href.endsWith('/posts.min.json'))).toBe(false)
    })

    it('goes for the new data as soon as one source reports it, even if another hangs', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const { fetchPublicData } = await loadStorage()
      const oldMeta = { lastUpdated: '2026-10-18T00:00:00.000Z' }
      const newMeta = { lastUpdated: '2026-10-18T05:00:00.000Z' }
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: oldMeta, source: 'x' }))
      vi.stubGlobal('fetch', slowFetch((href) => {
        if (!isRaw(href)) return { hang: true }
        return { delay: 50, body: isMeta(href) ? newMeta : compact('fresh') }
      }).fetchSpy)

      const { outcome } = await settle(fetchPublicData())

      expect(outcome.ok).toBe(true)
      expect(outcome.value.posts[0].id).toBe('fresh')
    })
  })

  describe('scraper heartbeat', () => {
    const content = {
      startBankroll: 10000,
      lastUpdated: '2026-10-18T10:00:00.000Z',
      postsChangedAt: '2026-10-18T10:00:00.000Z',
      brHistory: [],
    }

    it('carries a newer lastScrapeRun into the cached meta without downloading posts', async () => {
      const { fetchPublicData } = await loadStorage('test')
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: Date.now() - 5 * MIN,
        compact: compact('cached'),
        meta: { ...content, lastScrapeRun: '2026-10-18T10:00:00.000Z' },
        source: 'x',
      }))
      const fetchSpy = vi.fn((url) => {
        if (!isMeta(String(url))) throw new Error(`Unexpected heavy fetch: ${url}`)
        return Promise.resolve(respond({ ...content, lastScrapeRun: '2026-10-18T14:35:00.000Z' }))
      })
      vi.stubGlobal('fetch', fetchSpy)

      const first = await fetchPublicData()

      expect(first.meta.lastScrapeRun).toBe('2026-10-18T14:35:00.000Z')
      expect(first.posts[0].id).toBe('cached')
      expect(first.stale).toBe(false)
      expect(fetchSpy.mock.calls.every(([url]) => isMeta(String(url)))).toBe(true)

      // Within the TTL the same snapshot (and meta) keeps being served.
      const warm = await fetchPublicData()
      expect(warm.meta).toBe(first.meta)
      expect(warm.posts).toBe(first.posts)
    })

    describe('cold load, content tie with production timings', () => {
      // Same posts everywhere; only the heartbeat differs. Both sources answer
      // inside the settle window, so both are candidates and the heartbeat decides.
      const route = (sameDelay, rawDelay, beats) => (href) => {
        const raw = isRaw(href)
        const body = isMeta(href)
          ? { ...content, lastScrapeRun: raw ? beats.raw : beats.same }
          : compact(raw ? 'raw' : 'same')
        return { delay: raw ? rawDelay : sameDelay, body }
      }
      const load = async (sameDelay, rawDelay, beats) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        const { fetchPublicData } = await loadStorage()
        vi.stubGlobal('fetch', slowFetch(route(sameDelay, rawDelay, beats)).fetchSpy)
        const { outcome } = await settle(fetchPublicData())
        expect(outcome?.ok).toBe(true)
        return outcome.value
      }

      it('a stale same-origin snapshot that answers first does not hide the newer raw heartbeat', async () => {
        const result = await load(50, 600, { same: '2026-10-18T10:05:00.000Z', raw: '2026-10-18T14:35:00.000Z' })
        expect(result.meta.lastScrapeRun).toBe('2026-10-18T14:35:00.000Z')
        expect(result.posts[0].id).toBe('raw')
      })

      it('and the other way round: raw answers first with the older heartbeat', async () => {
        const result = await load(600, 50, { same: '2026-10-18T14:35:00.000Z', raw: '2026-10-18T10:05:00.000Z' })
        expect(result.meta.lastScrapeRun).toBe('2026-10-18T14:35:00.000Z')
        expect(result.posts[0].id).toBe('same')
      })
    })

    it('uses the newest heartbeat among the sources and never moves it backwards', async () => {
      let now = 1_800_000_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const { fetchPublicData } = await loadStorage('test')
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: now,
        compact: compact('cached'),
        meta: { ...content, lastScrapeRun: '2026-10-18T12:00:00.000Z' },
        source: 'x',
      }))
      const beats = { same: '2026-10-18T09:00:00.000Z', raw: '2026-10-18T13:00:00.000Z' }
      const fetchSpy = vi.fn((url) => {
        const href = String(url)
        if (!isMeta(href)) throw new Error(`Unexpected heavy fetch: ${href}`)
        return Promise.resolve(respond({ ...content, lastScrapeRun: isRaw(href) ? beats.raw : beats.same }))
      })
      vi.stubGlobal('fetch', fetchSpy)

      now += CACHE_TTL + 1
      const first = await fetchPublicData()
      expect(first.meta.lastScrapeRun).toBe('2026-10-18T13:00:00.000Z')

      beats.raw = '2026-10-18T11:00:00.000Z'
      now += CACHE_TTL + 1
      const second = await fetchPublicData()
      expect(second.meta.lastScrapeRun).toBe('2026-10-18T13:00:00.000Z')
      expect(second.meta).toBe(first.meta)
    })
  })
})
