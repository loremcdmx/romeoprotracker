// Flow tests: the REAL scripts/scrape.mjs, with a heartbeat that is NOT due.
// The sandbox meta normally carries a 2026-01-01 heartbeat, so every run is a
// committing run and the `hasRealChanges` clauses can never be told apart from
// "the heartbeat forced a write". Here meta.lastScrapeRun is "just now": a run
// writes ONLY when one of the clauses fires, which is what each test pins.
// (Mutation check: removing any single clause from hasRealChanges fails exactly
// the matching test below.)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'

vi.setConfig({ testTimeout: 60_000 })

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

const freshMeta = (over = {}) => baseMeta({ lastScrapeRun: new Date().toISOString(), ...over })
const asForum = p => ({ id: p.id, author: p.author, html: p.text, ts: p.timestamp, likes: p.likes })
// A one-post thread as the forum shows it (both pages identical).
const thread = (...forumPosts) => ({ 0: pageHtml(forumPosts, 20), 20: pageHtml(forumPosts, 20) })

describe('SCR-9: a run with a fresh heartbeat writes only when something real changed', () => {
  const stored = () => storedPost({ id: 10, author: 'A', text: 'same body' })

  it('control: nothing changed and the heartbeat is not due -> nothing is written', () => {
    const r = run({ posts: [stored()], meta: freshMeta(), pages: thread(asForum(stored())) })
    expect(r.status).toBe(0)
    expect(r.output).toContain('No changes')
    expect(r.untouched).toBe(true)
  })

  it('control: the same run with an aged heartbeat does write (the heartbeat commit)', () => {
    const r = run({ posts: [stored()], meta: baseMeta(), pages: thread(asForum(stored())) })
    expect(r.untouched).toBe(false)
    expect(r.meta.lastScrapeRun).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('newPosts: a new forum post is written', () => {
    const added = { id: 11, author: 'B', html: 'fresh post', ts: 1_700_000_100, likes: 0 }
    const r = run({ posts: [stored()], meta: freshMeta(), pages: thread(asForum(stored()), added) })
    expect(r.untouched).toBe(false)
    expect(r.posts.map(p => p.id)).toEqual(['10', '11'])
    expect(r.output).toContain('Found 1 new posts')
  })

  it('likesUpdated: a changed like count is written', () => {
    const r = run({ posts: [stored()], meta: freshMeta(), pages: thread({ ...asForum(stored()), likes: 7 }) })
    expect(r.untouched).toBe(false)
    expect(r.posts[0].likes).toBe(7)
    expect(r.output).toContain('Likes: 1 posts updated')
  })

  it('textEdited: an edited body is written (nothing else changed)', () => {
    const r = run({ posts: [stored()], meta: freshMeta(), pages: thread({ ...asForum(stored()), html: 'same body, now edited' }) })
    expect(r.output).toContain('Text: 1 posts refreshed')
    expect(r.output).not.toContain('Likes:')
    expect(r.output).not.toContain('Found')
    expect(r.untouched).toBe(false)
    expect(r.posts[0].text).toBe('same body, now edited')
    expect(r.compact.posts[0].x).toBe('same body, now edited')
  })

  it('pruned: a post the forum dropped is removed by a full scan (nothing else changed)', () => {
    // 100 stored posts -> the prune cap is min(50, 1%) = 1, so one removal passes without --prune-force
    const all = Array.from({ length: 100 }, (_, i) => storedPost({ id: 1000 + i, author: `User${i}`, timestamp: 1_700_000_000 + i, text: `body ${i}` }))
    const visible = all.filter(p => p.id !== '1050')
    const pages = { 0: pageHtml(visible.slice(0, 50).map(asForum), 20), 20: pageHtml(visible.slice(50).map(asForum), 20) }
    const r = run({ posts: all, meta: freshMeta({ totalPosts: 100 }), pages, args: ['--mode=full', '--no-push'] })
    expect(r.status).toBe(0)
    expect(r.output).toContain('Removed 1 post(s)')
    expect(r.output).not.toContain('Likes:')
    expect(r.output).not.toContain('Text:')
    expect(r.untouched).toBe(false)
    expect(r.posts).toHaveLength(99)
    expect(r.posts.some(p => p.id === '1050')).toBe(false)
    expect(r.meta.totalPosts).toBe(99)
  })

  it('brStateChanged: a bumped BR retry counter is written even though nothing else moved', () => {
    const IMG = 'https://img.example/post-1_thumb.webp'
    const romeo = storedPost({ id: 20, author: 'Romeopro', timestamp: 1_800_000_000, text: 'Day 5:', images: [IMG] })
    const forum = { id: 20, author: 'Romeopro', ts: 1_800_000_000, html: `Day 5:<img src="${IMG}">` }
    const r = run({
      posts: [romeo], meta: freshMeta(), apiKey: 'k',
      anthropic: { vision: [{ text: 'I cannot read the image' }] },
      pages: thread(forum),
    })
    expect(r.count('vision')).toBe(1)
    expect(r.output).toContain('attempt 1/6')
    expect(r.output).not.toContain('No changes')
    expect(r.untouched).toBe(false)
    expect(r.posts[0].brAttempts).toBe(1)
    expect(r.meta.brHistory).toHaveLength(0)
  })

  it('metaUpdated: a corrected day counter is written', () => {
    const romeo = storedPost({ id: 20, author: 'Romeopro', timestamp: 1_800_000_000, text: 'Day 6: no screenshots today' })
    const r = run({ posts: [romeo], meta: freshMeta({ day: 5 }), pages: thread(asForum(romeo)) })
    expect(r.untouched).toBe(false)
    expect(r.meta.day).toBe(6)
  })

  it('translated: a fresh Romeo translation is written', () => {
    const romeo = storedPost({ id: 20, author: 'Romeopro', timestamp: 1_800_000_000, text: 'Day 5: nothing to report' })
    const r = run({
      posts: [romeo], meta: freshMeta(), apiKey: 'k',
      anthropic: { translate: [{ text: 'TRANSLATED' }] },
      pages: thread(asForum(romeo)),
    })
    expect(r.count('translate')).toBe(2)
    expect(r.untouched).toBe(false)
    expect(r.posts[0].translations).toMatchObject({ en: 'TRANSLATED', es: 'TRANSLATED' })
  })
})
