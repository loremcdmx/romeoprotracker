import { describe, expect, it } from 'vitest'
import { ROMEO_RE } from './utils.js'
import {
  countActivityAuthors, groupActivityDays, pickTopActivityAuthors, selectActivityDays,
} from './activitySummary.js'

const ts = iso => Date.parse(iso) / 1000

// The pre-optimization scoring path is the equivalence oracle. Keep rarity
// based on all posts, the rating/like maxima, stable ties, and the same top 5.
function originalTopAuthors(dayPosts, allPosts) {
  const byAuthor = {}
  dayPosts.filter(post => post.author && !ROMEO_RE.test(post.author)).forEach(post => {
    const name = post.author
    if (!byAuthor[name]) byAuthor[name] = { rating: post.rating || 0, bestLikes: 0, count: 0 }
    byAuthor[name].count++
    if ((post.likes || 0) > byAuthor[name].bestLikes) byAuthor[name].bestLikes = post.likes || 0
    if ((post.rating || 0) > byAuthor[name].rating) byAuthor[name].rating = post.rating || 0
  })
  const counts = {}
  allPosts.forEach(post => { if (post.author) counts[post.author] = (counts[post.author] || 0) + 1 })
  return Object.entries(byAuthor)
    .filter(([, { rating }]) => rating >= 15000)
    .map(([name, { rating, bestLikes, count }]) => {
      const total = counts[name] || count
      const uniqueBonus = total <= 3 ? 10 : total <= 10 ? 4 : 0
      const score = Math.log10(rating + 1) * 20 + bestLikes * 2
        + (rating >= 25000 && bestLikes > 5 ? 80 : 0) + uniqueBonus
      return { name, rating, score, bestLikes }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

describe('activity day grouping', () => {
  it('keeps Warsaw days sorted and preserves complete post objects and within-day order', () => {
    const late = { id: 0, timestamp: ts('2026-08-02T22:01:00Z'), text: 'Zero ID is still a post' }
    const first = { id: 'first', timestamp: ts('2026-08-02T21:59:00Z'), text: '' }
    const sameDay = { id: 'same', timestamp: ts('2026-08-02T20:00:00Z'), text: '[QUOTE]unchanged[/QUOTE]' }
    const missingTime = { id: 'missing', text: 'No timestamp' }
    const posts = [late, first, sameDay, missingTime, { timestamp: 0 }]
    const original = structuredClone(posts)

    const days = groupActivityDays(posts)

    expect(days.map(([date, day]) => [date, day.count])).toEqual([
      ['2026-08-02', 2], ['2026-08-03', 1],
    ])
    expect(days[0][1].posts).toEqual([first, sameDay])
    expect(days[0][1].posts[0]).toBe(first)
    expect(days[1][1].posts[0]).toBe(late)
    expect(posts).toEqual(original)
  })

  it('keeps both repeated DST hours in the same Warsaw date', () => {
    const posts = ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T23:01:00Z']
      .map(timestamp => ({ timestamp: ts(timestamp) }))
    expect(groupActivityDays(posts).map(([date, day]) => [date, day.count])).toEqual([
      ['2026-10-25', 2], ['2026-10-26', 1],
    ])
  })

  it('switches periods by slicing the last active dates without regrouping or changing the source', () => {
    // Deliberate gaps: the original chart uses active dates, not calendar days.
    const posts = Array.from({ length: 40 }, (_, i) => ({
      id: i, timestamp: ts('2026-06-01T12:00:00Z') + i * 2 * 86400,
    })).reverse()
    const days = groupActivityDays(posts)
    const month = selectActivityDays(days, 'month')
    const week = selectActivityDays(days, 'week')
    const all = selectActivityDays(days, 'all')

    expect(month).toEqual(days.slice(-30))
    expect(week).toEqual(days.slice(-7))
    expect(week[0]).toBe(days[33])
    expect(all).toBe(days)
    expect(selectActivityDays(days, 'month')[0]).toBe(month[0])
    expect(days).toHaveLength(40)
    expect(posts[0].id).toBe(39)
  })

  it('handles empty data and an unknown period with the original all-dates fallback', () => {
    const days = groupActivityDays([])
    expect(selectActivityDays(days, 'week')).toEqual([])
    expect(selectActivityDays(days, 'unknown')).toBe(days)
  })
})

describe('activity author scoring', () => {
  it('counts the full feed, including undated posts, and preserves case and spelling', () => {
    const counts = countActivityAuthors([
      { author: 'Alpha', timestamp: 0 }, { author: 'Alpha' },
      { author: 'alpha' }, { author: ' Alpha ' }, { author: 'Romeopro' },
      { author: '' }, { author: 0 }, {},
    ])
    expect([...counts]).toEqual([
      ['Alpha', 2], ['alpha', 1], [' Alpha ', 1], ['Romeopro', 1],
    ])
  })

  it('matches the old result across rarity, rating, VIP, like, and tie boundaries for every day', () => {
    const ratings = [14999, 15000, 24999, 25000, 25001]
    const totals = [1, 3, 4, 10, 11]
    const posts = []
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < totals[i % totals.length]; j++) {
        posts.push({
          author: `Author ${i}`, rating: ratings[i % ratings.length], likes: (i + j) % 8,
          timestamp: ts('2026-08-01T12:00:00Z') + j * 86400,
        })
      }
    }
    posts.push({ author: 'Romeopro', rating: 99999, likes: 100, timestamp: posts[0].timestamp })
    posts.push({ author: '', rating: 99999, likes: 100, timestamp: posts[0].timestamp })
    const counts = countActivityAuthors(posts)
    for (const [, { posts: dayPosts }] of groupActivityDays(posts)) {
      expect(pickTopActivityAuthors(dayPosts, counts)).toEqual(originalTopAuthors(dayPosts, posts))
    }
  })

  it('uses maximum rating and likes per author and original global rarity after changing periods', () => {
    const dayPosts = [
      { author: 'Rare', rating: 25000, likes: 2 },
      { author: 'Rare', rating: 15000, likes: 6 },
      { author: 'Regular', rating: 25000, likes: 6 },
    ]
    const allPosts = [...dayPosts, ...Array.from({ length: 10 }, () => ({ author: 'Regular' }))]
    const counts = countActivityAuthors(allPosts)
    const result = pickTopActivityAuthors(dayPosts, counts)
    expect(result.map(author => author.name)).toEqual(['Rare', 'Regular'])
    expect(result[0]).toMatchObject({ rating: 25000, bestLikes: 6 })
    expect(result[0].score - result[1].score).toBeCloseTo(10)
    expect(result).toEqual(originalTopAuthors(dayPosts, allPosts))
    expect([...counts]).toEqual([['Rare', 2], ['Regular', 11]])
  })

  it('keeps tied authors in their original order, limits to five, and falls back to day counts', () => {
    const posts = ['C', 'B', 'A', 'F', 'E', 'D'].map(author => ({ author, rating: 15000, likes: 5 }))
    expect(pickTopActivityAuthors(posts, new Map()).map(author => author.name)).toEqual(['C', 'B', 'A', 'F', 'E'])
    expect(pickTopActivityAuthors([], new Map())).toEqual([])
  })
})
