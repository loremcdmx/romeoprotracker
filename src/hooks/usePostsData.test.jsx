import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { usePostsData } from './usePostsData.js'
import { fetchPublicData } from '../storage.js'

vi.mock('../storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

const POLL_INTERVAL_MS = 2 * 60 * 1000

function makePayload({ posts = [], meta = {} } = {}) {
  return {
    posts,
    meta: {
      startBankroll: 10000,
      totalTournaments: 0,
      brHistory: [],
      ...meta,
    },
  }
}

function PostsDataProbe() {
  const { posts, meta, loading, error, refresh, newPostIds, clearNewPosts } = usePostsData()

  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error?.message || ''}</output>
      <output data-testid="post-ids">{posts.map((post) => post.id).join(',')}</output>
      <output data-testid="new-post-ids">{newPostIds.join(',')}</output>
      <output data-testid="history-count">{String(meta?.brHistory?.length || 0)}</output>
      <output data-testid="romeo-exact-br">{String(posts.find((post) => post.id === 'romeo-exact')?.brAfter ?? '')}</output>
      <output data-testid="romeo-near-br">{String(posts.find((post) => post.id === 'romeo-near')?.brAfter ?? '')}</output>
      <button onClick={() => refresh().catch(() => {})}>refresh</button>
      <button onClick={() => clearNewPosts(posts)}>clear</button>
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

async function renderAndFlush() {
  render(<PostsDataProbe />)
  await act(async () => {
    await flushMicrotasks()
  })
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

  it('does not re-render on a no-op poll when the data is unchanged', async () => {
    vi.useFakeTimers()
    fetchPublicData.mockResolvedValue(makePayload({
      posts: [{ id: 'post-1', author: 'Romeopro', timestamp: 10000, brAfter: 11000 }],
      meta: { lastUpdated: '2026-01-01T00:00:00.000Z' },
    }))

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
    const rendersAfterLoad = renders

    await advancePoll()
    await advancePoll()

    // The polls fetched but returned content-identical data, so no extra render.
    expect(renders).toBe(rendersAfterLoad)
    expect(fetchPublicData.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
