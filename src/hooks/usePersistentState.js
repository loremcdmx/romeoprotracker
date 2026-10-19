import { useCallback, useEffect, useRef, useState } from 'react'

function defaultDeserialize(raw) {
  return JSON.parse(raw)
}

function defaultSerialize(value) {
  return JSON.stringify(value)
}

// Merely reading `window.localStorage` throws a SecurityError when the browser
// blocks site data (Chrome "block all cookies", sandboxed frames). That must
// not take the whole page down: preferences then live in memory only.
function getDefaultStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

export function usePersistentState(key, initialValue, options = {}) {
  const {
    storage: storageOption,
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
  } = options
  const storage = storageOption === undefined ? getDefaultStorage() : storageOption

  // Callers pass inline serializers and fresh initial values on every render.
  // They are read through this ref, so none of them can retrigger persistence.
  const latest = useRef(null)
  latest.current = { key, storage, initialValue, serialize, deserialize }
  // `stateRef` is the value the setter works from; `rawRef` is the serialized
  // form of the key this tab last read or wrote, so a different raw value in
  // storage means another tab changed it.
  const stateRef = useRef(null)
  const rawRef = useRef(null)

  const readRaw = () => {
    const { key: k, storage: s } = latest.current
    if (!s) return undefined
    try {
      return s.getItem(k)
    } catch {
      return undefined
    }
  }

  const initial = () => {
    const { initialValue: v } = latest.current
    return typeof v === 'function' ? v() : v
  }

  const decode = (raw) => {
    if (raw == null) return initial()
    try {
      return latest.current.deserialize(raw)
    } catch {
      return initial()
    }
  }

  const [state, setState] = useState(() => {
    const raw = readRaw()
    rawRef.current = raw === undefined ? null : raw
    const value = decode(raw === undefined ? null : raw)
    stateRef.current = value
    return value
  })

  // Adopt a value another tab stored since this tab last looked. Returns the
  // current value either way.
  const syncFromStorage = () => {
    const raw = readRaw()
    if (raw === undefined || raw === rawRef.current) return stateRef.current
    rawRef.current = raw
    const value = decode(raw)
    stateRef.current = value
    setState(value)
    return value
  }

  // Everything the setter needs is read through refs, so its identity is stable.
  const updateState = useCallback((next) => {
    // Apply updates to what is stored now, not to what this tab rendered
    // earlier: a tab that missed another tab's change must not overwrite it.
    const prev = syncFromStorage()
    const value = typeof next === 'function' ? next(prev) : next
    if (Object.is(value, prev)) return
    stateRef.current = value
    setState(value)
    const { key: k, storage: s, serialize: ser } = latest.current
    if (!s) return
    try {
      const raw = ser(value)
      s.setItem(k, raw)
      rawRef.current = raw
    } catch {
      // Quota/storage access failure: this tab keeps the value in memory.
      // Remember what storage actually holds, so it is not mistaken for an
      // edit made in another tab.
      const stored = readRaw()
      rawRef.current = stored === undefined ? null : stored
    }
  }, [])

  // A stored value that does not survive validation (malformed, unsupported,
  // or just not in canonical form) is replaced once on mount by the value this
  // tab actually uses, as before. A valid value is never written back here.
  useEffect(() => {
    const stored = readRaw()
    if (stored == null || stored !== rawRef.current) return
    try {
      const canonical = latest.current.serialize(stateRef.current)
      if (canonical === stored) return
      latest.current.storage.setItem(latest.current.key, canonical)
      rawRef.current = canonical
    } catch {
      // Storage may be read-only or full; the tab keeps working from memory.
    }
  }, [])

  useEffect(() => {
    if (!storage || typeof window === 'undefined') return undefined
    const onStorage = (event) => {
      if (event.storageArea && event.storageArea !== storage) return
      if (event.key !== null && event.key !== key) return
      syncFromStorage()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, storage])

  return [state, updateState]
}
