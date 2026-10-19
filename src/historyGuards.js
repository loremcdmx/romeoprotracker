// Client-side guards for mis-read rows in meta.brHistory. The rows come from
// screenshot extraction, so a report can arrive without a usable bankroll or
// with a cumulative tournament total that disagrees with its neighbours.

// A report without a finite bankroll cannot be drawn, summed or shown in the
// hero (it surfaced as "BR 0$ / Profit -10 000$", NaN counters and a NaN chart
// path). Flat reports (bankroll or cumulative unchanged) are legitimate and stay.
export function hasUsableBankroll(row) {
  return Number.isFinite(row?.brAfter)
}

// A history row is a plain object. A null, a number, a string or a nested array
// inside brHistory is mis-parsed JSON, never a report.
export function isHistoryRow(row) {
  return row != null && typeof row === 'object' && !Array.isArray(row)
}

// A numeric field of a report is a finite number, or absent (null/undefined).
// Anything else (1e999 parses to Infinity, a string, an object) cannot be drawn,
// summed or shown; the field is dropped so every consumer falls back to what it
// does for a report without it (derive the result from the bankroll step, use
// the cumulative total instead of the session count, ...).
const ROW_NUMBER_FIELDS = ['tournaments', 'totalTournaments', 'sessionResult', 'brBefore']

function isCleanNumber(value) {
  return value == null || Number.isFinite(value)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

// rooms is { before: { gg, ps, ... }, after: { ... } } and the tooltip reads both
// sides. A room value that is not a finite number is dropped (read as 0); a rooms
// value that is not that shape at all is dropped whole. Returns the same object
// when nothing is dropped.
function sanitizeRooms(rooms) {
  if (rooms == null) return rooms
  if (!isPlainObject(rooms) || !isPlainObject(rooms.before) || !isPlainObject(rooms.after)) return undefined
  let next = rooms
  for (const side of ['before', 'after']) {
    const balances = rooms[side]
    const keys = Object.keys(balances)
    if (keys.every(key => isCleanNumber(balances[key]))) continue
    const clean = {}
    for (const key of keys) if (isCleanNumber(balances[key])) clean[key] = balances[key]
    next = { ...next, [side]: clean }
  }
  return next
}

// Returns the same row object when every numeric field is usable.
export function sanitizeHistoryRow(row) {
  let next = row
  for (const field of ROW_NUMBER_FIELDS) {
    if (isCleanNumber(row[field])) continue
    if (next === row) next = { ...row }
    delete next[field]
  }
  const rooms = sanitizeRooms(row.rooms)
  if (rooms !== row.rooms) {
    if (next === row) next = { ...row }
    if (rooms === undefined) delete next.rooms
    else next.rooms = rooms
  }
  return next
}

// Returns the same array when every row is usable, so memoised consumers keep
// their identity on the common path. A history that is present but not an array
// ({} or a string) holds no reports at all: every consumer would otherwise call
// array methods on it. A report with a usable bankroll but a non-finite count,
// result or room balance stays, without that value (see sanitizeHistoryRow).
export function sanitizeBrHistory(brHistory) {
  if (brHistory == null) return brHistory
  if (!Array.isArray(brHistory)) return []
  let changed = false
  const clean = []
  for (const row of brHistory) {
    if (!hasUsableBankroll(row)) {
      changed = true
      continue
    }
    const next = sanitizeHistoryRow(row)
    if (next !== row) changed = true
    clean.push(next)
  }
  return changed ? clean : brHistory
}

export function sanitizeMeta(meta) {
  const brHistory = sanitizeBrHistory(meta?.brHistory)
  return brHistory === meta?.brHistory ? meta : { ...meta, brHistory }
}

const trustedTotalsCache = new WeakMap()

// The cumulative tournament counter only grows; an equal total is a report
// where the counter lagged. A mis-read total therefore shows up as a row that
// disagrees with the rows around it. We keep the longest non-decreasing run of
// finite positive totals and give every other row `null` ("no cumulative on
// this row"), so an outlier can neither become the baseline of the next delta
// (too low) nor swallow the following rows (too high).
//
// Equal-length runs happen when a too-low total lands between the totals of the
// two reports before it: keeping the outlier or keeping the real report is the
// same length. The rows' own reported session counts decide: a step between two
// kept totals is "confirmed" when it equals the sum of the counts reported by
// the rows in between, and the run with more confirmed steps wins. Only when
// that ties as well (or the counts are missing) does the later report win.
// `sorted` must be chronological; the result is cached per array.
export function trustedCumulativeTotals(sorted) {
  const cached = trustedTotalsCache.get(sorted)
  if (cached) return cached

  const totals = sorted.map(row => {
    const total = row?.totalTournaments
    return Number.isFinite(total) && total > 0 ? total : null
  })
  // Prefix sums of the reported counts, and of the rows that report none.
  const countSum = [0]
  const countGaps = [0]
  for (const row of sorted) {
    const count = row?.tournaments
    const known = Number.isFinite(count) && count >= 0
    countSum.push(countSum[countSum.length - 1] + (known ? count : 0))
    countGaps.push(countGaps[countGaps.length - 1] + (known ? 0 : 1))
  }
  const confirms = (j, i) => countGaps[i + 1] === countGaps[j + 1]
    && countSum[i + 1] - countSum[j + 1] === totals[i] - totals[j]

  const run = new Array(totals.length).fill(0)
  const confirmed = new Array(totals.length).fill(0)
  const link = new Array(totals.length).fill(-1)
  const atLeastAsGood = (aRun, aConfirmed, bRun, bConfirmed) =>
    aRun > bRun || (aRun === bRun && aConfirmed >= bConfirmed)
  let end = -1
  for (let i = 0; i < totals.length; i++) {
    if (totals[i] == null) continue
    run[i] = 1
    for (let j = 0; j < i; j++) {
      if (totals[j] == null || totals[j] > totals[i]) continue
      const viaRun = run[j] + 1
      const viaConfirmed = confirmed[j] + (confirms(j, i) ? 1 : 0)
      if (atLeastAsGood(viaRun, viaConfirmed, run[i], confirmed[i])) {
        run[i] = viaRun
        confirmed[i] = viaConfirmed
        link[i] = j
      }
    }
    if (end < 0 || atLeastAsGood(run[i], confirmed[i], run[end], confirmed[end])) end = i
  }

  const trusted = new Array(totals.length).fill(null)
  for (let i = end; i >= 0; i = link[i]) trusted[i] = totals[i]
  trustedTotalsCache.set(sorted, trusted)
  return trusted
}
