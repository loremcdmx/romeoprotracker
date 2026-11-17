// Review wave 2026-11-16, cluster SCRAPER: the REAL scripts/scrape.mjs through the sandbox.
//   SCR-1  a real author's shrink is accepted after 3 identical runs
//   SCR-P1 forum fetches time out and retry on transient failures only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'
import { textSignature } from './lib/translation.mjs'

vi.setConfig({ testTimeout: 60_000 })

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

const freshMeta = (over = {}) => baseMeta({ lastScrapeRun: new Date().toISOString(), ...over })
const forum = (html, over = {}) => ({ id: 10, author: over.author || 'A', html, ts: 1_700_000_000, likes: 0 })
const thread = (html, over = {}) => ({ 0: pageHtml([forum(html, over)], 20), 20: pageHtml([forum(html, over)], 20) })

const LONG = ('a long stored body that the author later cut down. '.repeat(20)).trim() // ~1000 chars
const CUT = 'the author really shortened this post, keeping only this much of it.' // 68 chars, < half of LONG

// One run on top of the previous run's output (heartbeat fresh: writes only on a real change).
const next = (prev, html, extra = {}) => run({ posts: prev.posts, meta: freshMeta(), pages: thread(html), ...extra })

describe('SCR-1: a real shrink is accepted after the same body is seen in 3 separate runs', () => {
  it('refused, refused, accepted - and the candidate is gone afterwards', () => {
    const start = storedPost({ id: 10, text: LONG })
    const r1 = run({ posts: [start], meta: freshMeta(), pages: thread(CUT) })
    expect(r1.posts[0].text).toBe(LONG)
    expect(r1.posts[0].textCandidate).toMatchObject({ len: CUT.length, n: 1 })
    expect(r1.untouched).toBe(false) // the counter is a real change and is persisted
    expect(r1.output).toContain('Text refresh skipped for 1 post')

    const r2 = next(r1, CUT)
    expect(r2.posts[0].text).toBe(LONG)
    expect(r2.posts[0].textCandidate.n).toBe(2)
    expect(r2.output).toContain('Text refresh skipped for 1 post')

    const r3 = next(r2, CUT)
    expect(r3.posts[0].text).toBe(CUT)
    expect(r3.posts[0].textCandidate).toBeUndefined()
    expect(r3.output).toContain('Text: 1 posts refreshed')
    expect(r3.output).not.toContain('Text refresh skipped')
    expect(r3.compact.posts[0].x).toBe(CUT)

    // and it stays quiet afterwards: same body, fresh heartbeat -> nothing written
    const r4 = next(r3, CUT)
    expect(r4.untouched).toBe(true)
    expect(r4.output).toContain('No changes')
  })

  it('a different shrunk body in run 2 resets the count', () => {
    const r1 = run({ posts: [storedPost({ id: 10, text: LONG })], meta: freshMeta(), pages: thread(CUT) })
    const other = CUT + ' Plus a different tail.'
    const r2 = next(r1, other)
    expect(r2.posts[0].textCandidate).toMatchObject({ len: other.length, n: 1 })
    const r3 = next(r2, other)
    expect(r3.posts[0].text).toBe(LONG)
    expect(r3.posts[0].textCandidate.n).toBe(2)
  })

  it('a one-off degraded page followed by the normal body clears the candidate and writes nothing else', () => {
    const r1 = run({ posts: [storedPost({ id: 10, text: LONG })], meta: freshMeta(), pages: thread(CUT) })
    expect(r1.posts[0].textCandidate).toBeTruthy()
    const r2 = next(r1, LONG)
    expect(r2.posts[0].textCandidate).toBeUndefined()
    expect(r2.posts[0].text).toBe(LONG)
    expect(r2.untouched).toBe(false) // clearing the candidate is persisted ...
    expect(r2.output).not.toContain('Text:') // ... but it is not a text refresh
    expect(r2.output).not.toContain('Text refresh skipped')
    expect({ ...r2.posts[0], textCandidate: undefined }).toEqual({ ...r1.posts[0], textCandidate: undefined })
    const r3 = next(r2, LONG)
    expect(r3.untouched).toBe(true)
  })

  it('a near-empty body is never accepted and never remembered; the warning stays', () => {
    let r = run({ posts: [storedPost({ id: 10, text: LONG })], meta: freshMeta(), pages: thread('x') })
    for (let i = 0; i < 4; i++) {
      expect(r.posts[0].text).toBe(LONG)
      expect(r.posts[0].textCandidate).toBeUndefined()
      expect(r.output).toContain('Text refresh skipped for 1 post')
      expect(r.untouched).toBe(true)
      r = next(r, 'x')
    }
  })

  it('warnings mention only posts that are still refused', () => {
    const a = storedPost({ id: 10, text: LONG, textCandidate: { len: CUT.length, h: 'ignored', n: 2 } })
    const b = storedPost({ id: 11, text: LONG })
    const page = pageHtml([forum(CUT), { ...forum(CUT), id: 11 }], 20)
    // run 1 with a crafted candidate whose hash does not match -> reset to n=1, both refused
    const r = run({ posts: [a, b], meta: freshMeta(), pages: { 0: page, 20: page } })
    expect(r.output).toMatch(/Text refresh skipped for 2 post/)
    // now give post 10 the right candidate (n=2): it is accepted and leaves the warning
    const r2 = next(r, CUT, {})
    r2.cleanup()
    const accept = run({ posts: r.posts.map(p => p.id === '10' ? { ...p, textCandidate: { ...p.textCandidate, n: 2 } } : p), meta: freshMeta(), pages: { 0: page, 20: page } })
    expect(accept.posts.find(p => p.id === '10').text).toBe(CUT)
    expect(accept.posts.find(p => p.id === '11').text).toBe(LONG)
    expect(accept.output).toMatch(/Text refresh skipped for 1 post\(s\)[^\n]*: 11$/m)
    expect(accept.output).not.toMatch(/skipped[^\n]*\b10\b/)
  })

  it('an accepted Romeo shrink re-queues the translation like any text refresh', () => {
    const oldText = 'Сегодня сыграл очень много турниров, итог плюс две тысячи долларов. '.repeat(12)
    const cut = 'Пост сокращён автором, осталась только эта часть, больше ничего.' // ~65 chars
    const start = storedPost({ id: 10, author: 'Romeopro', text: oldText, translations: { ...textSignature(oldText), en: 'old en', es: 'old es' } })
    const pages = thread(cut, { author: 'Romeopro' })
    const common = { apiKey: 'k', anthropic: { translate: [{ text: 'fresh translation' }] }, pages }
    const r1 = run({ posts: [start], meta: freshMeta(), ...common })
    expect(r1.count('translate')).toBe(0)
    const r2 = run({ posts: r1.posts, meta: freshMeta(), ...common })
    expect(r2.count('translate')).toBe(0)
    const r3 = run({ posts: r2.posts, meta: freshMeta(), ...common })
    expect(r3.posts[0].text).toBe(cut)
    expect(r3.count('translate')).toBe(2)
    expect(r3.posts[0].translations).toMatchObject({ ...textSignature(cut), en: 'fresh translation', es: 'fresh translation' })
  })
})

