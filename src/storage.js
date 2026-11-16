import { CACHE_KEY, CACHE_TTL } from './cacheConfig.js'

const DEFAULT_REPO = 'loremcdmx/romeoprotracker'
const IS_TEST = import.meta.env.MODE === 'test'
const JSON_FETCH_TIMEOUT_MS = IS_TEST ? 300 : 6500
// Budget for reading the body once the response headers are in. The multi-MB
// posts payload needs far longer than the headers do on a slow link, but a body
// that stops arriving must still end in a timeout instead of hanging forever.
const HEAVY_BODY_TIMEOUT_MS = IS_TEST ? 300 : 30000
const SOURCE_SETTLE_MS = IS_TEST ? 0 : 1400
// A raw copy cut because another source covers it is restarted when that
// source's posts have not produced response headers this long after the cut.
const HEDGE_MS = IS_TEST ? 50 : 2000
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

async function fetchJson(url, timeoutMs = JSON_FETCH_TIMEOUT_MS, externalSignal = null, bodyTimeoutMs = timeoutMs, onHeaders = null) {
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
    onHeaders?.()
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

// `onHeaders` fires when the response headers of the heavy posts file are in
// (the body may still be arriving).
async function fetchFromBase(base, externalSignal = null, onMeta = null, onHeaders = null) {
  let compact = null
  let posts = null
  let meta = null
  // Own controller: when this source fails, whatever of it is still running
  // (typically the multi-MB posts) is cancelled instead of downloading unused.
  const own = typeof AbortController === 'undefined' ? null : new AbortController()
  if (externalSignal) {
    if (externalSignal.aborted) own?.abort()
    else externalSignal.addEventListener?.('abort', () => own?.abort(), { once: true })
  }
  const signal = own?.signal || null

  try {
    // meta.json is small and lands long before the multi-MB posts payload; let
    // the caller see it early to know which source is the fresher one.
    const metaRequest = fetchJson(`${base}/meta.json`, JSON_FETCH_TIMEOUT_MS, signal).then((value) => {
      onMeta?.(value)
      return value
    })
    const compactRequest = fetchJson(`${base}/posts.min.json`, JSON_FETCH_TIMEOUT_MS, signal, HEAVY_BODY_TIMEOUT_MS, onHeaders)
    // The posts file falls back to posts.json. Waiting for both together means
    // a failure of either ends the attempt at once (and cancels the other).
    const postsRequest = compactRequest.then((value) => ({ compact: value, posts: null }), (error) => {
      // An aborted load (source not needed any more) must not start a second,
      // heavier request through the fallback file.
      if (signal?.aborted) throw error
      return fetchJson(`${base}/posts.json`, JSON_FETCH_TIMEOUT_MS, signal, HEAVY_BODY_TIMEOUT_MS, onHeaders)
        .then((value) => ({ compact: null, posts: value }))
    })
    postsRequest.catch(() => {})
    metaRequest.catch(() => {})
    ;[meta, { compact, posts }] = await Promise.all([metaRequest, postsRequest])
  } catch (error) {
    own?.abort()
    throw error
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

// How far `candidateMeta` is ahead of `baseMeta`, judged from the two small
// meta.json files only:
//   'structural' - a new bankroll report, more tournaments or more posts, or a
//                  corrected history (the trend signature differs);
//   'light'      - only the freshness stamps moved (likes, ratings,
//                  translations, text refresh) and/or the scraper heartbeat;
//   'none'       - not ahead.
// Most scraper commits are 'light', yet the file behind them is the 6.6 MB
// uncompressed raw copy, so callers use this to avoid downloading it for them.
function classifyAdvance(candidateMeta, baseMeta) {
  const candidate = { meta: candidateMeta }
  const base = { meta: baseMeta }
  if (!hasPayloadAdvanced(candidate, base)) return 'none'
  return getPayloadTrendSignature(candidate) === getPayloadTrendSignature(base) ? 'light' : 'structural'
}

function getRawBase() {
  const envRepo = import.meta.env.VITE_DATA_REPO || DEFAULT_REPO
  return trimTrailingSlash(`https://raw.githubusercontent.com/${envRepo}/main/data`)
}

function newerHeartbeat(current, candidate) {
  return parseTimestamp(candidate) > parseTimestamp(current) ? candidate : current
}

function withHeartbeat(payload, lastScrapeRun) {
  if (!payload || parseTimestamp(lastScrapeRun) <= parseTimestamp(payload.meta?.lastScrapeRun)) return payload
  return { ...payload, meta: { ...payload.meta, lastScrapeRun } }
}

// Cold load. Resolves as soon as the first complete source plus the short
// settle window is in; it never holds the first render for a slower source.
//
// The raw copy (the heavy, 1.5-6.6 MB one) is cut as soon as its meta shows
// it is NOT structurally ahead of another live source: light advance,
// heartbeat-only, tie or behind. Its heartbeat is still adopted from the meta.
// A cut is never allowed to cost more than a short hedge: the raw copy is
// restarted when the covering source fails, or when the covering source's posts
// have produced no response headers HEDGE_MS after the cut.
// A source that is STRUCTURALLY ahead and still downloading when the first
// payload resolves keeps running: `background` settles with its result so the
// caller can deliver it later, without a reload.
async function collectNetworkPayloads() {
  const bases = getDataBases()
  const rawBase = getRawBase()
  const controllers = bases.map(() => null)
  const knownMeta = bases.map(() => null)
  const headers = bases.map(() => false)
  const results = bases.map(() => null)
  const tasks = bases.map(() => null)
  const gen = bases.map(() => 0)
  // Cut on purpose (not a failure); `noCut` once it has been restarted.
  const cut = bases.map(() => false)
  const noCut = bases.map(() => false)
  const hedges = []
  // In completion order: on a freshness tie the first source to settle wins.
  const settled = []
  let finished = false
  let wake = null
  const nextEvent = () => new Promise((resolve) => { wake = resolve })
  const poke = () => wake?.()

  const alive = (i) => !cut[i] && results[i]?.status !== 'rejected'
  const winners = () => results.filter((result) => result?.status === 'fulfilled').map((result) => result.value)
  const bestWinner = () => winners().reduce((best, value) => selectFreshestPayload(best, value), null)
  // A live other source whose meta is known and whose heavy request is going
  // well (headers in, or already complete).
  const covered = (a) => bases.some((_, b) => b !== a && alive(b) && knownMeta[b]
    && (headers[b] || results[b]?.status === 'fulfilled'))
  const hasLiveCover = (a) => bases.some((_, b) => b !== a && alive(b) && knownMeta[b])

  const start = (i) => {
    const mine = ++gen[i]
    results[i] = null
    headers[i] = false
    controllers[i] = typeof AbortController === 'undefined' ? null : new AbortController()
    tasks[i] = fetchFromBase(
      bases[i],
      controllers[i]?.signal || null,
      (meta) => {
        if (gen[i] !== mine) return
        knownMeta[i] = meta
        considerCuts()
        poke()
      },
      () => { if (gen[i] === mine) { headers[i] = true; poke() } },
    )
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }))
      .then((result) => {
        if (gen[i] !== mine) return
        results[i] = result
        if (result.status === 'fulfilled') {
          // A source that completed is always usable, whatever was decided
          // about it before.
          cut[i] = false
          settled.push(result)
        } else {
          // Nothing of a failed source is worth finishing.
          controllers[i]?.abort()
          if (!cut[i]) settled.push(result)
          // Restart cut sources that no longer have a live cover.
          bases.forEach((_, a) => { if (cut[a] && !hasLiveCover(a)) revive(a) })
        }
        poke()
      })
  }

  function revive(a) {
    if (!cut[a]) return
    cut[a] = false
    noCut[a] = true
    start(a)
  }

  function considerCuts() {
    bases.forEach((_, a) => {
      if (finished || bases[a] !== rawBase || noCut[a] || cut[a] || results[a] || !knownMeta[a]) return
      const coveredBy = bases.some((__, b) => b !== a && knownMeta[b] && alive(b)
        && classifyAdvance(knownMeta[a], knownMeta[b]) !== 'structural')
      if (!coveredBy) return
      cut[a] = true
      controllers[a]?.abort()
      const hedge = startTimer(HEDGE_MS)
      hedges.push(hedge)
      hedge.promise.then(() => {
        if (cut[a] && !winners().length && !covered(a)) revive(a)
      })
    })
  }

  bases.forEach((_, i) => start(i))

  const open = () => tasks.filter((_, i) => !results[i] && !cut[i])

  // Wait for the first complete source; a hedge or a failure may restart a cut
  // one meanwhile. With nothing running and nothing to restart, give up.
  while (!winners().length) {
    const running = open()
    if (!running.length) {
      const stuck = bases.map((_, i) => i).filter((i) => cut[i])
      if (!stuck.length) break
      stuck.forEach((i) => revive(i))
      continue
    }
    await Promise.race([...running, nextEvent()])
  }

  let background = null
  if (winners().length) {
    const mightMatter = (i) => {
      if (results[i] || cut[i]) return false
      if (!knownMeta[i]) return true
      const kind = classifyAdvance(knownMeta[i], bestWinner().meta)
      // Structurally ahead (maybe worth waiting for) or, for a cheap source,
      // lightly ahead. Ties and heartbeats are adopted from the meta instead.
      return kind === 'structural' || (kind === 'light' && bases[i] !== rawBase)
    }
    const settle = startTimer(SOURCE_SETTLE_MS)
    let windowOver = false
    settle.promise.then(() => { windowOver = true })
    while (!windowOver && bases.some((_, i) => mightMatter(i))) {
      await Promise.race([...open(), settle.promise, nextEvent()])
    }
    settle.cancel()

    const winner = bestWinner()
    const late = bases.map((_, i) => i).filter((i) => (
      !results[i] && !cut[i] && knownMeta[i]
      && classifyAdvance(knownMeta[i], winner.meta) === 'structural'
    ))
    if (late.length) {
      background = Promise.all(late.map((i) => tasks[i])).then(() => (
        late.map((i) => results[i]).filter((result) => result?.status === 'fulfilled').map((result) => result.value)
      ))
    }
    // Everything that can no longer be used is cancelled.
    controllers.forEach((c, i) => { if (!late.includes(i)) c?.abort() })
  } else {
    controllers.forEach((c) => c?.abort())
  }
  finished = true
  hedges.forEach((hedge) => hedge.cancel())

  // Newest heartbeat any source reported: the footer shows it, the same way
  // the heartbeat-only revalidation does.
  let heartbeat = null
  knownMeta.forEach((meta) => { if (meta) heartbeat = newerHeartbeat(heartbeat, meta.lastScrapeRun) })

  return { settled, background, heartbeat }
}

