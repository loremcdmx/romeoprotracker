import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_KEY } from './cacheConfig.js'
import { expandPosts, fetchPublicData, isPayloadAtLeastAsFresh } from './storage.js'

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
    vi.useRealTimers()
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
    const calls = fetch.mock.calls.map(([url]) => String(url))
    expect(calls.filter(url => url.endsWith('/meta.json'))).toHaveLength(2)
    expect(calls.filter(url => url.includes('/posts'))).toEqual([
      'https://raw.githubusercontent.com/loremcdmx/romeoprotracker/main/data/posts.min.json',
    ])
  })

  it('downloads only one heavy payload when metadata is identical across sources', async () => {
    const fetchSpy = vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same revision', t: 1 }] })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('same')
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/meta.json'))).toHaveLength(2)
  })

  it('ranks a longer bankroll history above equal-timestamp source metadata', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) {
        const newer = href.includes('raw.githubusercontent.com')
        return jsonResponse({
          lastUpdated: '2026-04-19T02:00:00.000Z',
          brHistory: newer
            ? [{ id: 'first', timestamp: 1 }, { id: 'second', timestamp: 2 }]
            : [{ id: 'first', timestamp: 1 }],
        })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'new-history', a: 'Romeopro', t: 1 }] })
    }))

    const result = await fetchPublicData()

    expect(result.meta.brHistory).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts')).map(([url]) => String(url))).toEqual([
      'https://raw.githubusercontent.com/loremcdmx/romeoprotracker/main/data/posts.min.json',
    ])
  })

  it('shares an in-flight load and permits a later load after it settles', async () => {
    const fetchSpy = vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same revision', t: 1 }] })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const first = fetchPublicData()
    const second = fetchPublicData()
    expect(second).toBe(first)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toBe(firstResult)
    expect(fetchSpy).toHaveBeenCalledTimes(3)

    localStorage.clear()
    const third = fetchPublicData()
    expect(third).not.toBe(first)
    await third
    expect(fetchSpy).toHaveBeenCalledTimes(6)
  })

  it('clears the shared in-flight request after a failure so retry can succeed', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchPublicData()).rejects.toThrow('offline')

    fetchSpy.mockImplementation((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      : jsonResponse({ avatars: [], posts: [{ i: 'retry', a: 'Recovered', t: 1 }] }))

    const result = await fetchPublicData()
    expect(result.posts[0].id).toBe('retry')
  })

  it('still returns network data when persisting the cache exceeds storage quota', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      : jsonResponse({ avatars: [], posts: [{ i: 'network', a: 'Uncached', t: 1 }] })))

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('network')
  })

  it('returns a working source instead of waiting forever for a stalled fallback', async () => {
    let stalledSignal = null
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      const href = String(url)

      if (href.includes('localhost') && href.includes('/data/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }

      if (href.includes('localhost') && href.includes('/data/posts.min.json')) {
        return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Same origin', t: 1 }] })
      }

      if (href.includes('raw.githubusercontent.com')) {
        stalledSignal = options.signal
        return new Promise(() => {})
      }

      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const result = await fetchPublicData()

    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(result.posts[0].id).toBe('same')
    expect(stalledSignal.aborted).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
  })

  it('bounds a stalled metadata body and aborts it after another source succeeds', async () => {
    vi.useFakeTimers()
    let stalledSignal = null
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      const href = String(url)
      if (href.includes('raw.githubusercontent.com') && href.endsWith('/meta.json')) {
        stalledSignal = options.signal
        return Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
      }
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'same', a: 'Healthy source', t: 1 }] })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(5)
    const result = await pending

    expect(result.posts[0].id).toBe('same')
    expect(stalledSignal.aborted).toBe(true)
  })

  it('falls back to the next source if the freshest compact and full files fail', async () => {
    const fetchSpy = vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: href.includes('raw.githubusercontent.com')
          ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' })
      }
      if (href.includes('raw.githubusercontent.com')) {
        return Promise.resolve({ ok: false, status: 503, statusText: 'Unavailable' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'fallback', a: 'Healthy source', t: 1 }] })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('fallback')
    expect(result.meta.lastUpdated).toBe('2026-04-19T02:00:00.000Z')
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/meta.json'))).toHaveLength(2)
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/posts')).map(([url]) => String(url))).toEqual([
      'https://raw.githubusercontent.com/loremcdmx/romeoprotracker/main/data/posts.min.json',
      'https://raw.githubusercontent.com/loremcdmx/romeoprotracker/main/data/posts.json',
      'http://localhost:3000/data/posts.min.json',
    ])
  })

  it('times out a stalled posts body before trying full and alternative-source fallbacks', async () => {
    vi.useFakeTimers()
    let stalledSignal = null
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: href.includes('raw.githubusercontent.com')
          ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' })
      }
      if (href.includes('raw.githubusercontent.com') && href.endsWith('/posts.min.json')) {
        stalledSignal = options.signal
        return Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
      }
      if (href.includes('raw.githubusercontent.com')) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'fallback', a: 'Healthy source', t: 1 }] })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(899)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/posts.json'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(stalledSignal.aborted).toBe(true)
    expect(result.posts[0].id).toBe('fallback')
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/posts.json'))).toHaveLength(1)
  })

  it('waits for pending metadata without refetching it if the initially available source fails', async () => {
    let rawMetaRequests = 0
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.includes('raw.githubusercontent.com') && href.endsWith('/meta.json')) {
        rawMetaRequests++
        return new Promise(resolve => setTimeout(() => resolve({
          ok: true, json: async () => ({ lastUpdated: '2026-04-19T03:00:00.000Z' }),
        }), 20))
      }
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      }
      if (href.includes('localhost')) {
        return Promise.resolve({ ok: false, status: 503, statusText: 'Unavailable' })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'raw', a: 'Recovered mirror', t: 1 }] })
    }))

    const result = await fetchPublicData()

    expect(rawMetaRequests).toBe(1)
    expect(result.posts[0].id).toBe('raw')
  })

  it.each([true, false])('keeps metadata arriving during the selected body download (newer: %s)', async (newer) => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      const raw = href.includes('raw.githubusercontent.com')
      if (href.endsWith('/meta.json')) {
        const meta = { lastUpdated: raw && newer ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' }
        return raw
          ? new Promise(resolve => setTimeout(() => resolve({ ok: true, json: async () => meta }), 60))
          : jsonResponse(meta)
      }
      const body = { avatars: [], posts: [{ i: raw ? 'raw' : 'same', a: 'Source', t: 1 }] }
      return Promise.resolve({
        ok: true,
        json: () => raw ? Promise.resolve(body) : new Promise(resolve => setTimeout(() => resolve(body), 100)),
      })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(105)
    const result = await pending

    expect(result.posts[0].id).toBe(newer ? 'raw' : 'same')
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/meta.json'))).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(newer ? 2 : 1)
  })

  it('does not refresh an unchanged cache TTL before slow newer metadata finishes', async () => {
    vi.useFakeTimers()
    const oldTs = Date.now() - 5 * 60 * 1000
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: oldTs,
      posts: [{ id: 'cached', author: 'Cache' }],
      meta: { lastUpdated: '2026-04-19T02:00:00.000Z' },
      source: 'cache',
    }))
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) {
        const raw = href.includes('raw.githubusercontent.com')
        const meta = { lastUpdated: raw ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' }
        return raw
          ? new Promise(resolve => setTimeout(() => resolve({ ok: true, json: async () => meta }), 60))
          : jsonResponse(meta)
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'raw', a: 'Latest data', t: 1 }] })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(30)
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)).ts).toBe(oldTs)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(35)
    const result = await pending

    expect(result.posts[0].id).toBe('raw')
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
  })

  it('allows a slow posts stream while chunks keep arriving within the idle timeout', async () => {
    vi.useFakeTimers()
    const text = JSON.stringify({ avatars: [], posts: [{ i: 'streamed', a: 'Healthy slow link', t: 1 }] })
    const chunks = [text.slice(0, 20), text.slice(20, 40), text.slice(40)]
    const releaseLock = vi.fn()
    let part = 0
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) return jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      return Promise.resolve({
        ok: true,
        body: { getReader: () => ({
          releaseLock,
          read: () => part === chunks.length ? Promise.resolve({ done: true }) : new Promise(resolve => {
            const value = new TextEncoder().encode(chunks[part++])
            setTimeout(() => resolve({ done: false, value }), 200)
          }),
        }) },
      })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(605)
    const result = await pending

    expect(result.posts[0].id).toBe('streamed')
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
    expect(releaseLock).toHaveBeenCalledOnce()
  })

  it('aborts an idle posts stream and uses a healthy mirror when its full fallback is unavailable', async () => {
    vi.useFakeTimers()
    let signal = null
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      const href = String(url)
      const raw = href.includes('raw.githubusercontent.com')
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: raw ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' })
      }
      if (raw) {
        if (href.endsWith('/posts.json')) return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
        signal = options.signal
        return Promise.resolve({ ok: true, body: { getReader: () => ({
          releaseLock: vi.fn(),
          read: () => reads++ === 0
            ? Promise.resolve({ done: false, value: new TextEncoder().encode('{"avatars":') })
            : new Promise(() => {}),
        }) } })
      }
      return jsonResponse({ avatars: [], posts: [{ i: 'healthy', a: 'Available mirror', t: 1 }] })
    }))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(305)
    const result = await pending

    expect(result.posts[0].id).toBe('healthy')
    expect(signal.aborted).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/posts.json'))).toHaveLength(1)
  })

  it('allows a slower non-streaming posts response with the longer body timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse({ lastUpdated: '2026-04-19T02:00:00.000Z' })
      : Promise.resolve({ ok: true, json: () => new Promise(resolve => setTimeout(() => resolve({
        avatars: [], posts: [{ i: 'slow-body', a: 'Healthy non-streaming response', t: 1 }],
      }), 450)) })))

    const pending = fetchPublicData()
    await vi.advanceTimersByTimeAsync(455)
    const result = await pending

    expect(result.posts[0].id).toBe('slow-body')
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
  })

  it('preserves the fresher full-file fallback when its compact request has a network error', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) return jsonResponse({ lastUpdated: href.includes('raw.githubusercontent.com')
        ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' })
      if (href.includes('raw.githubusercontent.com') && href.endsWith('/posts.min.json')) {
        return Promise.reject(new TypeError('Network error'))
      }
      if (href.endsWith('/posts.min.json')) return jsonResponse({ avatars: [], posts: [{ i: 'older', a: 'Mirror', t: 1 }] })
      return jsonResponse([{ id: 'full', author: 'Last fallback' }])
    }))

    const result = await fetchPublicData()

    expect(result.posts[0].id).toBe('full')
    expect(result.meta.lastUpdated).toBe('2026-04-19T03:00:00.000Z')
    const files = fetch.mock.calls.filter(([url]) => String(url).includes('/posts')).map(([url]) => String(url).split('/').pop())
    expect(files).toEqual(['posts.min.json', 'posts.json'])
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
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(0)
  })

  it('retains stale cache if a newer source fails and the remaining source is older', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now() - 5 * 60 * 1000,
      posts: [{ id: 'cached', author: 'Cache' }],
      meta: { lastUpdated: '2026-04-19T02:30:00.000Z' },
      source: 'cache',
    }))
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/meta.json')) {
        return jsonResponse({ lastUpdated: href.includes('raw.githubusercontent.com')
          ? '2026-04-19T03:00:00.000Z' : '2026-04-19T02:00:00.000Z' })
      }
      return Promise.resolve({ ok: false, status: 503, statusText: 'Unavailable' })
    }))

    const result = await fetchPublicData()

    expect(result.posts).toEqual([{ id: 'cached', author: 'Cache' }])
    expect(result.stale).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('localhost') && String(url).includes('/posts'))).toHaveLength(0)
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
    expect(result.stale).toBe(false)
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
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/meta.json'))).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/posts'))).toHaveLength(1)
  })
})