describe('SCR-P1: forum fetches time out and retry only transient failures', () => {
  const stored = storedPost({ id: 10, text: 'same body' })
  const ok = pageHtml([forum('same body')], 20)
  const mk = (pages, env = {}) => run({ posts: [stored], meta: freshMeta(), pages, env })
  const forumCalls = r => r.calls.filter(l => l.includes(' forum '))

  it('502 then 200 on the first page -> success with one retry logged', () => {
    const r = mk({ 0: { seq: [{ status: 502, body: 'bad gateway' }, ok] }, 20: ok })
    expect(r.status).toBe(0)
    expect(r.output).toContain('fetch retry 1/2')
    expect(r.output).toContain('No changes')
    expect(forumCalls(r).filter(l => !l.includes('st=20'))).toHaveLength(2)
  })

  it('502 then 200 on a later page is retried too', () => {
    const r = mk({ 0: ok, 20: { seq: [{ status: 504, body: '' }, ok] } })
    expect(r.status).toBe(0)
    expect(r.output).toContain('fetch retry 1/2')
  })

  it('three 502 in a row -> the run fails and writes nothing', () => {
    const r = mk({ 0: { status: 502, body: 'bad gateway' } })
    expect(r.status).toBe(1)
    expect(r.output).toContain('HTTP 502')
    expect(forumCalls(r)).toHaveLength(3)
    expect(r.untouched).toBe(true)
  })

  it('a hanging request is aborted by the timeout and retried', () => {
    const r = mk({ 0: { seq: [{ hang: true }, ok] }, 20: ok }, { SCRAPE_FETCH_TIMEOUT_MS: '150' })
    expect(r.status).toBe(0)
    expect(r.output).toContain('timeout after 150 ms')
    expect(r.output).toContain('fetch retry 1/2')
  })

  it('a request that always hangs fails the run after 3 attempts', () => {
    const r = mk({ 0: { hang: true } }, { SCRAPE_FETCH_TIMEOUT_MS: '100' })
    expect(r.status).toBe(1)
    expect(r.output).toContain('Timeout after 100 ms (3 attempts)')
    expect(forumCalls(r)).toHaveLength(3)
    expect(r.untouched).toBe(true)
  })

  it('404 fails at once, no retry', () => {
    const r = mk({ 0: { status: 404, body: 'nope' } })
    expect(r.status).toBe(1)
    expect(r.output).toContain('HTTP 404')
    expect(r.output).not.toContain('fetch retry')
    expect(forumCalls(r)).toHaveLength(1)
  })

  it('the zero-post guard still fails the run when a page parses empty after a retry', () => {
    const empty = '<html><body><a class="theme-pagination--pager" href="https://forum.gipsyteam.ru/index.php?viewtopic=181676&amp;st=40">x</a></body></html>'
    const r = mk({ 0: { seq: [{ status: 503, body: '' }, empty] }, 20: ok })
    expect(r.status).toBe(1)
    expect(r.untouched).toBe(true)
  })
})
