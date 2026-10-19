import { describe, expect, it } from 'vitest'
import { isPersistentApiError, isPostSpecificApiError, neighbourEntries, persistentApiWarning, validateBrExtraction } from './lib/br-extraction.mjs'

const good = (over = {}) => ({
  brBefore: 10500, brAfter: 11200,
  roomsBefore: { gg: 10500, ps: 0 }, roomsAfter: { gg: 11200 },
  tournaments: 50, totalTournaments: 1500, ...over,
})
const history = [
  { id: 'a', timestamp: 100, brBefore: 10000, brAfter: 10500, totalTournaments: 1000 },
  { id: 'c', timestamp: 300, brBefore: 11200, brAfter: 11900, totalTournaments: 1600 },
]

describe('isPostSpecificApiError (SCR-1)', () => {
  it('account/API-level trouble never counts against a post', () => {
    for (const status of [401, 402, 403, 404, 408, 409, 429, 500, 502, 503, 529]) {
      expect(isPostSpecificApiError(status, 'whatever'), String(status)).toBe(false)
    }
    expect(isPostSpecificApiError(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API"}}')).toBe(false)
    expect(isPostSpecificApiError(400, 'Overloaded')).toBe(false)
    expect(isPostSpecificApiError(400, '{"message":"invalid x-api-key"}')).toBe(false)
  })

  it('a bad request about the post own images does count', () => {
    expect(isPostSpecificApiError(400, '{"error":{"message":"Could not process image"}}')).toBe(true)
    expect(isPostSpecificApiError(400, '')).toBe(true)
    expect(isPostSpecificApiError(413, 'request_too_large')).toBe(true)
  })
})

describe('isPersistentApiError / persistentApiWarning', () => {
  it('a dead key, no access or no credit is persistent', () => {
    for (const status of [401, 402, 403]) expect(isPersistentApiError(status, ''), String(status)).toBe(true)
    expect(isPersistentApiError(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toBe(true)
    expect(isPersistentApiError(400, '{"error":{"message":"You have reached your specified API usage limits."}}')).toBe(true)
    expect(isPersistentApiError(400, '{"message":"invalid x-api-key"}')).toBe(true)
  })

  it('outages that pass on their own, and per-post problems, are not', () => {
    for (const status of [404, 408, 413, 429, 500, 502, 503, 529]) expect(isPersistentApiError(status, 'x'), String(status)).toBe(false)
    expect(isPersistentApiError(400, 'Overloaded')).toBe(false)
    expect(isPersistentApiError(400, '{"error":{"message":"rate limit exceeded"}}')).toBe(false)
    expect(isPersistentApiError(400, '{"error":{"message":"Could not process image"}}')).toBe(false)
    expect(isPersistentApiError(400, '')).toBe(false)
  })

  it('whatever is persistent is never charged to a post (same free path as before)', () => {
    const bodies = ['', 'credit balance', 'usage limit', 'invalid x-api-key', 'permission denied', 'Could not process image', 'Overloaded']
    for (const status of [400, 401, 402, 403, 404, 413, 429, 500, 529]) {
      for (const body of bodies) {
        if (isPersistentApiError(status, body)) expect(isPostSpecificApiError(status, body), `${status} ${body}`).toBe(false)
      }
    }
  })

  it('the annotation is one single line: no newline, no raw % sequences, bounded', () => {
    const line = persistentApiWarning(402, `{"error":\n  {"message":"credit balance is too low %0A ${'x'.repeat(500)}"}}`)
    expect(line.startsWith('::warning::')).toBe(true)
    expect(line).toContain('HTTP 402')
    expect(line).not.toMatch(/[\r\n]/)
    expect(line).not.toContain('%0A')
    expect(line.length).toBeLessThan(600)
    expect(persistentApiWarning(401)).toContain('HTTP 401)')
  })
})

describe('validateBrExtraction (SCR-4)', () => {
  it('accepts a clean answer and shapes it for brHistory', () => {
    const r = validateBrExtraction(good(), { history, timestamp: 200 })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({
      brBefore: 10500, brAfter: 11200, sessionResult: 700,
      rooms: {
        before: { gg: 10500, ps: 0, king: 0, coin: 0, lux: 0 },
        after: { gg: 11200, ps: 0, king: 0, coin: 0, lux: 0 },
      },
      tournaments: 50, totalTournaments: 1500,
    })
  })

  it('coerces zero/absent counts to null like before and accepts a first-ever session', () => {
    const r = validateBrExtraction(good({ brBefore: 10000, tournaments: 0, totalTournaments: null }), { history: [], timestamp: 1 })
    expect(r.ok).toBe(true)
    expect(r.value.tournaments).toBeNull()
    expect(r.value.totalTournaments).toBeNull()
  })

  it.each([
    ['null body', null],
    ['array body', [1]],
    ['string body', '{"brBefore":1}'],
    ['null numbers', good({ brBefore: null, brAfter: null })],
    ['string numbers', good({ brBefore: '$10 500', brAfter: '$11 200' })],
    ['missing brAfter', { brBefore: 10500 }],
    ['NaN-like', good({ brAfter: 'NaN' })],
    ['zero', good({ brAfter: 0 })],
    ['negative', good({ brAfter: -5 })],
    ['huge', good({ brAfter: 1e12 })],
    ['10x swing up', good({ brAfter: 105000 })],
    ['10x swing down', good({ brAfter: 1120 })],
    ['room as string', good({ roomsAfter: { gg: '11200' } })],
    ['room negative', good({ roomsAfter: { gg: -1 } })],
    ['rooms as array', good({ roomsBefore: [1, 2] })],
    ['tournaments string', good({ tournaments: '50' })],
    ['tournaments negative', good({ tournaments: -3 })],
    ['totalTournaments string', good({ totalTournaments: '1500' })],
    ['totalTournaments fractional', good({ totalTournaments: 1.5 })],
    ['totalTournaments absurd', good({ totalTournaments: 1e9 })],
  ])('rejects %s', (_label, parsed) => {
    expect(validateBrExtraction(parsed, { history, timestamp: 200 }).ok).toBe(false)
  })

  it('checks continuity and monotonic totals against the chronological neighbours', () => {
    // chain: brBefore must continue the previous session (a: 10500)
    expect(validateBrExtraction(good({ brBefore: 1050, brAfter: 1100 }), { history, timestamp: 200 }).ok).toBe(false)
    // total must not fall below the previous session (a: 1000) ...
    expect(validateBrExtraction(good({ totalTournaments: 999 }), { history, timestamp: 200 }).ok).toBe(false)
    // ... nor exceed the next session (c: 1600)
    expect(validateBrExtraction(good({ totalTournaments: 1601 }), { history, timestamp: 200 }).ok).toBe(false)
    // equal totals are only a warning in the integrity report, so they pass here
    expect(validateBrExtraction(good({ totalTournaments: 1000 }), { history, timestamp: 200 }).ok).toBe(true)
    // the small historic -375 gap (5%) is fine
    expect(validateBrExtraction(good({ brBefore: 10125, brAfter: 10900 }), { history, timestamp: 200 }).ok).toBe(true)
  })

  it('works when the post has no timestamp (compares with the latest entry)', () => {
    expect(validateBrExtraction(good({ brBefore: 11900, brAfter: 12000, totalTournaments: 1700 }), { history, timestamp: null }).ok).toBe(true)
    expect(validateBrExtraction(good({ totalTournaments: 1500 }), { history, timestamp: null }).ok).toBe(false)
  })
})

describe('neighbourEntries', () => {
  it('finds the previous and next session by time, whatever the array order', () => {
    const shuffled = [history[1], history[0]]
    const { prev, next } = neighbourEntries(shuffled, 200)
    expect(prev.id).toBe('a')
    expect(next.id).toBe('c')
    expect(neighbourEntries(history, 50)).toEqual({ prev: null, next: history[0] })
    expect(neighbourEntries(undefined, 50)).toEqual({ prev: null, next: null })
  })
})
