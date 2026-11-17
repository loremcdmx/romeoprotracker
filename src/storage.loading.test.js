import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_KEY } from './cacheConfig.js'

// Data-loading contract (review PERF-1 / PERF-2): the first render is never
// held for a slower source; a source that is only lightly ahead (likes,
// ratings, heartbeat) is not downloaded; a structurally newer one is delivered
// later through `onFresher`. Production timeouts, virtual time.

const MIN = 60 * 1000
const compact = (id) => ({ avatars: [], posts: [{ i: id, a: 'Romeopro', t: 1 }] })

const BASE = {
  lastUpdated: '2026-11-16T10:00:00.000Z',
  postsChangedAt: '2026-11-16T10:00:00.000Z',
  lastScrapeRun: '2026-11-16T10:00:00.000Z',
  totalPosts: 10,
  totalTournaments: 100,
  bankroll: 5000,
  brHistory: [],
}
// Only likes moved, plus the heartbeat.
const LIKES = { ...BASE, postsChangedAt: '2026-11-16T10:20:00.000Z', lastScrapeRun: '2026-11-16T10:20:00.000Z' }
// One more post.
const STRUCT = { ...BASE, lastUpdated: '2026-11-16T10:20:00.000Z', postsChangedAt: '2026-11-16T10:20:00.000Z', lastScrapeRun: '2026-11-16T10:20:00.000Z', totalPosts: 11 }

async function loadStorage() {
  vi.resetModules()
  vi.stubEnv('MODE', 'production')
  return import('./storage.js')
}

// fetch stub with per-request latency; honors AbortSignal; `fail` answers 500.
function slowFetch(route) {
  const log = []
  const fetchSpy = vi.fn((url, init) => {
    const href = String(url)
    const entry = { href, aborted: false, done: false }
    log.push(entry)
    const { delay = 0, body, hang = false, fail = false, bodyDelay = 0 } = route(href)
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        entry.aborted = true
        entry.abortedAt = Date.now()
        reject(new DOMException('aborted', 'AbortError'))
      })
      if (hang) return
      setTimeout(() => {
        entry.done = true
        if (fail) resolve({ ok: false, status: 500, statusText: 'boom', json: async () => ({}) })
        else resolve({ ok: true, status: 200, json: () => new Promise((res, rej) => { const id = setTimeout(() => res(body), bodyDelay); init?.signal?.addEventListener('abort', () => { clearTimeout(id); rej(new DOMException('aborted', 'AbortError')) }) }) })
      }, delay)
    })
  })
  return { fetchSpy, log }
}

const isRaw = (href) => href.includes('raw.githubusercontent.com')
const isMeta = (href) => href.endsWith('/meta.json')
const isHeavy = (href) => href.endsWith('/posts.min.json')
const heavy = (log, which) => log.filter((entry) => isHeavy(entry.href) && (which === 'raw' ? isRaw(entry.href) : which === 'same' ? !isRaw(entry.href) : true))

async function settle(promise, limitMs = 120_000) {
  let outcome = null
  promise.then((value) => { outcome = { ok: true, value } }, (error) => { outcome = { ok: false, error } })
  const startedAt = Date.now()
  while (!outcome && Date.now() - startedAt < limitMs) {
    await vi.advanceTimersByTimeAsync(50)
  }
  return { outcome, elapsed: Date.now() - startedAt }
}