// Cheap freshness probe: pull only the small meta.json from every base. It
// does not wait for the slowest base: it stops one settle window after the
// first answer. Which base is worth the heavy download is decided from the
// answers collected by then (see planDownload). Requests still running keep
// going (a late meta can still reveal a structurally newer source once the
// download is done); `close()` cancels them and must always be called.
async function probeMetas() {
  const bases = getDataBases()
  const controllers = bases.map(() => (typeof AbortController === 'undefined' ? null : new AbortController()))
  const finished = bases.map(() => false)
  const metas = bases.map(() => null)
  let answered = false
  const tasks = bases.map((base, i) => (
    fetchJson(`${base}/meta.json`, JSON_FETCH_TIMEOUT_MS, controllers[i]?.signal || null)
      .then((meta) => {
        if (meta && typeof meta === 'object') { metas[i] = meta; answered = true }
      }, () => {})
      .then(() => { finished[i] = true })
  ))
  const open = () => tasks.filter((_, i) => !finished[i])
  const close = () => controllers.forEach((c) => c?.abort())

  try {
    while (open().length && !answered) {
      await Promise.race(open())
    }
    if (answered) {
      const settle = startTimer(SOURCE_SETTLE_MS)
      let windowOver = false
      settle.promise.then(() => { windowOver = true })
      while (open().length && !windowOver) {
        await Promise.race([...open(), settle.promise])
      }
      settle.cancel()
    }
  } catch (error) {
    close()
    throw error
  }

  if (!answered) { close(); return null }
  const heartbeat = () => metas.reduce((best, meta) => (meta ? newerHeartbeat(best, meta.lastScrapeRun) : best), null)
  return { bases, metas, heartbeat, close }
}

