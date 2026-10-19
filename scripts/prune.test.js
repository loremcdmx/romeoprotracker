import { describe, expect, it } from 'vitest'
import { planPrune, pruneLimit } from './lib/prune.mjs'

const post = (id, author = 'u') => ({ id: String(id), author })

describe('planPrune (SCR-8 / DL-1)', () => {
  const stored = [post(100), post(101), post(102), post(103), post(104), post(50), post(900)]

  it('flags stored posts inside the scanned id range that the scan did not see', () => {
    const scrapedIds = new Set(['100', '102', '104'])
    const plan = planPrune({ posts: stored, scrapedIds })
    expect(plan.missing).toEqual(['101', '103'])        // 50 and 900 are outside [100,104]
    expect(plan.lo).toBe(100)
    expect(plan.hi).toBe(104)
  })

  it('keeps protected posts out of the removal list and reports them', () => {
    const plan = planPrune({
      posts: [post(100), post(101, 'Romeopro'), post(102)],
      scrapedIds: new Set(['100', '102']),
      isKept: p => p.author === 'Romeopro',
    })
    expect(plan.missing).toEqual([])
    expect(plan.kept).toEqual(['101'])
  })

  it('an empty scan judges nothing', () => {
    expect(planPrune({ posts: stored, scrapedIds: new Set() }).missing).toEqual([])
  })
})

describe('pruneLimit', () => {
  it('is min(50, 1% of the stored posts)', () => {
    expect(pruneLimit(9050)).toBe(50)
    expect(pruneLimit(2000)).toBe(20)
    expect(pruneLimit(400)).toBe(4)
    expect(pruneLimit(50)).toBe(0)
  })
})
