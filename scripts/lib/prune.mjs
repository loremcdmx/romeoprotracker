// Reconciliation of stored posts against a COMPLETE forum scan (--mode=full):
// which stored posts has the forum stopped listing, and may we drop them.
// Pure functions; scrape.mjs does the fetching and the writing.

// A single run may remove at most min(50, 1% of the stored posts) unless
// --prune-force is given. A broken or partially hidden scan therefore cannot
// wipe the archive; a handful of moderator removals pass.
export const PRUNE_MAX_COUNT = 50
export const PRUNE_MAX_SHARE = 0.01

export function pruneLimit(totalPosts) {
  return Math.min(PRUNE_MAX_COUNT, Math.floor(totalPosts * PRUNE_MAX_SHARE))
}

// posts      stored posts
// scrapedIds Set of post ids the complete scan saw
// isKept     (post) => true for posts that must never be auto-removed
//            (Romeo's own posts feed brHistory and the day counter)
// Only ids inside the scanned id range [lowest seen, highest seen] are judged:
// anything outside it was never in front of the scanner.
export function planPrune({ posts, scrapedIds, isKept = () => false }) {
  let lo = Infinity
  let hi = -Infinity
  for (const id of scrapedIds) {
    const n = Number(id)
    if (Number.isFinite(n)) { lo = Math.min(lo, n); hi = Math.max(hi, n) }
  }
  const missing = []
  const kept = []
  if (lo === Infinity) return { missing, kept, lo: null, hi: null }

  for (const post of posts) {
    const n = Number(post.id)
    if (!Number.isFinite(n) || n < lo || n > hi) continue
    if (scrapedIds.has(post.id)) continue
    if (isKept(post)) kept.push(post.id)
    else missing.push(post.id)
  }
  return { missing, kept, lo, hi }
}
