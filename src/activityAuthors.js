import { ROMEO_RE, warsawDayKey, stripQuoteTags } from './utils.js'
import { isIgnoredAuthor } from './ignoredAuthors.js'

// The rarity bonus is based on the entire archive, independent of the chart
// period. Build this once when posts change, then reuse it for each day.
export function buildGlobalAuthorCounts(posts) {
  const counts = new Map()
  posts?.forEach(post => {
    if (post.author) counts.set(post.author, (counts.get(post.author) || 0) + 1)
  })
  return counts
}

export function pickTopAuthors(dayPosts, globalCounts, ignored) {
  const MIN_RATING = 15000
  const VIP_RATING = 25000
  const byAuthor = Object.create(null)
  dayPosts.forEach(post => {
    if (!post.author || ROMEO_RE.test(post.author) || isIgnoredAuthor(ignored, post.author)) return
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

// ── Calendar windows for the activity chart ─────────────────────────────────
// Day keys are Warsaw calendar days ("2026-10-25"). Stepping goes through pure
// Y-M-D arithmetic in UTC, never "midnight + 86400 s", so the 25-hour and
// 23-hour DST days each stay exactly one step.
const pad2 = n => String(n).padStart(2, '0')

export function shiftDayKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

// A timestamp (UTC seconds) that falls on the given Warsaw calendar day at any
// DST offset: noon UTC is 13:00 or 14:00 in Warsaw.
export function dayKeyTimestamp(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12) / 1000
}

export const ACTIVITY_PERIOD_DAYS = { week: 7, month: 30, all: null }

// byDate: { 'YYYY-MM-DD': { count, posts } } holding only days that have posts.
// Returns [[key, { count, posts }], ...] over consecutive calendar days, with a
// zero-count entry for every quiet day. week = today + 6 before, month = today
// + 29 before, all = first post day .. today. A post dated after "today"
// (clock skew) extends the window instead of being dropped.
export function buildActivityWindow(byDate, period, nowSec) {
  const keys = Object.keys(byDate).sort()
  if (!keys.length) return []
  const today = warsawDayKey(nowSec) || keys.at(-1)
  const end = keys.at(-1) > today ? keys.at(-1) : today
  const span = ACTIVITY_PERIOD_DAYS[period]
  const start = span ? shiftDayKey(end, -(span - 1)) : (keys[0] < end ? keys[0] : end)
  const out = []
  for (let k = start, guard = 0; k <= end && guard < 20000; k = shiftDayKey(k, 1), guard++) {
    out.push([k, byDate[k] || { count: 0, posts: [] }])
  }
  return out
}

// One preview line for both top-post lists. Quotes are dropped, runs of
// whitespace collapse ("Day 51:   40:" -> "Day 51: 40:"), and an image-only
// post (no quote) reads "📷 <imageLabel>". A quote-only post returns ''.
export function topPostPreview(post, imageLabel) {
  const clean = stripQuoteTags(post?.text).replace(/\s+/g, ' ').trim()
  if (clean) return clean
  const hasQuote = (post?.text || '').includes('[QUOTE]')
  return !hasQuote && post?.images?.[0] ? `📷 ${imageLabel}` : ''
}
