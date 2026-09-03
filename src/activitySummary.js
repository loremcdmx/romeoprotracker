import { ROMEO_RE, warsawDayKey } from './utils.js'

export const ACTIVITY_PERIOD_DAYS = { week: 7, month: 30, all: null }

// Keep the complete grouping independent from the selected period. Switching
// tabs then only slices this array, without formatting every post date again.
export function groupActivityDays(posts) {
  const byDate = new Map()
  for (const post of posts) {
    if (!post.timestamp) continue
    const key = warsawDayKey(post.timestamp)
    if (!key) continue
    if (!byDate.has(key)) byDate.set(key, { count: 0, posts: [] })
    const day = byDate.get(key)
    day.count++
    day.posts.push(post)
  }
  return [...byDate].sort((a, b) => a[0] > b[0] ? 1 : -1)
}

export function selectActivityDays(days, period) {
  const limit = ACTIVITY_PERIOD_DAYS[period]
  return limit ? days.slice(-limit) : days
}

// Author rarity is measured across the whole feed, not only the displayed
// dates. Compute it once instead of rescanning every post for every tooltip.
export function countActivityAuthors(posts) {
  const counts = new Map()
  for (const post of posts) {
    if (!post.author) continue
    const name = String(post.author)
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return counts
}

export function pickTopActivityAuthors(dayPosts, authorCounts) {
  const MIN_RATING = 15000
  const VIP_RATING = 25000
  const byAuthor = Object.create(null)
  for (const post of dayPosts) {
    if (!post.author || ROMEO_RE.test(post.author)) continue
    const name = post.author
    if (!byAuthor[name]) byAuthor[name] = { rating: post.rating || 0, bestLikes: 0, count: 0 }
    const author = byAuthor[name]
    author.count++
    if ((post.likes || 0) > author.bestLikes) author.bestLikes = post.likes || 0
    if ((post.rating || 0) > author.rating) author.rating = post.rating || 0
  }
  return Object.entries(byAuthor)
    .filter(([, { rating }]) => rating >= MIN_RATING)
    .map(([name, { rating, bestLikes, count }]) => {
      const globalCount = authorCounts.get(name) || count
      const uniqueBonus = globalCount <= 3 ? 10 : globalCount <= 10 ? 4 : 0
      const authority = Math.log10(rating + 1) * 20
      const likeScore = (bestLikes || 0) * 2
      const vipBoost = rating >= VIP_RATING && bestLikes > 5 ? 80 : 0
      return { name, rating, score: authority + likeScore + vipBoost + uniqueBonus, bestLikes }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
