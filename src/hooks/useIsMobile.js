import { useSyncExternalStore } from 'react'

const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 720px)')
  : null
const subscribe = cb => {
  query?.addEventListener('change', cb)
  return () => query?.removeEventListener('change', cb)
}
const getSnapshot = () => query?.matches ?? false

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
