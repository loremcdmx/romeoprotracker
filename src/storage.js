import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'

const DEFAULT_REPO = 'loremcdmx/romeoprotracker'
const IS_TEST = import.meta.env.MODE === 'test'
const JSON_FETCH_TIMEOUT_MS = IS_TEST ? 300 : 6500
const SOURCE_SETTLE_MS = IS_TEST ? 0 : 1400

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

function delay(ms) {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms)
    id.unref?.()
  })
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
  const parse = (value) => {
    if (!value) return 0
    const ts = Date.parse(value)
    return Number.isFinite(ts) ? ts : 0
  }
  // postsChangedAt moves on likes/translation-only scraper runs, which leave
  // lastUpdated untouched — both must count as freshness.
  return Math.max(parse(payload?.meta?.lastUpdated), parse(payload?.meta?.postsChangedAt))
}

function getPayloadTrendSignature(payload) {
  const meta = payload?.meta || {}
  const brHistory = Array.isArray(meta.brHistory) ? meta.brHistory : []
  const last = brHistory[brHistory.length - 1] || {}
  return [
    meta.bankroll ?? '',
    meta.totalTournaments ?? '',
    meta.totalPosts ?? '',
    brHistory.length,
    last.id ?? '',
    last.timestamp ?? '',
    last.brBefore ?? '',
    last.brAfter ?? '',
    last.sessionResult ?? '',
    last.tournaments ?? '',
    last.totalTournaments ?? '',
  ].join('|')
}

function getPayloadTrendRank(payload) {
  const meta = payload?.meta || {}
  const brHistory = Array.isArray(meta.brHistory) ? meta.brHistory : []
  const last = brHistory[brHistory.length - 1] || {}
  return {
    historyLength:brHistory.length,
    lastTimestamp:Number(last.timestamp || 0),
    totalTournaments:Number(meta.totalTournaments ?? last.totalTournaments ?? 0),
    totalPosts:Number(meta.totalPosts || 0),
  }
}

function comparePayloadTrendRank(candidate, current) {
  const next = getPayloadTrendRank(candidate)
  const prev = getPayloadTrendRank(current)
  for (const key of ['historyLength', 'lastTimestamp', 'totalTournaments', 'totalPosts']) {
    if (next[key] > prev[key]) return 1
    if (next[key] < prev[key]) return -1
  }
  return 0
}

function hasPayloadAdvanced(candidate, current) {
  if (!candidate) return false
  if (!current) return true

  const currentTs = getPayloadUpdatedAt(current)
  const candidateTs = getPayloadUpdatedAt(candidate)

  if (candidateTs > currentTs) return true
  if (candidateTs < currentTs) return false

  const trendRank = comparePayloadTrendRank(candidate, current)
  if (trendRank > 0) return true
  if (trendRank < 0) return false

  if (getPayloadTrendSignature(candidate) === getPayloadTrendSignature(current)) return false
  return !(candidate.stale && !current.stale)
}

function selectFreshestPayload(current, candidate) {
  if (!candidate) return current
  if (!current) return candidate

  return hasPayloadAdvanced(candidate, current) ? candidate : current
}

function normalizeAvatarUrl(value) {
  if (!value) return null
  const src = String(value).trim()
  if (!src) return null
  if (src.startsWith('//')) return `https:${src}`
  if (/^https?:\/\/forum\.gipsyteam\.ru\/img\//i.test(src)) {
    return src.replace(/^https?:\/\/forum\.gipsyteam\.ru/i, 'https://forum.gipsyteam.com')
  }
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('/upload/')) return `https://www.gipsyteam.ru${src}`
  if (src.startsWith('/img/')) return `https://forum.gipsyteam.com${src}`
  if (src.startsWith('/')) return `https://forum.gipsyteam.ru${src}`
  return src
}

function normalizePostAvatar(post) {
  if (!post || typeof post !== 'object') return post
  if (!Object.prototype.hasOwnProperty.call(post, 'avatar')) return post
  return { ...post, avatar: normalizeAvatarUrl(post.avatar) }
}

export function expandPosts(compact) {
  const avatars = (compact?.avatars || []).map(normalizeAvatarUrl)
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
  const posts = cache.compact ? expandPosts(cache.compact) : (cache.posts || []).map(normalizePostAvatar)
  return {
    posts,
    meta: cache.meta || {},
    source: cache.source || null,
    stale: Boolean(cache.stale),
  }
}