describe('fetchPublicData recent mode', () => {
  const recentCacheKey = `${CACHE_KEY}_recent`
  function recentSnapshot({ id = 'recent', updated = '2026-08-30T12:00:00.000Z', total = 8252 } = {}) {
    return {
      avatars: ['/img/imguser.png'],
      posts: [{ i: id, a: 'Romeopro', t: 100, v: 0, te: 'English text' }],
      meta: {
        lastUpdated: updated,
        totalPosts: total,
        bankroll: 13000,
        brHistory: [{ id: 'older-session', timestamp: 1, brAfter: 11000 }, { id: 'latest-session', timestamp: 100, brAfter: 13000 }],
      },
      coverage: { mode: 'recent', limit: 300, loadedPosts: 1, totalPosts: total },
    }
  }

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads only self-contained small snapshots and retains full chart metadata and coverage', async () => {
    const fetchSpy = vi.fn((url) => {
      if (!String(url).endsWith('/posts.recent.min.json')) throw new Error(`Forbidden recent-mode fetch: ${url}`)
      return jsonResponse(recentSnapshot())
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData({ mode: 'recent' })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result.posts[0]).toMatchObject({ id: 'recent', avatar: 'https://forum.gipsyteam.com/img/imguser.png', translations: { en: 'English text' } })
    expect(result.meta.brHistory).toHaveLength(2)
    expect(result.meta.bankroll).toBe(13000)
    expect(result.coverage).toEqual({ mode: 'recent', limit: 300, loadedPosts: 1, totalPosts: 8252 })
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(recentCacheKey)).coverage).toEqual(result.coverage)
  })

  it('does not read or overwrite an existing full cache', async () => {
    const fullCache = JSON.stringify({ ts: Date.now(), posts: [{ id: 'full-only' }], meta: { totalPosts: 5000 } })
    localStorage.setItem(CACHE_KEY, fullCache)
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(recentSnapshot())))

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.posts[0].id).toBe('recent')
    expect(getItem.mock.calls.every(([key]) => key === recentCacheKey)).toBe(true)
    expect(localStorage.getItem(CACHE_KEY)).toBe(fullCache)
  })

  it('selects the freshest embedded metadata without a separate metadata request', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => jsonResponse(recentSnapshot(String(url).includes('raw.githubusercontent.com')
      ? { id: 'newest', updated: '2026-08-30T13:00:00.000Z' }
      : { id: 'older', updated: '2026-08-30T12:00:00.000Z' }))))

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.posts[0].id).toBe('newest')
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/posts.recent.min.json'))).toBe(true)
  })

  it('reuses only its own fresh cache and preserves coverage without a network request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(recentSnapshot())))
    await fetchPublicData({ mode: 'recent' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.posts[0].id).toBe('recent')
    expect(result.coverage).toEqual({ mode: 'recent', limit: 300, loadedPosts: 1, totalPosts: 8252 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps full and recent in-flight requests independent and deduplicates each mode', async () => {
    const snapshot = recentSnapshot()
    vi.stubGlobal('fetch', vi.fn((url) => {
      const href = String(url)
      if (href.endsWith('/posts.recent.min.json')) return jsonResponse(snapshot)
      if (href.endsWith('/meta.json')) return jsonResponse(snapshot.meta)
      if (href.endsWith('/posts.min.json')) return jsonResponse({ avatars: [], posts: [{ i: 'full-history', a: 'History', t: 1 }] })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    const recent = fetchPublicData({ mode: 'recent' })
    const sameRecent = fetchPublicData({ mode: 'recent' })
    const full = fetchPublicData()
    expect(sameRecent).toBe(recent)
    expect(full).not.toBe(recent)
    const [recentResult, fullResult] = await Promise.all([recent, full])

    expect(recentResult.posts[0].id).toBe('recent')
    expect(fullResult.posts[0].id).toBe('full-history')
    expect(fullResult.coverage).toEqual({ mode: 'full', loadedPosts: 1, totalPosts: 8252 })
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/posts.recent.min.json'))).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/posts.min.json'))).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(recentCacheKey)).compact.posts[0].i).toBe('recent')
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)).compact.posts[0].i).toBe('full-history')
  })

  it('never falls back to full history when all recent snapshot files fail and can retry later', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchPublicData({ mode: 'recent' })).rejects.toThrow('404')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls.every(([url]) => String(url).endsWith('/posts.recent.min.json'))).toBe(true)
    fetchSpy.mockImplementation(() => jsonResponse(recentSnapshot({ id: 'retry' })))
    const result = await fetchPublicData({ mode: 'recent' })
    expect(result.posts[0].id).toBe('retry')
  })

  it('falls back to its stale recent cache on failure without opening the full cache', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(recentSnapshot())))
    await fetchPublicData({ mode: 'recent' })
    const cache = JSON.parse(localStorage.getItem(recentCacheKey))
    localStorage.setItem(recentCacheKey, JSON.stringify({ ...cache, ts: Date.now() - 5 * 60 * 1000 }))
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.stale).toBe(true)
    expect(result.coverage.mode).toBe('recent')
    expect(result.posts[0].id).toBe('recent')
    expect(getItem.mock.calls.every(([key]) => key === recentCacheKey)).toBe(true)
  })

  it('retains a newer recent cache when network snapshots are older', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(recentSnapshot({ id: 'new-cache', updated: '2026-08-30T14:00:00.000Z' }))))
    await fetchPublicData({ mode: 'recent' })
    const cache = JSON.parse(localStorage.getItem(recentCacheKey))
    localStorage.setItem(recentCacheKey, JSON.stringify({ ...cache, ts: Date.now() - 5 * 60 * 1000 }))
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(recentSnapshot({ id: 'older' }))))

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.posts[0].id).toBe('new-cache')
    expect(result.stale).toBe(false)
  })

  it('rejects a full/malformed payload in place of a bounded recent snapshot and uses another small source', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => jsonResponse(String(url).includes('raw.githubusercontent.com')
      ? recentSnapshot({ id: 'valid-small' })
      : { avatars: [], posts: [{ i: 'not-a-recent-snapshot' }] })))

    const result = await fetchPublicData({ mode: 'recent' })

    expect(result.posts[0].id).toBe('valid-small')
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/posts.recent.min.json'))).toBe(true)
  })

  it('rejects snapshots whose coverage claims more than the 300-post lightweight limit', async () => {
    const invalid = recentSnapshot()
    invalid.coverage.limit = 500
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(invalid)))

    await expect(fetchPublicData({ mode: 'recent' })).rejects.toThrow('Invalid recent posts snapshot')
    expect(localStorage.getItem(recentCacheKey)).toBeNull()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })
})

