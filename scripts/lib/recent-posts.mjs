export const RECENT_POST_LIMIT = 300

// The recent feed is a view of the authoritative compact dataset, not a second
// source of statistics: keep the complete marathon metadata/history unchanged.
export function buildRecentPosts(compact, meta, limit = RECENT_POST_LIMIT) {
  if (!Array.isArray(compact?.posts) || !Array.isArray(compact?.avatars)) {
    throw new TypeError('Recent posts require compact posts and avatars arrays')
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new TypeError('Recent posts require the complete metadata object')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > RECENT_POST_LIMIT) {
    throw new RangeError(`Recent post limit must be between 1 and ${RECENT_POST_LIMIT}`)
  }

  const selected = compact.posts.map((post, index) => {
    if (!Number.isFinite(post?.t)) {
      throw new TypeError(`Invalid timestamp for compact post ${post?.i ?? index}`)
    }
    return { post, index }
  }).sort((a, b) => a.post.t - b.post.t || a.index - b.index).slice(-limit)

  const avatars = []
  const avatarIndexes = new Map()
  const posts = selected.map(({ post }) => {
    const recentPost = { ...post }
    if (post.v != null) {
      if (!Number.isInteger(post.v) || post.v < 0 || post.v >= compact.avatars.length) {
        throw new RangeError(`Invalid avatar index for compact post ${post.i}`)
      }
      if (!avatarIndexes.has(post.v)) {
        avatarIndexes.set(post.v, avatars.length)
        avatars.push(compact.avatars[post.v])
      }
      recentPost.v = avatarIndexes.get(post.v)
    }
    return recentPost
  })

  return {
    avatars,
    posts,
    meta,
    coverage: {
      mode: 'recent',
      limit,
      loadedPosts: posts.length,
      totalPosts: compact.posts.length,
    },
  }
}
