import { useSyncExternalStore } from 'react'

// One matchMedia + stable subscribe/getSnapshot per breakpoint, cached so
// repeated calls and useSyncExternalStore always get the same references.
const cache = new Map()

function getEntry(maxWidth) {
  let entry = cache.get(maxWidth)
  if (entry) return entry
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${maxWidth}px)`)
    : null
  entry = {
    subscribe: cb => {
      query?.addEventListener('change', cb)
      return () => query?.removeEventListener('change', cb)
    },
    getSnapshot: () => query?.matches ?? false,
  }
  cache.set(maxWidth, entry)
  return entry
}

export function useIsMobile(maxWidth = 720) {
  const { subscribe, getSnapshot } = getEntry(maxWidth)
  return useSyncExternalStore(subscribe, getSnapshot)
}
