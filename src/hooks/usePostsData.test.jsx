import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { usePostsData } from './usePostsData.js'
import { fetchPublicData } from '../storage.js'

vi.mock('../storage.js', async importOriginal => {
  const actual = await importOriginal()
  return { fetchPublicData: vi.fn(), isPayloadAtLeastAsFresh: actual.isPayloadAtLeastAsFresh }
})

const POLL_INTERVAL_MS = 2 * 60 * 1000

function makePayload({ posts = [], meta = {}, coverage } = {}) {
  return {
    posts,
    meta: {
      startBankroll: 10000,
      totalTournaments: 0,
      brHistory: [],
      ...meta,
    },
    ...(coverage ? { coverage } : {}),
  }
}

function PostsDataProbe({ initialMode } = {}) {
  const {
    posts, meta, coverage, loading, error, refresh, newPostIds, clearNewPosts,
    loadingFullHistory, fullHistoryError, loadFullHistory,
  } = usePostsData({ initialMode })

  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error?.message || ''}</output>
      <output data-testid="coverage">{JSON.stringify(coverage)}</output>
      <output data-testid="loading-full-history">{String(loadingFullHistory)}</output>
      <output data-testid="full-history-error">{fullHistoryError?.message || ''}</output>
      <output data-testid="meta">{JSON.stringify(meta)}</output>
      <output data-testid="post-ids">{posts.map((post) => post.id).join(',')}</output>
      <output data-testid="new-post-ids">{newPostIds.join(',')}</output>
      <output data-testid="history-count">{String(meta?.brHistory?.length || 0)}</output>
      <output data-testid="romeo-exact-br">{String(posts.find((post) => post.id === 'romeo-exact')?.brAfter ?? '')}</output>
      <output data-testid="romeo-near-br">{String(posts.find((post) => post.id === 'romeo-near')?.brAfter ?? '')}</output>
      <button onClick={() => refresh().catch(() => {})}>refresh</button>
      <button onClick={() => clearNewPosts(posts)}>clear</button>
      <button onClick={() => loadFullHistory().catch(() => {})}>full history</button>
    </div>
  )
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

async function advancePoll() {
  await act(async () => {
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    await flushMicrotasks()
  })
}

