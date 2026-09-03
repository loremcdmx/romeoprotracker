import { describe, expect, it } from 'vitest'
import { buildRecentPosts, RECENT_POST_LIMIT } from './lib/recent-posts.mjs'

describe('recent posts snapshot', () => {
  it('selects the latest 300 source posts and returns them chronologically', () => {
    const compact = {
      avatars: [],
      posts: Array.from({ length: 400 }, (_, i) => ({ i: String(i), t: i, x: `post ${i}` })).reverse(),
    }
    const snapshot = buildRecentPosts(compact, { brHistory: [] })

    expect(snapshot.posts).toHaveLength(RECENT_POST_LIMIT)
    expect(snapshot.posts.map(post => post.i)).toEqual(Array.from({ length: 300 }, (_, i) => String(i + 100)))
    expect(snapshot.coverage).toEqual({ mode: 'recent', limit: 300, loadedPosts: 300, totalPosts: 400 })
  })

  it('remaps only used avatar references while preserving every post field', () => {
    const compact = {
      avatars: ['unused.png', 'one.png', 'two.png'],
      posts: [
        { i: '1', t: 1, v: 2, x: 'quote', te: 'English', ts: 'Español', vd: ['video'], p: ['image'] },
        { i: '2', t: 2, v: 1, ba: 10000, rm: { gg: 10000 } },
        { i: '3', t: 3, v: 2 },
        { i: '4', t: 4 },
      ],
    }
    const before = structuredClone(compact)
    const snapshot = buildRecentPosts(compact, { brHistory: [] })

    expect(snapshot.avatars).toEqual(['two.png', 'one.png'])
    expect(snapshot.posts).toEqual([
      { ...compact.posts[0], v: 0 }, { ...compact.posts[1], v: 1 },
      { ...compact.posts[2], v: 0 }, compact.posts[3],
    ])
    for (let i = 0; i < compact.posts.length; i++) {
      if (compact.posts[i].v != null) {
        expect(snapshot.avatars[snapshot.posts[i].v]).toBe(compact.avatars[compact.posts[i].v])
      }
    }
    expect(compact).toEqual(before)
  })

  it('preserves complete metadata and history even when most posts are omitted', () => {
    const compact = { avatars: [], posts: [{ i: 'old', t: 1 }, { i: 'new', t: 2 }] }
    const meta = { bankroll: 12000, totalPosts: 2, totalTournaments: 500, brHistory: [{ id: 'old', brAfter: 11000 }, { id: 'new', brAfter: 12000 }] }
    const snapshot = buildRecentPosts(compact, meta, 1)

    expect(snapshot.posts).toEqual([{ i: 'new', t: 2 }])
    expect(snapshot.meta).toEqual(meta)
    expect(snapshot.meta.brHistory).toHaveLength(2)
  })

  it('is deterministic and preserves input order for equal timestamps', () => {
    const compact = { avatars: [], posts: [{ i: 'a', t: 2 }, { i: 'b', t: 2 }, { i: 'c', t: 1 }] }
    const meta = { lastUpdated: '2026-08-30T12:00:00Z', brHistory: [] }
    const first = buildRecentPosts(compact, meta)

    expect(first.posts.map(post => post.i)).toEqual(['c', 'a', 'b'])
    expect(JSON.stringify(buildRecentPosts(structuredClone(compact), structuredClone(meta)))).toBe(JSON.stringify(first))
  })

  it('reports actual coverage for an empty or short dataset', () => {
    expect(buildRecentPosts({ avatars: [], posts: [] }, {}).coverage).toEqual({ mode: 'recent', limit: 300, loadedPosts: 0, totalPosts: 0 })
    expect(buildRecentPosts({ avatars: [], posts: [{ i: 'one', t: 1 }] }, {}).coverage.loadedPosts).toBe(1)
  })

  it('rejects invalid inputs instead of generating fabricated dates or avatars', () => {
    expect(() => buildRecentPosts({ avatars: [], posts: [{ i: 'bad' }] }, {})).toThrow('Invalid timestamp')
    expect(() => buildRecentPosts({ avatars: [], posts: [{ i: 'bad', t: 1, v: 0 }] }, {})).toThrow('Invalid avatar')
    expect(() => buildRecentPosts({ avatars: [], posts: [] }, {}, 301)).toThrow('limit')
  })
})
