import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'
import { expandPosts } from './storage.js'

function jsonResponse(body) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  })
}

function spyStorageMethod(method) {
  // jsdom Storage is a proxy: spying on the instance does not replace its
  // methods. The fallback memory storage from test-setup has own methods.
  const prototype = Object.getPrototypeOf(localStorage)
  return vi.spyOn(typeof prototype[method] === 'function' ? prototype : localStorage, method)
}

describe('expandPosts', () => {
  it('expands compact payload into full posts', () => {
    const posts = expandPosts({
      avatars: ['https://example.com/avatar.png'],
      posts: [{
        i: '42',
        a: 'Romeopro',
        t: 1712500000,
        l: 17,
        x: 'hello',
        d: '07.04.26',
        v: 0,
        r: 5000,
        m: 123,
        g: '2020',
        p: ['https://example.com/image.jpg'],
        vd: ['https://example.com/video'],
        ba: 11000,
        bb: 10000,
        sr: 1000,
        rm: { after: { gg: 11000 } },
        te: 'hello',
        ts: 'hola',
      }],
    })

    expect(posts).toEqual([{
      id: '42',
      author: 'Romeopro',
      timestamp: 1712500000,
      likes: 17,
      text: 'hello',
      date: '07.04.26',
      url: 'https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=42',
      avatar: 'https://example.com/avatar.png',
      rating: 5000,
      msgCount: 123,
      regData: '2020',
      images: ['https://example.com/image.jpg'],
      videos: ['https://example.com/video'],
      brAfter: 11000,
      brBefore: 10000,
      sessionResult: 1000,
      rooms: { after: { gg: 11000 } },
      translations: { en: 'hello', es: 'hola' },
    }])
  })

  it('fills defaults for missing optional compact fields', () => {
    const posts = expandPosts({
      avatars: [],
      posts: [{ i: '7', a: 'Anon', t: 2 }],
    })

    expect(posts).toEqual([{
      id: '7',
      author: 'Anon',
      timestamp: 2,
      likes: 0,
      text: '',
      date: '',
      url: 'https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=7',
      avatar: null,
      rating: 0,
      msgCount: null,
      regData: null,
      images: [],
      videos: [],
      brAfter: null,
      brBefore: null,
      sessionResult: null,
      rooms: null,
      translations: null,
    }])
  })

  it('normalizes forum-relative avatar URLs', () => {
    const posts = expandPosts({
      avatars: [
        '/img/imguser.png',
        '/upload/Avatar/default/1/2/3/avatar.jpg',
        '//cdn.example.com/avatar.png',
      ],
      posts: [
        { i: '1', a: 'Default avatar', t: 1, v: 0 },
        { i: '2', a: 'Uploaded avatar', t: 2, v: 1 },
        { i: '3', a: 'Protocol relative avatar', t: 3, v: 2 },
      ],
    })

    expect(posts.map(post => post.avatar)).toEqual([
      'https://forum.gipsyteam.com/img/imguser.png',
      'https://www.gipsyteam.ru/upload/Avatar/default/1/2/3/avatar.jpg',
      'https://cdn.example.com/avatar.png',
    ])
  })
})