describe('data loading: cold load', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const sources = ({ sameMeta = BASE, rawMeta, rawBody = {}, sameDelay = 100, rawMetaDelay = 300 }) => slowFetch((href) => {
    const raw = isRaw(href)
    if (isMeta(href)) return { delay: raw ? rawMetaDelay : 60, body: raw ? rawMeta : sameMeta }
    if (raw) return { delay: 20_000, body: compact('raw-NEW'), ...rawBody }
    return { delay: sameDelay, body: compact('same') }
  })

  it('a slow raw copy that is ahead only by likes does not hold the first render and is aborted', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = sources({ rawMeta: LIKES })
    vi.stubGlobal('fetch', fetchSpy)
    const onFresher = vi.fn()

    const { outcome, elapsed } = await settle(fetchPublicData({ onFresher }))

    expect(outcome.ok).toBe(true)
    expect(outcome.value.posts[0].id).toBe('same')
    // same-origin finished at 100 ms: about that, not 1.4 s settle, not 8 s
    expect(elapsed).toBeLessThan(700)
    expect(heavy(log, 'raw')[0].aborted).toBe(true)
    // the newer heartbeat of the aborted source still reaches the footer
    expect(outcome.value.meta.lastScrapeRun).toBe(LIKES.lastScrapeRun)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onFresher).not.toHaveBeenCalled()
  })

  it('a slow raw copy that is structurally ahead: resolves early, delivers the raw payload once', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = sources({ rawMeta: STRUCT, rawBody: { delay: 5000 } })
    vi.stubGlobal('fetch', fetchSpy)
    const onFresher = vi.fn()

    const { outcome, elapsed } = await settle(fetchPublicData({ onFresher }))

    expect(outcome.value.posts[0].id).toBe('same')
    expect(elapsed).toBeLessThan(2000)
    expect(heavy(log, 'raw')[0].aborted).toBe(false)
    expect(onFresher).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(6000)

    expect(onFresher).toHaveBeenCalledTimes(1)
    const late = onFresher.mock.calls[0][0]
    expect(late.posts[0].id).toBe('raw-NEW')
    expect(late.meta.totalPosts).toBe(11)
    // the late payload went through the cache: the next read returns it
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY))
    expect(cached.meta.totalPosts).toBe(11)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onFresher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['hangs', { hang: true }],
    ['answers 500', { delay: 400, fail: true }],
  ])('a structurally newer raw copy whose body %s: no delivery, no unhandled rejection', async (_name, rawBody) => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { fetchPublicData } = await loadStorage()
      vi.stubGlobal('fetch', sources({ rawMeta: STRUCT, rawBody }).fetchSpy)
      const onFresher = vi.fn()

      const { outcome } = await settle(fetchPublicData({ onFresher }))
      expect(outcome.value.posts[0].id).toBe('same')

      await vi.advanceTimersByTimeAsync(90_000)
      expect(onFresher).not.toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
      // a later load still works
      await vi.advanceTimersByTimeAsync(5 * MIN)
      const again = await settle(fetchPublicData({ onFresher }))
      expect(again.outcome.ok).toBe(true)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('if the same-origin copy fails, the raw copy that was lightly ahead is fetched after all', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy } = slowFetch((href) => {
      const raw = isRaw(href)
      if (isMeta(href)) return { delay: raw ? 300 : 60, body: raw ? LIKES : BASE }
      if (raw) return { delay: 800, body: compact('raw-LIKES') }
      return { delay: 500, fail: true }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome } = await settle(fetchPublicData())

    expect(outcome.ok).toBe(true)
    expect(outcome.value.posts[0].id).toBe('raw-LIKES')
  })
})