// Which bases to download the heavy posts from, best first, given what the
// probe saw. Empty means: nothing worth downloading, adopt the heartbeat only.
//  - STRUCTURAL advance anywhere: the freshest source, except that a cheap
//    (same-origin, compressed) source whose structure is as new is preferred;
//    the raw copy is requested only when it alone carries the new structure.
//  - LIGHT advance only: only a cheap source is downloaded (a new deploy
//    carrying newer likes). A light advance seen only on raw is never worth
//    the 6.6 MB uncompressed file: like counts catch up with the next deploy.
function planDownload(probe, cachedMeta) {
  const rawBase = getRawBase()
  const entries = probe.bases
    .map((base, i) => ({ base, meta: probe.metas[i], cheap: base !== rawBase }))
    .filter((entry) => entry.meta)
    .map((entry) => ({ ...entry, kind: classifyAdvance(entry.meta, cachedMeta) }))
    .filter((entry) => entry.kind !== 'none')
  const freshestOf = (list) => list.reduce((best, entry) => (
    !best || hasPayloadAdvanced({ meta: entry.meta }, { meta: best.meta }) ? entry : best
  ), null)

  const structural = entries.filter((entry) => entry.kind === 'structural')
  if (structural.length) {
    const freshest = freshestOf(structural)
    const asNew = structural.filter((entry) => entry.cheap
      && classifyAdvance(freshest.meta, entry.meta) !== 'structural')
    const first = asNew.length ? freshestOf(asNew) : freshest
    // Fallbacks if the first choice fails: the other advanced sources, cheap first.
    const rest = entries.filter((entry) => entry !== first)
      .sort((a, b) => Number(b.cheap) - Number(a.cheap))
    return [first, ...rest].map((entry) => entry.base)
  }
  const cheapLight = entries.filter((entry) => entry.cheap)
  if (cheapLight.length) return [freshestOf(cheapLight).base]
  return []
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

// A source that was structurally ahead but still downloading when the first
// payload resolved. It is delivered to these listeners (the hook) when it
// arrives, through the same path a successful poll uses.
const fresherListeners = new Set()
let backgroundActive = false

function notifyFresher(payload) {
  for (const listener of [...fresherListeners]) {
    try { listener(payload) } catch { /* a broken listener must not stop the others */ }
  }
}

function deliverLateSources(background) {
  backgroundActive = true
  background
    .then((payloads) => {
      const late = payloads.reduce((best, value) => selectFreshestPayload(best, value), null)
      // Compare with whatever the cache holds now (another poll or tab may
      // have moved it); a payload that no longer advances it is dropped.
      const current = getCache()
      if (!late || (current && !hasPayloadAdvanced(late, current))) return
      notifyFresher(inflateCachedPayload(setCache(late)))
    })
    .catch(() => {})
    .finally(() => {
      backgroundActive = false
      if (!inFlight) fresherListeners.clear()
    })
}

async function downloadFrom(bases) {
  let lastError = null
  for (const base of bases) {
    try {
      return { payload: await fetchFromBase(base), error: null }
    } catch (error) {
      lastError = error
    }
  }
  return { payload: null, error: lastError }
}

async function loadPublicData() {
  const cached = getCache()
  const cachedPayload = cached ? inflateCachedPayload(cached) : null

  if (cachedPayload && !cachedPayload.stale) return cachedPayload
  // The first render was resolved from one source while a structurally newer
  // one is still arriving: do not start a second download of the same thing.
  if (cachedPayload && backgroundActive) return cachedPayload

  // Stale cache but posts already in hand: probe the tiny meta first and reuse
  // the cached posts when nothing changed upstream. This is the common polling
  // case, and it avoids re-downloading the multi-MB posts payload every cycle.
  if (cached && (cached.compact || cached.posts) && cached.meta) {
    const probe = await probeMetas().catch(() => null)
    if (probe) {
      try {
        const plan = planDownload(probe, cached.meta)
        if (!plan.length) {
          // Refresh this tab's TTL without serializing/writing the multi-MB posts
          // again. A page reload may revalidate meta once, which is cheap.
          if (memoryCache?.record === cached) {
            memoryCache.validatedAt = Date.now()
          }
          cached.stale = false
          return inflateWithHeartbeat(cached, probe.heartbeat())
        }
        // Only the chosen base is downloaded, not every source.
        const rawBase = getRawBase()
        const cheapFirst = (list) => list.sort((x, y) => Number(x === rawBase) - Number(y === rawBase))
        let { payload } = await downloadFrom(plan)
        const tried = [...plan]
        // A source whose meta missed the probe window may carry newer
        // structure than what was just downloaded (or than the cache, when
        // every planned base failed): try those too, cheap ones first.
        const reference = payload?.meta || cached.meta
        const structuralSeen = probe.metas.some((meta) => meta && classifyAdvance(meta, cached.meta) === 'structural')
        const late = probe.bases.filter((base, i) => !tried.includes(base)
          && (probe.metas[i] ? classifyAdvance(probe.metas[i], reference) === 'structural' : (!payload && structuralSeen)))
        if (late.length) {
          const extra = (await downloadFrom(cheapFirst(late))).payload
          if (extra) payload = selectFreshestPayload(payload, extra)
        }
        if (payload) {
          const next = withHeartbeat(payload, probe.heartbeat())
          if (selectFreshestPayload(next, cached) === next) return inflateCachedPayload(setCache(next))
        }
        return cachedPayload
      } finally {
        probe.close()
      }
    }
  }

  let lastError = null
  let freshestNetworkPayload = null

  const { settled, background, heartbeat } = await collectNetworkPayloads()

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      freshestNetworkPayload = selectFreshestPayload(freshestNetworkPayload, result.value)
      continue
    }

    lastError = result.reason
  }

  freshestNetworkPayload = withHeartbeat(freshestNetworkPayload, heartbeat)
  const freshestPayload = selectFreshestPayload(freshestNetworkPayload, cached)

  if (freshestNetworkPayload && freshestPayload === freshestNetworkPayload) {
    const inflated = inflateCachedPayload(setCache(freshestPayload))
    if (background) deliverLateSources(background)
    return inflated
  }

  if (cachedPayload) return cachedPayload

  throw lastError || new Error('Failed to load tracker data from every configured source')
}

// `onFresher(payload)` is called at most once per load, later, when a source
// that was structurally ahead of the resolved payload finishes downloading.
export function fetchPublicData({ onFresher = null } = {}) {
  if (typeof onFresher === 'function') fresherListeners.add(onFresher)
  // Initial mount, visibility changes and manual refresh can overlap. Share
  // one source selection/download, and allow another attempt after failure.
  if (!inFlight) {
    inFlight = loadPublicData().finally(() => {
      inFlight = null
      if (!backgroundActive) fresherListeners.clear()
    })
  }
  return inFlight
}