describe('fetchPublicData', () => {
  let fetchPublicData

  beforeEach(async () => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.resetModules()
    ;({ fetchPublicData } = await import('./storage.js'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('chooses the freshest source when same-origin and raw data disagree', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)

      if (href.includes('localhost') && href.includes('/data/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T01:00:00.000Z' })
      }

      if (href.includes('localhost') && href.includes('/data/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same origin', t: 1 }] })
      }

      if (href.includes('raw.githubusercontent.com') && href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }

      if (href.includes('raw.githubusercontent.com') && href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'raw', a: 'Raw GitHub', t: 2 }] })
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(result.posts[0].id).toBe('raw')
  })

  it('returns a working source instead of waiting forever for a stalled fallback', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)

      if (href.includes('localhost') && href.includes('/data/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }

      if (href.includes('localhost') && href.includes('/data/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same origin', t: 1 }] })
      }

      if (href.includes('raw.githubusercontent.com')) {
        return new Promise(() => {})
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(result.posts[0].id).toBe('same')
  })

  it('keeps a fresher cached payload when the network returns older data', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      posts: [{ id: 'cached', author: 'Cache' }],
      meta: { lastUpdated: '2026-04-19T02:30:00.000Z' },
      source: 'cache',
    }))

    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)

      if (href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T01:00:00.000Z' })
      }

      if (href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'old', a: 'Old network', t: 1 }] })
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:30:00.000Z')
    expect(result.posts).toEqual([{ id: 'cached', author: 'Cache' }])
  })

  it('returns a fresh cache immediately without touching the network', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      compact: { avatars: [], posts: [{ i: 'fresh', a: 'Fresh cache', t: 1 }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
      source: 'cache',
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('fresh')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('decodes a cache once and revalidates unchanged posts without rewriting it', async () => {
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const raw = JSON.stringify({
      ts: now,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1 }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
    })
    localStorage.setItem(CACHE_KEY, raw)
    const parseSpy = vi.spyOn(JSON, 'parse')
    const writeSpy = spyStorageMethod('setItem')
    const fetchSpy = vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      }
      throw new Error(`Unexpected heavy fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const first = await fetchPublicData()
    const second = await fetchPublicData()
    expect(fetchSpy).not.toHaveBeenCalled()
    now += CACHE_TTL + 1
    const revalidated = await fetchPublicData()
    const afterRevalidation = await fetchPublicData()

    for (const result of [second, revalidated, afterRevalidation]) {
      expect(result.posts).toBe(first.posts)
      expect(result.meta).toBe(first.meta)
      expect(result.stale).toBe(false)
    }
    expect(parseSpy.mock.calls.filter(([value]) => value === raw)).toHaveLength(1)
    expect(writeSpy).not.toHaveBeenCalled()
    expect(fetchSpy.mock.calls.every(([url]) => String(url).endsWith('/meta.json'))).toBe(true)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
  })

  it('keeps a memory cache when a multi-MB payload cannot fit in localStorage', async () => {
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    spyStorageMethod('setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const fetchSpy = vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) return jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      if (String(url).endsWith('/posts.min.json')) return jsonResponse({ posts: [{ i: 'large', a: 'Romeopro', t: 1 }] })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const first = await fetchPublicData()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    fetchSpy.mockClear()
    const warm = await fetchPublicData()
    expect(fetchSpy).not.toHaveBeenCalled()
    now += CACHE_TTL + 1
    const revalidated = await fetchPublicData()

    expect(warm.posts).toBe(first.posts)
    expect(revalidated.posts).toBe(first.posts)
    expect(revalidated.meta).toBe(first.meta)
    expect(revalidated.stale).toBe(false)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
    expect(fetchSpy.mock.calls.every(([url]) => String(url).endsWith('/meta.json'))).toBe(true)
  })

  it('keeps fresh memory data when an existing persisted cache cannot be updated', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - CACHE_TTL - 1,
      compact: { posts: [{ i: 'old', a: 'Cached' }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
    }))
    spyStorageMethod('setItem').mockImplementation(() => { throw new Error('quota') })
    const fetchSpy = vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T04:00:00.000Z' })
      : jsonResponse({ posts: [{ i: 'new', a: 'Romeopro' }] }))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await fetchPublicData()
    fetchSpy.mockClear()
    const warm = await fetchPublicData()

    expect(first.posts[0].id).toBe('new')
    expect(warm.posts).toBe(first.posts)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)).compact.posts[0].i).toBe('old')
  })

  it('reuses the memory snapshot when the browser blocks all storage access', async () => {
    spyStorageMethod('getItem').mockImplementation(() => { throw new Error('blocked') })
    spyStorageMethod('setItem').mockImplementation(() => { throw new Error('blocked') })
    const fetchSpy = vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      : jsonResponse({ posts: [{ i: 'memory', a: 'Romeopro' }] }))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await fetchPublicData()
    fetchSpy.mockClear()
    const warm = await fetchPublicData()

    expect(warm.posts).toBe(first.posts)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses the original history for freshness after the hook deduplicates returned meta', async () => {
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const meta = {
      lastUpdated: '2026-04-19T03:00:00.000Z',
      brHistory: [
        { id: 'a', timestamp: 1, brBefore: 10000, brAfter: 11000 },
        { id: 'b', timestamp: 2, brBefore: 10000, brAfter: 12000 },
      ],
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now, compact: { posts: [{ i: 'b', a: 'Romeopro' }] }, meta }))
    const first = await fetchPublicData()
    first.meta.brHistory = first.meta.brHistory.slice(1)
    now += CACHE_TTL + 1
    const fetchSpy = vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) return jsonResponse(meta)
      throw new Error(`Unexpected heavy fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const revalidated = await fetchPublicData()

    expect(revalidated.posts).toBe(first.posts)
    expect(revalidated.meta.brHistory).toHaveLength(1)
    expect(fetchSpy.mock.calls.every(([url]) => String(url).endsWith('/meta.json'))).toBe(true)
  })

  it('observes a cache replaced or cleared by another tab', async () => {
    const persist = (id) => localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      compact: { posts: [{ i: id, a: 'Cached' }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
    }))
    persist('first')
    const first = await fetchPublicData()
    persist('second')
    const second = await fetchPublicData()
    expect(second.posts[0].id).toBe('second')
    expect(second.posts).not.toBe(first.posts)

    localStorage.removeItem(CACHE_KEY)
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) return jsonResponse({ lastUpdated: '2026-04-19T04:00:00.000Z' })
      return jsonResponse({ posts: [{ i: 'network', a: 'Network' }] })
    }))
    const afterClear = await fetchPublicData()
    expect(afterClear.posts[0].id).toBe('network')
  })

  it('shares overlapping loads instead of downloading each source twice', async () => {
    const pending = []
    const fetchSpy = vi.fn((url) => new Promise((resolve) => { pending.push({ url, resolve }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const first = fetchPublicData()
    const second = fetchPublicData()
    expect(second).toBe(first)
    expect(new Set(fetchSpy.mock.calls.map(([url]) => String(url))).size).toBe(fetchSpy.mock.calls.length)
    for (const { url, resolve } of pending) {
      resolve({ ok: true, json: async () => String(url).endsWith('/meta.json')
        ? { lastUpdated: '2026-04-19T03:00:00.000Z' }
        : { posts: [{ i: 'shared', a: 'Romeopro' }] } })
    }
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a.posts[0].id).toBe('shared')
  })

  it('falls back to posts.json when the compact payload is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)

      if (href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }

      if (href.includes('/posts.min.json')) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      }

      if (href.includes('/posts.json')) {
        return jsonResponse([{ id: 'full', author: 'Fallback', avatar: '/img/imguser.png' }])
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.posts).toEqual([{
      id: 'full',
      author: 'Fallback',
      avatar: 'https://forum.gipsyteam.com/img/imguser.png',
    }])
  })

  it('returns stale cache when every configured source fails', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      posts: [{ id: 'stale', author: 'Stale cache' }],
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
      source: 'cache',
    }))

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const result = await fetchPublicData()

    expect(result.posts).toEqual([{ id: 'stale', author: 'Stale cache' }])
    expect(result.stale).toBe(true)
  })

  it('throws when every source fails and no cache is available', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchPublicData()).rejects.toThrow('offline')

    fetchSpy.mockImplementation((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      : jsonResponse({ posts: [{ i: 'retry', a: 'Romeopro' }] }))
    expect((await fetchPublicData()).posts[0].id).toBe('retry')
  })

  it('reuses cached posts and skips the heavy payload when meta is unchanged', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1 }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
      source: 'cache',
    }))

    const fetchSpy = vi.fn((url) => {
      const href = String(url)
      if (href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      }
      if (href.includes('/posts')) {
        throw new Error(`Should not fetch posts when meta is unchanged: ${href}`)
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('cached')
    expect(result.meta.lastUpdated).toBe('2026-04-19T03:00:00.000Z')
    const postsFetches = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/posts'))
    expect(postsFetches).toHaveLength(0)
  })

  it('downloads fresh posts when the bankroll history advances without a new lastUpdated timestamp', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1 }] },
      meta: {
        lastUpdated: '2026-04-19T03:00:00.000Z',
        bankroll: 12000,
        totalTournaments: 4000,
        totalPosts: 10,
        brHistory: [
          { id: 'old', timestamp: 1000, brAfter: 12000, totalTournaments: 4000 },
        ],
      },
      source: 'cache',
    }))

    const fetchSpy = vi.fn((url) => {
      const href = String(url)
      if (href.includes('/meta.json')) {
        return jsonResponse({
          lastUpdated: '2026-04-19T03:00:00.000Z',
          bankroll: 9000,
          totalTournaments: 4500,
          totalPosts: 10,
          brHistory: [
            { id: 'old', timestamp: 1000, brAfter: 12000, totalTournaments: 4000 },
            { id: 'new', timestamp: 2000, brBefore: 12000, brAfter: 9000, sessionResult: -3000, tournaments: 500, totalTournaments: 4500 },
          ],
        })
      }
      if (href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'fresh', a: 'Fresh network', t: 2 }] })
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('fresh')
    expect(result.meta.totalTournaments).toBe(4500)
    expect(result.meta.brHistory).toHaveLength(2)
    const postsFetches = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/posts.min.json'))
    expect(postsFetches.length).toBeGreaterThan(0)
  })

  it('treats a likes-only postsChangedAt bump as fresh data', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1, l: 1 }] },
      meta: { lastUpdated: '2026-08-19T03:00:00.000Z' },
      source: 'cache',
    }))

    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.includes('/meta.json')) {
        // lastUpdated unchanged — only the likes revision moved
        return jsonResponse({ lastUpdated: '2026-08-19T03:00:00.000Z', postsChangedAt: '2026-08-19T04:00:00.000Z' })
      }
      if (href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1, l: 99 }] })
      }
      if (href.includes('/leaderboards.json')) return jsonResponse(null)
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()
    expect(result.posts[0].likes).toBe(99)
  })

  it('downloads fresh posts when upstream meta advances', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1 }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
      source: 'cache',
    }))

    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T04:00:00.000Z' })
      }
      if (href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'fresh', a: 'Fresh network', t: 2 }] })
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('fresh')
    expect(result.meta.lastUpdated).toBe('2026-04-19T04:00:00.000Z')
  })
})
