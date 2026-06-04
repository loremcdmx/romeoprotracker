import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expandPosts, fetchPublicData } from './storage.js'

const CACHE_KEY = 'rpt_cache_v7'

function jsonResponse(body) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  })
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
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
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

  it('keeps leaderboard freshness independent from post freshness', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)

      if (href.includes('localhost') && href.includes('/data/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }

      if (href.includes('localhost') && href.includes('/data/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same origin', t: 1 }] })
      }

      if (href.includes('localhost') && href.includes('/data/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T09:00:00.000Z', leaderboards: [{ tier: 'Low' }] })
      }

      if (href.includes('raw.githubusercontent.com') && href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T01:00:00.000Z' })
      }

      if (href.includes('raw.githubusercontent.com') && href.includes('/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'raw', a: 'Raw GitHub', t: 2 }] })
      }

      if (href.includes('raw.githubusercontent.com') && href.includes('/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T10:00:00.000Z', leaderboards: [{ tier: 'High' }] })
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(result.posts[0].id).toBe('same')
    expect(result.leaderboards.leaderboards[0].tier).toBe('High')
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

      if (href.includes('localhost') && href.includes('/data/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T09:00:00.000Z', leaderboards: [{ tier: 'Low' }] })
      }

      if (href.includes('raw.githubusercontent.com')) {
        return new Promise(() => {})
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(result.posts[0].id).toBe('same')
    expect(result.leaderboards.leaderboards[0].tier).toBe('Low')
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
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await expect(fetchPublicData()).rejects.toThrow('offline')
  })

  it('reuses cached posts and skips the heavy payload when meta is unchanged', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      compact: { avatars: [], posts: [{ i: 'cached', a: 'Cached', t: 1 }] },
      meta: { lastUpdated: '2026-04-19T03:00:00.000Z' },
      leaderboards: { fetchedAt: '2026-05-14T08:00:00.000Z', leaderboards: [{ tier: 'Low' }] },
      source: 'cache',
    }))

    const fetchSpy = vi.fn((url) => {
      const href = String(url)
      if (href.includes('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T03:00:00.000Z' })
      }
      if (href.includes('/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T11:00:00.000Z', leaderboards: [{ tier: 'High' }] })
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
    expect(result.leaderboards.leaderboards[0].tier).toBe('High')
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
      if (href.includes('/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T11:00:00.000Z', leaderboards: [] })
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
      if (href.includes('/leaderboards.json')) {
        return jsonResponse({ fetchedAt: '2026-05-14T11:00:00.000Z', leaderboards: [{ tier: 'High' }] })
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
