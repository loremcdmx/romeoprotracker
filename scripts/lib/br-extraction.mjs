// Pure helpers around the Claude-vision bankroll extraction in scrape.mjs:
// what counts against a post's retry budget, and whether the model's answer is
// fit to be written into meta.brHistory / meta.bankroll.

export const ROOM_KEYS = ['gg', 'ps', 'king', 'coin', 'lux']

// Plausibility limits. They are deliberately wide: live data has session
// ratios 0.55..1.95, chain steps 0.95..1.00, BR 2876..436927 and 40509 total
// tournaments. They exist to stop a dropped/added digit, a string or a null
// from becoming the headline number, not to second-guess a real swing.
export const BR_MAX = 100_000_000
export const SESSION_RATIO_RANGE = [0.2, 5]   // brAfter / brBefore
export const CHAIN_RATIO_RANGE = [0.5, 2]     // brBefore / previous brAfter
export const TOTAL_TOURNAMENTS_MAX = 1_000_000
export const SESSION_TOURNAMENTS_MAX = 10_000

// Anthropic reports account-level trouble as 400 too (low credit balance), so a
// 400 is only "this post's request is bad" when the message is not about the
// account. 413 (request too large) is always the post's own images.
const ACCOUNT_LEVEL_MESSAGE = /credit balance|billing|usage limit|rate.?limit|overloaded|api[ _-]?key|authenticat|permission|workspace|organization/i

// true  = the post itself cannot be processed (bad/oversized image): counts
//         against the per-post retry budget.
// false = API/account/network trouble (5xx, 429, 529, 401, 402, 403, 404,
//         low credit...): says nothing about the post, must never consume the
//         budget.
export function isPostSpecificApiError(status, bodyText = '') {
  if (status === 413) return true
  if (status !== 400) return false
  return !ACCOUNT_LEVEL_MESSAGE.test(String(bodyText))
}

const isNum = v => typeof v === 'number' && Number.isFinite(v)

function fail(reason) {
  return { ok: false, reason }
}

// Entries of brHistory around a timestamp: the chronologically previous and
// next session (normal runs process posts in page order, not time order).
export function neighbourEntries(history, timestamp) {
  const list = Array.isArray(history) ? history : []
  let prev = null
  let next = null
  const ts = Number.isFinite(timestamp) ? timestamp : null
  for (const entry of list) {
    const t = entry?.timestamp
    if (!Number.isFinite(t)) continue
    if (ts == null || t < ts) {
      if (!prev || t >= prev.timestamp) prev = entry
    } else if (t > ts) {
      if (!next || t < next.timestamp) next = entry
    }
  }
  return { prev, next }
}

// Rooms: absent/null room -> 0 (the model omits rooms it cannot see), anything
// else must be a finite non-negative number.
function normalizeRooms(raw, label) {
  if (raw == null) return { ok: true, rooms: Object.fromEntries(ROOM_KEYS.map(k => [k, 0])) }
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail(`${label} is not an object`)
  const rooms = {}
  for (const key of ROOM_KEYS) {
    const value = raw[key]
    if (value == null) { rooms[key] = 0; continue }
    if (!isNum(value) || value < 0 || value > BR_MAX) return fail(`${label}.${key} is not a plausible number`)
    rooms[key] = value
  }
  return { ok: true, rooms }
}

function optionalCount(value, label, max) {
  if (value == null || value === 0) return { ok: true, value: null }
  if (!isNum(value) || !Number.isInteger(value) || value < 0 || value > max) {
    return fail(`${label} is not a plausible count`)
  }
  return { ok: true, value }
}

// parsed: JSON.parse of the model answer (already known not to be {skip:true}).
// context: { history (brHistory array), timestamp (the post's) }.
// Returns { ok: true, value } with the exact shape processPostBr stores, or
// { ok: false, reason }. Any failure is an "unreadable answer": the caller
// counts it against the retry budget and writes nothing.
export function validateBrExtraction(parsed, { history = [], timestamp = null } = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('answer is not a JSON object')

  const { brBefore, brAfter } = parsed
  if (!isNum(brBefore) || !isNum(brAfter)) return fail('brBefore/brAfter are not finite numbers')
  if (brBefore <= 0 || brAfter <= 0 || brBefore > BR_MAX || brAfter > BR_MAX) {
    return fail(`brBefore/brAfter out of range (${brBefore} -> ${brAfter})`)
  }
  const ratio = brAfter / brBefore
  if (ratio < SESSION_RATIO_RANGE[0] || ratio > SESSION_RATIO_RANGE[1]) {
    return fail(`implausible session swing ${brBefore} -> ${brAfter}`)
  }

  const before = normalizeRooms(parsed.roomsBefore, 'roomsBefore')
  if (!before.ok) return before
  const after = normalizeRooms(parsed.roomsAfter, 'roomsAfter')
  if (!after.ok) return after

  const tournaments = optionalCount(parsed.tournaments, 'tournaments', SESSION_TOURNAMENTS_MAX)
  if (!tournaments.ok) return tournaments
  const total = optionalCount(parsed.totalTournaments, 'totalTournaments', TOTAL_TOURNAMENTS_MAX)
  if (!total.ok) return total

  const { prev, next } = neighbourEntries(history, timestamp)
  if (prev && isNum(prev.brAfter) && prev.brAfter > 0) {
    const chain = brBefore / prev.brAfter
    if (chain < CHAIN_RATIO_RANGE[0] || chain > CHAIN_RATIO_RANGE[1]) {
      return fail(`brBefore ${brBefore} does not follow the previous session's brAfter ${prev.brAfter}`)
    }
  }
  if (total.value != null) {
    if (prev && isNum(prev.totalTournaments) && total.value < prev.totalTournaments) {
      return fail(`totalTournaments ${total.value} is below the previous session's ${prev.totalTournaments}`)
    }
    if (next && isNum(next.totalTournaments) && total.value > next.totalTournaments) {
      return fail(`totalTournaments ${total.value} is above the next session's ${next.totalTournaments}`)
    }
  }

  return {
    ok: true,
    value: {
      brBefore,
      brAfter,
      sessionResult: brAfter - brBefore,
      rooms: { before: before.rooms, after: after.rooms },
      tournaments: tournaments.value,
      totalTournaments: total.value,
    },
  }
}