describe('guarded full-history upgrades', () => {
  const oldMeta = { lastUpdated: '2026-08-30T12:00:00.000Z', totalPosts: 8000 }
  const recentMeta = { lastUpdated: '2026-08-30T13:00:00.000Z', totalPosts: 8252 }

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(), posts: [{ id: 'old-full-cache', author: 'Cached' }], meta: oldMeta,
    }))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('bypasses a fresh older full cache and loads data at least as recent as the displayed snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse(recentMeta)
      : jsonResponse({ avatars: [], posts: [{ i: 'current-full-history', a: 'History', t: 1 }] })))

    const result = await fetchPublicData({ refresh: true, minMeta: recentMeta })

    expect(result.posts[0].id).toBe('current-full-history')
    expect(result.meta).toEqual(recentMeta)
    expect(result.coverage.mode).toBe('full')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects old network data instead of falling back to an older full cache', async () => {
    const originalCache = localStorage.getItem(CACHE_KEY)
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).endsWith('/meta.json')) return jsonResponse(oldMeta)
      throw new Error(`Outdated full posts should not be downloaded: ${url}`)
    }))

    await expect(fetchPublicData({ refresh: true, minMeta: recentMeta })).rejects.toThrow('older than the displayed recent snapshot')

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(CACHE_KEY)).toBe(originalCache)
  })

  it('does not return an outdated full cache if every network source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await expect(fetchPublicData({ refresh: true, minMeta: recentMeta })).rejects.toThrow('offline')
  })

  it('keeps a sufficiently recent cached full payload as a safe offline fallback', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(), posts: [{ id: 'current-cache', author: 'Cached' }], meta: recentMeta,
    }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const result = await fetchPublicData({ refresh: true, minMeta: recentMeta })

    expect(result.posts[0].id).toBe('current-cache')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps normal cache requests separate while deduplicating equivalent guarded upgrades', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('/meta.json')
      ? jsonResponse(recentMeta)
      : jsonResponse({ avatars: [], posts: [{ i: 'new-full', a: 'History', t: 1 }] })))

    const normal = fetchPublicData()
    const upgrade = fetchPublicData({ refresh: true, minMeta: recentMeta })
    const sameUpgrade = fetchPublicData({ refresh: true, minMeta: { ...recentMeta } })
    expect(upgrade).not.toBe(normal)
    expect(sameUpgrade).toBe(upgrade)
    const [normalResult, upgradeResult] = await Promise.all([normal, upgrade])

    expect(normalResult.posts[0].id).toBe('old-full-cache')
    expect(upgradeResult.posts[0].id).toBe('new-full')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('clears failed guarded requests so the same upgrade can retry', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchPublicData({ refresh: true, minMeta: recentMeta })).rejects.toThrow('offline')
    fetchSpy.mockImplementation((url) => String(url).endsWith('/meta.json')
      ? jsonResponse(recentMeta)
      : jsonResponse({ avatars: [], posts: [{ i: 'recovered', a: 'History', t: 1 }] }))

    const result = await fetchPublicData({ refresh: true, minMeta: recentMeta })
    expect(result.posts[0].id).toBe('recovered')
  })

  it('uses the existing likes and bankroll-history freshness rules for the minimum version', () => {
    expect(isPayloadAtLeastAsFresh({ meta: oldMeta }, recentMeta)).toBe(false)
    expect(isPayloadAtLeastAsFresh({ meta: recentMeta }, oldMeta)).toBe(true)
    const likesFloor = { ...oldMeta, postsChangedAt: '2026-08-30T14:00:00.000Z' }
    expect(isPayloadAtLeastAsFresh({ meta: oldMeta }, likesFloor)).toBe(false)
    const historyFloor = { ...recentMeta, brHistory: [{ timestamp: 1 }, { timestamp: 2 }] }
    expect(isPayloadAtLeastAsFresh({ meta: { ...recentMeta, brHistory: [{ timestamp: 1 }] } }, historyFloor)).toBe(false)
    expect(isPayloadAtLeastAsFresh({ meta: historyFloor }, historyFloor)).toBe(true)
  })
})
