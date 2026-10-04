import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGlobalAuthorCounts, pickTopAuthors } from './activityAuthors.js'
import { ROMEO_RE, warsawDayKey } from './utils.js'

// The previous per-day calculation is an independent parity reference: the
// new index may change how much work is done, never the author ranking.
function legacyPickTopAuthors(dayPosts, allPosts) {
  const byAuthor = {}
  dayPosts.filter(p => p.author && !ROMEO_RE.test(p.author)).forEach(p => {
    const a = p.author
    if (!byAuthor[a]) byAuthor[a] = { rating: p.rating || 0, bestLikes: 0, count: 0 }
    byAuthor[a].count++
    if ((p.likes || 0) > byAuthor[a].bestLikes) byAuthor[a].bestLikes = p.likes || 0
    if ((p.rating || 0) > byAuthor[a].rating) byAuthor[a].rating = p.rating || 0
  })
  const globalCounts = {}
  allPosts?.forEach(p => { if (p.author) globalCounts[p.author] = (globalCounts[p.author] || 0) + 1 })
  return Object.entries(byAuthor)
    .filter(([, { rating }]) => rating >= 15000)
    .map(([name, { rating, bestLikes, count }]) => {
      const gc = globalCounts[name] || count
      const uniqueBonus = gc <= 3 ? 10 : gc <= 10 ? 4 : 0
      const score = Math.log10(rating + 1) * 20 + bestLikes * 2 +
        ((rating >= 25000 && bestLikes > 5) ? 80 : 0) + uniqueBonus
      return { name, rating, score, bestLikes }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

const post = (author, rating = 15000, likes = 0) => ({ author, rating, likes })

describe('activity author ranking', () => {
  it('counts the full archive, including Romeo and posts without dates', () => {
    const counts = buildGlobalAuthorCounts([post('A'), post('A'), post('Romeopro'), post(null), post('')])
    expect([...counts]).toEqual([['A', 2], ['Romeopro', 1]])
    expect(buildGlobalAuthorCounts()).toEqual(new Map())
  })

  it('excludes Romeo and low ratings, using each author’s maximum daily rating and likes', () => {
    const posts = [post('romeoPRO', 99999, 99), post(null, 99999, 99), post('Low', 14999, 99),
      post('Qualified', 15000, 1), post('Qualified', 14000, 7), post('Missing')]
    const top = pickTopAuthors(posts, buildGlobalAuthorCounts(posts))
    expect(top.map(author => author.name)).toEqual(['Qualified', 'Missing'])
    expect(top[0]).toEqual({ name: 'Qualified', rating: 15000, bestLikes: 7,
      score: Math.log10(15001) * 20 + 14 + 10 })
  })

  it('keeps the rarity bonuses at 3/10 posts and VIP boost above five likes', () => {
    const counts = new Map([['Rare', 3], ['Regular', 10], ['Frequent', 11], ['VIP', 11], ['NoBoost', 11]])
    const top = pickTopAuthors([post('Frequent'), post('Regular'), post('Rare'),
      post('VIP', 25000, 6), post('NoBoost', 25000, 5)], counts)
    expect(top.map(author => author.name)).toEqual(['VIP', 'NoBoost', 'Rare', 'Regular', 'Frequent'])
    const scores = Object.fromEntries(top.map(author => [author.name, author.score]))
    expect(scores.Rare - scores.Regular).toBeCloseTo(6)
    expect(scores.Regular - scores.Frequent).toBeCloseTo(4)
    expect(scores.VIP - scores.NoBoost).toBeCloseTo(82)
  })

  it('falls back to daily counts, keeps ties in their original order and returns five authors', () => {
    const posts = ['D', 'C', 'B', 'A', 'E', 'F'].map(name => post(name))
    expect(pickTopAuthors(posts).map(author => author.name)).toEqual(['D', 'C', 'B', 'A', 'E'])
    expect(pickTopAuthors([post('Daily'), post('Daily'), post('Daily'), post('Daily')])[0].score)
      .toBe(Math.log10(15001) * 20 + 4)
  })

  it('handles author names that coincide with object prototype properties', () => {
    const posts = [post('__proto__'), post('constructor'), post('toString')]
    const top = pickTopAuthors(posts, buildGlobalAuthorCounts(posts))
    expect(top.map(author => author.name)).toEqual(['__proto__', 'constructor', 'toString'])
    expect(top.every(author => Number.isFinite(author.score))).toBe(true)
  })

  it('matches every saved day and scans the archive only once across period changes', () => {
    const posts = JSON.parse(readFileSync(resolve('data/posts.json'), 'utf8'))
    const byDay = new Map()
    posts.forEach(p => {
      if (!p.timestamp) return
      const day = warsawDayKey(p.timestamp)
      if (!day) return
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(p)
    })
    const days = [...byDay].sort(([a], [b]) => a > b ? 1 : -1)
    let visits = 0
    const archive = { forEach(callback) {
      posts.forEach(p => { visits++; callback(p) })
    } }
    const counts = buildGlobalAuthorCounts(archive)
    for (const periodDays of [7, 30, days.length]) {
      for (const [, dayPosts] of days.slice(-periodDays)) {
        expect(pickTopAuthors(dayPosts, counts)).toEqual(legacyPickTopAuthors(dayPosts, posts))
      }
    }
    expect(visits).toBe(posts.length)
  })
})
