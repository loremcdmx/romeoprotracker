// Flow tests: the REAL scripts/scrape.mjs against a mocked forum + mocked
// Anthropic (see test-support/). Bankroll extraction, retry budget, reextract
// and author identity. Each test spawns the scraper in a throwaway directory.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseMeta, pageHtml, runScrape, storedPost } from './test-support/scrape-sandbox.mjs'

vi.setConfig({ testTimeout: 60_000 })

const IMG = 'https://img.example/post-1_thumb.webp'
const NOW = 1_800_000_000
const okBr = (over = {}) => JSON.stringify({
  brBefore: 10500, brAfter: 11200,
  roomsBefore: { gg: 10500 }, roomsAfter: { gg: 11200 },
  tournaments: 50, totalTournaments: 1500, ...over,
})

// meta with one earlier session, so continuity/monotonic checks have a neighbour
const metaWithHistory = () => baseMeta({
  bankroll: 10500, day: 5, totalTournaments: 1000,
  brHistory: [{
    id: '10', date: 'x', timestamp: NOW - 86_400, brBefore: 10000, brAfter: 10500, sessionResult: 500,
    rooms: { before: {}, after: {} }, url: 'u', tournaments: 40, totalTournaments: 1000,
  }],
})

const romeoPost = (over = {}) => storedPost({
  id: 20, author: 'Romeopro', timestamp: NOW, text: 'Day 6:', images: [IMG], ...over,
})

// Pages that show the given stored posts unchanged (both thread pages).
function pagesFor(posts, extraOnLast = []) {
  const toForum = p => ({
    id: p.id, author: p.author, ts: p.timestamp, likes: p.likes,
    html: p.text + (p.images || []).map(src => `<img src="${src}">`).join(''),
  })
  return {
    0: pageHtml(posts.map(toForum), 20),
    20: pageHtml([...posts.map(toForum), ...extraOnLast], 20),
  }
}

const sandboxes = []
const run = opts => { const r = runScrape(opts); sandboxes.push(r); return r }
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup() })

describe('SCR-2/DL-1/DL-6: only the exact Romeo account feeds the marathon', () => {
  it('ignores a look-alike nick: no day change, no vision call, no BR entry', () => {
    const existing = storedPost({ id: 10, author: 'Romeopro', text: 'Day 5:' })
    const r = run({
      posts: [existing],
      meta: baseMeta({ day: 5 }),
      apiKey: 'k',
      anthropic: { vision: [{ text: okBr({ brBefore: 10000, brAfter: 10300 }) }] },
      pages: pagesFor([existing], [
        { id: 99, author: 'Romeopro_fan', html: 'Day 999: totally real update', ts: NOW + 10 },
        { id: 100, author: 'xxRoMeOpRo', html: `Day 998:<img src="${IMG}">`, ts: NOW + 20 },
      ]),
    })
    expect(r.status).toBe(0)
    expect(r.posts.map(p => p.id)).toEqual(['10', '99', '100'])   // still archived as ordinary posts
    expect(r.meta.day).toBe(5)
    expect(r.meta.brHistory).toHaveLength(0)
    expect(r.count('vision')).toBe(0)
  })

  it('still processes the real Romeopro post', () => {
    const existing = storedPost({ id: 10, author: 'Romeopro', text: 'Day 5:' })
    const r = run({
      posts: [existing],
      meta: metaWithHistory(),
      apiKey: 'k',
      anthropic: { vision: [{ text: okBr() }] },
      pages: pagesFor([existing], [
        { id: 20, author: 'Romeopro', html: `Day 6:<img src="${IMG}">`, ts: NOW },
      ]),
    })
    expect(r.status).toBe(0)
    expect(r.meta.day).toBe(6)
    expect(r.meta.brHistory.map(h => h.id)).toEqual(['10', '20'])
    expect(r.meta.bankroll).toBe(11200)
    expect(r.count('vision')).toBe(1)
  })
})

