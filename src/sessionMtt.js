import { warsawDayKey } from './utils.js'

const DAY_MS = 86400 * 1000
const dateKey = date => date.toISOString().slice(0, 10)

function calendarBounds(timestamp, grouping) {
  const dayKey = warsawDayKey(timestamp)
  // Treat Warsaw's civil date as a UTC date for calendar arithmetic. Adding
  // days to the real timestamp would move bucket edges during a DST change.
  const date = new Date(`${dayKey}T00:00:00Z`)
  if (grouping === 'week') {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7
    const start = new Date(date.getTime() - daysSinceMonday * DAY_MS)
    return [dateKey(start), dateKey(new Date(start.getTime() + 6 * DAY_MS))]
  }
  if (grouping === 'month') {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    return [dateKey(new Date(Date.UTC(year, month, 1))), dateKey(new Date(Date.UTC(year, month + 1, 0)))]
  }
  return [dayKey, dayKey]
}

// The input is the widget's reported-session series, not cumulative MTT deltas.
// Weekly/monthly bars retain the same unit: tournaments per played session.
// Empty calendar periods are omitted, never synthesized as zero sessions.
export function groupSessionMttRows(rows, grouping = 'session') {
  const mode = grouping === 'week' || grouping === 'month' ? grouping : 'session'
  const sorted = (rows || [])
    .filter(row => Number.isFinite(row?.timestamp) && row.timestamp > 0 && Number.isFinite(row?.mtt) && row.mtt >= 0)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
  const groups = new Map()

  sorted.forEach((row, index) => {
    const [periodStartKey, periodEndKey] = calendarBounds(row.timestamp, mode)
    const key = mode === 'session' ? `session-${row.timestamp}-${index}` : `${mode}-${periodStartKey}`
    const existing = groups.get(key)
    const profit = Number.isFinite(row.profit) ? row.profit : null
    if (!existing) {
      groups.set(key, {
        key,
        timestamp:row.timestamp,
        firstTimestamp:row.timestamp,
        lastTimestamp:row.timestamp,
        periodStartKey,
        periodEndKey,
        mtt:row.mtt,
        totalMtt:row.mtt,
        sessionCount:1,
        profit,
      })
      return
    }
    existing.totalMtt += row.mtt
    existing.sessionCount += 1
    existing.mtt = existing.totalMtt / existing.sessionCount
    existing.lastTimestamp = row.timestamp
    existing.profit = existing.profit != null && profit != null ? existing.profit + profit : null
  })

  return [...groups.values()]
}
