import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { usePostsData } from './usePostsData.js'
import { fetchPublicData } from '../storage.js'

vi.mock('../storage.js', () => ({
  fetchPublicData: vi.fn(),
}))

const payload = (ids, meta = {}) => ({
  posts: ids.map((id) => ({ id, author: 'Other', timestamp: 1 })),
  meta: { startBankroll: 10000, totalTournaments: 0, brHistory: [], ...meta },
})

function Probe() {
  const { posts, loading, newPostIds, meta } = usePostsData()
  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="ids">{posts.map((post) => post.id).join(',')}</output>
      <output data-testid="new">{newPostIds.join(',')}</output>
      <output data-testid="total">{String(meta?.totalPosts ?? '')}</output>
    </div>
  )
}

const text = (id) => screen.getByTestId(id).textContent
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('usePostsData: a source that arrives after the first render', () => {
  beforeEach(() => {
    fetchPublicData.mockReset()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })
  afterEach(() => vi.useRealTimers())

  it('applies the late payload like a poll: new ids tracked, loading stays false', async () => {
    let onFresher
    fetchPublicData.mockImplementation((options) => {
      onFresher = options?.onFresher
      return Promise.resolve(payload(['a', 'b'], { totalPosts: 2 }))
    })
    render(<Probe />)
    await flush()
    expect(text('loading')).toBe('false')
    expect(text('ids')).toBe('a,b')
    expect(text('new')).toBe('')
    expect(typeof onFresher).toBe('function')

    await act(async () => { onFresher(payload(['a', 'b', 'c'], { totalPosts: 3 })) })

    expect(text('ids')).toBe('a,b,c')
    expect(text('new')).toBe('c')
    expect(text('total')).toBe('3')
    expect(text('loading')).toBe('false')
  })

  it('a late payload that arrives before the first one is applied is applied right after it', async () => {
    let onFresher
    let resolveFirst
    fetchPublicData.mockImplementation((options) => {
      onFresher = options?.onFresher
      return new Promise((resolve) => { resolveFirst = resolve })
    })
    render(<Probe />)
    await flush()

    await act(async () => {
      onFresher(payload(['a', 'b'], { totalPosts: 2 }))
      resolveFirst(payload(['a'], { totalPosts: 1 }))
      await Promise.resolve()
    })
    await flush()

    expect(text('ids')).toBe('a,b')
    expect(text('new')).toBe('b')
  })

  it('a late payload after unmount is ignored without errors', async () => {
    let onFresher
    fetchPublicData.mockImplementation((options) => {
      onFresher = options?.onFresher
      return Promise.resolve(payload(['a']))
    })
    const view = render(<Probe />)
    await flush()
    view.unmount()

    expect(() => onFresher(payload(['a', 'b']))).not.toThrow()
  })
})