describe('SCR-1: API trouble never spends the retry budget', () => {
  const stored = () => romeoPost({ brAttempts: 5 })

  it.each([
    ['HTTP 500', { status: 500, raw: 'boom' }],
    ['HTTP 429', { status: 429, raw: 'slow down' }],
    ['HTTP 529 overloaded', { status: 529, raw: 'overloaded' }],
    ['HTTP 401 bad key', { status: 401, raw: '{"error":{"message":"invalid x-api-key"}}' }],
    ['HTTP 402', { status: 402, raw: 'payment required' }],
    ['HTTP 400 low credit balance', { status: 400, raw: '{"error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}' }],
    ['network error', { throw: true }],
  ])('%s leaves brAttempts and brChecked alone', (_label, response) => {
    const post = stored()
    const r = run({
      posts: [post], meta: metaWithHistory(), apiKey: 'k',
      anthropic: { vision: [response] },
      pages: pagesFor([post]),
    })
    const after = r.posts.find(p => p.id === '20')
    expect(r.count('vision')).toBe(1)
    expect(after.brAttempts).toBe(5)
    expect(after.brChecked).toBeFalsy()
    expect(after.brGaveUp).toBeUndefined()
    expect(r.status).toBe(0)
  })

  it('a long outage followed by recovery still records the session', () => {
    // Every run is a "committing" run (heartbeat aged), as in production where
    // a run commits every 10-20 minutes.
    const aged = meta => ({ ...meta, lastScrapeRun: '2026-01-01T00:00:00.000Z' })
    let state = { posts: [romeoPost()], meta: metaWithHistory() }
    for (let i = 0; i < 8; i++) {   // more than BR_MAX_ATTEMPTS committing runs
      const r = run({ posts: state.posts, meta: aged(state.meta), apiKey: 'k', anthropic: { vision: [{ status: 503, raw: 'down' }] }, pages: pagesFor(state.posts) })
      expect(r.count('vision')).toBe(1)
      state = { posts: r.posts, meta: r.meta }
    }
    expect(state.posts[0].brChecked).toBeFalsy()
    const healthy = run({ posts: state.posts, meta: aged(state.meta), apiKey: 'k', anthropic: { vision: [{ text: okBr() }] }, pages: pagesFor(state.posts) })
    expect(healthy.meta.brHistory.map(h => h.id)).toEqual(['10', '20'])
    expect(healthy.meta.bankroll).toBe(11200)
  })

  it('a 400 about the images themselves does count', () => {
    const r = run({
      posts: [romeoPost()], meta: metaWithHistory(), apiKey: 'k',
      anthropic: { vision: [{ status: 400, raw: '{"error":{"type":"invalid_request_error","message":"Could not process image"}}' }] },
      pages: pagesFor([romeoPost()]),
    })
    expect(r.posts.find(p => p.id === '20').brAttempts).toBe(1)
  })

  it('unusable answers count; the 6th gives up LOUDLY (flag, annotation, red run) and persists', () => {
    const garbage = { vision: [{ text: 'I cannot read the image' }] }
    const fifth = run({ posts: [romeoPost({ brAttempts: 4 })], meta: metaWithHistory(), apiKey: 'k', anthropic: garbage, pages: pagesFor([romeoPost()]) })
    const p5 = fifth.posts.find(p => p.id === '20')
    expect(p5.brAttempts).toBe(5)
    expect(p5.brChecked).toBeFalsy()
    expect(fifth.status).toBe(0)

    const sixth = run({ posts: [romeoPost({ brAttempts: 5 })], meta: metaWithHistory(), apiKey: 'k', anthropic: garbage, pages: pagesFor([romeoPost()]) })
    const p6 = sixth.posts.find(p => p.id === '20')
    expect(p6.brAttempts).toBe(6)
    expect(p6.brChecked).toBe(true)
    expect(p6.brGaveUp).toMatch(/^\d{4}-\d{2}-\d{2}T/)       // visible flag in the data
    expect(sixth.output).toContain('::error::')                // visible in the Actions log
    expect(sixth.status).toBe(1)                               // visible as a red run
    expect(sixth.meta.brHistory).toHaveLength(1)               // and nothing was invented
  })

  it('the first sighting of a missing API key does not spend attempts either', () => {
    const r = run({ posts: [romeoPost({ brAttempts: 5 })], meta: metaWithHistory(), pages: pagesFor([romeoPost()]) })
    const after = r.posts.find(p => p.id === '20')
    expect(after.brAttempts).toBe(5)
    expect(after.brChecked).toBeFalsy()
  })
})