async function renderAndFlush(props = {}) {
  const view = render(<PostsDataProbe {...props} />)
  await act(async () => {
    await flushMicrotasks()
  })
  return view
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('usePostsData', () => {
  beforeEach(() => {
    fetchPublicData.mockReset()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads data, deduplicates bankroll history, and enriches Romeopro posts', async () => {
    fetchPublicData.mockResolvedValueOnce(makePayload({
      posts: [
        { id: 'romeo-exact', author: 'Romeopro', timestamp: 10000, brAfter: null },
        { id: 'romeo-near', author: 'Romeopro', timestamp: 20000, brAfter: null },
        { id: 'reply-1', author: 'OtherUser', timestamp: 20500, brAfter: null },
      ],
      meta: {
        brHistory: [
          { id: 'romeo-exact', timestamp: 9500, brAfter: 11100 },
          { id: 'dup-a', timestamp: 19900, brBefore: 12000, brAfter: 12100, tournaments: 5 },
          { id: 'dup-b', timestamp: 19950, brBefore: 12000, brAfter: 12300, tournaments: 8 },
        ],
      },
    }))

    render(<PostsDataProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('romeo-exact-br')).toHaveTextContent('11100')
    expect(screen.getByTestId('romeo-near-br')).toHaveTextContent('12300')
    expect(screen.getByTestId('history-count')).toHaveTextContent('2')
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')
  })

  it('surfaces an initial load failure', async () => {
    fetchPublicData.mockRejectedValueOnce(new Error('offline'))

    render(<PostsDataProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('offline')
    })

    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('keeps the default desktop full loader and exposes full coverage without an upgrade request', async () => {
    fetchPublicData.mockResolvedValue(makePayload({
      posts: [{ id: 'old' }, { id: 'latest' }], meta: { totalPosts: 2 },
    }))
    await renderAndFlush()

    expect(fetchPublicData).toHaveBeenCalledWith()
    expect(JSON.parse(screen.getByTestId('coverage').textContent)).toEqual({
      mode: 'full', loadedPosts: 2, totalPosts: 2,
    })
    fireEvent.click(screen.getByText('full history'))
    expect(fetchPublicData).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')
  })

  it('starts recent mode with full metadata and retains that mode across resize, polling, and visibility changes', async () => {
    vi.useFakeTimers()
    const recent = makePayload({
      posts: [{ id: 'latest' }],
      meta: {
        totalPosts: 9000, totalTournaments: 32000,
        brHistory: [{ id: 'old-session', timestamp: 100, brAfter: 11000 }, { id: 'new-session', timestamp: 200, brAfter: 12000 }],
      },
      coverage: { mode: 'recent', limit: 300, loadedPosts: 1, totalPosts: 9000 },
    })
    fetchPublicData.mockResolvedValue(recent)
    const view = await renderAndFlush({ initialMode: 'recent' })

    expect(JSON.parse(screen.getByTestId('coverage').textContent)).toEqual(recent.coverage)
    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(recent.meta)
    view.rerender(<PostsDataProbe initialMode="full" />)
    await advancePoll()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await flushMicrotasks()
    })

    expect(fetchPublicData).toHaveBeenCalledTimes(3)
    expect(fetchPublicData.mock.calls.every(args => args.length === 1 && args[0].mode === 'recent')).toBe(true)
    expect(screen.getByTestId('post-ids').textContent).toBe('latest')
    expect(screen.getByTestId('history-count').textContent).toBe('2')
  })

  it('keeps recent posts visible during one deduplicated explicit upgrade, then polls the complete history', async () => {
    vi.useFakeTimers()
    const upgrade = deferred()
    const meta = {
      totalPosts: 3, totalTournaments: 32000,
      brHistory: [{ id: 'old-session', timestamp: 100, brAfter: 11000 }, { id: 'new-session', timestamp: 200, brAfter: 12000 }],
    }
    const recent = makePayload({ posts: [{ id: 'latest' }], meta })
    const full = makePayload({ posts: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'latest' }], meta })
    fetchPublicData.mockResolvedValueOnce(recent).mockReturnValueOnce(upgrade.promise).mockResolvedValue(full)
    await renderAndFlush({ initialMode: 'recent' })

    await act(async () => {
      fireEvent.click(screen.getByText('full history'))
      fireEvent.click(screen.getByText('full history'))
      await flushMicrotasks()
    })
    expect(fetchPublicData).toHaveBeenCalledTimes(2)
    expect(fetchPublicData.mock.calls[1]).toEqual([{ refresh: true, minMeta: recent.meta }])
    expect(screen.getByTestId('post-ids').textContent).toBe('latest')
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('coverage').textContent).mode).toBe('recent')

    await act(async () => { upgrade.resolve(full); await flushMicrotasks() })
    expect(screen.getByTestId('post-ids').textContent).toBe('old-1,old-2,latest')
    expect(JSON.parse(screen.getByTestId('coverage').textContent)).toEqual({ mode: 'full', loadedPosts: 3, totalPosts: 3 })
    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(full.meta)
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')

    await advancePoll()
    expect(fetchPublicData.mock.calls[2]).toEqual([])
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')
  })

  it('retains recent data after an upgrade failure, keeps recent polling, and permits a successful retry', async () => {
    vi.useFakeTimers()
    const recent = makePayload({ posts: [{ id: 'recent' }], meta: { totalPosts: 2 } })
    const full = makePayload({ posts: [{ id: 'old' }, { id: 'recent' }], meta: { totalPosts: 2 } })
    let fullAttempts = 0
    fetchPublicData.mockImplementation(options => {
      if (options?.mode === 'recent') return Promise.resolve(recent)
      if (fullAttempts++ === 0) throw new Error('archive offline')
      return Promise.resolve(full)
    })
    await renderAndFlush({ initialMode: 'recent' })
    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })

    expect(screen.getByTestId('full-history-error')).toHaveTextContent('archive offline')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(screen.getByTestId('post-ids').textContent).toBe('recent')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')
    expect(JSON.parse(screen.getByTestId('coverage').textContent).mode).toBe('recent')

    await advancePoll()
    expect(fetchPublicData.mock.calls[2]).toEqual([{ mode: 'recent' }])
    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })
    expect(screen.getByTestId('post-ids').textContent).toBe('old,recent')
    expect(screen.getByTestId('full-history-error').textContent).toBe('')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')
    expect(JSON.parse(screen.getByTestId('coverage').textContent).mode).toBe('full')
  })

  it('guards the full download with the latest polled metadata and retains recent data if no fresh archive is available', async () => {
    vi.useFakeTimers()
    const recent = makePayload({
      posts: [{ id: 'recent' }],
      meta: { totalPosts: 500, lastUpdated: '2026-08-30T10:00:00Z', bankroll: 11000 },
    })
    const current = makePayload({
      posts: [{ id: 'recent' }, { id: 'new' }],
      meta: { totalPosts: 501, lastUpdated: '2026-08-30T10:05:00Z', bankroll: 12000 },
    })
    fetchPublicData.mockResolvedValueOnce(recent).mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error('Full history is older than the recent snapshot'))
    await renderAndFlush({ initialMode: 'recent' })
    await advancePoll()
    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })

    expect(fetchPublicData.mock.calls[2]).toEqual([{ refresh: true, minMeta: current.meta }])
    expect(fetchPublicData.mock.calls[2][0].minMeta).toBe(current.meta)
    expect(screen.getByTestId('post-ids').textContent).toBe('recent,new')
    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(current.meta)
    expect(JSON.parse(screen.getByTestId('coverage').textContent)).toMatchObject({ mode: 'recent', totalPosts: 501 })
    expect(screen.getByTestId('full-history-error')).toHaveTextContent('Full history is older')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new')
  })

  it('rejects a full response if recent polling advanced beyond the original upgrade freshness floor', async () => {
    vi.useFakeTimers()
    const upgrade = deferred()
    const recent = makePayload({
      posts: [{ id: 'recent' }],
      meta: { totalPosts: 500, lastUpdated: '2026-08-30T10:00:00Z', bankroll: 11000 },
    })
    const newer = makePayload({
      posts: [{ id: 'recent' }, { id: 'new' }],
      meta: { totalPosts: 501, lastUpdated: '2026-08-30T10:05:00Z', bankroll: 12000 },
    })
    const outdatedFull = makePayload({ posts: [{ id: 'old' }, ...recent.posts], meta: { ...recent.meta } })
    fetchPublicData.mockResolvedValueOnce(recent).mockReturnValueOnce(upgrade.promise).mockResolvedValue(newer)
    await renderAndFlush({ initialMode: 'recent' })
    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })
    expect(fetchPublicData.mock.calls[1][0].minMeta).toBe(recent.meta)

    await advancePoll()
    await act(async () => { upgrade.resolve(outdatedFull); await flushMicrotasks() })
    expect(screen.getByTestId('post-ids').textContent).toBe('recent,new')
    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(newer.meta)
    expect(JSON.parse(screen.getByTestId('coverage').textContent).mode).toBe('recent')
    expect(screen.getByTestId('full-history-error')).toHaveTextContent('older than the current recent snapshot')
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new')
    expect(screen.getByTestId('loading-full-history')).toHaveTextContent('false')
  })

  it.each(['resolve', 'reject'])('discards an old recent poll that later %ss after the full-history upgrade', async completion => {
    vi.useFakeTimers()
    const stalePoll = deferred()
    const upgrade = deferred()
    const recent = makePayload({ posts: [{ id: 'recent' }], meta: { totalPosts: 2 } })
    const full = makePayload({ posts: [{ id: 'old' }, { id: 'recent' }], meta: { totalPosts: 2 } })
    const freshFull = makePayload({ posts: [...full.posts, { id: 'new' }], meta: { totalPosts: 3 } })
    fetchPublicData.mockResolvedValueOnce(recent).mockReturnValueOnce(stalePoll.promise)
      .mockReturnValueOnce(upgrade.promise).mockResolvedValue(freshFull)
    await renderAndFlush({ initialMode: 'recent' })
    await advancePoll()
    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })
    await act(async () => { upgrade.resolve(full); await flushMicrotasks() })

    await act(async () => {
      if (completion === 'resolve') stalePoll.resolve(makePayload({ posts: [{ id: 'recent' }, { id: 'new' }], meta: { totalPosts: 3 } }))
      else stalePoll.reject(new Error('old recent request failed'))
      await flushMicrotasks()
    })
    expect(screen.getByTestId('post-ids').textContent).toBe('old,recent')
    expect(JSON.parse(screen.getByTestId('coverage').textContent).mode).toBe('full')
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')

    await advancePoll()
    expect(fetchPublicData.mock.calls.at(-1)).toEqual([])
    expect(screen.getByTestId('post-ids').textContent).toBe('old,recent,new')
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new')
  })

  it('preserves genuine pending new-post badges while adding historical IDs to the full baseline', async () => {
    vi.useFakeTimers()
    const recent = makePayload({ posts: [{ id: 'recent' }] })
    const recentUpdate = makePayload({ posts: [{ id: 'recent' }, { id: 'new' }] })
    const full = makePayload({ posts: [{ id: 'old' }, ...recentUpdate.posts] })
    const freshFull = makePayload({ posts: [...full.posts, { id: 'newer' }] })
    fetchPublicData.mockResolvedValueOnce(recent).mockResolvedValueOnce(recentUpdate)
      .mockResolvedValueOnce(full).mockResolvedValue(freshFull)
    await renderAndFlush({ initialMode: 'recent' })
    await advancePoll()
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new')

    await act(async () => { fireEvent.click(screen.getByText('full history')); await flushMicrotasks() })
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new')
    await advancePoll()
    expect(screen.getByTestId('new-post-ids').textContent).toBe('new,newer')
    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')
  })

  it('detects new posts during silent polling and clears the badge on demand', async () => {
    vi.useFakeTimers()
    fetchPublicData
      .mockResolvedValueOnce(makePayload({
        posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
      }))
      .mockResolvedValueOnce(makePayload({
        posts: [
          { id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 },
          { id: 'post-2', author: 'OtherUser', timestamp: 10100, brAfter: null },
        ],
      }))

    await renderAndFlush()
    expect(screen.getByTestId('post-ids')).toHaveTextContent('post-1')

    await advancePoll()
    expect(screen.getByTestId('new-post-ids')).toHaveTextContent('post-2')

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('new-post-ids').textContent).toBe('')
  })

  it('keeps the latest good data visible when a silent refresh fails', async () => {
    vi.useFakeTimers()
    fetchPublicData
      .mockResolvedValueOnce(makePayload({
        posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
      }))
      .mockRejectedValueOnce(new Error('offline'))

    await renderAndFlush()
    expect(screen.getByTestId('post-ids')).toHaveTextContent('post-1')

    await advancePoll()

    expect(screen.getByTestId('post-ids')).toHaveTextContent('post-1')
    expect(screen.getByTestId('error').textContent).toBe('')
  })

  it('stops polling while the tab is hidden and refreshes immediately when visible again', async () => {
    vi.useFakeTimers()
    let hidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })

    fetchPublicData.mockResolvedValue(makePayload({
      posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
    }))

    await renderAndFlush()
    expect(fetchPublicData).toHaveBeenCalledTimes(1)

    hidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await advancePoll()
    expect(fetchPublicData).toHaveBeenCalledTimes(1)

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await flushMicrotasks()
    })
    expect(fetchPublicData).toHaveBeenCalledTimes(2)

    await advancePoll()
    expect(fetchPublicData).toHaveBeenCalledTimes(3)
  })

  it('re-renders when only postsChangedAt moves (likes-only scraper run)', async () => {
    vi.useFakeTimers()
    fetchPublicData
      .mockResolvedValueOnce(makePayload({
        posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000, likes: 1 }],
        meta: { lastUpdated: '2026-08-19T00:00:00.000Z' },
      }))
      .mockResolvedValue(makePayload({
        posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000, likes: 42 }],
        meta: { lastUpdated: '2026-08-19T00:00:00.000Z', postsChangedAt: '2026-08-19T00:30:00.000Z' },
      }))

    let seenLikes = 0
    function Probe() {
      const { posts } = usePostsData()
      seenLikes = posts[0]?.likes ?? 0
      return null
    }
    render(<Probe />)
    await act(async () => { await flushMicrotasks() })
    expect(seenLikes).toBe(1)

    await advancePoll()
    expect(seenLikes).toBe(42)
  })

  it.each([
    ['bankroll', (meta) => { meta.bankroll = 12000 }],
    ['total tournaments', (meta) => { meta.totalTournaments = 120 }],
    ['total posts', (meta) => { meta.totalPosts = 2 }],
    ['history length', (meta) => { meta.brHistory.unshift({ id: 'earlier', timestamp: 9000, brBefore: 9000, brAfter: 10000 }) }],
    ['last session id', (meta) => { meta.brHistory[0].id = 'corrected-session' }],
    ['last session timestamp', (meta) => { meta.brHistory[0].timestamp = 10100 }],
    ['last session opening bankroll', (meta) => { meta.brHistory[0].brBefore = 9900 }],
    ['last session closing bankroll', (meta) => { meta.brHistory[0].brAfter = 12000 }],
    ['last session result', (meta) => { meta.brHistory[0].sessionResult = 1100 }],
    ['last session tournaments', (meta) => { meta.brHistory[0].tournaments = 120 }],
    ['last session total tournaments', (meta) => { meta.brHistory[0].totalTournaments = 120 }],
  ])('applies a same-timestamp %s correction during silent polling', async (_field, correct) => {
    vi.useFakeTimers()
    const initial = makePayload({
      posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
      meta: {
        lastUpdated: '2026-08-19T00:00:00.000Z',
        postsChangedAt: '2026-08-19T00:30:00.000Z',
        bankroll: 11000,
        totalTournaments: 100,
        totalPosts: 1,
        brHistory: [{
          id: 'session-1', timestamp: 10000, brBefore: 10000, brAfter: 11000,
          sessionResult: 1000, tournaments: 100, totalTournaments: 100,
        }],
      },
    })
    const corrected = structuredClone(initial)
    correct(corrected.meta)
    fetchPublicData.mockResolvedValueOnce(initial).mockResolvedValue(corrected)

    function MetaProbe() {
      const { meta } = usePostsData()
      return <output data-testid="meta">{JSON.stringify(meta)}</output>
    }
    render(<MetaProbe />)
    await act(async () => { await flushMicrotasks() })
    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(initial.meta)

    await advancePoll()

    expect(JSON.parse(screen.getByTestId('meta').textContent)).toEqual(corrected.meta)
    expect(fetchPublicData).toHaveBeenCalledTimes(2)
  })

  it('does not re-render on a no-op poll when the data is unchanged', async () => {
    vi.useFakeTimers()
    const unchanged = makePayload({
      posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
      meta: {
        lastUpdated: '2026-01-01T00:00:00.000Z',
        bankroll: 11000,
        totalTournaments: 100,
        totalPosts: 1,
        brHistory: [{ id: 'session-1', timestamp: 10000, brBefore: 10000, brAfter: 11000, tournaments: 100 }],
      },
    })
    fetchPublicData.mockImplementation(async () => structuredClone(unchanged))

    let renders = 0
    function CountingProbe() {
      renders++
      const { posts } = usePostsData()
      return <output data-testid="ids">{posts.map((post) => post.id).join(',')}</output>
    }

    render(<CountingProbe />)
    await act(async () => {
      await flushMicrotasks()
    })
    expect(screen.getByTestId('ids')).toHaveTextContent('post-1')
    // let the post-load effects (new-post ids, refs) settle before counting —
    // otherwise the baseline depends on what earlier tests left warm
    await act(async () => {
      await flushMicrotasks()
      await flushMicrotasks()
    })
    const rendersAfterLoad = renders

    await advancePoll()
    await advancePoll()

    // The polls fetched but returned content-identical data, so no extra render.
    expect(renders).toBe(rendersAfterLoad)
    expect(fetchPublicData.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
