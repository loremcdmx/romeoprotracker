import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expandPosts, fetchPublicData } from './storage.js'

const CACHE_KEY = 'rpt_cache_v6'

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
        return jsonResponse([{ id: 'full', author: 'Fallback' }])
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.posts).toEqual([{ id: 'full', author: 'Fallback' }])
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
})
