import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'

const DEFAULT_REPO = 'loremcdmx/romeoprotracker'
const IS_TEST = import.meta.env.MODE === 'test'
const JSON_FETCH_TIMEOUT_MS = IS_TEST ? 300 : 6500
// Budget for reading the body once the response headers are in. The multi-MB
// posts payload needs far longer than the headers do on a slow link, but a body
// that stops arriving must still end in a timeout instead of hanging forever.
const HEAVY_BODY_TIMEOUT_MS = IS_TEST ? 300 : 30000
const SOURCE_SETTLE_MS = IS_TEST ? 0 : 1400
// A source whose meta.json is newer than the winner's is awaited past the
// settle window, but only up to this long after the load started.
const FRESHER_SOURCE_WAIT_MS = IS_TEST ? 300 : 8000
// A cache stamped slightly in the future (clock stepped back) still counts as
// fresh; a larger gap means the clock that wrote it was wrong.
const CLOCK_SKEW_TOLERANCE_MS = 5000

// Keep one decoded snapshot, keyed by the exact persisted value so another
// tab replacing/clearing the cache is still observed on the next read.
let memoryCache = null
let inFlight = null

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
  let raw
  try {
    raw = localStorage.getItem(CACHE_KEY)
  } catch {
    // Private/storage-blocked browsers can still reuse this tab's snapshot.
    raw = memoryCache?.raw ?? null
  }
  if (!memoryCache || memoryCache.raw !== raw) {
    if (!raw) {
      memoryCache = null
      return null
    }
    try {
      const record = JSON.parse(raw)
      // Valid JSON of the wrong shape ('123', 'true', '"x"', 'null', '[]') must
      // read as "no cache", not throw on every load.
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        memoryCache = null
        return null
      }
      memoryCache = { raw, record, validatedAt: record.ts, payload: null }
    } catch {
      memoryCache = null
      return null
    }
  }
  const cache = memoryCache.record
  // A negative age (record stamped by a clock that was ahead) must not look
  // fresh: it would suppress every probe and poll until the clock caught up.
  const age = Date.now() - memoryCache.validatedAt
  cache.stale = !(age >= -CLOCK_SKEW_TOLERANCE_MS && age < CACHE_TTL)
  return cache
}

function setCache(payload) {
  const record = {
    ts: Date.now(),
    compact: payload.compact ?? null,
    posts: payload.posts ?? null,
    meta: payload.meta ?? {},
    source: payload.source ?? null,
  }
  let raw = memoryCache?.raw ?? null
  try {
    const serialized = JSON.stringify(record)
    localStorage.setItem(CACHE_KEY, serialized)
    raw = serialized
  } catch {
    // Multi-MB payloads can exceed storage quota. Preserve the memory cache,
    // tied to the previous persisted value, even when this write fails.
  }
  memoryCache = { raw, record, validatedAt: record.ts, payload: null }
  return record
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

  if (hasPayloadAdvanced(candidate, current)) return candidate

  // Content tie (neither side advances the other, e.g. a stale same-origin
  // snapshot next to raw GitHub with the same posts): without a tie-break the
  // first source to settle wins, so the footer's "scraper ran" time could be
  // older than what another source already reports. The heartbeat is only ever
  // a tie-break here, never "advanced" content (that would re-download the
  // posts on every scraper run, see hasPayloadAdvanced/inflateWithHeartbeat).
  if (!hasPayloadAdvanced(current, candidate)
    && parseTimestamp(candidate.meta?.lastScrapeRun) > parseTimestamp(current.meta?.lastScrapeRun)) {
    return candidate
  }
  return current
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
  const snapshot = memoryCache?.record === cache ? memoryCache : null
  if (!snapshot?.payload) {
    const payload = {
      posts: cache.compact ? expandPosts(cache.compact) : (cache.posts || []).map((post) => ({ ...normalizePostAvatar(post) })),
      // The hook enriches posts and replaces brHistory with its deduplicated
      // version. Keep the source meta intact for subsequent freshness probes.
      meta: { ...(cache.meta || {}) },
      source: cache.source || null,
    }
    if (snapshot) snapshot.payload = payload
    else return { ...payload, stale: Boolean(cache.stale) }
  }
  return {
    ...snapshot.payload,
    source: cache.source || null,
    stale: Boolean(cache.stale),
  }
}

