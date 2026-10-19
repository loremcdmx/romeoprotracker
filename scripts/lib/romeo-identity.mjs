// Who is Romeo and which post is a marathon report - shared by the scraper,
// the data-integrity checks and the client (src/utils.js imports this file, so
// keep it dependency-free and browser-safe).

// The marathon author is exactly one forum account. The old /romeopro/i matched
// any nick that merely CONTAINED the word ("Romeopro_fan"), which let a
// look-alike set the day counter and feed the bankroll extraction. Anchored,
// case-insensitive, tolerant only of surrounding whitespace. No Unicode folding
// on purpose: full-width or zero-width look-alikes must not pass.
export const ROMEO_AUTHOR_RE = /^\s*romeopro\s*$/i

export function isRomeoAuthor(author) {
  return typeof author === 'string' && ROMEO_AUTHOR_RE.test(author)
}

// Drop [QUOTE]...[/QUOTE] bodies (a quoted old report is not today's report),
// a stray closing tag and an unclosed quote that was cut by the length cap.
function stripQuotes(text) {
  let s = text.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').replace(/\[\/QUOTE\]/gi, '')
  const unclosed = s.search(/\[QUOTE\]/i)
  if (unclosed !== -1) s = s.slice(0, unclosed)
  return s
}

// A marathon report starts with its own header: "Day 187:" / "День #5".
// Anchored at the start of the post's OWN text (quotes removed) and the number
// must stand alone, so "каждый день 2 сессии", "Sunday 3 bet pot" or
// "today 5 final tables" no longer count as a day.
const DAY_HEADER_RE = /^\s*(?:день|day)\s*#?\s*(\d+)(?![\p{L}\p{N}])/iu

export function extractMarathonDay(text) {
  if (typeof text !== 'string' || !text) return null
  const match = stripQuotes(text).match(DAY_HEADER_RE)
  return match ? Number(match[1]) : null
}
