// storage.js — fetch compact data with localStorage caching
const REPO = 'loremcdmx/romeoprotracker'
// jsDelivr mirrors GitHub via a global edge CDN with brotli — much faster
// than raw.githubusercontent.com on mobile, and free. @main always resolves
// to the latest commit on the main branch.
const BASE = `https://cdn.jsdelivr.net/gh/${REPO}@main/data`
const CACHE_KEY = 'rpt_cache_v4'
const CACHE_TTL = 60 * 1000 // 1 min — don't refetch within this window

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (Date.now() - c.ts < CACHE_TTL) return c
    return null // expired
  } catch { return null }
}

function setCache(posts, meta) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), posts, meta }))
  } catch { /* quota exceeded — ignore */ }
}

// Expand compact format back to full post objects
function expandPosts(compact) {
  const { avatars, posts } = compact
  const FORUM_BASE = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p='
  return posts.map(p => {
    const o = {
      id: p.i,
      author: p.a,
      timestamp: p.t,
      likes: p.l || 0,
      text: p.x || '',
      date: p.d || '',
      url: FORUM_BASE + p.i,
      avatar: p.v != null ? avatars[p.v] : null,
      rating: p.r || 0,
      msgCount: p.m || null,
      regData: p.g || null,
      images: p.p || [],
      videos: p.vd || [],
      brAfter: p.ba ?? null,
      brBefore: p.bb ?? null,
      sessionResult: p.sr ?? null,
      rooms: p.rm || null,
    }
    return o
  })
}

export async function fetchPublicData() {
  // Return cache if fresh
  const cached = getCache()
  if (cached) return { posts: cached.posts, meta: cached.meta }

  const [postsRes, metaRes] = await Promise.all([
    fetch(`${BASE}/posts.min.json?t=${Date.now()}`),
    fetch(`${BASE}/meta.json?t=${Date.now()}`),
  ])

  let posts
  if (postsRes.ok) {
    const compact = await postsRes.json()
    posts = expandPosts(compact)
  } else {
    // Fallback to full posts.json
    const fullRes = await fetch(`${BASE}/posts.json?t=${Date.now()}`)
    posts = fullRes.ok ? await fullRes.json() : []
  }

  const meta = metaRes.ok ? await metaRes.json() : {}
  setCache(posts, meta)
  return { posts, meta }
}
