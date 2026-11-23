import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'
import { expandPosts } from '../src/storage.js'

vi.setConfig({ testTimeout: 60_000 })

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

const freshMeta = (over = {}) => baseMeta({ lastScrapeRun: new Date().toISOString(), ...over })

describe('scraper bughunt regression tests', () => {
  it('sorts newPosts chronologically when a burst spans multiple pages in normal mode', () => {
    const p1 = storedPost({ id: 10, author: 'A', timestamp: 1_700_000_000, text: 'old post' })
    const oldPagePost = { id: 11, author: 'UserA', html: 'earlier new post', ts: 1_700_000_100, likes: 0 }
    const newPagePost = { id: 12, author: 'UserB', html: 'later new post', ts: 1_700_000_200, likes: 3 }
    const pages = {
      0: pageHtml([{ id: 10, author: 'A', html: 'old post', ts: 1_700_000_000, likes: 0 }, oldPagePost], 20),
      20: pageHtml([newPagePost], 20),
    }
    const r = run({ posts: [p1], meta: freshMeta(), pages })
    expect(r.status).toBe(0)
    expect(r.posts.map(p => p.id)).toEqual(['10', '11', '12'])
    expect(r.posts.map(p => p.timestamp)).toEqual([1_700_000_000, 1_700_000_100, 1_700_000_200])

    // Compact v2 output round-trips cleanly through expandPosts
    expect(Array.isArray(r.compact.authors)).toBe(true)
    expect(Array.isArray(r.compact.regData)).toBe(true)
    const expanded = expandPosts(r.compact)
    expect(expanded.map(p => p.author)).toEqual(['A', 'UserA', 'UserB'])
    expect(expanded.map(p => p.likes)).toEqual([0, 0, 3])
  })

  it('persists brChecked = true on a retry run when Claude Vision returns skip:true', () => {
    const img = 'https://img.gipsyteam.ru/non-br-meme.png'
    const existing = storedPost({
      id: 20,
      author: 'Romeopro',
      timestamp: 1_700_000_000,
      text: 'just a funny meme',
      images: [img],
      brAfter: null,
    })
    const page = pageHtml([{
      id: 20,
      author: 'Romeopro',
      html: `just a funny meme<img src="${img}">`,
      ts: 1_700_000_000,
      likes: 0,
    }], 20)
    const r = run({
      posts: [existing],
      meta: freshMeta(),
      apiKey: 'test-key',
      anthropic: { br: [{ text: '{"skip":true}' }] },
      pages: { 0: page, 20: page },
    })
    expect(r.status).toBe(0)
    expect(r.untouched).toBe(false)
    expect(r.posts[0].brChecked).toBe(true)

    // Next run with persisted brChecked=true makes zero Claude Vision calls
    const r2 = run({
      posts: r.posts,
      meta: freshMeta(),
      apiKey: 'test-key',
      anthropic: { br: [{ text: '{"skip":true}' }] },
      pages: { 0: page, 20: page },
    })
    expect(r2.count('br')).toBe(0)
    expect(r2.untouched).toBe(true)
  })
})
