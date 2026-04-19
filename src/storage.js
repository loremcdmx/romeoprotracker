const DEFAULT_REPO = 'loremcdmx/romeoprotracker'
const CACHE_KEY = 'rpt_cache_v6'
const CACHE_TTL = 60 * 1000

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function getSameOriginBase() {
  if (typeof window === 'undefined') return null
  try {
    return trimTrailingSlash(new URL(`${import.meta.env.BASE_URL}data/`, window.location.origin).toString())
  } catch {
    return null
  }
}

export function getDataBases() {
  const bases = []
  const envBase = import.meta.env.VITE_DATA_BASE_URL
  const envRepo = import.meta.env.VITE_DATA_REPO || DEFAULT_REPO
  const sameOriginBase = getSameOriginBase()
  const rawBase = `https://raw.githubusercontent.com/${envRepo}/main/data`

  if (envBase) bases.push(trimTrailingSlash(envBase))
  if (sameOriginBase) bases.push(sameOriginBase)
  bases.push(trimTrailingSlash(rawBase))

  return [...new Set(bases.filter(Boolean))]
}

function withCacheBust(url) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${Date.now()}`
}

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw)
    if (Date.now() - cache.ts < CACHE_TTL) return cache
    return { ...cache, stale: true }
  } catch {
    return null
  }
}

function setCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      compact: payload.compact ?? null,
      posts: payload.posts ?? null,
      meta: payload.meta ?? {},
      source: payload.source ?? null,
    }))
  } catch {
    // Ignore storage quota/access issues.
  }
}

function getPayloadUpdatedAt(payload) {
  const value = payload?.meta?.lastUpdated
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function selectFreshestPayload(current, candidate) {
  if (!candidate) return current
  if (!current) return candidate

  const currentTs = getPayloadUpdatedAt(current)
  const candidateTs = getPayloadUpdatedAt(candidate)

  if (candidateTs > currentTs) return candidate
  if (candidateTs < currentTs) return current
  return current
}

export function expandPosts(compact) {
  const avatars = compact?.avatars || []
  const posts = compact?.posts || []
  const forumBase = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p='

  return posts.map((post) => ({
    id: post.i,
    author: post.a,
    timestamp: post.t,
    likes: post.l || 0,
    text: post.x || '',
    date: post.d || '',
    url: forumBase + post.i,
    avatar: post.v != null ? avatars[post.v] : null,
    rating: post.r || 0,
    msgCount: post.m || null,
    regData: post.g || null,
    images: post.p || [],
    videos: post.vd || [],
    brAfter: post.ba ?? null,
    brBefore: post.bb ?? null,
    sessionResult: post.sr ?? null,
    rooms: post.rm || null,
    translations: (post.te || post.ts) ? { en: post.te || null, es: post.ts || null } : null,
  }))
}

function inflateCachedPayload(cache) {
  const posts = cache.compact ? expandPosts(cache.compact) : (cache.posts || [])
  return { posts, meta: cache.meta || {}, source: cache.source || null, stale: Boolean(cache.stale) }
}

async function fetchJson(url) {
  const response = await fetch(withCacheBust(url), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  return response.json()
}

async function fetchFromBase(base) {
  let compact = null
  let posts = null

  const [metaResult, compactResult] = await Promise.allSettled([
    fetchJson(`${base}/meta.json`),
    fetchJson(`${base}/posts.min.json`),
  ])

  if (metaResult.status !== 'fulfilled') {
    throw metaResult.reason
  }

  const meta = metaResult.value

  if (compactResult.status === 'fulfilled') {
    compact = compactResult.value
  } else {
    posts = await fetchJson(`${base}/posts.json`)
  }

  return { compact, posts, meta, source: base }
}

export async function fetchPublicData() {
  const cached = getCache()
  const cachedPayload = cached ? inflateCachedPayload(cached) : null

  if (cachedPayload && !cachedPayload.stale) return cachedPayload

  let lastError = null
  let freshestNetworkPayload = null

  const results = await Promise.allSettled(
    getDataBases().map((base) => fetchFromBase(base))
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      freshestNetworkPayload = selectFreshestPayload(freshestNetworkPayload, result.value)
      continue
    }

    lastError = result.reason
  }

  const freshestPayload = selectFreshestPayload(freshestNetworkPayload, cachedPayload)

  if (freshestNetworkPayload && freshestPayload === freshestNetworkPayload) {
    setCache(freshestNetworkPayload)
    return inflateCachedPayload(freshestNetworkPayload)
  }

  if (cachedPayload) return cachedPayload

  throw lastError || new Error('Failed to load tracker data from every configured source')
}