describe('data loading: poll with a cache', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function poll({ sameMeta, rawMeta }) {
    const { fetchPublicData } = await loadStorage()
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: BASE, source: 'x' }))
    const { fetchSpy, log } = slowFetch((href) => {
      const raw = isRaw(href)
      if (isMeta(href)) return { delay: 50, body: raw ? rawMeta : sameMeta }
      return { delay: 200, body: compact(raw ? 'raw-body' : 'same-body') }
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { outcome } = await settle(fetchPublicData())
    expect(outcome?.ok).toBe(true)
    return { result: outcome.value, log }
  }

  it('a likes-only advance seen on raw alone downloads no heavy file and adopts the heartbeat', async () => {
    const { result, log } = await poll({ sameMeta: BASE, rawMeta: LIKES })

    expect(heavy(log)).toHaveLength(0)
    expect(result.posts[0].id).toBe('cached')
    expect(result.meta.lastScrapeRun).toBe(LIKES.lastScrapeRun)
  })

  it('a structural advance on raw alone costs exactly one heavy request, to raw', async () => {
    const { result, log } = await poll({ sameMeta: BASE, rawMeta: STRUCT })

    expect(heavy(log)).toHaveLength(1)
    expect(heavy(log, 'raw')).toHaveLength(1)
    expect(result.posts[0].id).toBe('raw-body')
  })

  it('a structural advance both sources carry goes to same-origin only, even if raw has newer likes', async () => {
    const rawLikes = { ...STRUCT, postsChangedAt: '2026-11-16T10:40:00.000Z', lastScrapeRun: '2026-11-16T10:40:00.000Z' }
    const { result, log } = await poll({ sameMeta: STRUCT, rawMeta: rawLikes })

    expect(heavy(log)).toHaveLength(1)
    expect(heavy(log, 'same')).toHaveLength(1)
    expect(result.posts[0].id).toBe('same-body')
    expect(result.meta.lastScrapeRun).toBe(rawLikes.lastScrapeRun)
  })

  it('identical structural advance on both: same-origin wins the tie', async () => {
    const { log, result } = await poll({ sameMeta: STRUCT, rawMeta: STRUCT })

    expect(heavy(log, 'raw')).toHaveLength(0)
    expect(result.posts[0].id).toBe('same-body')
  })

  it('a likes-only advance on same-origin (new deploy) downloads from same-origin only', async () => {
    const { result, log } = await poll({ sameMeta: LIKES, rawMeta: LIKES })

    expect(heavy(log)).toHaveLength(1)
    expect(heavy(log, 'same')).toHaveLength(1)
    expect(result.posts[0].id).toBe('same-body')
  })

  it('a no-op poll still costs only the two meta requests', async () => {
    const { log } = await poll({ sameMeta: BASE, rawMeta: BASE })

    expect(log.every((entry) => isMeta(entry.href))).toBe(true)
    expect(log).toHaveLength(2)
  })

  it('if the chosen base fails, the next advanced base is tried', async () => {
    const { fetchPublicData } = await loadStorage()
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: BASE, source: 'x' }))
    vi.stubGlobal('fetch', slowFetch((href) => {
      if (isMeta(href)) return { delay: 20, body: STRUCT }
      return isRaw(href) ? { delay: 50, body: compact('raw-body') } : { delay: 50, fail: true }
    }).fetchSpy)

    const { outcome } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('raw-body')
  })
})

