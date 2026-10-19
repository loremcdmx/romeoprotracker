// Client-side guards for mis-read rows in meta.brHistory. The rows come from
// screenshot extraction, so a report can arrive without a usable bankroll or
// with a cumulative tournament total that disagrees with its neighbours.

// A report without a finite bankroll cannot be drawn, summed or shown in the
// hero (it surfaced as "BR 0$ / Profit -10 000$", NaN counters and a NaN chart
// path). Flat reports (bankroll or cumulative unchanged) are legitimate and stay.
export function hasUsableBankroll(row) {
  return Number.isFinite(row?.brAfter)
}

// Returns the same array when every row is usable, so memoised consumers keep
// their identity on the common path.
export function sanitizeBrHistory(brHistory) {
  if (!Array.isArray(brHistory)) return brHistory
  const clean = brHistory.filter(hasUsableBankroll)
  return clean.length === brHistory.length ? brHistory : clean
}

export function sanitizeMeta(meta) {
  const brHistory = sanitizeBrHistory(meta?.brHistory)
  return brHistory === meta?.brHistory ? meta : { ...meta, brHistory }
}

const trustedTotalsCache = new WeakMap()

// The cumulative tournament counter only grows; an equal total is a report
// where the counter lagged. A mis-read total therefore shows up as a row that
// disagrees with the rows around it. We keep the longest non-decreasing run of
// finite positive totals (ties prefer the later report) and give every other
// row `null` ("no cumulative on this row"), so an outlier can neither become
// the baseline of the next delta (too low) nor swallow the following rows (too
// high). `sorted` must be chronological; the result is cached per array.
export function trustedCumulativeTotals(sorted) {
  const cached = trustedTotalsCache.get(sorted)
  if (cached) return cached

  const totals = sorted.map(row => {
    const total = row?.totalTournaments
    return Number.isFinite(total) && total > 0 ? total : null
  })
  const run = new Array(totals.length).fill(0)
  const link = new Array(totals.length).fill(-1)
  let end = -1
  for (let i = 0; i < totals.length; i++) {
    if (totals[i] == null) continue
    run[i] = 1
    for (let j = 0; j < i; j++) {
      if (totals[j] != null && totals[j] <= totals[i] && run[j] + 1 >= run[i]) {
        run[i] = run[j] + 1
        link[i] = j
      }
    }
    if (end < 0 || run[i] >= run[end]) end = i
  }

  const trusted = new Array(totals.length).fill(null)
  for (let i = end; i >= 0; i = link[i]) trusted[i] = totals[i]
  trustedTotalsCache.set(sorted, trusted)
  return trusted
}
