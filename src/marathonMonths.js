import { warsawParts } from './utils.js'

function isKnownDistance(value) {
  return Number.isFinite(value) && value >= 0
}

// Normalize the complete archive in chronological order BEFORE filtering it.
// The archive starts at zero MTT; a filtered window keeps the distances that
// were already measured against its preceding reports.
export function normalizeMarathonDistance(points) {
  let previousCumulative = 0
  return (points || []).map(point => {
    let cumulativeMTT = null
    let distanceMTT = null

    if (point.totalTournaments != null) {
      if (isKnownDistance(point.totalTournaments)) {
        cumulativeMTT = point.totalTournaments
        if (previousCumulative != null) {
          const delta = cumulativeMTT - previousCumulative
          if (delta >= 0) distanceMTT = delta
        }
      }
    } else if (isKnownDistance(point.tournaments)) {
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
