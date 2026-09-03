import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'

const DEFAULT_REPO = 'loremcdmx/romeoprotracker'
const IS_TEST = import.meta.env.MODE === 'test'
const JSON_FETCH_TIMEOUT_MS = IS_TEST ? 300 : 6500
const JSON_BODY_TIMEOUT_MS = IS_TEST ? 900 : 30000
const SOURCE_SETTLE_MS = IS_TEST ? 0 : 1400
const RECENT_CACHE_KEY = `${CACHE_KEY}_recent`
let publicDataRequest = null
let recentDataRequest = null
const guardedFullRequests = new Map()

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

function getCache(key = CACHE_KEY) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const cache = JSON.parse(raw)
    if (Date.now() - cache.ts < CACHE_TTL) return cache
    return { ...cache, stale: true }
  } catch {
    return null
  }
}

function setCache(payload, key = CACHE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      compact: payload.compact ?? null,
      posts: payload.posts ?? null,
      meta: payload.meta ?? {},
      source: payload.source ?? null,
      coverage: payload.coverage ?? null,
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

export function isPayloadAtLeastAsFresh(payload, minMeta) {
  return Boolean(payload) && (!minMeta || !hasPayloadAdvanced({ meta: minMeta }, payload))
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
  const coverage = cache.coverage?.mode === 'recent'
    ? { ...cache.coverage, loadedPosts: posts.length }
    : { mode: 'full', loadedPosts: posts.length, totalPosts: cache.meta?.totalPosts || posts.length }
  return {
    posts,
    meta: cache.meta || {},
    source: cache.source || null,
    stale: Boolean(cache.stale),
    coverage,
  }
}

async function fetchJson(url, timeoutMs = JSON_FETCH_TIMEOUT_MS, externalSignal = null, bodyTimeoutMs = timeoutMs) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  let reader = null
  let onAbort = null
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      controller?.abort()
      const error = new Error(`Aborted loading ${url}`)
      error.name = 'AbortError'
      reject(error)
    }
    if (externalSignal?.aborted) onAbort()
    else externalSignal?.addEventListener?.('abort', onAbort, { once: true })
  })
  let timeoutId = null
  let rejectTimeout = null
  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject
  })
  const resetTimeout = (ms = timeoutMs) => {
    if (timeoutId !== null) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      controller?.abort()
      const error = new Error(`Timeout loading ${url}`)
      error.code = 'FETCH_TIMEOUT'
      rejectTimeout(error)
    }, ms)
    timeoutId.unref?.()
  }
  resetTimeout()

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { cache: 'no-cache', signal: controller?.signal })
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText} for ${url}`)
        }
        if (response.body?.getReader) {
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          let text = ''
          const allowProgress = bodyTimeoutMs > timeoutMs
          if (allowProgress) resetTimeout()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            // Bound inactivity, not total download time: a healthy slow link
            // can take much longer than 6.5 seconds for the complete posts file.
            if (allowProgress) resetTimeout()
            text += decoder.decode(value, { stream: true })
          }
          text += decoder.decode()
          return JSON.parse(text)
        }
        // Test doubles and older browsers may not expose a readable stream.
        if (bodyTimeoutMs > timeoutMs) resetTimeout(bodyTimeoutMs)
        return response.json()
      })(),
      timeout,
      aborted,
    ])
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
    externalSignal?.removeEventListener?.('abort', onAbort)
    try { reader?.releaseLock?.() } catch { /* A cancelled read can retain its lock. */ }
  }
}

async function fetchFromSource({ source, meta }) {
  try {
    const compact = await fetchJson(`${source}/posts.min.json`, JSON_FETCH_TIMEOUT_MS, null, JSON_BODY_TIMEOUT_MS)
    return { compact, posts: null, meta, source }
  } catch { /* Preserve the full-file fallback on the same, freshest source. */ }
  const posts = await fetchJson(`${source}/posts.json`, JSON_FETCH_TIMEOUT_MS, null, JSON_BODY_TIMEOUT_MS)
  return { compact: null, posts, meta, source }
}

// Keep metadata discovery alive while the selected posts body is downloading.
// A slower mirror may be newer than the deployed snapshot; aborting it after
// the initial grace period would silently pin visitors to old deployed data.
function discoverPayloads(loadSource, bases = getDataBases()) {
  const controllers = bases.map(() => (typeof AbortController === 'undefined' ? null : new AbortController()))
  const results = []
  let resolveFirstSuccess = null
  const firstSuccess = new Promise((resolve) => { resolveFirstSuccess = resolve })
  const requests = bases.map((base, i) => (
    loadSource(base, controllers[i]?.signal || null)
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }))
      .then((result) => {
        results.push(result)
        if (result.status === 'fulfilled') resolveFirstSuccess()
        return result
      })
  ))
  const complete = Promise.all(requests).then(() => { resolveFirstSuccess() })

  async function settle() {
    if (results.length === bases.length) return
    let timer = null
    try {
      await Promise.race([
        complete,
        new Promise((resolve) => {
          timer = setTimeout(resolve, SOURCE_SETTLE_MS)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  return {
    results,
    complete,
    settle,
    async initial() {
      await firstSuccess
      await settle()
    },
    abort() { controllers.forEach((controller) => controller?.abort()) },
  }
}

function discoverSourceMetadata() {
  return discoverPayloads(async (source, signal) => ({
    meta: await fetchJson(`${source}/meta.json`, JSON_FETCH_TIMEOUT_MS, signal),
    source,
  }))
}

function rankSources(results) {
  const candidates = []
  for (const result of results) {
    if (result.status === 'fulfilled') candidates.push(result.value)
  }
  const ranked = []
  while (candidates.length) {
    const freshest = candidates.reduce(selectFreshestPayload, null)
    ranked.push(freshest)
    candidates.splice(candidates.indexOf(freshest), 1)
  }
  return ranked
}

async function loadPublicData({ refresh = false, minMeta = null } = {}) {
  const stored = getCache()
  // An explicit upgrade must not replace a newer recent snapshot with an older
  // full cache, even while that cache's ordinary TTL is still valid.
  const cached = stored && isPayloadAtLeastAsFresh(stored, minMeta) ? stored : null
  const cachedPayload = cached ? inflateCachedPayload(cached) : null

  if (cachedPayload && !cachedPayload.stale && !refresh) return cachedPayload

  const discovery = discoverSourceMetadata()
  const eligibleByVersion = () => rankSources(discovery.results).filter(source => isPayloadAtLeastAsFresh(source, minMeta))
  let lastError = null
  let networkPayload = null
  const attempted = new Set()
  try {
    await discovery.initial()

    const initialSource = eligibleByVersion()[0]
    if (cached && (cached.compact || cached.posts) && cached.meta
      && (!initialSource || !hasPayloadAdvanced(initialSource, cachedPayload))) {
      // An unchanged fast snapshot does not prove the cache is current. Honor
      // the full metadata timeout before refreshing its TTL, as the old probe
      // did, so a slow newer raw source cannot be excluded on every poll.
      await discovery.complete
      const freshestSource = eligibleByVersion()[0]
      if (freshestSource && !hasPayloadAdvanced(freshestSource, cachedPayload)) {
        setCache(cached)
        cachedPayload.stale = false
        return cachedPayload
      }
    }

    while (true) {
      const current = selectFreshestPayload(networkPayload, cachedPayload)
      const eligibleSources = () => eligibleByVersion().filter(candidate =>
        !current || hasPayloadAdvanced(candidate, current))
      let source = eligibleSources().find(candidate => !attempted.has(candidate.source))

      if (!source && !networkPayload) {
        // If every known source failed, a pending mirror still gets its original
        // metadata timeout rather than being discarded or requested twice.
        await discovery.complete
        source = eligibleSources().find(candidate => !attempted.has(candidate.source))
      }
      if (!source) break

      attempted.add(source.source)
      try {
        const payload = await fetchFromSource(source)
        networkPayload = selectFreshestPayload(networkPayload, payload)
        // Match the original freshness window: include slower metadata received
        // while the full body downloaded, plus a bounded grace after success.
        // Equal/older metadata never causes a second heavy posts download.
        await discovery.settle()
      } catch (error) {
        lastError = error
      }
    }

    if (networkPayload && selectFreshestPayload(networkPayload, cachedPayload) === networkPayload) {
      setCache(networkPayload)
      return inflateCachedPayload(networkPayload)
    }
    if (cachedPayload) return cachedPayload

    for (const result of discovery.results) {
      if (result.status === 'rejected') lastError = result.reason
    }
    throw lastError || new Error(minMeta
      ? 'Full history is older than the displayed recent snapshot'
      : 'Failed to load tracker data from every configured source')
  } finally {
    discovery.abort()
  }
}

function normalizeRecentSnapshot(snapshot, source) {
  const coverage = snapshot?.coverage
  if (!Array.isArray(snapshot?.posts) || !Array.isArray(snapshot?.avatars)
    || !snapshot.meta || typeof snapshot.meta !== 'object' || Array.isArray(snapshot.meta)
    || coverage?.mode !== 'recent' || coverage.limit !== 300
    || coverage.loadedPosts !== snapshot.posts.length || snapshot.posts.length > 300
    || !Number.isInteger(coverage.totalPosts) || coverage.totalPosts < snapshot.posts.length) {
    throw new Error(`Invalid recent posts snapshot from ${source}`)
  }
  return {
    compact: { avatars: snapshot.avatars, posts: snapshot.posts },
    posts: null,
    meta: snapshot.meta,
    coverage: { mode: 'recent', limit: 300, loadedPosts: snapshot.posts.length, totalPosts: coverage.totalPosts },
    source,
  }
}

async function loadRecentData() {
  const cache = getCache(RECENT_CACHE_KEY)
  let cached = null
  if (cache) {
    try {
      cached = {
        ...normalizeRecentSnapshot({ ...cache.compact, meta: cache.meta, coverage: cache.coverage }, cache.source),
        stale: Boolean(cache.stale),
      }
    } catch { /* Ignore a malformed recent cache without opening the full cache. */ }
  }
  const cachedPayload = cached ? inflateCachedPayload(cached) : null
  if (cachedPayload && !cachedPayload.stale) return cachedPayload

  // Each small snapshot includes the full chart metadata. Recent mode never
  // requests separate metadata or either full-history posts representation.
  const discovery = discoverPayloads(async (source, signal) => normalizeRecentSnapshot(
    await fetchJson(`${source}/posts.recent.min.json`, JSON_FETCH_TIMEOUT_MS, signal, JSON_BODY_TIMEOUT_MS), source,
  ))
  try {
    await discovery.initial()
    let networkPayload = rankSources(discovery.results)[0]
    if (cached && (!networkPayload || !hasPayloadAdvanced(networkPayload, cached))) {
      // As with full mode, don't renew an old cache from just one fast but
      // unchanged deployed snapshot while another source may still be newer.
      await discovery.complete
      networkPayload = rankSources(discovery.results)[0]
      if (networkPayload && !hasPayloadAdvanced(networkPayload, cached)) {
        setCache(cached, RECENT_CACHE_KEY)
        cachedPayload.stale = false
        return cachedPayload
      }
    }
    if (networkPayload && selectFreshestPayload(networkPayload, cached) === networkPayload) {
      setCache(networkPayload, RECENT_CACHE_KEY)
      return inflateCachedPayload(networkPayload)
    }
    if (cachedPayload) return cachedPayload
    const failed = discovery.results.filter(result => result.status === 'rejected')
    throw failed[failed.length - 1]?.reason || new Error('Failed to load recent tracker data from every configured source')
  } finally {
    discovery.abort()
  }
}

export function fetchPublicData({ mode = 'full', refresh = false, minMeta = null } = {}) {
  if (mode === 'recent') {
    if (!recentDataRequest) {
      recentDataRequest = loadRecentData().finally(() => {
        recentDataRequest = null
      })
    }
    return recentDataRequest
  }
  if (refresh || minMeta) {
    // A guarded upgrade must never join an ordinary request that can resolve
    // immediately from an older fresh cache. Equivalent guarded calls can join.
    const floor = minMeta ? { meta: minMeta } : null
    const key = `${Boolean(refresh)}|${getPayloadUpdatedAt(floor)}|${getPayloadTrendSignature(floor)}`
    if (!guardedFullRequests.has(key)) {
      const request = loadPublicData({ refresh, minMeta }).finally(() => guardedFullRequests.delete(key))
      guardedFullRequests.set(key, request)
    }
    return guardedFullRequests.get(key)
  }
  if (!publicDataRequest) {
    publicDataRequest = loadPublicData().finally(() => {
      publicDataRequest = null
    })
  }
  return publicDataRequest
}
