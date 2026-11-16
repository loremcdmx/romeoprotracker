// Review tails 2026-11-16, package tail-b (loading):
//   K2-2  the download fallback order: cheap (same-origin / env) sources before the raw copy
//   K2-6  a late `onFresher` payload after unmount is dropped before it is touched
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { CACHE_KEY } from './cacheConfig.js'

const MIN = 60 * 1000
const compact = (id) => ({ avatars: [], posts: [{ i: id, a: 'Romeopro', t: 1 }] })
const BASE = {
  lastUpdated: '2026-11-16T10:00:00.000Z', postsChangedAt: '2026-11-16T10:00:00.000Z', lastScrapeRun: '2026-11-16T10:00:00.000Z',
  totalPosts: 10, totalTournaments: 100, bankroll: 5000, brHistory: [],
}
const STRUCT = { ...BASE, lastUpdated: '2026-11-16T10:20:00.000Z', postsChangedAt: '2026-11-16T10:20:00.000Z', lastScrapeRun: '2026-11-16T10:20:00.000Z', totalPosts: 11 }

const ENV_BASE = 'https://cdn.example.test/data'
const isRaw = (href) => href.includes('raw.githubusercontent.com')
const isEnv = (href) => href.startsWith(ENV_BASE)
const isMeta = (href) => href.endsWith('/meta.json')
const isHeavy = (href) => href.endsWith('/posts.min.json')

describe('K2-2: when the first download fails, the next one is a cheap source, not the raw copy', () => {
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

  it('env base fails, same-origin and raw both carry the structural advance: same-origin is tried second and raw is never asked', async () => {
    vi.resetModules()
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_DATA_BASE_URL', ENV_BASE)
    const { fetchPublicData, getDataBases } = await import('./storage.js')
    expect(getDataBases()).toHaveLength(3) // env, same-origin, raw: the order below is only visible with three sources
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now() - 5 * MIN, compact: compact('cached'), meta: BASE, source: 'x' }))
    const heavyAsked = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url)
      if (isHeavy(href)) heavyAsked.push(isEnv(href) ? 'env' : isRaw(href) ? 'raw' : 'same')
      if (isMeta(href)) return { ok: true, status: 200, json: async () => STRUCT }
      if (isEnv(href)) return { ok: false, status: 500, statusText: 'boom', json: async () => ({}) }
      return { ok: true, status: 200, json: async () => compact(isRaw(href) ? 'raw-body' : 'same-body') }
    }))

    const promise = fetchPublicData()
    let outcome = null
    promise.then((value) => { outcome = { ok: true, value } }, (error) => { outcome = { ok: false, error } })
    for (let i = 0; i < 400 && !outcome; i++) await vi.advanceTimersByTimeAsync(50)

    expect(outcome?.ok, String(outcome?.error)).toBe(true)
    expect(heavyAsked).toEqual(['env', 'same'])
    expect(outcome.value.posts[0].id).toBe('same-body')
  })
})

describe('K2-6: usePostsData drops a late payload after unmount before touching it', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.doUnmock('./storage.js') })

  it('the payload object handed to onFresher after unmount is left exactly as it was (no enrichment, no dedup)', async () => {
    vi.doMock('./storage.js', () => ({ fetchPublicData: vi.fn() }))
    const { fetchPublicData } = await import('./storage.js')
    const { usePostsData } = await import('./hooks/usePostsData.js')
    let onFresher
    fetchPublicData.mockImplementation((options) => {
      onFresher = options?.onFresher
      return Promise.resolve({ posts: [], meta: { startBankroll: 10000, totalTournaments: 0, brHistory: [] } })
    })
    const view = renderHook(() => usePostsData())
    await vi.waitFor(() => expect(view.result.current.loading).toBe(false))
    view.unmount()

    // A Romeo post with no brAfter and a matching bankroll row: applyPayload would copy brAfter onto the post.
    const late = {
      posts: [{ id: 'p1', author: 'Romeopro', timestamp: 1000 }],
      meta: { startBankroll: 10000, totalTournaments: 0, brHistory: [{ id: 'p1', timestamp: 1000, brAfter: 12345 }] },
    }
    const before = structuredClone(late)
    onFresher(late)

    expect(late.posts[0]).toEqual(before.posts[0])
    expect('brAfter' in late.posts[0]).toBe(false)
  })
})
