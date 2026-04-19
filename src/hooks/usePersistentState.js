import { useCallback, useEffect, useState } from 'react'

function defaultDeserialize(raw) {
  return JSON.parse(raw)
}

function defaultSerialize(value) {
  return JSON.stringify(value)
}

export function usePersistentState(key, initialValue, options = {}) {
  const {
    storage = typeof window !== 'undefined' ? window.localStorage : null,
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
  } = options

  const [state, setState] = useState(() => {
    if (!storage) return typeof initialValue === 'function' ? initialValue() : initialValue
    try {
      const raw = storage.getItem(key)
      if (raw == null) return typeof initialValue === 'function' ? initialValue() : initialValue
      return deserialize(raw)
    } catch {
      return typeof initialValue === 'function' ? initialValue() : initialValue
    }
  })

  useEffect(() => {
    if (!storage) return
    try {
      storage.setItem(key, serialize(state))
    } catch {
      // Ignore quota/storage access failures.
    }
  }, [key, serialize, state, storage])

  const updateState = useCallback((next) => {
    setState((prev) => (typeof next === 'function' ? next(prev) : next))
  }, [])

  return [state, updateState]
}
