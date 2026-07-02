import { describe, expect, it } from 'vitest'
import {
  computeMarathonDay,
  extractMarathonDay,
  validateMarathonIntegrity,
} from './lib/marathon-integrity.mjs'

describe('marathon integrity helpers', () => {
  it('extracts the latest author-numbered marathon day', () => {
    const posts = [
      { id:'1', author:'Romeopro', timestamp:10, text:'Day 96:' },
      { id:'2', author:'Romeopro', timestamp:20, text:'Day 97:' },
    ]

    expect(extractMarathonDay('Day 97:')).toBe(97)
    expect(computeMarathonDay(posts, [])).toBe(97)
  })

  it('keeps repeated Day updates as warnings instead of changing day truth', () => {
    const posts = [
      { id:'1', author:'Romeopro', timestamp:10, text:'Day 12:' },
      { id:'2', author:'Romeopro', timestamp:20, text:'Day 12 upd:' },
      { id:'3', author:'Romeopro', timestamp:30, text:'Day 13:' },
    ]
    const meta = {
      day:13,
      bankroll:13000,
      totalTournaments:300,
      brHistory:[
        { id:'1', timestamp:10, brAfter:11000, totalTournaments:100 },
        { id:'2', timestamp:20, brAfter:12000, totalTournaments:200 },
        { id:'3', timestamp:30, brAfter:13000, totalTournaments:300 },
      ],
    }

    const result = validateMarathonIntegrity({ posts, meta })

    expect(result.errors).toEqual([])
    expect(result.report.metaDay).toBe(13)
    expect(result.report.brUpdateCount).toBe(3)
    expect(result.report.repeatedDays).toHaveLength(1)
  })

  it('fails when meta day drifts from the latest Day post', () => {
    const result = validateMarathonIntegrity({
      posts:[{ id:'1', author:'Romeopro', timestamp:10, text:'Day 97:' }],
      meta:{ day:98, brHistory:[] },
    })

    expect(result.errors[0]).toContain('meta.day 98 does not match latest Romeo Day 97')
  })
})
