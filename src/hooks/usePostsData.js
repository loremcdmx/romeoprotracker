import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPublicData } from '../storage.js'
import { dedupBrHistory, ROMEO_RE } from '../utils.js'

const POLL_INTERVAL_MS = 2 * 60 * 1000
const BR_MATCH_WINDOW_SEC = 2 * 60 * 60

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

export function usePostsData() {
  const knownIdsRef = useRef(null)
  const latestPostsRef = useRef([])
  const latestMetaRef = useRef(null)
  const appliedSigRef = useRef(null)
  // Mirror of `error` so no-op polls never call setError(null) on an already
  // null state — React 18 may still render once for a same-value update, which
  // defeated the no-op fast path on the first poll.
  const errorRef = useRef(null)
  const [posts, setPosts] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newPostIds, setNewPostIds] = useState([])

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent && errorRef.current) { errorRef.current = null; setError(null) }

    try {
      const { posts: nextPosts = [], meta: nextMeta = {} } = await fetchPublicData()

      // No-op poll fast path: when the freshness markers are unchanged the payload
      // is content-identical (the storage layer returns the cached posts), so skip
      // enrich + setState entirely and avoid re-rendering the whole app every cycle.
      const signature = `${nextMeta?.lastUpdated || ''}|${nextMeta?.postsChangedAt || ''}|${nextPosts.length}`
      if (silent && knownIdsRef.current && appliedSigRef.current === signature) {
        if (errorRef.current) { errorRef.current = null; setError(null) }
        return { posts: latestPostsRef.current, meta: latestMetaRef.current }
      }
      appliedSigRef.current = signature

      enrichPosts(nextPosts, nextMeta)

      if (knownIdsRef.current) {
        const fresh = nextPosts.filter((post) => !knownIdsRef.current.has(post.id))
        if (fresh.length > 0) {
          setNewPostIds(fresh.map((post) => post.id))
        }
      } else {
        knownIdsRef.current = new Set(nextPosts.map((post) => post.id))
      }

      latestPostsRef.current = nextPosts
      latestMetaRef.current = nextMeta
      setPosts(nextPosts)
      setMeta(nextMeta)
      if (errorRef.current) { errorRef.current = null; setError(null) }
      return { posts: nextPosts, meta: nextMeta }
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error('Failed to load tracker data')
      if (!silent || latestPostsRef.current.length === 0) {
        errorRef.current = nextError
        setError(nextError)
      }
      throw nextError
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

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
    setNewPostIds([])
  }, [])

  return {
    posts,
    meta,
    loading,
    error,
    newPostIds,
    refresh: loadData,
    clearNewPosts,
  }
}
