import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPublicData, isPayloadAtLeastAsFresh } from '../storage.js'
import { dedupBrHistory, ROMEO_RE } from '../utils.js'

const POLL_INTERVAL_MS = 2 * 60 * 1000
const BR_MATCH_WINDOW_SEC = 2 * 60 * 60

function getAppliedSignature(posts, meta) {
  const history = Array.isArray(meta?.brHistory) ? meta.brHistory : []
  const last = history[history.length - 1] || {}

  // Match the trend fields used by storage.js to distinguish fresh payloads.
  // Scraper corrections can advance history/totals without changing timestamps.
  return [
    meta?.lastUpdated ?? '',
    meta?.postsChangedAt ?? '',
    posts.length,
    meta?.bankroll ?? '',
    meta?.totalTournaments ?? '',
    meta?.totalPosts ?? '',
    history.length,
    last.id ?? '',
    last.timestamp ?? '',
    last.brBefore ?? '',
    last.brAfter ?? '',
    last.sessionResult ?? '',
    last.tournaments ?? '',
    last.totalTournaments ?? '',
  ].join('|')
}

function enrichPosts(posts, meta) {
  if (meta?.brHistory?.length) {
    meta.brHistory = dedupBrHistory(meta.brHistory)
  }

  const brHistory = meta?.brHistory
  if (!brHistory?.length) return

  const brById = new Map(brHistory.filter((entry) => entry.id).map((entry) => [entry.id, entry]))
  const brByTs = [...brHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  posts?.forEach((post) => {
    if (!ROMEO_RE.test(post.author) || post.brAfter) return

    const byId = brById.get(post.id)
    if (byId) {
      post.brAfter = byId.brAfter
      return
    }

    if (!post.timestamp) return

    let best = null
    let bestDiff = Infinity
    for (const entry of brByTs) {
      const diff = Math.abs((entry.timestamp || 0) - post.timestamp)
      if (diff < bestDiff) {
        best = entry
        bestDiff = diff
      }
    }

    if (best && bestDiff < BR_MATCH_WINDOW_SEC) {
      post.brAfter = best.brAfter
    }
  })
}

function getCoverage(payload, mode) {
  const posts = payload.posts || []
  return {
    ...payload.coverage,
    mode,
    ...(mode === 'recent' ? { limit: payload.coverage?.limit || 300 } : {}),
    loadedPosts: posts.length,
    totalPosts: payload.coverage?.totalPosts ?? payload.meta?.totalPosts ?? posts.length,
  }
}

export function usePostsData({ initialMode = 'full' } = {}) {
  // A resize must not silently download the archive or discard already loaded
  // history. Only an explicit successful upgrade changes this mode.
  const modeRef = useRef(initialMode === 'recent' ? 'recent' : 'full')
  const generationRef = useRef(0)
  const upgradePromiseRef = useRef(null)
  const knownIdsRef = useRef(null)
  const newPostIdsRef = useRef([])
  const latestPostsRef = useRef([])
  const latestMetaRef = useRef(null)
  const latestCoverageRef = useRef(getCoverage({}, modeRef.current))
  const appliedSigRef = useRef(null)
  // Mirror of `error` so no-op polls never call setError(null) on an already
  // null state — React 18 may still render once for a same-value update, which
  // defeated the no-op fast path on the first poll.
  const errorRef = useRef(null)
  const [posts, setPosts] = useState([])
  const [meta, setMeta] = useState(null)
  const [coverage, setCoverage] = useState(latestCoverageRef.current)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newPostIds, setNewPostIds] = useState([])
  const [loadingFullHistory, setLoadingFullHistory] = useState(false)
  const [fullHistoryError, setFullHistoryError] = useState(null)

  const currentSnapshot = useCallback(() => ({
    posts: latestPostsRef.current,
    meta: latestMetaRef.current,
    coverage: latestCoverageRef.current,
  }), [])

  const applyPayload = useCallback((payload, mode, { upgrade = false } = {}) => {
    const { posts: nextPosts = [], meta: nextMeta = {} } = payload
    const nextCoverage = getCoverage(payload, mode)
    appliedSigRef.current = `${mode}|${nextCoverage.totalPosts}|${getAppliedSignature(nextPosts, nextMeta)}`
    enrichPosts(nextPosts, nextMeta)

    if (upgrade) {
      // Older archive IDs are not newly published posts. Retain any genuinely
      // unseen IDs already announced by a recent poll, without adding history.
      const pending = new Set(newPostIdsRef.current)
      knownIdsRef.current = new Set(nextPosts.filter(post => !pending.has(post.id)).map(post => post.id))
    } else if (knownIdsRef.current) {
      const fresh = nextPosts.filter(post => !knownIdsRef.current.has(post.id))
      if (fresh.length > 0) {
        newPostIdsRef.current = fresh.map(post => post.id)
        setNewPostIds(newPostIdsRef.current)
      }
    } else {
      knownIdsRef.current = new Set(nextPosts.map(post => post.id))
    }

    latestPostsRef.current = nextPosts
    latestMetaRef.current = nextMeta
    latestCoverageRef.current = nextCoverage
    setPosts(nextPosts)
    setMeta(nextMeta)
    setCoverage(nextCoverage)
    setError(null)
    return { posts: nextPosts, meta: nextMeta, coverage: nextCoverage }
  }, [])

  const loadData = useCallback(async ({ silent = false } = {}) => {
    const mode = modeRef.current
    const generation = generationRef.current
    if (!silent) setError(null)

    try {
      const payload = mode === 'recent'
        ? await fetchPublicData({ mode: 'recent' })
        : await fetchPublicData()

      // A poll may have started before the explicit full-history load. Once
      // that upgrade succeeds, its recent response must never shrink the feed.
      if (generation !== generationRef.current) return currentSnapshot()
      const { posts: nextPosts = [], meta: nextMeta = {} } = payload
      const nextCoverage = getCoverage(payload, mode)

      // Skip enrichment/state updates only when freshness and trend markers match.
      const signature = `${mode}|${nextCoverage.totalPosts}|${getAppliedSignature(nextPosts, nextMeta)}`
      if (silent && knownIdsRef.current && appliedSigRef.current === signature) {
        setError(null)
        return currentSnapshot()
      }
      return applyPayload(payload, mode)
    } catch (err) {
      if (generation !== generationRef.current) return currentSnapshot()
      const nextError = err instanceof Error ? err : new Error('Failed to load tracker data')
      if (!silent || latestPostsRef.current.length === 0) {
        errorRef.current = nextError
        setError(nextError)
      }
      throw nextError
    } finally {
      if (!silent && generation === generationRef.current) setLoading(false)
    }
  }, [applyPayload, currentSnapshot])

  const loadFullHistory = useCallback(() => {
    if (modeRef.current === 'full') return Promise.resolve(currentSnapshot())
    if (upgradePromiseRef.current) return upgradePromiseRef.current

    setLoadingFullHistory(true)
    setFullHistoryError(null)
    const promise = (async () => {
      try {
        const payload = await Promise.resolve().then(() => fetchPublicData({
          refresh: true,
          minMeta: latestMetaRef.current,
        }))
        // A recent poll can advance while the archive is downloading. Recheck
        // the live floor using the storage comparator before replacing it.
        if (!isPayloadAtLeastAsFresh(payload, latestMetaRef.current)) {
          throw new Error('Full history is older than the current recent snapshot')
        }
        // Commit the mode only with a complete successful payload. Existing
        // recent polls can continue if this download fails and is retried.
        const result = applyPayload(payload, 'full', { upgrade: true })
        modeRef.current = 'full'
        generationRef.current++
        setLoading(false)
        return result
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error('Failed to load full history')
        setFullHistoryError(nextError)
        throw nextError
      } finally {
        upgradePromiseRef.current = null
        setLoadingFullHistory(false)
      }
    })()
    upgradePromiseRef.current = promise
    return promise
  }, [applyPayload, currentSnapshot])

  useEffect(() => {
    let intervalId = null

    const start = () => {
      if (intervalId) return
      intervalId = setInterval(() => {
        loadData({ silent: true }).catch(() => {})
      }, POLL_INTERVAL_MS)
    }

    const stop = () => {
      if (!intervalId) return
      clearInterval(intervalId)
      intervalId = null
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
        return
      }

      loadData({ silent: true }).catch(() => {})
      start()
    }

    loadData().catch(() => {})
    start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadData])

  const clearNewPosts = useCallback((sourcePosts) => {
    const currentPosts = sourcePosts || latestPostsRef.current
    knownIdsRef.current = new Set((currentPosts || []).map((post) => post.id))
    newPostIdsRef.current = []
    setNewPostIds([])
  }, [])

  return {
    posts,
    meta,
    coverage,
    loading,
    error,
    loadingFullHistory,
    fullHistoryError,
    loadFullHistory,
    newPostIds,
    refresh: loadData,
    clearNewPosts,
  }
}
