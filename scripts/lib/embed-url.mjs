// Which <iframe src> values from forum HTML may be stored and rendered.
// Used twice: by the scraper (drop at the source) and by PostCard (double check
// at render, because old or hand-edited data is re-served). Dependency-free and
// browser-safe.
//
// Only https, only an exact host from the list below. Everything else
// (javascript:, data:, http:, relative paths, unknown hosts) is dropped.
// The first group is every host that exists in data/posts.json today; the
// second group is the usual player hosts so a new post with another YouTube,
// Vimeo, Rutube or Twitch embed does not need a code change.
export const EMBED_HOSTS = new Set([
  // present in the dataset
  'www.youtube.com',
  'video.gipsyteam.ru',
  'clips.twitch.tv',
  'player.vimeo.com',
  'vk.com',
  'coub.com',
  // usual players
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'rutube.ru',
  'www.rutube.ru',
  'player.twitch.tv',
])

// The forum stores most embeds protocol-relative ("//www.youtube.com/embed/ID");
// that is https on our https-only site, so it is accepted as such.
export function isSafeEmbedUrl(src) {
  if (typeof src !== 'string') return false
  const value = src.trim()
  // Whitespace/control characters inside a URL are never legitimate here and
  // are stripped by URL parsers, which is how filters get bypassed.
  if (!value || /[\u0000- \u007f]/.test(value)) return false
  if (!/^(?:https:)?\/\//i.test(value)) return false
  let url
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  return EMBED_HOSTS.has(url.hostname.toLowerCase())
}

// Render-time helper: tolerant of a missing or non-array value in hostile data.
export function safeEmbedUrls(list) {
  return Array.isArray(list) ? list.filter(src => isSafeEmbedUrl(src)) : []
}