async function fetchJson(url, timeoutMs = JSON_FETCH_TIMEOUT_MS, externalSignal = null, bodyTimeoutMs = timeoutMs) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  if (externalSignal) {
    if (externalSignal.aborted) controller?.abort()
    else externalSignal.addEventListener?.('abort', () => controller?.abort(), { once: true })
  }
  let timeoutId = null
  let fail = null
  const timeout = new Promise((_, reject) => { fail = reject })
  const arm = (ms) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      controller?.abort()
      fail(new Error(`Timeout loading ${url}`))
    }, ms)
    timeoutId.unref?.()
  }

  // The timer stays armed until the body is parsed: a connection that sends
  // headers and then stalls would otherwise leave this promise (and the shared
  // in-flight load behind it) pending forever.
  arm(timeoutMs)
  const load = (async () => {
    const response = await fetch(url, { cache: 'no-cache', signal: controller?.signal })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`)
    }
    arm(bodyTimeoutMs)
    return response.json()
  })()
  // When the timeout wins, the aborted request rejects later with nobody left
  // to handle it.
  load.catch(() => {})

  try {
    return await Promise.race([load, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchFromBase(base, signal = null, onMeta = null) {
  let compact = null
  let posts = null

  // meta.json is small and lands long before the multi-MB posts payload; let
  // the caller see it early to know which source is the fresher one.
  const metaRequest = fetchJson(`${base}/meta.json`, JSON_FETCH_TIMEOUT_MS, signal).then((value) => {
    onMeta?.(value)
    return value
  })
  const compactRequest = fetchJson(`${base}/posts.min.json`, JSON_FETCH_TIMEOUT_MS, signal, HEAVY_BODY_TIMEOUT_MS)
  // If meta fails the posts are not needed, and their outcome is never read.
  compactRequest.catch(() => {})

  const meta = await metaRequest

  try {
    compact = await compactRequest
  } catch {
    posts = await fetchJson(`${base}/posts.json`, JSON_FETCH_TIMEOUT_MS, signal, HEAVY_BODY_TIMEOUT_MS)
  }

  return { compact, posts, meta, source: base }
}

function parseTimestamp(value) {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

// Cancellable timer promise: a wait that turned out not to be needed leaves
// nothing pending behind it.
function startTimer(ms) {
  let id = null
  const promise = new Promise((resolve) => {
    id = setTimeout(resolve, ms)
    id.unref?.()
  })
  return { promise, cancel: () => clearTimeout(id) }
}

async function collectNetworkPayloads() {
  const bases = getDataBases()
  const controllers = bases.map(() => (typeof AbortController === 'undefined' ? null : new AbortController()))
  // meta.json of each base the moment it is known, long before its posts land.
  const knownMeta = bases.map(() => null)
  const results = bases.map(() => null)
  // In completion order: on a freshness tie the first source to settle wins.
  const settled = []
  const tasks = bases.map((base, i) => (
    fetchFromBase(base, controllers[i]?.signal || null, (meta) => { knownMeta[i] = meta })
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }))
      .then((result) => {
        results[i] = result
        settled.push(result)
      })
  ))
  const open = () => tasks.filter((_, i) => !results[i])
  const hasWinner = () => results.some((result) => result?.status === 'fulfilled')
  // Overall cap, counted from the start of the load, for waiting on a fresher
  // source after the settle window.
  const cap = startTimer(FRESHER_SOURCE_WAIT_MS)
  let capReached = false
  cap.promise.then(() => { capReached = true })

  while (open().length && !hasWinner()) {
    await Promise.race(open())
  }

  if (hasWinner()) {
    const settle = startTimer(SOURCE_SETTLE_MS)
    await Promise.race([Promise.all(tasks), settle.promise])
    settle.cancel()

    // The settle window keeps a stalled source from holding the load up, but a
    // source whose meta.json already shows newer data than the winner must not
    // lose just because its posts are slower to download. Wait for it, up to a
    // cap, so a stale first responder cannot win every poll.
    while (!capReached) {
      const winner = results.reduce((best, result) => (
        result?.status === 'fulfilled' ? selectFreshestPayload(best, result.value) : best
      ), null)
      const fresher = tasks.filter((_, i) => !results[i] && knownMeta[i]
        && hasPayloadAdvanced({ meta: knownMeta[i] }, winner))
      if (!fresher.length) break
      await Promise.race([...fresher, cap.promise])
    }
  }

  // A winner is in hand — losing bases would each finish a multi-MB download
  // for nothing (cold load paid ~2.9MB instead of ~1.5MB). With no winner this
  // just drops requests that are still running after their source failed.
  controllers.forEach((c) => c?.abort())
  cap.cancel()

  return settled
}

// Cheap freshness probe: pull only the small meta.json from the bases and keep
// the freshest. Used to decide whether the heavy posts.min.json actually needs
// to be downloaded again. Like the cold path it does not wait for the slowest
// base: it stops as soon as an answer shows newer data than `cachedMeta`, or
// one settle window after the first answer.
async function probeFreshestMeta(cachedMeta) {
  const bases = getDataBases()
  const controllers = bases.map(() => (typeof AbortController === 'undefined' ? null : new AbortController()))
  const finished = bases.map(() => false)
  let freshest = null
  // Scraper heartbeats move only lastScrapeRun, so the newest one is tracked
  // apart from the content freshness above.
  let lastScrapeRun = null
  const tasks = bases.map((base, i) => (
    fetchJson(`${base}/meta.json`, JSON_FETCH_TIMEOUT_MS, controllers[i]?.signal || null)
      .then((meta) => {
        freshest = selectFreshestPayload(freshest, { meta, source: base })
        if (parseTimestamp(meta?.lastScrapeRun) > parseTimestamp(lastScrapeRun)) lastScrapeRun = meta.lastScrapeRun
      }, () => {})
      .then(() => { finished[i] = true })
  ))
  const open = () => tasks.filter((_, i) => !finished[i])
  const advanced = () => Boolean(freshest) && hasPayloadAdvanced(freshest, { meta: cachedMeta, stale: true })

  while (open().length && !freshest) {
    await Promise.race(open())
  }
  if (freshest && !advanced()) {
    const settle = startTimer(SOURCE_SETTLE_MS)
    let windowOver = false
    settle.promise.then(() => { windowOver = true })
    while (open().length && !windowOver && !advanced()) {
      await Promise.race([...open(), settle.promise])
    }
    settle.cancel()
  }
  controllers.forEach((c) => c?.abort())

  if (!freshest) return null
  return { meta: freshest.meta, lastScrapeRun }
}

// Heartbeat-only scraper commits move just meta.lastScrapeRun. They must not
// count as "advanced" (that would re-download the multi-MB posts every cycle),
// but the footer shows that time, so carry the newer value into the cached meta
// without touching the posts or rewriting the persisted cache.
function inflateWithHeartbeat(cached, lastScrapeRun) {
  const payload = inflateCachedPayload(cached)
  if (parseTimestamp(lastScrapeRun) <= parseTimestamp(payload.meta?.lastScrapeRun)) return payload
  const meta = { ...payload.meta, lastScrapeRun }
  cached.meta = { ...cached.meta, lastScrapeRun }
  if (memoryCache?.record === cached && memoryCache.payload) {
    memoryCache.payload = { ...memoryCache.payload, meta }
  }
  return { ...payload, meta }
}

async function loadPublicData() {
  const cached = getCache()
  const cachedPayload = cached ? inflateCachedPayload(cached) : null

  if (cachedPayload && !cachedPayload.stale) return cachedPayload

  // Stale cache but posts already in hand: probe the tiny meta first and reuse
  // the cached posts when nothing changed upstream. This is the common polling
  // case, and it avoids re-downloading the multi-MB posts payload every cycle.
  if (cached && (cached.compact || cached.posts) && cached.meta) {
    const probe = await probeFreshestMeta(cached.meta).catch(() => null)
    if (probe && !hasPayloadAdvanced(probe, { meta: cached.meta, stale: true })) {
      // Refresh this tab's TTL without serializing/writing the multi-MB posts
      // again. A page reload may revalidate meta once, which is cheap.
      if (memoryCache?.record === cached) {
        memoryCache.validatedAt = Date.now()
      }
      cached.stale = false
      return inflateWithHeartbeat(cached, probe.lastScrapeRun)
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

  const freshestPayload = selectFreshestPayload(freshestNetworkPayload, cached)

  if (freshestNetworkPayload && freshestPayload === freshestNetworkPayload) {
    return inflateCachedPayload(setCache(freshestPayload))
  }

  if (cachedPayload) return cachedPayload

  throw lastError || new Error('Failed to load tracker data from every configured source')
}

export function fetchPublicData() {
  // Initial mount, visibility changes and manual refresh can overlap. Share
  // one source selection/download, and allow another attempt after failure.
  if (!inFlight) {
    inFlight = loadPublicData().finally(() => { inFlight = null })
  }
  return inFlight
}
