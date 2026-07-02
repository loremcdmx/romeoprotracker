export const ROMEO_AUTHOR_RE = /romeopro/i

export function extractMarathonDay(text) {
  const match = String(text || '').match(/(?:[Дд]ень|[Dd]ay)\s*#?\s*(\d+)/i)
  return match ? Number(match[1]) : null
}

export function latestRomeoDay(posts = []) {
  const romeoPosts = posts
    .filter(post => ROMEO_AUTHOR_RE.test(post.author || ''))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  for (const post of romeoPosts) {
    const day = extractMarathonDay(post.text)
    if (day) {
      return {
        day,
        post,
      }
    }
  }

  return null
}

export function computeMarathonDay(posts = [], brHistory = []) {
  return latestRomeoDay(posts)?.day || brHistory.length || null
}

export function analyzeMarathonIntegrity({ posts = [], meta = {} } = {}) {
  const brHistory = Array.isArray(meta.brHistory)
    ? meta.brHistory.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    : []
  const postsById = new Map(posts.map(post => [String(post.id), post]))
  const latestDay = latestRomeoDay(posts)
  const duplicateBrIds = []
  const seenIds = new Map()
  const repeatedDays = []
  const seenDays = new Map()
  const brUpdatesWithoutDay = []
  const flatTournamentTotals = []
  const decreasingTournamentTotals = []

  brHistory.forEach((entry, idx) => {
    const id = String(entry.id || '')
    if (id) {
      if (seenIds.has(id)) duplicateBrIds.push({ id, previousIndex:seenIds.get(id), index:idx })
      seenIds.set(id, idx)
    }

    const post = postsById.get(id)
    const day = extractMarathonDay(post?.text)
    if (!day) {
      brUpdatesWithoutDay.push({ id:entry.id, index:idx, date:entry.date || null })
    } else if (seenDays.has(day)) {
      repeatedDays.push({ day, previous:seenDays.get(day), current:{ id:entry.id, index:idx, date:entry.date || null } })
    } else {
      seenDays.set(day, { id:entry.id, index:idx, date:entry.date || null })
    }

    const prev = brHistory[idx - 1]
    if (idx > 0 && Number.isFinite(entry.totalTournaments) && Number.isFinite(prev?.totalTournaments)) {
      const delta = entry.totalTournaments - prev.totalTournaments
      if (delta === 0) flatTournamentTotals.push({ id:entry.id, index:idx, totalTournaments:entry.totalTournaments })
      if (delta < 0) decreasingTournamentTotals.push({
        id:entry.id,
        index:idx,
        previousId:prev.id,
        previousTotalTournaments:prev.totalTournaments,
        totalTournaments:entry.totalTournaments,
      })
    }
  })

  const lastBr = brHistory[brHistory.length - 1] || null

  return {
    metaDay:meta.day || null,
    latestDay:latestDay?.day || null,
    latestDayPostId:latestDay?.post?.id || null,
    brUpdateCount:brHistory.length,
    lastBr,
    duplicateBrIds,
    repeatedDays,
    brUpdatesWithoutDay,
    flatTournamentTotals,
    decreasingTournamentTotals,
  }
}

export function validateMarathonIntegrity(payload) {
  const report = analyzeMarathonIntegrity(payload)
  const errors = []
  const warnings = []
  const meta = payload?.meta || {}

  if (report.latestDay && report.metaDay && report.latestDay !== report.metaDay) {
    errors.push(`meta.day ${report.metaDay} does not match latest Romeo Day ${report.latestDay}`)
  }
  if (report.lastBr) {
    if (meta.bankroll != null && meta.bankroll !== report.lastBr.brAfter) {
      errors.push(`meta.bankroll ${meta.bankroll} does not match last brAfter ${report.lastBr.brAfter}`)
    }
    if (meta.totalTournaments != null
      && report.lastBr.totalTournaments != null
      && meta.totalTournaments !== report.lastBr.totalTournaments) {
      errors.push(`meta.totalTournaments ${meta.totalTournaments} does not match last BR total ${report.lastBr.totalTournaments}`)
    }
  }
  if (report.duplicateBrIds.length) {
    errors.push(`duplicate BR ids: ${report.duplicateBrIds.map(item => item.id).join(', ')}`)
  }
  if (report.decreasingTournamentTotals.length) {
    errors.push(`totalTournaments decreases at ids: ${report.decreasingTournamentTotals.map(item => item.id).join(', ')}`)
  }

  if (report.repeatedDays.length) warnings.push(`${report.repeatedDays.length} repeated Day-labelled BR updates`)
  if (report.brUpdatesWithoutDay.length) warnings.push(`${report.brUpdatesWithoutDay.length} BR updates without Day label`)
  if (report.flatTournamentTotals.length) warnings.push(`${report.flatTournamentTotals.length} flat totalTournaments transitions`)

  return { report, errors, warnings }
}