async function fetchJson(url, timeoutMs = JSON_FETCH_TIMEOUT_MS, externalSignal = null) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  if (externalSignal) {
    if (externalSignal.aborted) controller?.abort()
    else externalSignal.addEventListener?.('abort', () => controller?.abort(), { once: true })
  }
  let timeoutId = null
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort()
      reject(new Error(`Timeout loading ${url}`))
    }, timeoutMs)
    timeoutId.unref?.()
  })

  const response = await Promise.race([
    fetch(url, { cache: 'no-cache', signal: controller?.signal }),
    timeout,
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  return response.json()
}

async function fetchFromBase(base, signal = null) {
  let compact = null
  let posts = null

  const [metaResult, compactResult] = await Promise.allSettled([
    fetchJson(`${base}/meta.json`, JSON_FETCH_TIMEOUT_MS, signal),
    fetchJson(`${base}/posts.min.json`, JSON_FETCH_TIMEOUT_MS, signal),
  ])

  if (metaResult.status !== 'fulfilled') {
    throw metaResult.reason
  }

  const meta = metaResult.value

  if (compactResult.status === 'fulfilled') {
    compact = compactResult.value
  } else {
    posts = await fetchJson(`${base}/posts.json`, JSON_FETCH_TIMEOUT_MS, signal)
  }

  return { compact, posts, meta, source: base }
}

async function collectNetworkPayloads() {
  const bases = getDataBases()
  const controllers = bases.map(() => (typeof AbortController === 'undefined' ? null : new AbortController()))
  const pending = bases.map((base, i) => (
    fetchFromBase(base, controllers[i]?.signal || null)
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }))
  ))
  const settled = []

  while (pending.length) {
    const next = await Promise.race(
      pending.map((promise, index) => promise.then((result) => ({ ...result, index })))
    )
    pending.splice(next.index, 1)
    settled.push(next)

    if (next.status === 'fulfilled') {
      const extra = await Promise.race([
        Promise.all(pending),
        delay(SOURCE_SETTLE_MS).then(() => []),
      ])
      settled.push(...extra)
      // A winner is in hand — losing bases would each finish a multi-MB
      // download for nothing (cold load paid ~2.9MB instead of ~1.5MB).
      controllers.forEach((c) => c?.abort())
      break
    }
  }

  return settled
}

// Cheap freshness probe: pull only the small meta.json from every base and keep
// the freshest. Used to decide whether the heavy posts.min.json actually needs
// to be downloaded again.
async function probeFreshestMeta() {
  const bases = getDataBases()
  const results = await Promise.allSettled(bases.map(async (base) => {
    const meta = await fetchJson(`${base}/meta.json`)
    return { meta, source: base }
  }))

  let freshest = null
  for (const result of results) {
    if (result.status === 'fulfilled') {
      freshest = selectFreshestPayload(freshest, result.value)
    }
  }

  if (!freshest) return null
  return { meta: freshest.meta }
}

export async function fetchPublicData() {
  const cached = getCache()
  const cachedPayload = cached ? inflateCachedPayload(cached) : null

  if (cachedPayload && !cachedPayload.stale) return cachedPayload

  // Stale cache but posts already in hand: probe the tiny meta first and reuse
  // the cached posts when nothing changed upstream. This is the common polling
  // case, and it avoids re-downloading the multi-MB posts payload every cycle.
  if (cached && (cached.compact || cached.posts) && cached.meta) {
    const probe = await probeFreshestMeta().catch(() => null)
    if (probe && !hasPayloadAdvanced(probe, { meta: cached.meta, stale: true })) {
      const refreshed = {
        compact: cached.compact ?? null,
        posts: cached.posts ?? null,
        meta: cached.meta,
        source: cached.source ?? null,
      }
      setCache(refreshed)
      return inflateCachedPayload(refreshed)
    }
  }

  let lastError = null
  let freshestNetworkPayload = null

  const results = await collectNetworkPayloads()

  for (const result of results) {
    if (result.status === 'fulfilled') {
      freshestNetworkPayload = selectFreshestPayload(freshestNetworkPayload, result.value)
      continue
    }

    lastError = result.reason
  }

  const freshestPayload = selectFreshestPayload(freshestNetworkPayload, cachedPayload)

  if (freshestNetworkPayload && freshestPayload === freshestNetworkPayload) {
    setCache(freshestPayload)
    return inflateCachedPayload(freshestPayload)
  }

  if (cachedPayload) return freshestPayload || cachedPayload

  throw lastError || new Error('Failed to load tracker data from every configured source')
}
