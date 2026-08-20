function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function computePaceTrendStats(segments) {
  const trendPoints = (segments || [])
    .filter(seg => seg.full && Number.isFinite(seg?.rate) && Number.isFinite(seg?.endMtt))
    .map(seg => ({
      mtt:seg.endMtt,
      rate:seg.rate,
      weight:1,
    }))

  if (trendPoints.length < 2) return null

  const totalWeight = trendPoints.reduce((sum, point) => sum + point.weight, 0)
  if (!totalWeight) return null

  const meanX = trendPoints.reduce((sum, point) => sum + point.mtt * point.weight, 0) / totalWeight
  const meanY = trendPoints.reduce((sum, point) => sum + point.rate * point.weight, 0) / totalWeight
  const denominator = trendPoints.reduce((sum, point) => sum + point.weight * (point.mtt - meanX) ** 2, 0)
  if (!denominator) return null

  const slope = trendPoints.reduce(
    (sum, point) => sum + point.weight * (point.mtt - meanX) * (point.rate - meanY),
    0
  ) / denominator
  const intercept = meanY - slope * meanX
  const endMtt = Math.max(...trendPoints.map(point => point.mtt))
  const startRate = intercept
  const endRate = intercept + slope * endMtt

  return {
    slope,
    intercept,
    startRate,
    endRate,
    endMtt,
    rising:endRate >= startRate,
  }
}

export function buildPaceTrend(segments, { maxMtt, maxAbs, xByMtt, y }) {
  const stats = computePaceTrendStats(segments)
  if (!stats) return null

  // Fit on completed chunks only, but DRAW across the whole plot — cutting the
  // dashes at the last full chunk read as a broken line once a partial tail
  // extended the axis past it.
  const trendEndMtt = maxMtt || stats.endMtt
  const visibleStartRate = clampNumber(stats.startRate, -maxAbs, maxAbs)
  const visibleEndRate = clampNumber(stats.intercept + stats.slope * trendEndMtt, -maxAbs, maxAbs)
  const startX = xByMtt(0)
  const endX = xByMtt(trendEndMtt)
  const startY = y(visibleStartRate)
  const endY = y(visibleEndRate)

  return {
    ...stats,
    path:`M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    startX,
    endX,
    startY,
    endY,
  }
}