describe('SCR-4: model output is validated before it touches brHistory/meta', () => {
  const rejected = [
    ['null numbers (instead of skip)', { brBefore: null, brAfter: null }],
    ['string numbers', { brBefore: '$10 500', brAfter: '$11 200' }],
    ['zero bankroll', { brBefore: 10500, brAfter: 0 }],
    ['negative bankroll', { brBefore: 10500, brAfter: -3 }],
    ['absurdly large bankroll', { brBefore: 10500, brAfter: 5e12 }],
    ['dropped digit (10x low)', { brBefore: 10500, brAfter: 1120 }],
    ['does not continue the previous session', { brBefore: 1050, brAfter: 1100 }],
    ['totalTournaments decreases', { totalTournaments: 400 }],
    ['totalTournaments is a string', { totalTournaments: '1 500' }],
    ['totalTournaments is fractional', { totalTournaments: 1500.5 }],
    ['rooms contain text', { roomsAfter: { gg: 'n/a' } }],
    ['session count is a string', { tournaments: 'fifty' }],
  ]

  it.each(rejected)('rejects: %s', (_label, over) => {
    const r = run({
      posts: [romeoPost()], meta: metaWithHistory(), apiKey: 'k',
      anthropic: { vision: [{ text: okBr(over) }] },
      pages: pagesFor([romeoPost()]),
    })
    expect(r.meta.bankroll).toBe(10500)
    expect(r.meta.totalTournaments).toBe(1000)
    expect(r.meta.brHistory).toHaveLength(1)
    const after = r.posts.find(p => p.id === '20')
    expect(after.brAfter).toBeNull()
    expect(after.brAttempts).toBe(1)    // invalid output = unusable answer
  })

  it('rejects a non-object answer (JSON null / array)', () => {
    for (const text of ['null', '[1,2]', '42']) {
      const r = run({
        posts: [romeoPost()], meta: metaWithHistory(), apiKey: 'k',
        anthropic: { vision: [{ text }] }, pages: pagesFor([romeoPost()]),
      })
      expect(r.meta.brHistory).toHaveLength(1)
      expect(r.posts.find(p => p.id === '20').brAttempts).toBe(1)
    }
  })

  it('accepts a clean answer, with missing rooms defaulting to 0', () => {
    const r = run({
      posts: [romeoPost()], meta: metaWithHistory(), apiKey: 'k',
      anthropic: { vision: [{ text: okBr({ roomsBefore: { gg: 10500 }, roomsAfter: null, tournaments: 0 }) }] },
      pages: pagesFor([romeoPost()]),
    })
    const entry = r.meta.brHistory.find(h => h.id === '20')
    expect(entry).toMatchObject({ brBefore: 10500, brAfter: 11200, sessionResult: 700, tournaments: null, totalTournaments: 1500 })
    expect(entry.rooms.after).toEqual({ gg: 0, ps: 0, king: 0, coin: 0, lux: 0 })
    expect(r.meta.bankroll).toBe(11200)
  })

  it('a skip answer is still "no BR data" and marks the post checked', () => {
    const r = run({
      posts: [romeoPost()], meta: metaWithHistory(), apiKey: 'k',
      anthropic: { vision: [{ text: '{"skip":true}' }] }, pages: pagesFor([romeoPost()]),
    })
    expect(r.posts.find(p => p.id === '20').brChecked).toBe(true)
    expect(r.posts.find(p => p.id === '20').brGaveUp).toBeUndefined()
  })
})

