import { warsawParts } from './utils.js'
import { isHistoryRow, trustedCumulativeTotals } from './historyGuards.js'

function isKnownDistance(value) {
  return Number.isFinite(value) && value >= 0
}

// Normalize the complete archive in chronological order BEFORE filtering it.
// The archive starts at zero MTT; a filtered window keeps the distances that
// were already measured against its preceding reports.
//
// The cumulative counter only grows, so a total that disagrees with its
// neighbours (see trustedCumulativeTotals, the rule the pace widgets use) is a
// mis-read. It counts as "no cumulative on this row": it can neither become the
// baseline of the next delta (a too-low total used to inflate the next row's
// monthly distance) nor swallow the rows after it. Such a row falls back to its
// reported count exactly like a row that never had a total.
export function normalizeMarathonDistance(points) {
  const rows = (points || []).filter(isHistoryRow)
  const trusted = trustedCumulativeTotals(rows)
  let previousCumulative = 0
  // A total of 0 is the archive start; once any positive total is trusted a
  // later 0 is a mis-read like every other disagreeing total.
  let positiveTrusted = false
  return rows.map((point, idx) => {
    let cumulativeMTT = null
    let distanceMTT = null

    const total = point.totalTournaments
    const knownTotal = total != null && isKnownDistance(total)
    const agrees = knownTotal && (total === 0 ? !positiveTrusted : trusted[idx] != null)
    if (trusted[idx] != null) positiveTrusted = true

    if (agrees) {
      cumulativeMTT = total
      if (previousCumulative != null) {
        const delta = cumulativeMTT - previousCumulative
        if (delta >= 0) distanceMTT = delta
      }
    } else if ((total == null || knownTotal) && isKnownDistance(point.tournaments)) {
      distanceMTT = point.tournaments
      if (previousCumulative != null) cumulativeMTT = previousCumulative + distanceMTT
    }

    // An unknown report breaks the baseline. A later official total restores
    // it, but that first delta spans the gap and cannot be assigned to one row.
    previousCumulative = cumulativeMTT
    return { ...point, cumulativeMTT, distanceMTT }
  })
}

export function groupMarathonMonths(points) {
  const months = new Map()
  for (const point of points || []) {
    if (!Number.isFinite(point.timestamp)) continue
    let parts
    try {
      parts = warsawParts(point.timestamp)
    } catch {
      continue
    }
    if (!parts) continue
    const { year, month } = parts
    const key = `${year}-${String(month).padStart(2, '0')}`
    let group = months.get(key)
    if (!group) {
      group = { key, year: Number(year), month, first: point, last: point,
        count: 0, tournaments: 0, allDistancesKnown: true }
      months.set(key, group)
    }
    if (point.timestamp < group.first.timestamp) group.first = point
    if (point.timestamp >= group.last.timestamp) group.last = point
    group.count++
    if (isKnownDistance(point.distanceMTT)) group.tournaments += point.distanceMTT
    else group.allDistancesKnown = false
  }

  return [...months.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map(({ key, year, month, first, last, count, tournaments, allDistancesKnown }) => ({
      key,
      year,
      month,
      br: last.br,
      brPrev: first.brPrev,
      profit: Number.isFinite(last.br) && Number.isFinite(first.brPrev) ? last.br - first.brPrev : null,
      tournaments: allDistancesKnown ? tournaments : null,
      totalTournaments: last.cumulativeMTT ?? null,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      timestamp: last.timestamp,
      count,
      firstId: first.id,
      lastId: last.id,
    }))
}