describe('data loading: cutting the raw copy (review rework B1-B4, L1)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const route = ({ sameMeta = BASE, rawMeta, same = { delay: 100 }, raw = { delay: 20_000 }, rawMetaSpec = { delay: 300 }, sameMetaSpec = { delay: 60 } }) => slowFetch((href) => {
    const isR = isRaw(href)
    if (isMeta(href)) return { ...(isR ? rawMetaSpec : sameMetaSpec), body: isR ? rawMeta : sameMeta }
    return isR ? { body: compact('raw'), ...raw } : { body: compact('same'), ...same }
  })

  it('B1: a same-origin copy whose posts never answer costs the visitor only the hedge, not the 6.5 s timeout', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = route({ rawMeta: LIKES, same: { hang: true }, raw: { delay: 400 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome, elapsed } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('raw')
    // cut at ~300 ms, hedge 2000 ms, raw download 400 ms
    expect(elapsed).toBeGreaterThanOrEqual(2000)
    expect(elapsed).toBeLessThan(3500)
    expect(heavy(log, 'raw')).toHaveLength(2)
  })

  it('B1: once same-origin headers are in it is trusted: no second raw request while its body is slow', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = route({ rawMeta: LIKES, same: { delay: 100, bodyDelay: 9000 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome, elapsed } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('same')
    expect(elapsed).toBeGreaterThanOrEqual(9000)
    expect(heavy(log, 'raw')).toHaveLength(1)
    expect(heavy(log, 'raw')[0].aborted).toBe(true)
  })

  it('B2: a raw body that completes before its meta is still usable; the load never rejects', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy } = route({ rawMeta: LIKES, rawMetaSpec: { delay: 400 }, raw: { delay: 50 }, same: { delay: 4000 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome } = await settle(fetchPublicData())

    expect(outcome.ok).toBe(true)
    expect(outcome.value.posts[0].id).toBe('raw')
  })

  it('B3: when the planned base fails, a base whose meta missed the probe window is tried', async () => {
    const { fetchPublicData } = await loadStorage()
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: BASE, source: 'x' }))
    const { fetchSpy } = route({ sameMeta: STRUCT, rawMeta: STRUCT, sameMetaSpec: { delay: 50 }, rawMetaSpec: { delay: 3000 }, same: { fail: true }, raw: { delay: 100 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('raw')
  })

  it('B3: a late meta that shows newer structure than what was downloaded is followed up', async () => {
    const { fetchPublicData } = await loadStorage()
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: BASE, source: 'x' }))
    const NEWER = { ...STRUCT, totalPosts: 12, lastUpdated: '2026-11-16T10:40:00.000Z', postsChangedAt: '2026-11-16T10:40:00.000Z' }
    const { fetchSpy } = route({ sameMeta: STRUCT, rawMeta: NEWER, sameMetaSpec: { delay: 50 }, rawMetaSpec: { delay: 2000 }, same: { delay: 3000 }, raw: { delay: 100 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('raw')
    expect(outcome.value.meta.totalPosts).toBe(12)
  })

  it('B4: a source whose meta failed does not keep downloading its posts', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = slowFetch((href) => {
      if (isRaw(href)) return isMeta(href) ? { delay: 100, fail: true } : { delay: 20_000, body: compact('raw') }
      return { delay: 100, body: isMeta(href) ? BASE : compact('same') }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome } = await settle(fetchPublicData())
    await vi.advanceTimersByTimeAsync(1000)

    expect(outcome.value.posts[0].id).toBe('same')
    expect(heavy(log, 'raw')[0].aborted).toBe(true)
    expect(log.every((entry) => entry.done || entry.aborted)).toBe(true)
  })

  it('L1: a raw copy that merely ties the same-origin one is cut at its meta, not at the end', async () => {
    const { fetchPublicData } = await loadStorage()
    const { fetchSpy, log } = route({ rawMeta: BASE, same: { delay: 1500 } })
    vi.stubGlobal('fetch', fetchSpy)
    const startedAt = Date.now()

    const { outcome, elapsed } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('same')
    expect(heavy(log, 'raw')[0].aborted).toBe(true)
    expect(heavy(log, 'raw')[0].done).toBe(false)
    // cut when its meta arrived (300 ms), long before the same-origin copy finished (1500 ms)
    expect(heavy(log, 'raw')[0].abortedAt - startedAt).toBeLessThan(600)
    expect(elapsed).toBeLessThan(1700)
  })

  it('L1: a raw copy ahead by the heartbeat only is cut; the first render does not wait; its heartbeat is adopted', async () => {
    const { fetchPublicData } = await loadStorage()
    const HB = { ...BASE, lastScrapeRun: '2026-11-16T10:30:00.000Z' }
    const { fetchSpy, log } = route({ rawMeta: HB, same: { delay: 200 } })
    vi.stubGlobal('fetch', fetchSpy)

    const { outcome, elapsed } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('same')
    expect(outcome.value.meta.lastScrapeRun).toBe(HB.lastScrapeRun)
    expect(elapsed).toBeLessThan(700)
    expect(heavy(log, 'raw')[0].aborted).toBe(true)
  })

  it('L1: a raw copy that is behind is cut as soon as its meta is known', async () => {
    const { fetchPublicData } = await loadStorage()
    const OLD = { ...BASE, totalPosts: 9, lastUpdated: '2026-11-16T09:00:00.000Z', postsChangedAt: '2026-11-16T09:00:00.000Z', lastScrapeRun: '2026-11-16T09:00:00.000Z' }
    const { fetchSpy, log } = route({ rawMeta: OLD, same: { delay: 1500 } })
    vi.stubGlobal('fetch', fetchSpy)
    const startedAt = Date.now()

    const { outcome, elapsed } = await settle(fetchPublicData())

    expect(outcome.value.posts[0].id).toBe('same')
    expect(elapsed).toBeLessThan(1700)
    expect(heavy(log, 'raw')[0].abortedAt - startedAt).toBeLessThan(600)
  })
})