describe('SCR-3: reextract never wipes before it has results', () => {
  const romeoWithImages = () => [
    storedPost({ id: 10, author: 'Romeopro', timestamp: NOW - 86_400, text: 'Day 5:', images: [IMG], brBefore: 10000, brAfter: 10500, sessionResult: 500, brAttempts: 2 }),
    storedPost({ id: 20, author: 'Romeopro', timestamp: NOW, text: 'Day 6:', images: [IMG], brBefore: 10500, brAfter: 11000, sessionResult: 500 }),
  ]
  const existingMeta = () => baseMeta({
    bankroll: 11000, totalTournaments: 1100,
    brHistory: [
      { id: '10', date: 'x', timestamp: NOW - 86_400, brBefore: 10000, brAfter: 10500, sessionResult: 500, rooms: { before: {}, after: {} }, url: 'u', tournaments: 40, totalTournaments: 1000 },
      { id: '20', date: 'x', timestamp: NOW, brBefore: 10500, brAfter: 11000, sessionResult: 500, rooms: { before: {}, after: {} }, url: 'u', tournaments: 40, totalTournaments: 1100 },
    ],
  })
  const args = ['--mode=reextract', '--no-push']

  it('refuses to start without ANTHROPIC_API_KEY and changes nothing', () => {
    const r = run({ posts: romeoWithImages(), meta: existingMeta(), args })
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('ANTHROPIC_API_KEY')
    expect(r.untouched).toBe(true)
    expect(r.count('vision')).toBe(0)
  })

  it.each([
    ['API outage', [{ status: 500, raw: 'boom' }]],
    ['bad key', [{ status: 401, raw: 'nope' }]],
    ['network error', [{ throw: true }]],
    ['unreadable answer', [{ text: 'sorry' }]],
    ['invalid numbers', [{ text: okBr({ brAfter: null }) }]],
    ['"skip" for every post (would publish an empty history)', [{ text: '{"skip":true}' }]],
  ])('aborts without writing on %s', (_label, vision) => {
    const r = run({ posts: romeoWithImages(), meta: existingMeta(), apiKey: 'k', args, anthropic: { vision } })
    expect(r.status).not.toBe(0)
    expect(r.untouched).toBe(true)
  })

  it('aborts without writing when a later post fails', () => {
    const r = run({
      posts: romeoWithImages(), meta: existingMeta(), apiKey: 'k', args,
      anthropic: { vision: [{ text: okBr({ brBefore: 10000, brAfter: 10600, totalTournaments: 1010 }) }, { status: 503, raw: 'down' }] },
    })
    expect(r.status).not.toBe(0)
    expect(r.untouched).toBe(true)
  })

  it('writes the rebuilt history only after every post succeeded', () => {
    const r = run({
      posts: romeoWithImages(), meta: existingMeta(), apiKey: 'k', args,
      anthropic: { vision: [
        { text: okBr({ brBefore: 10000, brAfter: 10600, totalTournaments: 1010 }) },
        { text: okBr({ brBefore: 10600, brAfter: 11300, totalTournaments: 1090 }) },
      ] },
    })
    expect(r.status).toBe(0)
    expect(r.meta.brHistory.map(h => [h.id, h.brAfter])).toEqual([['10', 10600], ['20', 11300]])
    expect(r.meta.bankroll).toBe(11300)
    expect(r.meta.totalTournaments).toBe(1090)
    const first = r.posts.find(p => p.id === '10')
    expect(first.brAfter).toBe(10600)
    expect(first.brAttempts).toBeUndefined()
  })
})
