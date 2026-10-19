// One rule for "is this author ignored?", shared by the feed filter, the
// sidebar top list, post-card stubs, the chart tooltip, the expanded day list and
// the top-author picks. The stored list keeps names exactly as the user typed or
// clicked them (that is what the settings list shows); only the comparison is
// normalised: surrounding whitespace is trimmed and case is ignored.
export const authorKey = (name) => String(name ?? '').trim().toLowerCase()

const EMPTY = new Set()
const keyCache = new WeakMap()

// Normalised keys of an ignored list, computed once per list instance. The app
// replaces the Set on every change, so a new list simply gets a new entry.
export function ignoredKeySet(ignored) {
  if (!ignored || typeof ignored.forEach !== 'function') return EMPTY
  const hit = keyCache.get(ignored)
  if (hit && hit.size === ignored.size) return hit.keys
  const keys = new Set()
  ignored.forEach(name => {
    const key = authorKey(name)
    if (key) keys.add(key)
  })
  keyCache.set(ignored, { size: ignored.size, keys })
  return keys
}

export function isIgnoredAuthor(ignored, author) {
  const key = authorKey(author)
  return key !== '' && ignoredKeySet(ignored).has(key)
}

// Returns the same list when the author is already covered (any casing), so
// "Troll" and "troll" never pile up as two entries.
export function addIgnoredAuthor(ignored, name) {
  const value = String(name ?? '').trim()
  if (!value || isIgnoredAuthor(ignored, value)) return ignored
  const next = new Set(ignored)
  next.add(value)
  return next
}

// Removes every stored spelling of the author, so un-ignoring a post whose
// author is spelled "troll" also clears an entry that was typed as "TROLL".
export function removeIgnoredAuthor(ignored, name) {
  const key = authorKey(name)
  if (!key) return ignored
  const next = new Set()
  ignored.forEach(entry => { if (authorKey(entry) !== key) next.add(entry) })
  return next.size === ignored.size ? ignored : next
}
