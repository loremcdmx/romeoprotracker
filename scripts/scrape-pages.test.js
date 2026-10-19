// Flow tests: the REAL scripts/scrape.mjs against a mocked forum. Page-level
// integrity: blind scans must fail loudly, deletions are reconciled only by a
// complete full scan (with a safety cap), embeds are allow-listed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'

vi.setConfig({ testTimeout: 60_000 })

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

const asForum = p => ({ id: p.id, author: p.author, html: p.text, ts: p.timestamp, likes: p.likes })

describe('SCR-6: a scrape that cannot see posts fails without touching anything', () => {
  const existing = storedPost({ id: 10, author: 'A', text: 'old body' })
  const good = pageHtml([asForum(existing)], 20)
  // same pages, but the post markup changed class names (forum redesign)
  const blind = good.replace(/class="post /g, 'class="entry ')

  it('markup change: pages parse to zero posts -> non-zero exit, files and heartbeat untouched', () => {
    const r = run({ posts: [existing], pages: { 0: blind, 20: blind } })
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('Parsed 0 posts')
    expect(r.untouched).toBe(true)
    expect(r.meta.lastScrapeRun).toBe('2026-01-01T00:00:00.000Z')
  })

  it('missing pager (block page / redesign) -> non-zero exit, nothing written', () => {
    const noPager = good.replace(/<a class="theme-pagination--pager"[^>]*>last<\/a>/, '')
    const r = run({ posts: [existing], pages: { 0: noPager, 20: noPager } })
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('Could not find the last page')
    expect(r.untouched).toBe(true)
  })

  it('an empty NEWEST page next to a healthy older page is tolerated', () => {
    const emptyNewest = good.replace(/class="post /g, 'class="entry ')
    const r = run({ posts: [existing], pages: { 0: good, 20: emptyNewest } })
    // st=20 is the newest page; with only hidden posts on it the run is still healthy
    expect(r.status).toBe(0)
    expect(r.meta.lastScrapeRun).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('an empty page in the middle of a full scan is fatal', () => {
    const pages = {}
    for (let st = 0; st <= 60; st += 20) pages[st] = pageHtml([{ id: 100 + st, author: 'A', html: `body ${st}` }], 60)
    pages[40] = pageHtml([], 60)
    const r = run({ posts: [], pages, args: ['--mode=full', '--no-push'] })
    expect(r.status).not.toBe(0)
    expect(r.untouched).toBe(true)
  })
})

describe('SCR-8 / DL-1: deletions are reconciled by complete full scans only', () => {
  // 400 stored posts, 20 per forum page (st = 0 .. 380). Safe cap = min(50, 1%) = 4.
  const TOTAL = 400
  const stored = Array.from({ length: TOTAL }, (_, i) => storedPost({
    id: 1000 + i, author: `User${i}`, timestamp: 1_700_000_000 + i, text: `body ${i}`,
  }))
  const romeoIdx = 77
  stored[romeoIdx] = storedPost({ id: 1000 + romeoIdx, author: 'Romeopro', timestamp: 1_700_000_000 + romeoIdx, text: 'Day 3:' })

  function forumWithout(missingIds) {
    const gone = new Set(missingIds.map(String))
    const visible = stored.filter(p => !gone.has(p.id))
    const pages = {}
    // the forum re-flows: pages are slices of what is still visible
    for (let i = 0; i < visible.length; i += 20) pages[i] = pageHtml(visible.slice(i, i + 20).map(asForum), visible.length - (visible.length % 20 || 20))
    return pages
  }
  const idsOf = r => new Set(r.posts.map(p => p.id))
  const full = ['--mode=full', '--no-push']

  it('removes the posts the forum no longer lists (within the cap) and logs their ids', () => {
    const missing = ['1005', '1150', '1390']
    const r = run({ posts: stored, meta: baseMeta({ totalPosts: TOTAL }), pages: forumWithout(missing), args: full })
    expect(r.status).toBe(0)
    expect(r.posts).toHaveLength(TOTAL - 3)
    for (const id of missing) { expect(idsOf(r).has(id)).toBe(false); expect(r.output).toContain(id) }
    expect(r.meta.totalPosts).toBe(TOTAL - 3)
    expect(r.compact.posts).toHaveLength(TOTAL - 3)
  })

  it('refuses to remove more than the cap without --prune-force, and says which ids', () => {
    const missing = ['1005', '1006', '1150', '1151', '1390']   // 5 > 4
    const r = run({ posts: stored, meta: baseMeta({ totalPosts: TOTAL }), pages: forumWithout(missing), args: full })
    expect(r.status).toBe(0)
    expect(r.posts).toHaveLength(TOTAL)
    expect(r.output).toContain('Prune refused')
    for (const id of missing) expect(r.output).toContain(id)
  })

  it('--prune-force lifts the cap', () => {
    const missing = ['1005', '1006', '1150', '1151', '1390']
    const r = run({ posts: stored, meta: baseMeta({ totalPosts: TOTAL }), pages: forumWithout(missing), args: [...full, '--prune-force'] })
    expect(r.posts).toHaveLength(TOTAL - 5)
  })

  it("never removes Romeo's own posts (they feed brHistory and the day)", () => {
    const r = run({ posts: stored, meta: baseMeta({ totalPosts: TOTAL }), pages: forumWithout([String(1000 + romeoIdx), '1200']), args: full })
    expect(idsOf(r).has(String(1000 + romeoIdx))).toBe(true)
    expect(idsOf(r).has('1200')).toBe(false)
    expect(r.output).toContain('Romeo post(s) no longer listed')
  })

  describe('a normal (non-full) scan never prunes', () => {
    // The fixture removes every OTHER barrier, so `isFullScan` is the only thing
    // standing between this scan and the prune: a two-page thread (the normal
    // scan reads both pages, i.e. it is complete), 120 stored posts (cap =
    // floor(1.2) = 1, so one removal is within the safe limit), and the one
    // missing post is a plain non-Romeo post inside the scanned id range.
    const small = Array.from({ length: 120 }, (_, i) => storedPost({
      id: 5000 + i, author: `User${i}`, timestamp: 1_700_000_000 + i, text: `body ${i}`,
    }))
    const visible = small.filter(p => p.id !== '5050')
    const twoPages = {
      0: pageHtml(visible.slice(0, 60).map(asForum), 20),
      20: pageHtml(visible.slice(60).map(asForum), 20),
    }

    it('control: the very same forum IS pruned by a full scan', () => {
      const r = run({ posts: small, meta: baseMeta({ totalPosts: 120 }), pages: twoPages, args: full })
      expect(r.posts).toHaveLength(119)
      expect(r.output).toContain('Removed 1 post(s)')
    })

    it('normal scan, complete and within the cap: nothing is removed', () => {
      const r = run({ posts: small, meta: baseMeta({ totalPosts: 120 }), pages: twoPages })
      expect(r.status).toBe(0)
      expect(r.count('forum')).toBe(2)               // both pages of the thread were read
      expect(r.output).not.toContain('Removed')
      expect(r.output).not.toContain('Prune refused')
      expect(r.output).not.toContain('no longer listed')
      expect(r.posts).toHaveLength(120)
      expect(r.posts.some(p => p.id === '5050')).toBe(true)
      expect(r.meta.totalPosts).toBe(120)
    })

    it('--prune-force does not turn a normal scan into a pruning one', () => {
      const r = run({ posts: small, meta: baseMeta({ totalPosts: 120 }), pages: twoPages, args: ['--no-push', '--prune-force'] })
      expect(r.posts).toHaveLength(120)
      expect(r.output).not.toContain('Removed')
    })
  })

  it('an incomplete full scan (a page fails) removes nothing and writes nothing', () => {
    const pages = forumWithout(['1005'])
    pages[200] = { status: 503, body: 'maintenance' }
    const r = run({ posts: stored, meta: baseMeta({ totalPosts: TOTAL }), pages, args: full })
    expect(r.status).not.toBe(0)
    expect(r.untouched).toBe(true)
  })
})

describe('FD-8 / DL-3 / DL-7: only allow-listed https embeds are kept', () => {
  const fig = src => `<figure class="media"><iframe src="${src}"></iframe></figure>`
  const hostile = [
    'javascript:parent.__pwned=1',
    'data:text/html,hi',
    'http://www.youtube.com/embed/insecure',
    '//evil.example/embed/x',
    'https://www.youtube.com.evil.example/embed/x',
    'https://www.youtube.com@evil.example/embed/x',
  ]
  const legit = ['//www.youtube.com/embed/DZl0J-eTjz8', 'https://player.vimeo.com/video/1175524410', 'https://video.gipsyteam.ru/player/embed.php?vid=SN2XD1N41YB4']

  it('drops hostile iframe src at the source and keeps legitimate ones verbatim', () => {
    const existing = storedPost({ id: 10, author: 'A' })
    const html = 'watch this ' + [...hostile, ...legit].map(fig).join('')
    const r = run({
      posts: [existing],
      pages: {
        0: pageHtml([asForum(existing)], 20),
        20: pageHtml([asForum(existing), { id: 11, author: 'B', html, ts: 1_700_000_100 }], 20),
      },
    })
    const added = r.posts.find(p => p.id === '11')
    expect(added.videos).toEqual(legit)
    expect(r.compact.posts.find(p => p.i === '11').vd).toEqual(legit)
    expect(r.output).toContain('dropped embed')
  })

  it('removes an already-stored hostile src the next time the post is scanned', () => {
    const poisoned = storedPost({ id: 10, author: 'A', text: 'v', videos: ['javascript:alert(1)', '//www.youtube.com/embed/ok'] })
    // the forum still lists both embeds; only the allow-listed one may stay
    const forumHtml = 'v' + fig('javascript:alert(1)') + fig('//www.youtube.com/embed/ok')
    const r = run({
      posts: [poisoned],
      pages: {
        0: pageHtml([{ id: 10, author: 'A', html: forumHtml }], 20),
        20: pageHtml([{ id: 10, author: 'A', html: forumHtml }], 20),
      },
    })
    expect(r.posts.find(p => p.id === '10').videos).toEqual(['//www.youtube.com/embed/ok'])
  })
})
