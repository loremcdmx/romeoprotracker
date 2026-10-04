import { ROMEO_RE } from './utils.js'

// The rarity bonus is based on the entire archive, independent of the chart
// period. Build this once when posts change, then reuse it for each day.
export function buildGlobalAuthorCounts(posts) {
  const counts = new Map()
  posts?.forEach(post => {
    if (post.author) counts.set(post.author, (counts.get(post.author) || 0) + 1)
  })
  return counts
}

export function pickTopAuthors(dayPosts, globalCounts) {
  const MIN_RATING = 15000
  const VIP_RATING = 25000
  const byAuthor = Object.create(null)
  dayPosts.forEach(post => {
    if (!post.author || ROMEO_RE.test(post.author)) return
    const name = post.author
    if (!byAuthor[name]) byAuthor[name] = { rating: post.rating || 0, bestLikes: 0, count: 0 }
    const author = byAuthor[name]
    author.count++
    if ((post.likes || 0) > author.bestLikes) author.bestLikes = post.likes || 0
    if ((post.rating || 0) > author.rating) author.rating = post.rating || 0
  })
  return Object.entries(byAuthor)
    .filter(([, { rating }]) => rating >= MIN_RATING)
    .map(([name, { rating, bestLikes, count }]) => {
      const gc = globalCounts?.get(name) || count
      const uniqueBonus = gc <= 3 ? 10 : gc <= 10 ? 4 : 0
      const authority = Math.log10(rating + 1) * 20
      const likeScore = (bestLikes || 0) * 2
      const vipBoost = (rating >= VIP_RATING && bestLikes > 5) ? 80 : 0
      const score = authority + likeScore + vipBoost + uniqueBonus
      return { name, rating, score, bestLikes }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
