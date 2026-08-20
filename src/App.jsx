import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react'
import { Analytics } from '@vercel/analytics/react'
import {
  timeAgo, fmtBR, fmtNum, fmtInt, fmtExact, fmtExactSigned, fmtDateShort, extractDay, extractBR,
  fk, fkAbs, ROMEO_RE, autoCloseQuotes, stripQuoteTags, extractQuoteBody,
  pl, plural,
  warsawDayKey, warsawParts, fmtDateTimeLang,
} from './utils.js'
import { createTranslator, DEFAULT_LANG, FORUM_WORD, fmtDateShortLang } from './i18n.js'
import { computeFixedPopupLayout, findHoverListIndexAtPoint } from './floating.js'
import { useIsMobile } from './hooks/useIsMobile.js'
import { useExclusiveHoverPopup } from './hooks/useExclusiveHoverPopup.js'
import { usePersistentState } from './hooks/usePersistentState.js'
import { usePostsData } from './hooks/usePostsData.js'
import AnimatedValue, { useTweenValue } from './components/AnimatedValue.jsx'
import { buildPaceTrend, computePaceTrendStats } from './paceTrend.js'

let _lang = DEFAULT_LANG
let _translate = createTranslator(DEFAULT_LANG)
const _t = (key) => _translate(key)

function plPosts(n, lang) {
  if (lang === 'ru') return pl(n, ['пост','поста','постов'])
  return `${n} post${n === 1 ? '' : 's'}`
}
function plDays(n, lang) {
  if (lang === 'ru') return pl(n, ['день','дня','дней'])
  if (lang === 'es') return `${n} día${n === 1 ? '' : 's'}`
  return `${n} day${n === 1 ? '' : 's'}`
}
function plSessions(n, lang) {
  if (lang === 'ru') return pl(n, ['сессия','сессии','сессий'])
  if (lang === 'es') return `${n} ${n === 1 ? 'sesión' : 'sesiones'}`
  return `${n} session${n === 1 ? '' : 's'}`
}
function plBrUpdates(n, lang) {
  if (lang === 'ru') return pl(n, ['BR-апдейт','BR-апдейта','BR-апдейтов'])
  if (lang === 'es') return `${n} ${n === 1 ? 'actualización BR' : 'actualizaciones BR'}`
  return `${n} BR update${n === 1 ? '' : 's'}`
}

// ─── HELPERS (imported from utils.js) ────────────────────────────────────────

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ values, width = 64, height = 24, color = '#4caf50' }) {
  if (!values || values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{overflow:'visible',flexShrink:0,opacity:.85}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"/>
      {/* last dot */}
      <circle cx={(width).toFixed(1)} cy={(height-((values[values.length-1]-min)/range)*height).toFixed(1)}
        r="2.5" fill={color}/>
    </svg>
  )
}

const MARATHON_TARGET = 10_000_000
const PACE_PERIOD_SECONDS = { week:7 * 86400, month:30 * 86400 }
const PACE_BIN_SIZE = 2000

function formatDollarPerMTT(value, unit = 'MTT') {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  const abs = Math.abs(rounded)
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${body}$/${unit}`
}

function formatPaceMoney(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  return fmtBR(Math.round(value))
}

function historySessionProfit(row, sorted, idx, startBR) {
  if (row?.sessionResult != null) return row.sessionResult
  const prev = idx === 0 ? startBR : sorted[idx - 1]?.brAfter
  return row?.brAfter != null && prev != null ? row.brAfter - prev : 0
}

function computePaceWindow(sorted, predicate, startBR, fallbackTotal = null) {
  const indexed = sorted
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => predicate(row))

  if (!indexed.length) return null

  const profit = indexed.reduce((sum, { row, idx }) =>
    sum + historySessionProfit(row, sorted, idx, startBR), 0)
  let tournaments = indexed.reduce((sum, { row, idx }) => sum + historySessionTournaments(row, sorted, idx), 0)

  if (!tournaments) {
    const firstIdx = indexed[0].idx
    const lastIdx = indexed[indexed.length - 1].idx
    const beforeTotal = firstIdx > 0 ? sorted[firstIdx - 1]?.totalTournaments || 0 : 0
    const lastTotal = sorted[lastIdx]?.totalTournaments || fallbackTotal || 0
    tournaments = Math.max(0, lastTotal - beforeTotal)
  }

  return {
    profit,
    tournaments:tournaments || null,
    sessions:indexed.length,
    startTs:indexed[0].row.timestamp,
    endTs:indexed[indexed.length - 1].row.timestamp,
    rate:tournaments ? profit / tournaments : null,
  }
}

// Cumulative totals are the authoritative MTT source (same one the hero counter
// shows), so every widget sums to the same number. Per-session reported counts
// are only trusted when no cumulative context exists.
function historySessionTournaments(row, sorted, idx) {
  const total = row?.totalTournaments || 0
  let prevTotal = 0
  for (let i = idx - 1; i >= 0; i--) {
    const t = sorted[i]?.totalTournaments
    if (t) { prevTotal = t; break }
  }
  if (total && prevTotal) return Math.max(0, total - prevTotal)
  if (total) return row?.tournaments || total
  // No cumulative on this row: if a later row has one, its delta will absorb
  // this session — counting the reported number here would double it.
  for (let i = idx + 1; i < sorted.length; i++) {
    if (sorted[i]?.totalTournaments) return 0
  }
  return row?.tournaments || 0
}

function buildPaceSegments(sorted, predicate, startBR, binSize = PACE_BIN_SIZE) {
  const segments = []
  let active = { profit:0, tournaments:0 }

  const flush = () => {
    if (!active.tournaments) return
    const startMtt = segments.reduce((sum, seg) => sum + seg.tournaments, 0)
    segments.push({
      ...active,
      startMtt,
      endMtt:startMtt + active.tournaments,
      rate:active.profit / active.tournaments,
      full:active.tournaments >= binSize - 0.01,
    })
    active = { profit:0, tournaments:0 }
  }

  sorted.forEach((row, idx) => {
    if (!predicate(row)) return
    const tournaments = historySessionTournaments(row, sorted, idx)
    const profit = historySessionProfit(row, sorted, idx, startBR)
    if (!tournaments) {
      // Zero-MTT report (cumulative unchanged): keep the money in the open bin
      // instead of dropping it from the rate.
      active.profit += profit
      return
    }

    // Reports are session-level, so split session profit proportionally when it crosses a bin.
    let left = tournaments
    while (left > 0) {
      const room = binSize - active.tournaments
      const take = Math.min(room, left)
      active.tournaments += take
      active.profit += profit * (take / tournaments)
      left -= take
      if (active.tournaments >= binSize - 0.01) flush()
    }
  })

  flush()
  return segments.map((seg, idx) => ({
    ...seg,
    index:idx,
    label:formatPaceSegmentLabel(seg.endMtt, binSize),
  }))
}

function formatPaceSegmentLabel(endMtt, binSize) {
  if (Math.abs(endMtt % binSize) < 0.01) return `${Math.round(endMtt / 1000)}k`
  const thousands = endMtt / 1000
  const digits = thousands < 10 ? 2 : 1
  return `${Number(thousands.toFixed(digits))}k`
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function interpolateLinearChartY(coords, x) {
  if (!coords?.length || !Number.isFinite(x)) return null
  if (coords.length === 1) return coords[0].y

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    if (x < minX || x > maxX) continue

    const span = b.x - a.x
    if (Math.abs(span) < 0.001) return b.y
    const t = (x - a.x) / span
    return a.y + (b.y - a.y) * t
  }

  const first = coords[0]
  const last = coords[coords.length - 1]
  return Math.abs(x - first.x) < Math.abs(x - last.x) ? first.y : last.y
}

function mergeMarathonMarkerCluster(cluster, yAtX = null) {
  if (!cluster.length) return null
  if (cluster.length === 1) return cluster[0]

  const first = cluster[0]
  const last = cluster[cluster.length - 1]
  const sessions = cluster.flatMap(marker => marker.sessions || [])
  const count = cluster.reduce((sum, marker) => sum + (marker.count || 1), 0)
  const profit = cluster.reduce((sum, marker) => sum + (marker.profit || 0), 0)
  const weightTotal = cluster.reduce((sum, marker) => sum + Math.max(1, marker.count || 1), 0) || 1
  const x = cluster.reduce((sum, marker) => sum + marker.x * Math.max(1, marker.count || 1), 0) / weightTotal
  const weightedY = cluster.reduce((sum, marker) => sum + marker.y * Math.max(1, marker.count || 1), 0) / weightTotal
  const projectedY = typeof yAtX === 'function' ? yAtX(x) : null
  const y = Number.isFinite(projectedY) ? projectedY : weightedY
  const hasPositive = cluster.some(marker => (marker.profit || 0) > 0 || (marker.sessions || []).some(session => session.profit > 0))
  const hasNegative = cluster.some(marker => (marker.profit || 0) < 0 || (marker.sessions || []).some(session => session.profit < 0))

  return {
    start:first.start,
    end:last.end,
    p:last.p,
    x,
    y,
    profit,
    count,
    sessions,
    parts:cluster.map(marker => ({
      start:marker.start,
      end:marker.end,
      x:marker.x,
      y:marker.y,
      profit:marker.profit,
      count:marker.count || 1,
    })),
    compacted:true,
    mixedTone:hasPositive && hasNegative,
  }
}

function compactCrowdedMarathonMarkers(markers, minGap, yAtX = null) {
  if (!markers?.length || markers.length <= 2) return markers || []

  const latest = markers[markers.length - 1]
  const keepLatestReadable = items => {
    const output = items.slice(0, -1)
    const previous = output[output.length - 1]
    if (previous && Math.hypot(latest.x - previous.x, latest.y - previous.y) < minGap * .82) {
      const beforePrevious = output[output.length - 2]
      const targetX = latest.x - minGap * .95
      const leftLimit = beforePrevious ? beforePrevious.x + minGap * .72 : previous.x - minGap
      const nextX = clampNumber(targetX, leftLimit, previous.x)
      const projectedY = typeof yAtX === 'function' ? yAtX(nextX) : null
      output[output.length - 1] = {
        ...previous,
        x:nextX,
        y:Number.isFinite(projectedY) ? projectedY : previous.y,
      }
    }
    return [...output, latest]
  }
  const tailSearchStart = Math.max(0, markers.length - 18)
  let tailStart = markers.length - 2

  while (tailStart > tailSearchStart) {
    const prev = markers[tailStart - 1]
    const current = markers[tailStart]
    if (!prev || !current) break
    const horizontalGap = current.x - prev.x
    const visualGap = Math.hypot(current.x - prev.x, current.y - prev.y)
    if (horizontalGap >= minGap * 1.35 && visualGap >= minGap * 1.55) break
    tailStart--
  }

  const body = markers.slice(tailStart, -1)
  if (body.length < 2) return keepLatestReadable(markers)

  const head = markers.slice(0, tailStart)
  const compacted = []
  let cluster = []

  const flushCluster = () => {
    const merged = mergeMarathonMarkerCluster(cluster, yAtX)
    if (merged) compacted.push(merged)
    cluster = []
  }

  body.forEach(marker => {
    if (!cluster.length) {
      cluster = [marker]
      return
    }

    const prev = cluster[cluster.length - 1]
    const prevGap = Math.hypot(marker.x - prev.x, marker.y - prev.y)
    const horizontalGap = marker.x - prev.x
    const shouldMerge = prevGap < minGap || horizontalGap < minGap * .8

    if (shouldMerge) {
      cluster.push(marker)
      return
    }

    flushCluster()
    cluster = [marker]
  })

  flushCluster()

  return keepLatestReadable([...head, ...compacted, latest])
}

function makeLinearChartPath(coords) {
  if (!coords?.length) return ''
  return `M ${coords.map(point => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')}`
}

function makeLinearChartArea(coords, baseline) {
  if (!coords?.length) return ''
  return `${makeLinearChartPath(coords)} L ${coords[coords.length - 1].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${baseline} Z`
}

function estimateSvgTextWidth(text, fontSize) {
  return String(text || '').length * fontSize * .58
}

function svgTextRect({ x, y, text, fontSize, anchor = 'middle' }) {
  const width = estimateSvgTextWidth(text, fontSize)
  const height = fontSize + 4
  let left = x - width / 2
  if (anchor === 'end') left = x - width
  if (anchor === 'start') left = x
  return {
    left,
    right:left + width,
    top:y - height + 3,
    bottom:y + 4,
  }
}

function rectsOverlap(a, b, gap = 0) {
  if (!a || !b) return false
  return a.left < b.right + gap
    && a.right > b.left - gap
    && a.top < b.bottom + gap
    && a.bottom > b.top - gap
}

function resolvePaceTrendLabelLayout({ trend, text, latestValue, latestPoint, gridLeft, gridRight, plotTop, plotBottom }) {
  if (!trend) return null

  const fontSize = 8.6
  const minX = gridLeft + 92
  const maxX = gridRight - 18
  const minY = plotTop + 13
  const maxY = plotBottom - 8
  const primaryY = clampNumber(trend.endY + (trend.rising ? -10 : 14), minY, maxY)
  const primaryX = clampNumber(trend.endX - 18, minX, maxX)
  const blockers = []

  if (latestValue?.show) {
    blockers.push(svgTextRect({
      x:latestValue.x,
      y:latestValue.y,
      text:latestValue.text,
      fontSize:10,
      anchor:latestValue.anchor,
    }))
  }

  if (latestPoint) {
    blockers.push({
      left:latestPoint.x - 12,
      right:latestPoint.x + 12,
      top:latestPoint.y - 12,
      bottom:latestPoint.y + 12,
    })
  }

  const makeLayout = (x, y, shifted = false) => {
    const next = { x, y, shifted }
    return {
      ...next,
      rect:svgTextRect({ x, y, text, fontSize, anchor:'end' }),
    }
  }

  let layout = makeLayout(primaryX, primaryY)
  if (!blockers.some(blocker => rectsOverlap(layout.rect, blocker, 3))) return layout

  const shiftedX = blockers.reduce((nextX, blocker) => (
    rectsOverlap(layout.rect, blocker, 3) ? Math.min(nextX, blocker.left - 6) : nextX
  ), primaryX)
  layout = makeLayout(clampNumber(shiftedX, minX, maxX), primaryY, true)
  if (!blockers.some(blocker => rectsOverlap(layout.rect, blocker, 3))) return layout

  const latestSafeY = latestPoint
    ? (trend.rising ? latestPoint.y + 24 : latestPoint.y - 21)
    : trend.endY + (trend.rising ? 25 : -21)
  const alternateY = clampNumber(
    trend.rising ? Math.max(trend.endY + 25, latestSafeY) : Math.min(trend.endY - 21, latestSafeY),
    minY,
    maxY
  )
  layout = makeLayout(primaryX, alternateY, true)
  if (!blockers.some(blocker => rectsOverlap(layout.rect, blocker, 3))) return layout

  const alternateShiftedX = blockers.reduce((nextX, blocker) => (
    rectsOverlap(layout.rect, blocker, 3) ? Math.min(nextX, blocker.left - 6) : nextX
  ), primaryX)
  return makeLayout(clampNumber(alternateShiftedX, minX, maxX), alternateY, true)
}

function formatPaceAxisTick(value, unit) {
  if (Math.abs(value) < .05) return '0'
  return formatDollarPerMTT(value, unit).replace(`/${unit}`, '')
}

function buildSmoothSvgPath(points, tension = .64, minY = -Infinity, maxY = Infinity) {
  if (!points.length) return ''
  const p = point => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  if (points.length === 1) return `M ${p(points[0])}`
  if (points.length === 2) return `M ${p(points[0])} L ${p(points[1])}`

  let d = `M ${p(points[0])}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) * tension / 6
    const cp1y = clampNumber(p1.y + (p2.y - p0.y) * tension / 6, minY, maxY)
    const cp2x = p2.x - (p3.x - p1.x) * tension / 6
    const cp2y = clampNumber(p2.y - (p3.y - p1.y) * tension / 6, minY, maxY)
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p(p2)}`
  }
  return d
}

function computePaceMetrics({ meta, stats, period, target = MARATHON_TARGET, now = Date.now() / 1000 }) {
  const sorted = (meta?.brHistory || [])
    .slice()
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
  if (!sorted.length || !stats?.br) return null

  const startBR = stats.startBR || meta?.startBankroll || 10000
  const totalTournaments = stats.totalTourneys || meta?.totalTournaments || null
  const currentPredicate = period === 'all'
    ? () => true
    : (() => {
      const seconds = PACE_PERIOD_SECONDS[period]
      if (!seconds) return () => false
      const cutoff = now - seconds
      return row => (row.timestamp || 0) >= cutoff
    })()
  const current = computePaceWindow(sorted, currentPredicate, startBR, totalTournaments)

  if (!current?.tournaments) return current ? { current, period, target, remaining:Math.max(0, target - stats.br) } : null

  let previous = null
  if (period !== 'all' && PACE_PERIOD_SECONDS[period]) {
    const seconds = PACE_PERIOD_SECONDS[period]
    const start = now - seconds * 2
    const end = now - seconds
    previous = computePaceWindow(sorted, row => {
      const ts = row.timestamp || 0
      return ts >= start && ts < end
    }, startBR)
  }

  const remaining = Math.max(0, target - stats.br)
  const rate = current.rate
  const finishMTT = rate > 0 ? Math.ceil(remaining / rate) : null
  const bustMTT = rate < 0 ? Math.ceil(stats.br / Math.abs(rate)) : null
  const deltaRate = previous?.rate != null && rate != null ? rate - previous.rate : null
  const segments = buildPaceSegments(sorted, currentPredicate, startBR, PACE_BIN_SIZE)

  return {
    period,
    target,
    current,
    previous,
    segments,
    trend:computePaceTrendStats(segments),
    binSize:PACE_BIN_SIZE,
    rate,
    deltaRate,
    finishMTT,
    bustMTT,
    remaining,
  }
}

function PaceRateValue({ value, unit, className = '', animate = true }) {
  const animated = useTweenValue(value ?? 0, animate ? 620 : 0)
  const [pulse, setPulse] = useState(false)
  const prev = useRef(value)
  useEffect(() => {
    if (animate && prev.current !== value) {
      prev.current = value
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 650)
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [animate, value])
  if (value == null) return <span className={className}>—</span>
  const tone = value > 0 ? 'pos' : value < 0 ? 'neg' : ''
  return <span className={`pace-rate-value ${tone} ${pulse ? 'pulse' : ''} ${className}`}>{formatDollarPerMTT(animated, unit)}</span>
}

function PaceMiniChart({ segments, unit, t }) {
  const [hovered, setHovered] = useState(null)
  // Must stay above the early return so the hook order never changes.
  const isMobile = useIsMobile()
  if (!segments?.length) return <div className="pace-chart-empty">{t('pace_chart_empty')}</div>

  // Same reasoning as the marathon chart: a 920-wide canvas rendered into a
  // ~335px column scaled everything to 0.36, leaving the axis labels at ~3px.
  // Authoring near the real render width keeps them legible.
  const width = isMobile ? 340 : 920
  const height = isMobile ? 220 : 230
  // left must clear the right-aligned Y tick labels, which are drawn at
  // gridLeft - 13 and run ~34 units wide at the mobile font size.
  const pad = isMobile
    ? { left:54, right:14, top:26, bottom:36 }
    : { left:58, right:28, top:32, bottom:42 }
  const gridLeft = pad.left
  const gridRight = width - pad.right
  const basePlotW = gridRight - gridLeft
  const plotH = height - pad.top - pad.bottom
  const maxAbs = Math.max(5, ...segments.map(seg => Math.abs(seg.rate || 0)))
  const zeroY = pad.top + plotH / 2
  const barW = Math.max(12, Math.min(34, basePlotW / Math.max(1, segments.length) * .48))
  const pointLeft = gridLeft
  const pointRight = gridRight - barW / 2
  const pointW = pointRight - pointLeft
  const maxMtt = Math.max(1, ...segments.map(seg => seg.endMtt || 0))
  const xByMtt = value => pointLeft + clampNumber(value / maxMtt, 0, 1) * pointW
  const x = idx => xByMtt(segments[idx]?.endMtt || 0)
  const y = value => pad.top + (maxAbs - value) / (maxAbs * 2) * plotH
  const yTicks = [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs]
  const points = segments.map((seg, idx) => ({ x:x(idx), y:y(seg.rate) }))
  const originPoint = { x:pointLeft, y:zeroY }
  const hasPartialTail = !segments[segments.length - 1].full
  const fullPoints = hasPartialTail ? points.slice(0, -1) : points
  const solidPoints = [originPoint, ...fullPoints]
  const solidLinePath = buildSmoothSvgPath(solidPoints, .62, pad.top, pad.top + plotH)
  const lastSolidPoint = solidPoints[solidPoints.length - 1]
  const areaPath = solidLinePath && solidPoints.length > 1 && lastSolidPoint
    ? `${solidLinePath} L ${lastSolidPoint.x.toFixed(1)} ${zeroY.toFixed(1)} L ${solidPoints[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
    : ''
  const partialStartPoint = fullPoints.length ? fullPoints[fullPoints.length - 1] : originPoint
  const partialTailPath = hasPartialTail
    ? `M ${partialStartPoint.x.toFixed(1)} ${partialStartPoint.y.toFixed(1)} L ${points[points.length - 1].x.toFixed(1)} ${points[points.length - 1].y.toFixed(1)}`
    : ''
  const partialTailTone = hasPartialTail && segments[segments.length - 1].rate >= 0 ? 'pos' : 'neg'
  const bestIdx = segments.reduce((best, seg, idx) => seg.rate > segments[best].rate ? idx : best, 0)
  const worstIdx = segments.reduce((worst, seg, idx) => seg.rate < segments[worst].rate ? idx : worst, 0)
  const labelIndexes = new Set([segments.length - 1, bestIdx, worstIdx])
  if (segments.length <= 3) segments.forEach((_, idx) => labelIndexes.add(idx))
  const trend = buildPaceTrend(segments, { maxMtt, maxAbs, xByMtt, y })
  const latestIdx = segments.length - 1
  const latestSeg = segments[latestIdx]
  const latestPoint = points[latestIdx]
  const latestShowsRateLabel = Boolean(latestSeg && labelIndexes.has(latestIdx))
  const latestValueText = latestSeg ? formatDollarPerMTT(latestSeg.rate, unit).replace(`/${unit}`, '') : ''
  const latestValueIsEdge = latestPoint && latestPoint.x > gridRight - 42
  const latestValueLayout = latestSeg && latestPoint ? {
    show:latestShowsRateLabel,
    text:latestValueText,
    x:latestValueIsEdge ? latestPoint.x - 10 : latestPoint.x,
    y:latestPoint.y + (latestSeg.rate >= 0 ? -11 : 17),
    anchor:latestValueIsEdge ? 'end' : 'middle',
  } : null
  const trendLabelText = trend ? `${t('pace_trend_label')} ${formatPaceAxisTick(trend.endRate, unit)}` : ''
  const trendLabel = trend ? resolvePaceTrendLabelLayout({
    trend,
    text:trendLabelText,
    latestValue:latestValueLayout,
    latestPoint,
    gridLeft,
    gridRight,
    plotTop:pad.top,
    plotBottom:pad.top + plotH,
  }) : null
  const xLabelIndexes = new Set()
  segments.forEach((_, idx) => {
    if (segments.length <= 8 || idx % 2 === 0 || idx === segments.length - 1) xLabelIndexes.add(idx)
  })
  // Drop x-axis ticks that would collide with the final (current-total) label.
  // The partial tail can end only a few MTT past the last full bin (e.g. 14k vs
  // 14.2k), which otherwise renders as overlapping text.
  const lastLabelIdx = segments.length - 1
  const lastLabelX = x(lastLabelIdx)
  for (const idx of [...xLabelIndexes]) {
    if (idx !== lastLabelIdx && Math.abs(x(idx) - lastLabelX) < 30) xLabelIndexes.delete(idx)
  }
  const firstTone = segments[0]?.rate >= 0 ? '#78d984' : '#f0756d'
  const lineStops = [
    { offset:'0%', color:firstTone },
    ...segments.map(seg => ({
      offset:`${(seg.endMtt || 0) / maxMtt * 100}%`,
      color:seg.rate >= 0 ? '#78d984' : '#f0756d',
    })),
  ]
  const openTooltip = (seg, idx, cx, cy) => {
    setHovered({
      seg,
      idx,
      x:cx,
      y:cy,
      align:cx > width * .72 ? 'left' : cx < width * .28 ? 'right' : 'center',
      vertical:cy < height * .38 ? 'below' : 'above',
    })
  }
  const closeTooltip = () => setHovered(null)

  return (
    <div className="pace-chart-wrap" data-testid="pace-chart" onMouseLeave={closeTooltip}>
      <svg className="pace-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('pace_chart_label')}>
        <defs>
          <linearGradient id="paceAreaGrad" x1="0" y1={pad.top} x2="0" y2={pad.top + plotH} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity=".12"/>
            <stop offset="60%" stopColor="#ffffff" stopOpacity=".04"/>
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="paceLineGrad" x1={gridLeft} y1="0" x2={gridRight} y2="0" gradientUnits="userSpaceOnUse">
            {lineStops.map((stop, idx) => <stop key={`${stop.offset}-${idx}`} offset={stop.offset} stopColor={stop.color}/>)}
          </linearGradient>
        </defs>
        <rect x={gridLeft} y={pad.top} width={basePlotW} height={plotH} rx="12" className="pace-plot-bg"/>
        {yTicks.map(rate => {
          const tickY = y(rate)
          const isZero = Math.abs(rate) < .05
          return (
            <g key={`yt-${rate.toFixed(3)}`} className={isZero ? 'pace-y-tick zero' : 'pace-y-tick'}>
              <line className={`pace-grid-line ${isZero ? 'pace-zero' : ''}`} x1={gridLeft} x2={gridRight} y1={tickY} y2={tickY}/>
              <text className={`pace-y-label ${isZero ? 'zero' : ''}`} x={gridLeft - 13} y={tickY + 4}>
                {formatPaceAxisTick(rate, unit)}
              </text>
            </g>
          )
        })}
        {segments.map((seg, idx) => {
          const cx = x(idx)
          return <line key={`guide-${idx}`} className="pace-chunk-guide" x1={cx} x2={cx} y1={pad.top + 6} y2={pad.top + plotH - 6}/>
        })}
        {areaPath && <path className="pace-area" d={areaPath}/>}
        {trend && (
          <g className={`pace-trend ${trend.rising ? 'rising' : 'falling'} ${trendLabel?.shifted ? 'shifted' : ''}`} aria-hidden="true">
            <path className="pace-trend-line" d={trend.path}/>
            <text className={`pace-trend-label ${trend.rising ? 'rising' : 'falling'}`} x={trendLabel?.x} y={trendLabel?.y}>
              {trendLabelText}
            </text>
          </g>
        )}
        {solidPoints.length > 1 && <path className="pace-line-rail" d={solidLinePath}/>}
        {solidPoints.length > 1 && <path className="pace-line" d={solidLinePath}/>}
        {partialTailPath && <path className="pace-line-rail partial" d={partialTailPath}/>}
        {partialTailPath && <path className={`pace-line partial ${partialTailTone}`} d={partialTailPath}/>}
        {segments.map((seg, idx) => {
          const cx = x(idx)
          const rateY = y(seg.rate)
          const tone = seg.rate >= 0 ? 'pos' : 'neg'
          const isLatest = idx === segments.length - 1
          const isBest = idx === bestIdx
          const isWorst = idx === worstIdx
          const showRateLabel = labelIndexes.has(idx) && (idx === segments.length - 1 || Math.abs(seg.rate) >= Math.max(1, maxAbs * .08))
          const isPartial = !seg.full
          const isRightEdgeLabel = isLatest && cx > gridRight - 42
          const valueLabelX = isRightEdgeLabel ? cx - 10 : cx
          return (
            <g key={`${idx}-${seg.endMtt}`} className={`pace-segment ${tone} ${isPartial ? 'partial' : ''} ${isLatest ? 'latest' : ''} ${isBest ? 'best' : ''} ${isWorst ? 'worst' : ''}`}
              onMouseEnter={() => openTooltip(seg, idx, cx, rateY)}
              onMouseMove={() => openTooltip(seg, idx, cx, rateY)}
              onPointerEnter={() => openTooltip(seg, idx, cx, rateY)}
              onPointerMove={() => openTooltip(seg, idx, cx, rateY)}
              onFocus={() => openTooltip(seg, idx, cx, rateY)}
              onBlur={closeTooltip}
              onClick={(e) => { e.stopPropagation(); openTooltip(seg, idx, cx, rateY) }}
              tabIndex="0" role="button" aria-label={`${seg.label}: ${formatDollarPerMTT(seg.rate, unit)}${isPartial ? `, ${t('pace_tip_partial')}` : ''}`}>
              <circle className="pace-dot-hit" cx={cx} cy={rateY} r={isMobile ? 16 : 12}/>
              {isPartial && <circle className="pace-dot-partial-ring" cx={cx} cy={rateY} r="8.2"/>}
              {isLatest && <circle className="pace-dot-latest-ring" cx={cx} cy={rateY} r="8.4"/>}
              <circle className="pace-dot" cx={cx} cy={rateY} r={isLatest ? 5 : 3.8}/>
              {showRateLabel && (
                <text className={`pace-chart-value ${tone} ${isRightEdgeLabel ? 'edge' : ''}`} x={valueLabelX} y={rateY + (seg.rate >= 0 ? -11 : 17)}>
                  {formatDollarPerMTT(seg.rate, unit).replace(`/${unit}`, '')}
                </text>
              )}
              {xLabelIndexes.has(idx) && <text className="pace-x-label" x={cx} y={height - 22}>{seg.label}</text>}
            </g>
          )
        })}
      </svg>
      {hovered && (
        <div className={`pace-point-tooltip ${hovered.align} ${hovered.vertical}`}
          style={{ left:`${hovered.x / width * 100}%`, top:`${hovered.y / height * 100}%` }}>
          <div className="pace-point-tooltip-head">
            <span>{t('pace_tip_chunk')} {hovered.seg.label}{!hovered.seg.full && <em>{t('pace_tip_partial')}</em>}</span>
            <b className={hovered.seg.rate >= 0 ? 'pos' : 'neg'}>{formatDollarPerMTT(hovered.seg.rate, unit)}</b>
          </div>
          {!hovered.seg.full && (
            <div className="pace-point-tooltip-row">
              <span>{t('pace_tip_net')}</span>
              <b className={hovered.seg.profit >= 0 ? 'pos' : 'neg'}>{formatPaceMoney(hovered.seg.profit)}</b>
            </div>
          )}
          <div className="pace-point-tooltip-row">
            <span>{t('pace_tip_tournaments')}</span>
            <b>{fmtInt(Math.round(hovered.seg.tournaments))} {unit}</b>
          </div>
          <div className="pace-point-tooltip-formula">
            <span className="pace-formula-label">{t('pace_tip_formula')}</span>
            <span className="pace-formula-eq"><b>{formatPaceMoney(hovered.seg.profit)}</b> / <b>{fmtInt(Math.round(hovered.seg.tournaments))}</b> = <b className={hovered.seg.rate >= 0 ? 'pos' : 'neg'}>{formatDollarPerMTT(hovered.seg.rate, unit)}</b></span>
          </div>
        </div>
      )}
    </div>
  )
}

function PaceWidget({ meta, stats, period, setPeriod, lang, t }) {
  const pace = useMemo(() => computePaceMetrics({ meta, stats, period }), [meta, stats, period])
  if (!pace?.current) return null

  const currentRate = pace.rate
  const prevRate = pace.previous?.rate
  const deltaRate = pace.deltaRate
  const isNegative = currentRate != null && currentRate < 0
  const paceRateLabel = period === 'all' ? t('pace_rate_all') : t('pace_rate_now')
  const mttUnit = t('sr_mtt_short')
  const finishTarget = pace.finishMTT || pace.bustMTT || null
  const showHistory = prevRate != null
  const showTrend = pace.trend?.endRate != null

  return (
    <section className={`pace-widget ${isNegative ? 'negative' : currentRate > 0 ? 'positive' : ''}`} data-testid="pace-widget">
      <div className="pace-head">
        <div>
          <h2 className="section-title">{t('pace_title')}</h2>
        </div>
        <div className="pace-periods">
          {[['week', t('period_week')], ['month', t('period_month')], ['all', t('period_all')]].map(([key, label]) => (
            <button type="button" key={key} className={`mc-period ${period === key ? 'active' : ''}`}
              aria-pressed={period === key} onClick={() => setPeriod(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pace-dashboard">
        <div className={`pace-summary-panel marathon-progress-side ${showHistory ? 'has-history' : 'no-history'} ${showTrend ? 'has-trend' : 'no-trend'}`}>
          <div className="mps-item pace-rate-item">
            <span className="mps-label">{paceRateLabel}</span>
            <span className="mps-value-row">
              <PaceRateValue value={currentRate} unit={mttUnit} className="mps-value" animate={false}/>
            </span>
            <span className="pace-summary-note">{fmtBR(pace.current.profit)} / {fmtInt(pace.current.tournaments)} {mttUnit}</span>
          </div>
          <div className="mps-divider"/>
          <div className="mps-item pace-projection-item">
            <span className="mps-label">{isNegative ? t('pace_to_zero') : t('pace_finish')}</span>
            {finishTarget ? <TempoValue target={finishTarget} title={t('pace_at_current')} animate={false} suffix={` ${t('pace_projection_unit')}`}/> : <span className="mps-value">—</span>}
          </div>
          {showTrend && <>
            <div className="mps-divider"/>
            <div className="mps-item pace-trend-item">
              <span className="mps-label">{t('pace_trend_card')}</span>
              <span className="mps-value">
                <PaceRateValue value={pace.trend.endRate} unit={mttUnit} animate={false}/>
              </span>
              <span className="pace-summary-note">{t('pace_trend_note')}</span>
            </div>
          </>}
          {showHistory && <>
            <div className="mps-divider"/>
            <div className="mps-item pace-history-item">
              <span className="mps-label">{t('pace_rate_prev')}</span>
              <span className="mps-value">
                <PaceRateValue value={prevRate} unit={mttUnit} animate={false}/>
              </span>
              <span className="pace-summary-note">{`${t('pace_delta')}: ${formatDollarPerMTT(deltaRate, mttUnit)}`}</span>
            </div>
          </>}
        </div>
        <div className="pace-chart-meta">
          <div className="pace-chart-title">
            <b>{t('pace_chart_step')}: {fmtInt(pace.binSize)} {mttUnit}</b>
          </div>
        </div>
        <PaceMiniChart segments={pace.segments} unit={mttUnit} t={t}/>
      </div>
    </section>
  )
}

// ─── MARATHON CHART (bezier functions imported from utils.js) ─────────────────

const CHART_ROOMS = [
  { key:'gg',   label:'GG',    logo:'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://ggpoker.com&size=64' },
  { key:'ps',   label:'Stars', logo:'https://www.gipsyteam.ru/upload/Pokerroomwidgetlogo/default/1.png?1651069603' },
  { key:'king', label:'King',  logo:'https://www.gipsyteam.ru/upload/Pokerroomwidgetlogo/default/9.png?1650962615' },
  { key:'coin', label:'Coin',  logo:'https://www.gipsyteam.ru/upload/Pokerroomwidgetlogo/default/1/109.webp?1772698374' },
  { key:'lux',  label:'Lux',   logo:'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://luxon.com&size=64' },
]

const CHART_MONTHS_BY_LANG = {
  ru:['ЯНВ','ФЕВ','МАР','АПР','МАЙ','ИЮН','ИЮЛ','АВГ','СЕН','ОКТ','НОЯ','ДЕК'],
  en:['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
  es:['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],
}

// Milestone plate geometry — shared with the peak-callout scorer so the peak
// leader can steer around these plates. Sizes kept compact on purpose.
const MILESTONE_PLATE_LAYOUTS = {
  recovery:{ desktop:{ width:92, height:28, dx:-14, dy:-36 }, mobile:{ width:116, height:40, dx:4, dy:-56 } },
  best:{ desktop:{ width:72, height:28, dx:-31, dy:-36 }, mobile:{ width:94, height:40, dx:-54, dy:-56 } },
  twoHundred:{ desktop:{ width:64, height:28, dx:-24, dy:-36 }, mobile:{ width:86, height:40, dx:-44, dy:-56 } },
}
function milestonePlateRect(type, point, isMobile, frame) {
  const layout = MILESTONE_PLATE_LAYOUTS[type]?.[isMobile ? 'mobile' : 'desktop']
  if (!layout || !point) return null
  const { W, pL, pR, pT, plotBottom } = frame
  const cx = clampNumber(point.x + layout.dx, pL + layout.width / 2 + 5, W - pR - layout.width / 2 - 5)
  const cy = clampNumber(point.y + layout.dy, pT + layout.height / 2 + 5, plotBottom - layout.height / 2 - 5)
  return {
    layout, cx, cy,
    left:cx - layout.width / 2, right:cx + layout.width / 2,
    top:cy - layout.height / 2, bottom:cy + layout.height / 2,
  }
}

function MarathonMilestoneCallout({ milestone, type, isMobile, W, pL, pR, pT, plotBottom }) {
  if (!milestone) return null
  const { point, p, i, primary, secondary } = milestone
  const sourceId = p?.id || `point-${i}`

  if (isMobile && type !== 'best') {
    return (
      <g className={`mc-milestone-callout ${type} compact`} data-source-id={sourceId} data-source-index={i}>
        <circle className="mc-milestone-anchor muted" cx={point.x} cy={point.y} r="4.3"/>
      </g>
    )
  }

  const plate = milestonePlateRect(type, point, isMobile, { W, pL, pR, pT, plotBottom })
  if (!plate) return null
  const { layout, cx, cy, left, top } = plate
  const leaderX = clampNumber(point.x, left + 8, left + layout.width - 8)
  const leaderY = top + layout.height

  return (
    <g className={`mc-milestone-callout ${type}`} data-source-id={sourceId} data-source-index={i}>
      <line className="mc-milestone-leader" data-role="milestone-leader"
        x1={point.x} y1={point.y} x2={leaderX} y2={leaderY}/>
      <circle className="mc-milestone-anchor" cx={point.x} cy={point.y} r={isMobile ? 5.1 : 4.1}/>
      <rect className="mc-milestone-plate" x={left} y={top}
        width={layout.width} height={layout.height} rx={isMobile ? 8 : 6}/>
      <text className="mc-milestone-label" x={cx} y={cy - (isMobile ? 3 : 2)} textAnchor="middle">
        <tspan className="mc-milestone-primary" x={cx}>{primary}</tspan>
        <tspan className="mc-milestone-secondary" x={cx} dy={isMobile ? 17 : 12}>{secondary}</tspan>
      </text>
    </g>
  )
}

function MarathonChart({ posts, meta, startBR, setLightbox, period, setPeriod, lang, t }) {
  const [tip, setTip]     = useState(null)
  const [tipVisible, setTipVisible] = useState(false)
  const [pathLen, setPathLen] = useState(null)
  const setPeriodPersist = (p) => {
    setPeriod(p)
  }
  const pathRef = useRef(null)
  const chartRef = useRef(null)
  const tipCloseTimer = useRef(null)
  const isMobile = useIsMobile()
  const closeTip = useCallback(() => {
    setTipVisible(false)
    clearTimeout(tipCloseTimer.current)
    tipCloseTimer.current = setTimeout(() => setTip(null), 130)
  }, [])
  const openTipState = useCallback((nextTip) => {
    clearTimeout(tipCloseTimer.current)
    setTip(nextTip)
    const raf = typeof window !== 'undefined' && window.requestAnimationFrame
      ? window.requestAnimationFrame
      : (fn) => setTimeout(fn, 0)
    raf(() => setTipVisible(true))
  }, [])
  const { announceOpen: announceHoverPopupOpen } = useExclusiveHoverPopup(closeTip)

  useEffect(() => () => clearTimeout(tipCloseTimer.current), [])

  // Close tooltip on click outside chart
  useEffect(() => {
    if (!tip) return
    const handler = (e) => {
      if (chartRef.current && !chartRef.current.contains(e.target)) closeTip()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [tip, closeTip])

  // Reset animation on period change so line redraws
  useEffect(() => { setPathLen(null) }, [period])

  const allPoints = useMemo(() => {
    if (meta?.brHistory?.length) {
      return meta.brHistory
        .slice()
        .sort((a,b) => (a.timestamp||0)-(b.timestamp||0))
        .map((h,i,arr) => ({
          id:h.id,
          br:h.brAfter, brPrev:i===0?startBR:arr[i-1].brAfter,
          date:h.date, timestamp:h.timestamp, text:h.text||'',
          url:h.url||`https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=${h.id}`,
          images:[], sessionResult:h.sessionResult, rooms:h.rooms||null,
          tournaments:h.tournaments||null, totalTournaments:h.totalTournaments||null,
        }))
    }
    return posts
      .filter(p => ROMEO_RE.test(p.author) && p.brAfter)
      .sort((a,b) => (a.timestamp||0)-(b.timestamp||0))
      .map((p,i,arr) => ({
        id:p.id,
        br:p.brAfter, brPrev:i===0?startBR:arr[i-1].brAfter,
        date:p.date, timestamp:p.timestamp, text:p.text, url:p.url,
        images:p.images||[], sessionResult:p.sessionResult,
      }))
  }, [posts, meta, startBR])

  // Period filter: keep points within cutoff. If result < 2 points, fall back to all.
  const points = useMemo(() => {
    if (period === 'all' || !allPoints.length) return allPoints
    const now = Date.now() / 1000
    const cutoff = period === 'week' ? now - 7*86400 : period === 'month' ? now - 30*86400 : 0
    const filtered = allPoints.filter(p => (p.timestamp||0) >= cutoff)
    return filtered.length >= 2 ? filtered : allPoints
  }, [allPoints, period])

  useEffect(() => {
    if (pathRef.current) setPathLen(pathRef.current.getTotalLength())
  }, [points.length, isMobile])

  // On mobile the SVG is authored close to the width it actually renders at
  // (~340px), so one user unit ≈ one CSS px and the axis labels keep their
  // intended size. A wider canvas (the old 520) got scaled down to ~0.66,
  // shrinking every label with it. Label collision math is in the same user
  // units, so a narrower canvas simply thins the labels out on its own.
  const W = isMobile ? 360 : 700
  const H = isMobile ? (period === 'all' ? 380 : 310) : 240
  const pL = isMobile ? 46 : 58
  const pR = isMobile ? 18 : 22
  const pT = isMobile ? 18 : 14
  const pB = isMobile ? 58 : 44
  const plotBottom = H - pB
  // 'all' keeps the legacy absolute scale (start anchored); week/month zoom the
  // Y domain to the visible points — previously the line used 10-17% of the
  // plot height because the $10k start stayed pinned into the domain.
  const isZoomedView = period !== 'all' && points.length < allPoints.length
  const dataMin = isZoomedView
    ? Math.min(...points.map(p=>p.br))
    : Math.min(...points.map(p=>p.br), startBR)
  const dataMax = isZoomedView
    ? Math.max(...points.map(p=>p.br))
    : Math.max(...points.map(p=>p.br), startBR)
  const rangePad = Math.max((dataMax - dataMin) * 0.12, 400)
  const minV = isZoomedView
    ? Math.max(0, Math.floor((dataMin - rangePad) / 1000) * 1000)
    : Math.max(0, Math.floor(dataMin * 0.7 / 1000) * 1000)
  const maxV = isZoomedView ? dataMax + rangePad : dataMax * 1.05
  const yOf = v => pT + (1-(v-minV)/(maxV-minV)) * (plotBottom-pT)

  // Two arrays: cumMTT (absolute totals, used for display labels) and cumMTTX
  // (normalized + anti-overlap, used for X-axis positioning). Mixing them caused
  // the "last point shows 5004 instead of 5171" bug — normalization subtracted
  // the first session's own MTT count as base.
  const hasMTT = points.length > 1 && points.some(p => p.totalTournaments)
  const { cumMTT, cumMTTX } = (() => {
    const raw = points.map(p => p.totalTournaments || 0)
    // Forward-fill zeros (use previous value + session tournaments)
    for (let i = 1; i < raw.length; i++) {
      if (!raw[i] && raw[i-1]) raw[i] = raw[i-1] + (points[i].tournaments || 0)
    }
    // Positioning: normalize so filtered views start at x=0
    const base = raw[0] || 0
    const norm = raw.map(c => c - base)
    // Anti-overlap nudge: only for data anomalies (duplicate/decreasing totalTournaments).
    // Strict proportionality otherwise. ~0.8% of total range = visible gap.
    // Nudge sized below the typical real step: 0.8% of range used to exceed the
    // dense tail's session deltas, so every later point got re-nudged and the
    // "MTT-proportional" axis degenerated into uniform spacing.
    const deltas = []
    for (let i = 1; i < norm.length; i++) {
      const d = norm[i] - norm[i-1]
      if (d > 0) deltas.push(d)
    }
    const medianDelta = deltas.length
      ? deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)]
      : 0
    const maxSoFar = norm[norm.length - 1] || 1
    const nudge = Math.max(1, Math.min(maxSoFar * 0.008, medianDelta ? medianDelta * 0.5 : maxSoFar * 0.008))
    for (let i = 1; i < norm.length; i++) {
      if (norm[i] <= norm[i-1]) norm[i] = norm[i-1] + nudge
    }
    return { cumMTT: raw, cumMTTX: norm }
  })()
  const totalMTTX = cumMTTX[cumMTTX.length - 1] || 1

  const xOf = (() => {
    if (!hasMTT || totalMTTX === 0)
      return i => pL + (i / Math.max(points.length - 1, 1)) * (W - pL - pR)
    return i => pL + (cumMTTX[i] / totalMTTX) * (W - pL - pR)
  })()
  const coords = points.map((p,i) => ({ x:xOf(i), y:yOf(p.br) }))
  const allTimeMonthTicks = (() => {
    if (period !== 'all') return []
    const seen = new Set()
    const months = CHART_MONTHS_BY_LANG[lang] || CHART_MONTHS_BY_LANG.ru
    return points.flatMap((p, i) => {
      const parts = warsawParts(p.timestamp)
      if (!parts) return []
      const key = `${parts.year}-${parts.month}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{
        i,
        p,
        x:coords[i]?.x,
        label:months[parts.month - 1],
        year:parts.year,
      }]
    }).filter(tick => Number.isFinite(tick.x))
  })()
  const monthTicks = (() => {
    if (allTimeMonthTicks.length <= 3) return allTimeMonthTicks
    if (isMobile) {
      const middle = allTimeMonthTicks[Math.floor(allTimeMonthTicks.length / 2)]
      return [...new Map([
        allTimeMonthTicks[0],
        middle,
        allTimeMonthTicks[allTimeMonthTicks.length - 1],
      ].map(tick => [tick.i, tick])).values()]
    }

    const first = allTimeMonthTicks[0]
    const latest = allTimeMonthTicks[allTimeMonthTicks.length - 1]
    const minGap = 68
    const spaced = [first]
    for (let i = 1; i < allTimeMonthTicks.length - 1; i++) {
      const tick = allTimeMonthTicks[i]
      const previous = spaced[spaced.length - 1]
      if (tick.x - previous.x >= minGap && latest.x - tick.x >= minGap) spaced.push(tick)
    }
    spaced.push(latest)
    if (spaced.length <= 8) return spaced

    return [...new Map(Array.from({ length:8 }, (_, i) => {
      const index = Math.round(i * (spaced.length - 1) / 7)
      return spaced[index]
    }).map(tick => [tick.i, tick])).values()]
  })()
  const yAtChartX = x => interpolateLinearChartY(coords, x)
  const linePath = makeLinearChartPath(coords)
  const areaPath = makeLinearChartArea(coords, plotBottom)
  const fmtMoneyTick = v => {
    if (v >= 1000) {
      const k = v / 1000
      return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`
    }
    return `$${v}`
  }
  // Y ticks: true linear scale.
  const yTicks = (() => {
    const candidates = [1000,2000,5000,10000,20000,50000]
    const range = maxV - minV
    const step = candidates.find(s => { const n = Math.floor(range / s); return n >= 3 && n <= 7 }) || 2000
    const ticks = []
    const first = Math.ceil(minV / step) * step
    for (let v = first; v < maxV; v += step) {
      ticks.push({ v, y: yOf(v) })
    }
    return ticks
  })()
  const xAxisY = plotBottom + (isMobile ? 18 : 16)
  const xMainLabelY = xAxisY + (isMobile ? 19 : 16)
  const xSubLabelY = xMainLabelY + (isMobile ? 13 : 11)
  const xLabelEdgePad = isMobile ? 6 : 8
  const xLabelExtraBottom = 0
  const signOfProfit = v => v > 0 ? 1 : v < 0 ? -1 : 0
  const sessionProfitAt = i => {
    const p = points[i]
    if (!p) return 0
    return p.sessionResult ?? (p.br - p.brPrev)
  }
  const profitSignAt = i => signOfProfit(sessionProfitAt(i))
  const mttDeltaAt = i => {
    const p = points[i]
    if (!p) return null
    if (p.tournaments) return p.tournaments
    const prevTotal = i > 0 ? points[i - 1]?.totalTournaments : null
    if (p.totalTournaments && prevTotal) return Math.max(0, p.totalTournaments - prevTotal)
    return null
  }
  const isRangeView = period !== 'all' && points.length < allPoints.length
  const rangeBaseline = (() => {
    if (!isRangeView || !points.length) return null
    const first = points[0]
    const allIndex = allPoints.findIndex(p => p === first)
    const prevPoint = allIndex > 0 ? allPoints[allIndex - 1] : null
    const firstSessionMTT = first.tournaments
      ?? (first.totalTournaments && prevPoint?.totalTournaments
        ? Math.max(0, first.totalTournaments - prevPoint.totalTournaments)
        : null)
    const tournaments = prevPoint?.totalTournaments
      ?? (first.totalTournaments != null && firstSessionMTT != null
        ? Math.max(0, first.totalTournaments - firstSessionMTT)
        : null)
    const br = first.brPrev ?? prevPoint?.br ?? startBR
    return {
      br,
      profit:br - startBR,
      tournaments,
    }
  })()
  const rangeStartText = (() => {
    if (lang === 'en') return 'START'
    if (lang === 'es') return 'INICIO'
    return 'СТАРТ'
  })()
  const firstSessionText = (() => {
    if (lang === 'en') return 'first session'
    if (lang === 'es') return 'primera sesión'
    return 'первая сессия'
  })()
  const recoveryText = (() => {
    if (lang === 'en') return 'turnaround'
    if (lang === 'es') return 'punto de giro'
    return 'перелом'
  })()
  const eventLabel = kind => {
    if (lang === 'en') return ({ best:'BEST', worst:'WORST', peak:'PEAK' })[kind]
    if (lang === 'es') return ({ best:'MEJOR', worst:'PEOR', peak:'PICO' })[kind]
    return ({ best:'БЕСТ', worst:'ВОРСТ', peak:'ПИК' })[kind]
  }
  const mttUnit = lang === 'ru' ? 'МТТ' : 'MTT'
  const markerGroups = (() => {
    if (!points.length) return []
    if (points.length === 1) return [{
      start:0,
      end:0,
      p:points[0],
      x:coords[0].x,
      y:coords[0].y,
      profit:sessionProfitAt(0),
      count:1,
      sessions:[{ p:points[0], profit:sessionProfitAt(0), tournaments:mttDeltaAt(0) }],
    }]

    const groups = []
    const minMarkerGap = isMobile ? 24 : 18
    const detailedTailStart = Math.max(0, points.length - 5)
    let start = 0
    let runSign = profitSignAt(0)

    const emit = end => {
      if (end < start) return
      groups.push({ start, end })
    }

    for (let i = 1; i < detailedTailStart; i++) {
      const sign = profitSignAt(i) || runSign
      if (!runSign && sign) runSign = sign

      const signChanged = runSign && sign && sign !== runSign
      const enoughGap = coords[i].x - coords[start].x >= minMarkerGap

      if (signChanged) {
        emit(i - 1)
        start = i
        runSign = profitSignAt(i)
      } else if (enoughGap) {
        emit(i)
        start = i + 1
        runSign = start < points.length ? (profitSignAt(start) || runSign) : runSign
      }
    }

    if (start < detailedTailStart) emit(detailedTailStart - 1)
    for (let i = detailedTailStart; i < points.length; i++) {
      groups.push({ start:i, end:i })
    }

    const rawMarkers = groups
      .filter((g, idx, arr) => idx === 0 || g.end !== arr[idx - 1].end)
      .map(g => ({
        ...g,
        p: points[g.end],
        x: coords[g.end].x,
        y: coords[g.end].y,
        profit: points
          .slice(g.start, g.end + 1)
          .reduce((sum, p, offset) => sum + sessionProfitAt(g.start + offset), 0),
        count: g.end - g.start + 1,
        sessions: points.slice(g.start, g.end + 1).map((p, offset) => {
          const idx = g.start + offset
          return { p, profit:sessionProfitAt(idx), tournaments:mttDeltaAt(idx) }
        }),
      }))

    return compactCrowdedMarathonMarkers(rawMarkers, isMobile ? 30 : 24, yAtChartX)
  })()
  const xLabelItems = (() => {
    if (!points.length) return []

    const byIndex = new Map()
    const labelNote = item => item.note || (
      ['milestone','best','worst','range-start','recovery'].includes(item.kind) ? item.main : null
    )
    const uniq = arr => [...new Set(arr.filter(Boolean))]
    const put = (i, item) => {
      if (i < 0 || i >= points.length || !coords[i]) return
      const prev = byIndex.get(i)
      const next = { ...item, notes:uniq(item.notes || []) }
      if (!prev) {
        byIndex.set(i, { ...next, i, x:coords[i].x, y:coords[i].y, p:points[i] })
      } else {
        const primary = next.priority > prev.priority ? next : prev
        const secondary = next.priority > prev.priority ? prev : next
        byIndex.set(i, {
          ...primary,
          i,
          x:coords[i].x,
          y:coords[i].y,
          p:points[i],
          kind:uniq([primary.kind, secondary.kind]).join(' '),
          notes:uniq([...(primary.notes || []), labelNote(secondary), ...(secondary.notes || [])]),
        })
      }
    }

    if (rangeBaseline) {
      put(0, {
        kind:'range-start',
        main:`${rangeStartText} ${fk(rangeBaseline.profit)}`,
        priority:134,
        notes:[
          rangeBaseline.tournaments != null ? `${fmtInt(rangeBaseline.tournaments)} ${mttUnit}` : null,
        ],
      })
    } else {
      put(0, {
        kind:'start',
        main:firstSessionText,
        priority:58,
      })
    }
    put(points.length - 1, {
      kind:'last',
      main:cumMTT[points.length - 1] ? fmtInt(cumMTT[points.length - 1]) : ({ ru:'сейчас', es:'ahora' }[lang] || 'now'),
      priority:122,
    })

    const milestoneStep = dataMax >= 125000 ? 50000 : 25000
    const milestoneMarks = []
    if (startBR < 25000 && dataMax >= 25000) milestoneMarks.push(25000)
    const firstMilestone = Math.ceil(Math.max(startBR + 1, milestoneStep) / milestoneStep) * milestoneStep
    for (let mark = firstMilestone; mark <= dataMax; mark += milestoneStep) milestoneMarks.push(mark)
    for (const mark of uniq(milestoneMarks).sort((a,b) => a - b)) {
      for (let i = 0; i < points.length; i++) {
        const prevBR = i === 0 ? startBR : points[i - 1].br
        if (prevBR < mark && points[i].br >= mark) {
          put(i, {
            kind:'milestone',
            main:`$${Math.round(mark / 1000)}k`,
            priority:mark >= 100000 ? 112 : 92 + mark / milestoneStep,
            note:`$${Math.round(mark / 1000)}k`,
          })
          break
        }
      }
    }

    if (!rangeBaseline && points.length > 1 && Number.isFinite(startBR)) {
      let dippedBelowStart = false
      for (let i = 0; i < points.length; i++) {
        const prevBR = i === 0 ? startBR : points[i - 1].br
        if (points[i].br < startBR) dippedBelowStart = true
        if (dippedBelowStart && prevBR < startBR && points[i].br >= startBR) {
          const stayedAboveStart = points.slice(i).every(p => p.br >= startBR)
          if (stayedAboveStart) {
            put(i, {
              kind:'recovery',
              main:`$${Math.round(startBR / 1000)}k`,
              priority:96,
              notes:[recoveryText],
            })
            break
          }
        }
      }
    }

    const dayStats = new Map()
    points.forEach((p, i) => {
      const key = warsawDayKey(p.timestamp) || `idx-${i}`
      const prev = dayStats.get(key) || { profit:0, firstIdx:i, lastIdx:i }
      prev.profit += sessionProfitAt(i)
      prev.lastIdx = i
      dayStats.set(key, prev)
    })
    const days = [...dayStats.values()]
    const bestDay = days.reduce((best, day) => !best || day.profit > best.profit ? day : best, null)
    const worstDay = days.reduce((worst, day) => !worst || day.profit < worst.profit ? day : worst, null)
    if (bestDay?.profit > 0) {
      put(bestDay.lastIdx, {
        kind:'best',
        main:fk(bestDay.profit),
        priority:130,
      })
    }
    if (worstDay?.profit < 0) {
      put(worstDay.lastIdx, {
        kind:'worst',
        main:fk(worstDay.profit),
        priority:126,
        note:eventLabel('worst').toLowerCase(),
      })
    }

    let selected = []
    const maxLabels = isMobile ? 7 : 9
    // The solver used to compare nominal centres while the renderer clamps
    // edge labels to the plot bounds and joins notes+date into one sub line —
    // so clamped labels could land on top of each other (month view). Model
    // the exact rendered interval instead.
    const buildSub = item => uniq(item.notes || [])
      .filter(note => note !== item.main)
      .filter(note => !(String(item.kind || '').includes('best') && String(note).trim().startsWith('$')))
      .slice(0, String(item.kind || '').includes('range-start') ? 2 : 1)
      .concat(fmtDateShortLang(item.p.timestamp, lang))
      .join(' · ')
    const intervalFor = item => {
      const mainWidth = String(item.main || '').length * (isMobile ? 7.4 : 7.1)
      const subWidth = buildSub(item).length * (isMobile ? 4.9 : 4.7)
      const textWidth = Math.min(isMobile ? 138 : 176, Math.max(48, mainWidth, subWidth))
      const lx = Math.min(Math.max(item.x, pL), W - pR)
      const leftBound = pL + xLabelEdgePad
      const rightBound = W - pR - xLabelEdgePad
      const anchor = lx - textWidth / 2 < leftBound ? 'start' : lx + textWidth / 2 > rightBound ? 'end' : 'middle'
      const left = anchor === 'start' ? leftBound : anchor === 'end' ? rightBound - textWidth : lx - textWidth / 2
      return { left, right:left + textWidth }
    }
    // Legacy centre-distance test kept for the 'all' view, whose label layer is
    // display:none — there the solver only feeds marker significance, and the
    // rendered-interval test would change which markers show for no visual gain.
    const legacyWidth = item => {
      const notes = uniq(item.notes || [])
      const mainWidth = String(item.main || '').length * (isMobile ? 7.4 : 7.1)
      const noteWidth = notes.reduce((max, note) => Math.max(max, String(note || '').length * (isMobile ? 4.9 : 4.7)), 0)
      return Math.min(isMobile ? 138 : 176, Math.max(48, mainWidth, noteWidth))
    }
    const legacyGap = (a, b) => Math.max(isMobile ? 78 : 68, (legacyWidth(a) + legacyWidth(b)) / 2 + (isMobile ? 16 : 14))
    const labelsCollide = (a, b) => {
      if (period === 'all') return Math.abs(a.x - b.x) < legacyGap(a, b)
      const ia = intervalFor(a)
      const ib = intervalFor(b)
      return Math.min(ia.right, ib.right) - Math.max(ia.left, ib.left) > -(isMobile ? 12 : 10)
    }
    const candidates = [...byIndex.values()].sort((a,b) => b.priority - a.priority)
    for (const candidate of candidates) {
      const conflicts = selected.filter(item => labelsCollide(item, candidate))
      if (!conflicts.length && selected.length < maxLabels) {
        selected.push(candidate)
        continue
      }

      if (conflicts.length && conflicts.every(item => candidate.priority > item.priority)) {
        selected = selected.filter(item => !conflicts.includes(item))
        if (selected.length < maxLabels) selected.push(candidate)
        continue
      }

      if (!conflicts.length && selected.length >= maxLabels) {
        const weakest = selected.slice().sort((a,b) => a.priority - b.priority)[0]
        const withoutWeakest = selected.filter(item => item !== weakest)
        const stillFits = withoutWeakest.every(item => !labelsCollide(item, candidate))
        if (weakest && candidate.priority > weakest.priority && stillFits) {
          selected = [...withoutWeakest, candidate]
        }
      }
    }

    return selected
      .sort((a,b) => a.x - b.x)
      .map(item => ({
        ...item,
        sub:buildSub({
          ...item,
          notes:uniq(item.notes || []).sort((a, b) => {
            const rank = note => {
              const lower = String(note).toLowerCase()
              if (lower.includes('пик') || lower.includes('peak') || lower.includes('pico')) return 0
              if (lower.includes('мтт') || lower.includes('mtt')) return 0
              if (lower.includes('$100k')) return 1
              if (lower.startsWith('$')) return 2
              return 3
            }
            return rank(a) - rank(b)
          }),
        }),
      }))
  })()
  const allTimeMilestones = (() => {
    if (period !== 'all' || !points.length) return []

    let recoveryIndex = -1
    let dippedBelowStart = false
    for (let i = 0; i < points.length; i++) {
      const previousBR = i === 0 ? startBR : points[i - 1].br
      if (points[i].br < startBR) dippedBelowStart = true
      if (dippedBelowStart && previousBR < startBR && points[i].br >= startBR) {
        if (points.slice(i).every(point => point.br >= startBR)) {
          recoveryIndex = i
          break
        }
      }
    }

    const dayStats = new Map()
    points.forEach((p, i) => {
      const key = warsawDayKey(p.timestamp) || `idx-${i}`
      const current = dayStats.get(key) || { profit:0, lastIndex:i }
      current.profit += sessionProfitAt(i)
      current.lastIndex = i
      dayStats.set(key, current)
    })
    const bestDay = [...dayStats.values()].reduce(
      (best, current) => !best || current.profit > best.profit ? current : best,
      null,
    )
    const twoHundredIndex = points.findIndex((p, i) => {
      const previousBR = i === 0 ? startBR : points[i - 1].br
      return previousBR < 200000 && p.br >= 200000
    })

    const formatBestDay = value => {
      const absolute = Math.abs(value)
      const precision = absolute < 100000 && absolute % 1000 !== 0 ? 1 : 0
      const amount = absolute >= 1000
        ? `${(absolute / 1000).toFixed(precision)}k`
        : `${Math.round(absolute)}`
      return `${value >= 0 ? '+' : '−'}$${amount}`
    }
    const startLabel = `$${Number.isInteger(startBR / 1000) ? startBR / 1000 : (startBR / 1000).toFixed(1)}k`
    const recoveryLabel = lang === 'en'
      ? `TURNAROUND ${startLabel}`
      : lang === 'es'
        ? `GIRO ${startLabel}`
        : `ПЕРЕЛОМ ${startLabel}`
    const create = (type, i, primary) => {
      if (i < 0 || !points[i] || !coords[i]) return null
      return {
        type,
        i,
        p:points[i],
        point:coords[i],
        primary,
        secondary:fmtDateShortLang(points[i].timestamp, lang),
      }
    }

    return [
      create('recovery', recoveryIndex, recoveryLabel),
      create('best', bestDay?.profit > 0 ? bestDay.lastIndex : -1, formatBestDay(bestDay?.profit || 0)),
      create('twoHundred', twoHundredIndex, '$200k'),
    ].filter(Boolean)
  })()
  const peakCallout = (() => {
    if (!points.length) return null
    let peakIdx = 0
    points.forEach((p, i) => { if (p.br > points[peakIdx].br) peakIdx = i })
    const point = coords[peakIdx]
    if (!point) return null
    const badgeW = isMobile ? 76 : 72
    const badgeH = isMobile ? 25 : 23
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max)
    const clampCx = x => clamp(x, pL + badgeW / 2 + 8, W - pR - badgeW / 2 - 8)
    const clampCy = y => clamp(y, pT + badgeH / 2 + 8, plotBottom - badgeH / 2 - 8)
    const lineSegments = coords.slice(1).map((coord, i) => ({ a:coords[i], b:coord }))
    const dangerPoints = coords.flatMap((coord, i) => {
      const prev = coords[i - 1]
      return prev ? [
        coord,
        { x:(prev.x * 2 + coord.x) / 3, y:(prev.y * 2 + coord.y) / 3 },
        { x:(prev.x + coord.x) / 2, y:(prev.y + coord.y) / 2 },
        { x:(prev.x + coord.x * 2) / 3, y:(prev.y + coord.y * 2) / 3 },
      ] : [coord]
    })
    const leaderDangerPoints = coords.filter((_, i) => Math.abs(i - peakIdx) > 1)
    const chartFrame = { W, pL, pR, pT, plotBottom }
    const milestonePlates = allTimeMilestones
      .map(m => milestonePlateRect(m.type, m.point, isMobile, chartFrame))
      .filter(Boolean)
    const rectsOverlap = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const nearX = badgeW / 2 + (isMobile ? 12 : 14)
    const farX = badgeW + (isMobile ? 20 : 22)
    const nearY = badgeH / 2 + (isMobile ? 13 : 12)
    const farY = badgeH + (isMobile ? 20 : 16)
    const candidateOffsets = [
      { cx:point.x - badgeW * 2.1, cy:pT + badgeH / 2 + 16, affinity:34 },
      { cx:point.x - badgeW * 2.6, cy:pT + badgeH / 2 + 16, affinity:30 },
      { cx:point.x - badgeW * 3.1, cy:pT + badgeH / 2 + 17, affinity:22 },
      { cx:point.x - badgeW * 3.7, cy:pT + badgeH / 2 + 18, affinity:10 },
      { cx:pL + (W - pL - pR) * .58, cy:pT + badgeH / 2 + 18, affinity:5 },
      { cx:pL + (W - pL - pR) * .46, cy:pT + badgeH / 2 + 18, affinity:-4 },
      { cx:pL + badgeW * 2.2, cy:pT + badgeH / 2 + 16, affinity:-12 },
      { cx:pL + badgeW / 2 + 18, cy:pT + badgeH / 2 + 14, affinity:-42 },
      { dx:-nearX, dy:-nearY, affinity:160 },
      { dx:-farX, dy:0, affinity:115 },
      { dx:-nearX, dy:nearY, affinity:85 },
      { dx:-nearX, dy:0, affinity:72 },
      { dx:-farX, dy:nearY, affinity:48 },
      { dx:-farX, dy:farY, affinity:2 },
      { dx:0, dy:farY, affinity:3 },
      { dx:nearX, dy:nearY, affinity:0 },
      { dx:nearX, dy:-nearY, affinity:-4 },
      { dx:-nearX, dy:farY * 1.7, affinity:26 },
      { dx:-farX, dy:farY * 1.9, affinity:22 },
      { dx:-badgeW * 1.3, dy:farY * 2.3, affinity:14 },
      { dx:-badgeW * 1.9, dy:farY * 2.8, affinity:6 },
    ]
    const distanceToRect = (p, rect) => {
      const dx = Math.max(rect.left - p.x, 0, p.x - rect.right)
      const dy = Math.max(rect.top - p.y, 0, p.y - rect.bottom)
      return Math.hypot(dx, dy)
    }
    const rectContainsPoint = (rect, p) =>
      p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom
    const segmentIntersectsRect = (a, b, rect) => {
      if (rectContainsPoint(rect, a) || rectContainsPoint(rect, b)) return true
      const intersects = (p1, p2, p3, p4) => {
        const ccw = (u, v, w) => (w.y - u.y) * (v.x - u.x) > (v.y - u.y) * (w.x - u.x)
        return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
      }
      const corners = [
        { x:rect.left, y:rect.top },
        { x:rect.right, y:rect.top },
        { x:rect.right, y:rect.bottom },
        { x:rect.left, y:rect.bottom },
      ]
      return corners.some((corner, i) => intersects(a, b, corner, corners[(i + 1) % corners.length]))
    }
    const distanceToSegment = (p, a, b) => {
      const vx = b.x - a.x
      const vy = b.y - a.y
      const wx = p.x - a.x
      const wy = p.y - a.y
      const c1 = vx * wx + vy * wy
      if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y)
      const c2 = vx * vx + vy * vy
      if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y)
      const t = c1 / c2
      return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
    }
    const anchorForRect = rect => point.x < rect.left
      ? { x:rect.left, y:clamp(point.y, rect.top + 5, rect.bottom - 5) }
      : point.x > rect.right
        ? { x:rect.right, y:clamp(point.y, rect.top + 5, rect.bottom - 5) }
        : point.y < rect.top
          ? { x:clamp(point.x, rect.left + 7, rect.right - 7), y:rect.top }
          : { x:clamp(point.x, rect.left + 7, rect.right - 7), y:rect.bottom }
    const candidates = candidateOffsets.map(({ dx, dy, cx:targetAbsCx, cy:targetAbsCy, affinity }) => {
      const targetCx = Number.isFinite(targetAbsCx) ? targetAbsCx : point.x + dx
      const targetCy = Number.isFinite(targetAbsCy) ? targetAbsCy : point.y + dy
      const cx = clampCx(targetCx)
      const cy = clampCy(targetCy)
      const rect = {
        left:cx - badgeW / 2,
        right:cx + badgeW / 2,
        top:cy - badgeH / 2,
        bottom:cy + badgeH / 2,
      }
      const padded = {
        left:rect.left - 12,
        right:rect.right + 12,
        top:rect.top - 12,
        bottom:rect.bottom + 12,
      }
      const minDistance = Math.min(...dangerPoints.map(p => distanceToRect(p, rect)))
      const minPaddedDistance = Math.min(...dangerPoints.map(p => distanceToRect(p, padded)))
      const overlaps = dangerPoints.filter(p =>
        p.x >= padded.left && p.x <= padded.right && p.y >= padded.top && p.y <= padded.bottom
      ).length
      const dotBounds = {
        left:rect.left - 4,
        right:rect.right + 4,
        top:rect.top - 4,
        bottom:rect.bottom + 4,
      }
      const dotOverlaps = coords.filter(p =>
        p.x >= dotBounds.left && p.x <= dotBounds.right && p.y >= dotBounds.top && p.y <= dotBounds.bottom
      ).length
      const lineIntersections = lineSegments.filter(({ a, b }) => segmentIntersectsRect(a, b, padded)).length
      const anchor = anchorForRect(rect)
      const leaderLength = Math.hypot(cx - point.x, cy - point.y)
      const plateLeaderHits = milestonePlates.filter(r => segmentIntersectsRect(point, anchor,
        { left:r.left - 3, right:r.right + 3, top:r.top - 3, bottom:r.bottom + 3 })).length
      const tightRect = { left:rect.left - 2, right:rect.right + 2, top:rect.top - 2, bottom:rect.bottom + 2 }
      const plateOverlaps = milestonePlates.filter(r => rectsOverlap(tightRect, r)).length
      const leaderDistance = leaderDangerPoints.length
        ? Math.min(...leaderDangerPoints.map(p => distanceToSegment(p, point, anchor)))
        : 32
      const leaderCrowding = Math.max(0, 14 - leaderDistance)
      const clampPenalty = Math.hypot(cx - targetCx, cy - targetCy)
      const topAir = Math.max(0, rect.top - pT)
      const farLeaderPenalty = Math.max(0, leaderLength - (isMobile ? 150 : 130))
      const clearRectScore = Math.min(minDistance, isMobile ? 96 : 110)
      const clearPaddedScore = Math.min(minPaddedDistance, isMobile ? 74 : 84)
      const edgePenalty = rect.top < pT + 7 || rect.right > W - pR - 7 || rect.left < pL + 7 ? 8 : 0
      return {
        cx,
        cy,
        rect,
        anchor,
        overlaps,
        dotOverlaps,
        lineIntersections,
        plateOverlaps,
        plateLeaderHits,
        score:clearRectScore * 2.4 + clearPaddedScore * 2 + Math.min(leaderDistance, 34) * .8
          + affinity - overlaps * 220 - lineIntersections * 180 - leaderLength * .38
          - plateLeaderHits * 260 - plateOverlaps * 300
          - farLeaderPenalty * 2.4 - leaderCrowding * 4 - clampPenalty * 1.8 - topAir * .18 - edgePenalty,
      }
    }).sort((a,b) => b.score - a.score)
    const preferredCx = clampCx(point.x - nearX)
    const preferredCy = clampCy(point.y - nearY)
    const pointSafeCandidates = candidates.filter(candidate => candidate.dotOverlaps === 0)
    // Never sit on (or run the leader through) a milestone plate if any clean
    // spot exists — overlapping "$200k"-style plates was the visible defect.
    const plateSafeCandidates = pointSafeCandidates.filter(
      candidate => candidate.plateOverlaps === 0 && candidate.plateLeaderHits === 0,
    )
    const candidatePool = plateSafeCandidates.length
      ? plateSafeCandidates
      : (pointSafeCandidates.length ? pointSafeCandidates : candidates)
    const preferred = candidatePool.reduce((best, candidate) => {
      const distance = Math.hypot(candidate.cx - preferredCx, candidate.cy - preferredCy)
      const selectionScore = candidate.score - distance * 8
      return !best || selectionScore > best.selectionScore
        ? { ...candidate, distance, selectionScore }
        : best
    }, null)
    const { cx, cy, anchor } = preferred || candidates[0]
    return {
      idx:peakIdx,
      point,
      cx,
      cy,
      anchor,
      badgeW,
      badgeH,
      label:eventLabel('peak'),
      value:`$${Math.round(points[peakIdx].br / 1000)}k`,
    }
  })()

  const sessionProfits = points.map((_, i) => sessionProfitAt(i))
  const lineStops = (() => {
    if (!coords.length) return []
    const pctOfX = x => Math.max(0, Math.min(100, ((x - pL) / Math.max(W - pL - pR, 1)) * 100))
    const colorFor = profit => profit >= 0 ? '#76d982' : '#ff665d'
    const stops = []
    const pushStop = (offset, color) => {
      const clamped = Math.max(0, Math.min(100, offset))
      const prev = stops[stops.length - 1]
      if (prev && Math.abs(prev.offsetValue - clamped) < 0.01 && prev.color === color) return
      stops.push({ offsetValue:clamped, offset:`${clamped}%`, color })
    }
    let prevColor = colorFor(sessionProfits[1] ?? sessionProfits[0] ?? 0)
    pushStop(0, prevColor)

    for (let i = 1; i < coords.length; i++) {
      const startPct = pctOfX(coords[i - 1].x)
      const endPct = pctOfX(coords[i].x)
      const color = colorFor(sessionProfits[i])
      if (color !== prevColor) {
        const transition = Math.min(1.2, Math.max(0.28, Math.abs(endPct - startPct) * 0.22))
        pushStop(startPct - transition, prevColor)
        pushStop(startPct + transition, color)
      } else {
        pushStop(startPct, color)
      }
      pushStop(endPct, color)
      prevColor = color
    }

    return stops
  })()
  const significantMarkerGroups = (() => {
    if (!points.length) return []

    const indexes = new Set([0, points.length - 1])
    let peakIdx = 0
    let troughIdx = 0
    points.forEach((p, i) => {
      if (p.br > points[peakIdx].br) peakIdx = i
      if (p.br < points[troughIdx].br) troughIdx = i
    })
    indexes.add(peakIdx)
    indexes.add(troughIdx)
    xLabelItems.forEach(item => indexes.add(item.i))

    const bankrollRange = Math.max(1, dataMax - dataMin)
    const localTurnMoney = Math.max(4500, bankrollRange * .045)
    const largeSessionMoney = Math.max(7000, bankrollRange * .06)
    const localTurnPixels = isMobile ? 15 : 11

    points.forEach((point, idx) => {
      if (Math.abs(sessionProfitAt(idx)) >= largeSessionMoney) indexes.add(idx)
      if (idx <= 0 || idx >= points.length - 1) return

      const prev = points[idx - 1]
      const next = points[idx + 1]
      const isLocalPeak = point.br > prev.br && point.br > next.br
      const isLocalTrough = point.br < prev.br && point.br < next.br
      if (!isLocalPeak && !isLocalTrough) return

      const moneySwing = Math.min(Math.abs(point.br - prev.br), Math.abs(point.br - next.br))
      const pixelSwing = Math.min(
        Math.abs(coords[idx].y - coords[idx - 1].y),
        Math.abs(coords[idx].y - coords[idx + 1].y),
      )
      if (moneySwing >= localTurnMoney || pixelSwing >= localTurnPixels) indexes.add(idx)
    })

    return markerGroups.filter(marker =>
      [...indexes].some(idx => idx >= marker.start && idx <= marker.end)
    )
  })()
  const markerVisuals = significantMarkerGroups.map((marker, idx, arr) => {
    const distances = [
      arr[idx - 1] ? Math.hypot(marker.x - arr[idx - 1].x, marker.y - arr[idx - 1].y) : Infinity,
      arr[idx + 1] ? Math.hypot(marker.x - arr[idx + 1].x, marker.y - arr[idx + 1].y) : Infinity,
    ]
    const nearestDistance = Math.min(...distances)
    return {
      ...marker,
      nearestDistance,
      isCrowded:nearestDistance < (isMobile ? 23 : 20),
    }
  })

  // ── Mobile: long-press (300ms) to show tooltip ──
  const longPressTimer = useRef(null)
  const handleTouchStart = e => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const tx = (touch.clientX - rect.left) * (W / rect.width)
    const sy = touch.clientY
    longPressTimer.current = setTimeout(() => {
      let nearest=null, minD=Infinity
      significantMarkerGroups.forEach(m => { const d=Math.abs(m.x-tx); if(d<minD){minD=d;nearest=m} })
      if (!nearest) return
      const p = nearest.p
      announceHoverPopupOpen()
      openTipState({ p, profit:nearest.profit, x:nearest.x, y:nearest.y, screenY: sy, groupCount:nearest.count, sessions:nearest.sessions, totalMTT:cumMTT[nearest.end] || null })
    }, 300)
  }
  const handleTouchEnd = () => { clearTimeout(longPressTimer.current) }
  const handleTouchMove = () => { clearTimeout(longPressTimer.current) }

  if (!points.length) return (
    <div className="marathon-chart">
      <div className="section-head"><h2 className="section-title">{t('chart_marathon')}</h2></div>
      <div className="empty-state">{t('empty_data_scraper')}</div>
    </div>
  )

  return (
    <div className="marathon-chart" ref={chartRef} onClick={tip ? closeTip : undefined}>
      <div className="section-head" style={{marginBottom:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <h2 className="section-title">{t('chart_marathon')}</h2>
        <div className="mc-periods">
          {[['week',t('period_week')],['month',t('period_month')],['all',t('period_all')]].map(([k,label])=>(
            <button type="button" key={k} onClick={()=>setPeriodPersist(k)}
              className={`mc-period ${period===k?'active':''}`} aria-pressed={period===k}>
              {label}
            </button>
          ))}
        </div>
        <span className="section-count">{plBrUpdates(points.length, lang)}</span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H+pB+xLabelExtraBottom}`}
        role="img" aria-label={`${t('chart_marathon')}: ${plBrUpdates(points.length, lang)}`}
        onMouseLeave={(e)=>{
          // Don't close tooltip if mouse moved to the tooltip itself
          const related = e.relatedTarget
          if (related && chartRef.current?.contains(related)) return
          closeTip()
        }}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        style={{touchAction:'pan-y',WebkitUserSelect:'none',userSelect:'none',WebkitTouchCallout:'none'}}>
        <defs>
          <linearGradient id="mcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity=".12"/>
            <stop offset="58%"  stopColor="#ffffff" stopOpacity=".035"/>
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="mcLineGrad" x1={pL} y1="0" x2={W-pR} y2="0" gradientUnits="userSpaceOnUse">
            {lineStops.map((stop, i) => (
              <stop key={`${stop.offset}-${i}`} offset={stop.offset} stopColor={stop.color}/>
            ))}
          </linearGradient>
          <radialGradient id="mcPlotGlow" cx="86%" cy="18%" r="72%">
            <stop offset="0%" stopColor="#ffb300" stopOpacity=".12"/>
            <stop offset="55%" stopColor="#e53935" stopOpacity=".035"/>
            <stop offset="100%" stopColor="#e53935" stopOpacity="0"/>
          </radialGradient>
          <filter id="mcGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect x={pL} y={pT} width={W-pL-pR} height={plotBottom-pT} rx="10" className="mc-plot-bg"/>
        <rect x={pL} y={pT} width={W-pL-pR} height={plotBottom-pT} rx="10" fill="url(#mcPlotGlow)" className="mc-plot-glow"/>
        {yTicks.map(({v,y},i) => (
          <g key={i} className="mc-y-tick">
            <line x1={pL} y1={y} x2={W-pR} y2={y} className="mc-grid"/>
            <line x1={pL-6} y1={y} x2={pL} y2={y} className="mc-y-tickmark"/>
            <text x={pL-12} y={y+3.5} className="mc-yaxis-label">{fmtMoneyTick(v)}</text>
          </g>
        ))}
        {startBR >= minV && startBR <= maxV && <line x1={pL} y1={yOf(startBR)} x2={W-pR} y2={yOf(startBR)} className="mc-zero"/>}
        <line x1={pL} y1={plotBottom} x2={W-pR} y2={plotBottom} className="mc-axis-line"/>
        <line x1={pL} y1={pT} x2={pL} y2={plotBottom} className="mc-axis-line mc-axis-line-y"/>
        <path d={areaPath} fill="url(#mcGrad)" className="mc-area"/>
        <path d={linePath} fill="none" stroke="var(--chart-line-rail)" className="mc-line-aura" strokeWidth="7"
          vectorEffect="non-scaling-stroke"/>
        <path ref={pathRef} d={linePath} fill="none" stroke="url(#mcLineGrad)" className="mc-line-main" strokeWidth="3.2"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          style={pathLen!=null ? {
            strokeDasharray: pathLen,
            strokeDashoffset: 0,
            animation: 'drawLine 1.4s cubic-bezier(.4,0,.2,1) forwards',
          } : {}}
        />
        {coords.slice(1).map((point, segmentIndex) => {
          const previous = coords[segmentIndex]
          const p = points[segmentIndex + 1]
          const profit = sessionProfits[segmentIndex + 1] ?? 0
          return (
            <line key={`line-segment-${p.id || segmentIndex + 1}`}
              className={`mc-line-segment ${profit >= 0 ? 'positive' : 'negative'}`}
              data-source-id={p.id || `point-${segmentIndex + 1}`}
              data-source-index={segmentIndex + 1}
              x1={previous.x} y1={previous.y} x2={point.x} y2={point.y}/>
          )
        })}
        <path d={linePath} fill="none" className="mc-line-highlight" strokeWidth={isMobile ? .9 : .7}/>
        {/* Desktop: the whole plot is hoverable — the tooltip follows the nearest
            session group, so the sparse visible markers no longer limit where
            you can point (reader/channel feedback). */}
        {!isMobile && markerGroups.length > 0 && (
          <rect x={pL} y={pT} width={Math.max(0, W - pL - pR)} height={Math.max(0, plotBottom - pT)}
            fill="transparent" data-testid="mc-hover-capture"
            onMouseMove={e => {
              const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect?.()
              const scale = svgRect && svgRect.width ? W / svgRect.width : 1
              const mx = (e.clientX - (svgRect?.left || 0)) * scale
              let nearest = null, minD = Infinity
              markerGroups.forEach(m => { const d = Math.abs(m.x - mx); if (d < minD) { minD = d; nearest = m } })
              if (!nearest || tip?.p === nearest.p) return
              announceHoverPopupOpen()
              openTipState({ p:nearest.p, profit:nearest.profit, x:nearest.x, y:nearest.y,
                groupCount:nearest.count, sessions:nearest.sessions, totalMTT:cumMTT[nearest.end] || null })
            }}/>
        )}
        {markerVisuals.map(({ p, start, end, x, y, profit, count, sessions, parts, compacted, mixedTone, isCrowded }) => {
          const i=end
          const isLast = i===points.length-1
          const cx=x, cy=y
          const isHovered = tip?.p === p
          const isGrouped = count > 1
          const clusterParts = compacted && Array.isArray(parts) && parts.length >= 4 ? parts : null
          const renderClusterParts = !!clusterParts && count >= 8
          const baseDotR = isMobile
            ? (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : isGrouped ? 4.5 : 3.4))
            : (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : isGrouped ? 4.6 : 3.8))
          const dotR = isCrowded
            ? Math.min(baseDotR, isLast ? (isMobile ? 4.8 : 4.6) : (isMobile ? 3.4 : 3.5))
            : baseDotR
          const clusterPartR = partCount => {
            const base = isMobile ? 2.2 : 2.05
            const groupedBoost = partCount > 1 ? .45 : 0
            const hoverBoost = isHovered ? .35 : 0
            return base + groupedBoost + hoverBoost
          }
          const openTip = () => {
            announceHoverPopupOpen()
            openTipState({p,profit,x:cx,y:cy,groupCount:count,sessions,totalMTT:cumMTT[end] || null})
          }
          return (
            <g key={`marker-${start}-${end}`} className={isHovered ? 'is-hovered' : ''} onMouseEnter={!isMobile ? openTip : undefined}
              onClick={!isMobile ? e => { e.stopPropagation(); openTip() } : undefined}
              data-start={start} data-end={end} data-count={count}>
              {!isMobile && <circle cx={cx} cy={cy} r={renderClusterParts ? 18 : isLast?14:10} fill="transparent"
                className={renderClusterParts ? 'mc-dot-cluster-hit' : undefined}
                />}
              {renderClusterParts ? (
                <g className="mc-dot-cluster-parts" data-part-count={clusterParts.length}>
                  {clusterParts.map((part, partIdx) => {
                    const partCount = part.count || 1
                    return (
                      <circle key={`part-${part.start}-${part.end}-${partIdx}`}
                        cx={part.x} cy={part.y} r={clusterPartR(partCount)}
                        className={`mc-dot mc-dot-cluster-part ${partCount > 1 ? 'mc-dot-cluster-part-grouped' : ''}`}
                        fill={(part.profit || 0) >= 0 ? '#4caf50' : '#e53935'}/>
                    )
                  })}
                </g>
              ) : (
                <>
                  {isGrouped && <circle cx={cx} cy={cy} r={dotR + (compacted ? 3.2 : 2.6)}
                    className={`mc-dot-grouped-ring ${mixedTone ? 'mc-dot-mixed-ring' : ''}`}
                    stroke={profit>=0?'#4caf50':'#e53935'}/>}
                  <circle cx={cx} cy={cy} r={dotR}
                    className={`mc-dot ${isLast && !isCrowded ? 'mc-dot-last' : ''} ${isGrouped?'mc-dot-grouped':''} ${compacted?'mc-dot-compacted':''} ${mixedTone?'mc-dot-mixed':''} ${isCrowded?'mc-dot-crowded':''}`}
                    fill={profit>=0?'#4caf50':'#e53935'}
                    style={{transition:'r .12s', ...(isLast?{color:profit>=0?'#4caf50':'#e53935'}:{})}}/>
                </>
              )}
            </g>
          )
        })}
        {allTimeMilestones.map(milestone => (
          <MarathonMilestoneCallout key={milestone.type}
            milestone={milestone} type={milestone.type} isMobile={isMobile}
            W={W} pL={pL} pR={pR} pT={pT} plotBottom={plotBottom}/>
        ))}
        {peakCallout && (
          <g className="mc-peak-callout" data-idx={peakCallout.idx} data-source-id={points[peakCallout.idx]?.id}>
            <line x1={peakCallout.point.x} y1={peakCallout.point.y}
              x2={peakCallout.anchor.x} y2={peakCallout.anchor.y}
              className="mc-peak-callout-line"/>
            <rect x={peakCallout.cx - peakCallout.badgeW / 2} y={peakCallout.cy - peakCallout.badgeH / 2}
              width={peakCallout.badgeW} height={peakCallout.badgeH} rx="7"
              className="mc-peak-callout-bg"/>
            <text x={peakCallout.cx} y={peakCallout.cy + 4} textAnchor="middle" className="mc-peak-callout-text">
              <tspan className="mc-peak-callout-kicker">{peakCallout.label}</tspan>
              <tspan dx="5" className="mc-peak-callout-value">{peakCallout.value}</tspan>
            </text>
            <circle className="mc-peak-anchor" cx={peakCallout.point.x} cy={peakCallout.point.y} r={isMobile ? 6.5 : 5.2}/>
          </g>
        )}
        <g className={`mc-axis-event-layer ${period === 'all' ? 'is-hidden' : ''}`}>
        {xLabelItems.map(({ i, x, y, main, sub, kind }) => {
          const isLast = i===points.length-1
          const lx = Math.min(Math.max(x,pL),W-pR)
          const mainWidth = String(main || '').length * (isMobile ? 7.4 : 7.1)
          const subWidth = String(sub || '').length * (isMobile ? 4.9 : 4.7)
          const textWidth = Math.min(isMobile ? 138 : 176, Math.max(48, mainWidth, subWidth))
          const leftBound = pL + xLabelEdgePad
          const rightBound = W - pR - xLabelEdgePad
          const anchor = lx - textWidth / 2 < leftBound
            ? 'start'
            : lx + textWidth / 2 > rightBound
              ? 'end'
              : 'middle'
          const tx = anchor === 'start' ? leftBound : anchor === 'end' ? rightBound : lx
          const mainY = xMainLabelY
          const subY = xSubLabelY
          const currentLine = anchor === 'end'
            ? { x1: tx - 44, x2: tx }
            : anchor === 'start'
              ? { x1: tx, x2: tx + 44 }
              : { x1: tx - 22, x2: tx + 22 }
          return (
            <g key={`xlabel-${kind}-${i}`} className={`mc-x-tick ${kind} ${isLast?'last':''}`}>
              <line x1={lx} y1={y + (isLast?6:4) + 3} x2={lx} y2={xAxisY - 9} className="mc-guide"/>
              <line x1={lx} y1={plotBottom} x2={lx} y2={xAxisY} className="mc-x-tickmark"/>
              <text x={tx} y={mainY} textAnchor={anchor} className="mc-xaxis-label-main">
                {main}
              </text>
              <text x={tx} y={subY} textAnchor={anchor} className="mc-xaxis-label-sub">
                {sub}
              </text>
              {(isLast || kind.includes('milestone') || kind.includes('recovery')) && <line x1={currentLine.x1} y1={subY + 6} x2={currentLine.x2} y2={subY + 6} className="mc-x-current-line"/>}
            </g>
          )
        })}
        </g>
        {period === 'all' && monthTicks.map((tick, index) => {
          const isFirst = index === 0
          const isLast = index === monthTicks.length - 1
          const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
          return (
            <g key={`month-${tick.year}-${tick.label}`} className={`mc-month-tick ${isLast ? 'latest' : ''}`}
              data-source-id={tick.p.id || `point-${tick.i}`} data-source-index={tick.i}>
              <line x1={tick.x} y1={plotBottom} x2={tick.x} y2={xAxisY} className="mc-month-tickmark"/>
              <text x={tick.x} y={xMainLabelY} textAnchor={anchor} className="mc-month-label-main">
                {tick.label}
              </text>
              {isLast && (
                <text x={tick.x} y={xSubLabelY + 1} textAnchor="end" className="mc-month-label-sub">
                  {fmtDateShortLang(points[points.length - 1].timestamp, lang)}
                </text>
              )}
            </g>
          )
        })}
        {tip && <>
          <line x1={tip.x} y1={pT} x2={tip.x} y2={tip.y - 11} stroke="var(--border2)" strokeWidth="1" strokeDasharray="1 3" opacity="0.55"/>
          <line x1={tip.x} y1={tip.y + 11} x2={tip.x} y2={H} stroke="var(--border2)" strokeWidth="1" strokeDasharray="1 3" opacity="0.55"/>
        </>}
      </svg>
      {tip && (() => {
        const pct=tip.x/W*100, right=pct>60
        const roomDeltas = tip.p.rooms ? CHART_ROOMS.map(r=>({...r,v:(tip.p.rooms.after[r.key]||0)-(tip.p.rooms.before[r.key]||0)})).filter(r=>r.v!==0) : []
        const pillColor  = tip.profit >= 0 ? '#66bb6a' : '#ff5252'
        const pillBorder = tip.profit >= 0 ? 'rgba(102,187,106,.25)' : 'rgba(255,82,82,.25)'
        const mobileStyle = isMobile ? {
          position:'fixed', bottom:Math.max(90, window.innerHeight - (tip.screenY||0) + 16)+'px',
          left:'12px', right:'12px', maxWidth:'none', width:'auto',
          '--mc-tooltip-x':'0px',
        } : {
          position:'absolute',
          bottom:(H-tip.y+24)+'px',
          left:`${pct}%`,
          right:'auto',
          '--mc-tooltip-x':right?'calc(-100% + 8px)':'8px',
          transformOrigin:right?'right bottom':'left bottom',
        }
        return (
          <div className={`mc-tooltip ${tipVisible ? 'is-visible' : ''}`} style={{...mobileStyle, position: isMobile ? 'fixed' : 'absolute', pointerEvents: isMobile ? 'auto' : 'none'}}
            onClick={e => e.stopPropagation()}>
            {/* Pill — всегда в правом верхнем углу тултипа */}
            <div className="mc-pill" style={{
              position:'absolute', top:12, right:12,
              transform:'none',
              color: pillColor,
              borderColor: pillBorder,
            }}>
              {fk(tip.profit)}
            </div>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:5,paddingRight:64}}>{fmtDateTimeLang(tip.p.timestamp, lang)}</div>
            {/* Compact stat row (hstat-style): BR and the cumulative MTT total —
                the counter readers use to measure streak length in tournaments. */}
            <div style={{display:'flex',gap:14,margin:'1px 0',marginBottom:tip.p.tournaments?5:roomDeltas.length?8:5}}>
              <div>
                <div style={{fontSize:9,color:'var(--dim)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:2}}>{t('tip_br')}</div>
                <b style={{fontSize:13,color:'var(--white)',fontFamily:"'Roboto Mono',monospace",fontVariantNumeric:'tabular-nums'}}>{fkAbs(tip.p.br)}</b>
              </div>
              {tip.totalMTT != null && (
                <div style={{borderLeft:'1px solid var(--border)',paddingLeft:14}}>
                  <div style={{fontSize:9,color:'var(--dim)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:2}}>{t('tip_mtt_total')}</div>
                  <b style={{fontSize:13,color:'var(--white)',fontFamily:"'Roboto Mono',monospace",fontVariantNumeric:'tabular-nums'}}>{fmtInt(tip.totalMTT)}</b>
                </div>
              )}
            </div>
            {tip.p.tournaments && (
              <div style={{fontSize:11,color:'var(--dim)',marginBottom:roomDeltas.length?8:4}}>
                {t('tip_mtt_since')}: <b style={{color:'var(--dim2)'}}>{fmtInt(tip.p.tournaments)}</b>
              </div>
            )}
            {tip.groupCount > 1 && (
              <div style={{fontSize:10,color:'var(--dim)',marginBottom:6}}>
                {lang === 'ru' ? 'точка объединяет' : lang === 'es' ? 'punto agrupado' : 'merged point'}: <b style={{color:'var(--dim2)'}}>{plBrUpdates(tip.groupCount, lang)}</b>
              </div>
            )}
            {tip.groupCount > 1 && tip.sessions?.length > 0 && (
              <div className="mc-session-breakdown">
                {tip.sessions.length > 12 && (
                  <div className="mc-session-more">
                    {lang === 'ru' ? `… ещё ${tip.sessions.length - 11} сессий раньше`
                      : lang === 'es' ? `… ${tip.sessions.length - 11} sesiones anteriores`
                      : `… ${tip.sessions.length - 11} earlier sessions`}
                  </div>
                )}
                {(tip.sessions.length > 12 ? tip.sessions.slice(-11) : tip.sessions).map((s, idx) => (
                  <div key={`${s.p.timestamp || idx}-${idx}`} className="mc-session-row">
                    <span className="mc-session-date">{fmtDateShortLang(s.p.timestamp, lang)}</span>
                    <span className={s.profit >= 0 ? 'mc-session-profit pos' : 'mc-session-profit neg'}>{fk(s.profit)}</span>
                    <span className="mc-session-mtt">{s.tournaments ? `${fmtInt(s.tournaments)} MTT` : '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {roomDeltas.length>0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',marginBottom:8}}>
                {roomDeltas.map(r=>(
                  <span key={r.key} style={{fontSize:11,display:'flex',alignItems:'center',gap:4}}>
                    {r.logo && <img src={r.logo} alt={r.label} style={{width:16,height:16,objectFit:'contain',borderRadius:2}} onError={e=>e.target.style.display='none'}/>}
                    <span style={{color:'var(--dim)'}}>{r.label}:</span>
                    <span className={`tip-stat ${r.v>=0?'pos':'neg'}`}>{fk(r.v)}</span>
                  </span>
                ))}
              </div>
            )}
            {tip.p.text && <div style={{fontSize:11,color:'var(--dim2)',lineHeight:1.6,display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{tip.p.text.substring(0,180)}</div>}
            <div style={{fontSize:10,color:'var(--dim)',marginTop:5,display:'flex',justifyContent:'space-between',alignItems:'center',pointerEvents:'auto'}}>
              <span style={{cursor:'pointer'}} onClick={closeTip}>{t('close')}</span>
              {tip.p.url && <a href={tip.p.url} target="_blank" rel="noreferrer"
                onClick={e=>e.stopPropagation()}
                style={{color:'var(--red2)',fontSize:11}}>→ {FORUM_WORD[_lang] || 'форум'}</a>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}


// ─── ROOM WIDGET ─────────────────────────────────────────────────────────────
// ─── ACTIVITY CHART ───────────────────────────────────────────────────────────

function cleanText(t) {
  return (t||'').replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'').replace(/\[.*?\]/g,'').trim()
}

function trimWord(s, n) {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const sp = cut.lastIndexOf(' ')
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:!?—\-–\s]+$/, '') + '…'
}

function makeDayEvents(ps) {
  const events = []
  const sorted = [...ps].sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
  const romeoPosts = sorted.filter(p => ROMEO_RE.test(p.author))
  if (romeoPosts.length) {
    const brPost = romeoPosts.find(p => p.sessionResult != null)
    if (brPost) {
      events.push({ kind:'session', result: brPost.sessionResult, brAfter: brPost.brAfter, post: brPost, image: brPost.images?.[0] })
    } else {
      const rp = romeoPosts[0]
      const s = cleanText(rp.text)
      if (s) events.push({ kind:'romeo', text: trimWord(s, 160), post: rp, image: rp.images?.[0] })
      else events.push({ kind:'romeo-empty', count: romeoPosts.length, post: rp, image: rp.images?.[0] })
    }
  }
  const topOthers = sorted
    .filter(p => !ROMEO_RE.test(p.author) && (p.likes||0) >= 3)
    .sort((a,b) => (b.likes||0) - (a.likes||0))
    .slice(0, 3)
  for (const p of topOthers) {
    const s = cleanText(p.text)
    if (!s && !p.images?.[0]) continue
    events.push({ kind:'reply', author: p.author, likes: p.likes||0, text: s ? trimWord(s, 160) : '', post: p, image: p.images?.[0] })
  }
  return events
}

function scrollToPost(p) {
  if (!p?.id) return
  const el = document.getElementById(`post-${p.id}`)
  if (!el) return
  el.scrollIntoView({ behavior:scrollBehavior(), block:'center' })
  el.classList.add('post-highlight')
  setTimeout(() => el.classList.remove('post-highlight'), 1800)
}

function makeDaySummary(ps, lang = _lang) {
  const events = makeDayEvents(ps)
  const romeo = _t('day_romeo')
  const brLbl = _t('day_br_label')
  if (!events.length) return `${plPosts(ps.length, lang)}.`
  return events.map(e => {
    if (e.kind === 'session') return `${romeo} ${_t('day_reports_session')}: ${fmtBR(e.result)}${e.brAfter ? ` (${brLbl} ${fmtNum(e.brAfter)})` : ''}`
    if (e.kind === 'romeo') return `${romeo}: «${e.text}»`
    if (e.kind === 'romeo-empty') return `${romeo} ${_t('day_romeo_write_verb')} ${plPosts(e.count, lang)}`
    return `${e.author} (+${e.likes} 👍): «${e.text}»`
  }).join(' · ')
}

function DayEventsList({ events, compact, onPostClick, setLightbox, lang = _lang }) {
  if (!events.length) return null
  const romeo = _t('day_romeo')
  const brLbl = _t('day_br_label')
  const handleClick = (e, ev) => {
    if (e.target.closest('.day-event-thumb')) return
    if (onPostClick) onPostClick(ev.post)
    else scrollToPost(ev.post)
  }
  const thumb = (src) => (
    <img src={src} alt="" className="day-event-thumb" loading="lazy"
      onClick={e => { e.stopPropagation(); setLightbox?.(src) }}/>
  )
  return (
    <div className={compact ? 'day-events day-events-compact' : 'day-events'}>
      {events.map((ev, i) => {
        const clickable = !!ev.post
        const cls = (kind) => `day-event day-event-${kind}${clickable ? ' day-event-clickable' : ''}`
        const onClick = clickable ? (e) => handleClick(e, ev) : undefined
        if (ev.kind === 'session') {
          const positive = ev.result >= 0
          return (
            <div key={i} className={cls('session')} onClick={onClick}>
              <span className="day-event-icon">🎯</span>
              <div className="day-event-body">
                <span className="day-event-author">{romeo}</span>
                <span className="day-event-meta"> {_t('day_reports_session')}</span>
                <span className={'day-event-pill ' + (positive ? 'pos' : 'neg')}>{fmtBR(ev.result)}</span>
                {ev.brAfter && <span className="day-event-br">{brLbl} {fmtNum(ev.brAfter)}</span>}
                {ev.image && thumb(ev.image)}
              </div>
            </div>
          )
        }
        if (ev.kind === 'romeo') {
          return (
            <div key={i} className={cls('romeo')} onClick={onClick}>
              <span className="day-event-icon">💬</span>
              <div className="day-event-body">
                <span className="day-event-author">{romeo}</span>
                <span className="day-event-quote">«{ev.text}»</span>
                {ev.image && thumb(ev.image)}
              </div>
            </div>
          )
        }
        if (ev.kind === 'romeo-empty') {
          return (
            <div key={i} className={cls('romeo')} onClick={onClick}>
              <span className="day-event-icon">💬</span>
              <div className="day-event-body">
                <span className="day-event-author">{romeo}</span>
                <span className="day-event-meta"> {_t('day_romeo_write_verb')} {plPosts(ev.count, lang)}</span>
                {ev.image && thumb(ev.image)}
              </div>
            </div>
          )
        }
        return (
          <div key={i} className={cls('reply')} onClick={onClick}>
            <span className="day-event-icon">↳</span>
            <div className="day-event-body">
              <span className="day-event-author">{ev.author}</span>
              <span className="day-event-likes">+{ev.likes} 👍</span>
              {ev.text && <span className="day-event-quote">«{ev.text}»</span>}
              {ev.image && thumb(ev.image)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function pickTopAuthors(dayPosts, allPosts) {
  const MIN_RATING = 15000
  const VIP_RATING = 25000
  const byAuthor = {}
  dayPosts.filter(p => p.author && !ROMEO_RE.test(p.author)).forEach(p => {
    const a = p.author
    if (!byAuthor[a]) byAuthor[a] = { rating: p.rating||0, bestLikes: 0, count: 0 }
    byAuthor[a].count++
    if ((p.likes||0) > byAuthor[a].bestLikes) byAuthor[a].bestLikes = p.likes||0
    if ((p.rating||0) > byAuthor[a].rating) byAuthor[a].rating = p.rating||0
  })
  const globalCounts = {}
  allPosts?.forEach(p => { if (p.author) globalCounts[p.author] = (globalCounts[p.author]||0)+1 })
  return Object.entries(byAuthor)
    .filter(([, {rating}]) => rating >= MIN_RATING)
    .map(([name, {rating, bestLikes, count}]) => {
      const gc = globalCounts[name] || count
      const uniqueBonus = gc <= 3 ? 10 : gc <= 10 ? 4 : 0
      const authority = Math.log10(rating + 1) * 20
      const likeScore = (bestLikes || 0) * 2
      const vipBoost = (rating >= VIP_RATING && bestLikes > 5) ? 80 : 0
      const score = authority + likeScore + vipBoost + uniqueBonus
      return { name, rating, score, bestLikes }
    })
    .sort((a,b) => b.score - a.score)
    .slice(0, 5)
}

function smartSortPosts(ps) {
  if (ps.length < 2) return ps
  const sorted = [...ps].sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
  // "Spark" = earliest post with decent engagement, or the most liked if none
  let sparkIdx = sorted.findIndex(p => (p.likes||0) >= 8)
  if (sparkIdx < 0) {
    let maxL = 0
    sorted.forEach((p,i) => { if ((p.likes||0) > maxL) { maxL = p.likes||0; sparkIdx = i } })
  }
  if (sparkIdx < 0) sparkIdx = 0
  const spark = sorted[sparkIdx]
  const after = sorted.slice(sparkIdx + 1).sort((a,b) => (b.likes||0) - (a.likes||0))
  const before = sorted.slice(0, sparkIdx).sort((a,b) => (b.likes||0) - (a.likes||0))
  return [spark, ...after, ...before]
}

function ActivityChart({ posts, favorites, ignored, onFav, onIgnore, onUnignore, setLightbox,
                         minLikes, minRating, search, onPostClick, lang, t }) {
  const [tip,      setTip]      = useState(null)
  const [tipStyle, setTipStyle] = useState(null)
  const [selected, setSelected] = useState(null)
  const [period,   setPeriod]   = useState('month')
  const isMobile = useIsMobile()
  const tipHideTimer = useRef(null)
  const tipShowTimer = useRef(null)
  const tipLocked    = useRef(false)
  const tipRef       = useRef(null)
  const closeTip = useCallback(() => {
    clearTimeout(tipHideTimer.current)
    clearTimeout(tipShowTimer.current)
    setTip(null)
    setTipStyle(null)
    tipLocked.current = false
  }, [])
  const { announceOpen: announceHoverPopupOpen } = useExclusiveHoverPopup(closeTip)
  const scheduleTipHide = () => {
    clearTimeout(tipHideTimer.current)
    tipHideTimer.current = setTimeout(closeTip, 200)
  }
  const cancelTipHide = () => clearTimeout(tipHideTimer.current)
  const requestTip = (t) => {
    if (tipLocked.current) return
    cancelTipHide()
    clearTimeout(tipShowTimer.current)
    tipShowTimer.current = setTimeout(() => {
      announceHoverPopupOpen()
      setTip(t)
    }, 90)
  }
  useEffect(() => () => {
    clearTimeout(tipHideTimer.current)
    clearTimeout(tipShowTimer.current)
  }, [])

  const PERIOD_DAYS = { week: 7, month: 30, all: null }
  const PERIOD_LABELS = { week: t('period_week'), month: t('period_month'), all: t('period_all_marathon') }

  const data = useMemo(() => {
    const byDate = {}
    posts.forEach(p => {
      if (!p.timestamp) return
      const k = warsawDayKey(p.timestamp)
      if (!k) return
      if (!byDate[k]) byDate[k] = { count:0, posts:[] }
      byDate[k].count++
      byDate[k].posts.push(p)
    })
    const sorted = Object.entries(byDate).sort((a,b)=>a[0]>b[0]?1:-1)
    const days = PERIOD_DAYS[period]
    return days ? sorted.slice(-days) : sorted
  }, [posts, period])

  // Precompute tooltip payload per date — avoids re-running makeDayEvents / pickTopAuthors
  // on every hover frame. Building this once per `data/posts` change is much cheaper
  // than doing it inside the render path of the hover tooltip.
  const dayMeta = useMemo(() => {
    const meta = new Map()
    for (const [date, { posts: dp }] of data) {
      const romeoCount = dp.reduce((n, p) => n + (ROMEO_RE.test(p.author) ? 1 : 0), 0)
      meta.set(date, {
        events: makeDayEvents(dp),
        topAuthors: pickTopAuthors(dp, posts).slice(0, 3),
        romeoCount,
      })
    }
    return meta
  }, [data, posts])

  useLayoutEffect(() => {
    if (!tip || selected || !tip.anchorRect || !tipRef.current) {
      setTipStyle(null)
      return
    }

    const nextStyle = computeFixedPopupLayout({
      anchorRect: tip.anchorRect,
      panelRect: tipRef.current.getBoundingClientRect(),
      preferredWidth: 380,
      minWidth: 280,
      gap: 12,
      edge: 8,
      vertical: 'center',
    })
    setTipStyle(nextStyle)
  }, [tip, selected])

  useEffect(() => {
    if (!tip || selected) return undefined

    const closeOnViewportChange = () => closeTip()
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [tip, selected, closeTip])

  const scrollRef = useRef(null)
  useEffect(() => {
    if (isMobile && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isMobile, data.length])

  const svgRef = useRef(null)
  if (!data.length) return null
  const max = Math.max(...data.map(d=>d[1].count), 1)

  // ── MOBILE: горизонтальный скролл, последние 7 дней видны сразу ─────────────
  if (isMobile) {
    const BAR_W = 36
    const BAR_MAX_H = 80

    return (
      <div className="chart-wrap">
        <div className="section-head" style={{marginBottom:8,flexWrap:'wrap',gap:8}}>
          <h2 className="section-title">{t('chart_activity')}</h2>
          <span className="section-count">{plDays(data.length, lang)}</span>
          <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
            {Object.keys(PERIOD_DAYS).map(k => (
              <button type="button" key={k} onClick={()=>setPeriod(k)} aria-pressed={period===k}
                style={{background:period===k?'var(--red)':'var(--bg3)',border:'1px solid '+(period===k?'var(--red)':'var(--border2)'),borderRadius:4,color:period===k?'#fff':'var(--dim2)',fontSize:10,padding:'4px 8px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
          {selected && (
            <button onClick={()=>setSelected(null)}
              style={{background:'none',border:'none',color:'var(--dim)',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
              ✕ {t('close')}
            </button>
          )}
        </div>

        {/* Горизонтальный скролл — скроллится к правому краю (последние дни) */}
        <div ref={scrollRef} style={{overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:4}}>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',minWidth:'max-content',padding:'4px 8px 0'}}>
            {data.map(([date, {count, posts:dp}]) => {
              const bh = Math.max(6, Math.round((count/max)*BAR_MAX_H))
              const isSelected = selected?.date === date
              return (
                <div key={date} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',minWidth:BAR_W}}
                  role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${date}: ${count}`}
                  onKeyDown={e=>{
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    setSelected(selected?.date===date ? null : {date,posts:dp})
                  }}
                  onClick={()=>setSelected(selected?.date===date ? null : {date,posts:dp})}>
                  {/* Число постов над баром */}
                  <span style={{fontSize:10,color:isSelected?'var(--white)':'var(--dim)',fontFamily:"'Roboto Mono',monospace",fontWeight:isSelected?700:400}}>
                    {count}
                  </span>
                  <div style={{
                    width:BAR_W-6, height:bh, borderRadius:3,
                    background:isSelected?'#e53935':'#e5393540',
                    border: isSelected?'2px solid #e53935':'1px solid #e5393530',
                    transition:'all .15s',
                    boxShadow: isSelected?'0 0 8px #e5393580':'none'
                  }}/>
                  {/* Дата под баром */}
                  <span className="activity-mobile-date" style={{color:isSelected?'var(--text)':'var(--dim)'}}>
                    {date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{fontSize:11,color:'var(--dim)',textAlign:'center',padding:'4px 0 6px'}}>{t('mobile_scroll_hint')}</div>

        {/* Selected day posts */}
        {selected && (() => {
          const events = makeDayEvents(selected.posts)
          let dayPosts = smartSortPosts([...selected.posts]
            .filter(p => !minLikes  || (p.likes||0)  >= minLikes)
            .filter(p => !minRating || (p.rating||0) >= minRating)
            .filter(p => !search    || p.text?.toLowerCase().includes(search?.toLowerCase())))
          return (
            <div style={{marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--dim2)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:6}}>
                📅 {selected.date} — {plPosts(selected.posts.length, lang)}
              </div>
              {events.length > 0 && <div style={{marginBottom:10}}><DayEventsList events={events} setLightbox={setLightbox} onPostClick={onPostClick} lang={lang}/></div>}
              {dayPosts.length === 0
                ? <div className="empty-state">{t('empty_no_posts_day')}</div>
                : dayPosts.map(p => (
                  <PostCard key={p.id||p.url} p={p} lang={lang}
                    favorites={favorites||new Set()} ignored={ignored||new Set()}
                    onFav={onFav||(() =>{})} onIgnore={onIgnore||(() =>{})} onUnignore={onUnignore||(() =>{})}
                    setLightbox={setLightbox||(() =>{})}/>
                ))
              }
            </div>
          )
        })()}
      </div>
    )
  }

  // ── DESKTOP: SVG bar chart ─────────────────────────────────────────────────
  const W=600, H=70, pad=3
  const bw   = (W - pad * (data.length - 1)) / data.length
  const labelEdge = 40
  const labelWidth = 30
  const labelGap = 8
  const maxLabels = 9
  const pitch = bw + pad
  const densityStep = data.length > 1
    ? Math.max(1, Math.ceil((data.length - 1) / (maxLabels - 1)))
    : 1
  const widthStep = Math.max(1, Math.ceil((labelWidth + labelGap) / pitch))
  const step = Math.max(densityStep, widthStep)
  const labelCandidates = []
  for (let i = 0; i < data.length; i += step) labelCandidates.push(i)
  const lastIndex = data.length - 1
  if (labelCandidates.at(-1) !== lastIndex) labelCandidates.push(lastIndex)

  const labelBounds = i => {
    const x = i * pitch + bw / 2
    const anchor = x < labelEdge ? 'start' : x > W - labelEdge ? 'end' : 'middle'
    const left = anchor === 'start' ? x : anchor === 'end' ? x - labelWidth : x - labelWidth / 2
    const right = anchor === 'start' ? x + labelWidth : anchor === 'end' ? x : x + labelWidth / 2
    return { i, left, right }
  }
  const packedLabels = []
  for (const i of labelCandidates) {
    const next = labelBounds(i)
    if (i === lastIndex) {
      while (packedLabels.length && next.left < packedLabels.at(-1).right + labelGap) packedLabels.pop()
      packedLabels.push(next)
      continue
    }
    const previous = packedLabels.at(-1)
    if (!previous || next.left >= previous.right + labelGap) packedLabels.push(next)
  }
  const labelSet = new Set(packedLabels.map(label => label.i))

  return (
    <div className="chart-wrap">
      <div className="section-head" style={{marginBottom:8,gap:10}}>
        <h2 className="section-title">{t('chart_activity')}</h2>
        <span className="section-count">{period==='all' ? `${t('chart_whole_marathon')} · ${plDays(data.length, lang)}` : `${t('chart_last_period')} ${plDays(data.length, lang)}`}</span>
        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          {Object.keys(PERIOD_DAYS).map(k => (
            <button type="button" key={k} onClick={()=>setPeriod(k)} aria-pressed={period===k}
              style={{background:period===k?'var(--red)':'var(--bg3)',border:'1px solid '+(period===k?'var(--red)':'var(--border2)'),borderRadius:4,color:period===k?'#fff':'var(--dim2)',fontSize:10,padding:'3px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
              {PERIOD_LABELS[k]}
            </button>
          ))}
          {selected && (
            <button onClick={()=>setSelected(null)}
              style={{background:'none',border:'none',color:'var(--dim)',fontSize:11,cursor:'pointer',fontFamily:'inherit',marginLeft:4}}>
              ✕ {t('close')}
            </button>
          )}
        </div>
      </div>
      <svg ref={svgRef} className="chart-svg" viewBox={`0 0 ${W} ${H+22}`} onMouseLeave={scheduleTipHide}>
        {data.map(([date, {count, posts:dp}], i) => {
          const x  = i * (bw + pad)
          const bh = Math.max(3, (count / max) * H)
          const isSelected = selected?.date === date
          const labelX = x + bw / 2
          const labelAnchor = labelX < labelEdge ? 'start' : labelX > W - labelEdge ? 'end' : 'middle'
          return (
            <g key={date} className="activity-bar" style={{cursor:'pointer'}}
              onMouseEnter={(e)=>{
                const rect = e.currentTarget.getBoundingClientRect()
                requestTip({
                  date,
                  count,
                  posts: dp,
                  x: x + bw / 2,
                  anchorRect: {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                  },
                })
              }}
              onClick={()=>{
                closeTip()
                setSelected(selected?.date===date ? null : {date,posts:dp})
              }}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2}
                className={isSelected ? 'activity-bar-rect active' : 'activity-bar-rect'}/>
              {labelSet.has(i) && (
                <text x={labelX} y={H+16}
                  textAnchor={labelAnchor}
                  style={{textAnchor:labelAnchor}}
                  className="chart-label">
                  {date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* HOVER TOOLTIP */}
      {tip && !selected && (() => {
        const m = dayMeta.get(tip.date) || { events: [], topAuthors: [], romeoCount: 0 }
        const topAuthors = m.topAuthors
        const romeoCount = m.romeoCount
        return (
          <div ref={tipRef} className="chart-tooltip"
            onMouseEnter={()=>{ cancelTipHide(); tipLocked.current = true }}
            onMouseLeave={()=>{ tipLocked.current = false; scheduleTipHide() }}
            style={{
              position:'fixed',
              left: tipStyle?.left ?? 0,
              top: tipStyle?.top ?? 0,
              pointerEvents:'auto',
              width: tipStyle?.width ?? 380,
              maxHeight: tipStyle?.maxHeight ?? 'calc(100vh - 16px)',
              maxWidth:'calc(100vw - 16px)',
              minWidth:280,
              overflowY:'auto',
              visibility: tipStyle ? 'visible' : 'hidden',
              transformOrigin: tipStyle?.transformOrigin ?? 'left top',
            }}>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:12,marginBottom:4}}>📅 {tip.date}</div>
            <div style={{fontSize:11,color:'var(--dim)',marginBottom:8}}>
              {plPosts(tip.count, lang)}
              {romeoCount ? ` · ${t('day_romeo')}: ${romeoCount}` : ''}
            </div>
            {topAuthors.length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:'var(--dim)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>{t('ac_auth_label')}</div>
                {topAuthors.map(a => (
                  <div key={a.name} style={{fontSize:11,color:'var(--dim2)',display:'flex',justifyContent:'space-between',gap:8,lineHeight:1.6}}>
                    <span style={{color:'var(--text)'}}>{a.name}</span>
                    <span style={{fontSize:10,fontFamily:"'Roboto Mono',monospace",display:'inline-flex',alignItems:'center',gap:6}}>
                      {a.bestLikes > 0 && <span style={{color:'#ffb74d'}}>+{a.bestLikes} 👍</span>}
                      <span style={{color:'#4caf50',display:'inline-flex',alignItems:'center',gap:2}}>
                        <svg viewBox="0 0 12 10" style={{width:9,height:8,fill:'#4caf50',flexShrink:0}}>
                          <rect x="0" y="6" width="2.5" height="4"/>
                          <rect x="3.2" y="3" width="2.5" height="7"/>
                          <rect x="6.4" y="1" width="2.5" height="9"/>
                          <rect x="9.6" y="0" width="2.5" height="10"/>
                        </svg>
                        {fmtInt(a.rating)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{borderTop:'1px solid var(--border)',paddingTop:6,marginTop:2}}>
              <DayEventsList events={m.events} compact lang={lang}
                setLightbox={(src)=>{ setLightbox?.(src); closeTip() }}
                onPostClick={(p)=>{ closeTip(); onPostClick?.(p) }}/>
            </div>
          </div>
        )
      })()}

      {/* EXPANDED DAY VIEW */}
      {selected && (() => {
        const events = makeDayEvents(selected.posts)
        let dayPosts = [...selected.posts]
          .filter(p => !minLikes  || (p.likes||0)  >= minLikes)
          .filter(p => !minRating || (p.rating||0) >= minRating)
          .filter(p => !search    || p.text?.toLowerCase().includes(search?.toLowerCase()))
        dayPosts = smartSortPosts(dayPosts)
        return (
          <div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--dim2)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>
              📅 {selected.date} — {plPosts(selected.posts.length, lang)}
            </div>
            {events.length > 0 && <div style={{marginBottom:12}}><DayEventsList events={events} setLightbox={setLightbox} lang={lang}/></div>}
            <div style={{marginTop:4}}>
              {dayPosts.length === 0
                ? <div className="empty-state">{t('empty_no_posts_topic')}</div>
                : dayPosts.map((p,i) => (
                  <PostCard key={p.id||p.url} p={p} lang={lang}
                    favorites={favorites||new Set()} ignored={ignored||new Set()}
                    onFav={onFav||(() =>{})} onIgnore={onIgnore||(() =>{})} onUnignore={onUnignore||(() =>{})}
                    setLightbox={setLightbox||(() =>{})}/>
                ))
              }
            </div>
          </div>
        )
      })()}
    </div>
  )
}


// ─── FILTER BAR ──────────────────────────────────────────────────────────────
const ROMEO_AVATAR = 'https://www.gipsyteam.ru/upload/Avatar/default/2/6/6/26670.jpg'
const GT_DEFAULT_AVATAR = 'https://forum.gipsyteam.com/img/imguser.png'
const avatarError = e => {
  const img = e.currentTarget
  if (img.dataset.fallbackApplied !== '1') {
    img.dataset.fallbackApplied = '1'
    img.src = GT_DEFAULT_AVATAR
    return
  }
  img.closest('[data-avatar-initial]')?.classList.add('avatar-failed')
  img.style.display = 'none'
}

// Smooth scrolling honors prefers-reduced-motion (rAF-driven scrolls can't be
// caught by the CSS media query alone).
const scrollBehavior = () =>
  (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth'

function FilterBar({ sortBy, setSortBy, search, setSearch, showSearch, setShowSearch,
                     romeoOnly, setRomeoOnly, minLikes, setMinLikes,
                     minRating, setMinRating, count, showSort=true, t, lang }) {
  const tr = t || (k => k)
  const ruControls = !lang || lang === 'ru'
  const hasFilters = (ruControls && (romeoOnly || minLikes !== 3 || minRating !== 0)) || search
  return (
    <div className="filter-bar" role="search" aria-label={tr('filter_bar_label')}>
      {showSort && (
        <label className="filter-field filter-sort" htmlFor="feed-sort">
          <span>{tr('filter_sort_label')}</span>
          <select id="feed-sort" className="feed-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="date_asc">{tr('sort_date_asc')}</option>
            <option value="date_desc">{tr('sort_date_desc')}</option>
            <option value="likes">{tr('sort_likes')}</option>
          </select>
        </label>
      )}
      {ruControls && (
      <button type="button" className={`filter-pill filter-romeo ${romeoOnly?'on':'off'}`}
        onClick={()=>setRomeoOnly(s=>!s)} title={tr('filter_romeo_title')} aria-pressed={romeoOnly}>
        <img src={ROMEO_AVATAR} alt="" onError={e=>e.target.style.display='none'} />
        {tr('day_romeo')}
      </button>
      )}
      {ruControls && (
      <label className="filter-field" htmlFor="filter-min-likes" title={tr('filter_min_likes')}>
        <span>{tr('filter_likes_from')}</span>
        <input id="filter-min-likes" className="filter-num" type="number" min="0" value={minLikes}
          title={tr('filter_min_likes')}
          onChange={e=>setMinLikes(+e.target.value||0)} onFocus={e=>e.target.select()}/>
      </label>
      )}
      {ruControls && (
      <label className="filter-field" htmlFor="filter-min-reputation" title={tr('filter_min_rep')}>
        <span>{tr('filter_reputation_from')}</span>
        <input id="filter-min-reputation" className="filter-num" type="number" min="0" step="100" value={minRating}
          title={tr('filter_min_rep')}
          onChange={e=>setMinRating(+e.target.value||0)} onFocus={e=>e.target.select()}/>
      </label>
      )}
      <button type="button" className={`filter-pill filter-search-toggle ${showSearch?'on':'off'}`}
        onClick={()=>setShowSearch(s=>!s)} title={tr('filter_search_title')}
        aria-expanded={showSearch} aria-controls={showSearch ? 'feed-search' : undefined}>
        <span aria-hidden="true">🔍</span>
        <span>{tr('filter_search_action')}</span>
      </button>
      {showSearch && (
        <input id="feed-search" className="feed-search" placeholder={tr('filter_search_placeholder')}
          aria-label={tr('filter_search_title')} value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
      )}
      {hasFilters && (
        <button type="button" className="filter-pill filter-reset off" title={tr('filter_reset')} onClick={()=>{
          setRomeoOnly(false); setMinLikes(3); setMinRating(0); setSearch(''); setShowSearch(false);
        }}>{tr('filter_reset_short')}</button>
      )}
      <output className="filter-active-count" aria-live="polite">{plPosts(count, lang || 'ru')}</output>
    </div>
  )
}

function SettingsPanel({ theme, setTheme, lang, setLang, sortBy, setSortBy,
                         ignored, removeIgnore, ignoreInput, setIgnoreInput, addIgnore, t }) {
  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <div className="settings-heading">
        <h2 id="settings-heading">{t('tab_settings')}</h2>
        <p>{t('settings_intro')}</p>
      </div>

      <div className="settings-grid">
        <section className="sblock settings-card" aria-labelledby="settings-appearance-heading">
          <h3 className="sblock-title" id="settings-appearance-heading">◐ {t('settings_appearance')}</h3>
          <div className="settings-card-body">
            <div className="settings-row">
              <span className="settings-label">{t('settings_theme')}</span>
              <div className="settings-choice-group" role="group" aria-label={t('settings_theme')}>
                <button type="button" className={theme==='dark'?'active':''}
                  aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')}>{t('theme_dark')}</button>
                <button type="button" className={theme==='light'?'active':''}
                  aria-pressed={theme==='light'} onClick={()=>setTheme('light')}>{t('theme_light')}</button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('settings_language')}</span>
              <div className="settings-choice-group" role="group" aria-label={t('settings_language')}>
                {['ru','en','es'].map(code => (
                  <button type="button" key={code} className={lang===code?'active':''}
                    aria-pressed={lang===code} onClick={()=>setLang(code)}>{code.toUpperCase()}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sblock settings-card" aria-labelledby="settings-feed-heading">
          <h3 className="sblock-title" id="settings-feed-heading">☷ {t('settings_feed')}</h3>
          <div className="settings-card-body">
            <label className="settings-row" htmlFor="settings-feed-sort">
              <span className="settings-label">{t('settings_sort')}</span>
              <select id="settings-feed-sort" className="settings-select" value={sortBy}
                onChange={e=>setSortBy(e.target.value)}>
                <option value="date_desc">{t('sort_date_desc')}</option>
                <option value="date_asc">{t('sort_date_asc')}</option>
                <option value="likes">{t('sort_likes')}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="sblock settings-card settings-ignored" aria-labelledby="settings-ignored-heading">
          <h3 className="sblock-title" id="settings-ignored-heading">🚫 {t('settings_ignored_authors')}</h3>
          {ignored.size===0
            ? <div className="ignore-empty">{t('settings_ignored_empty')}</div>
            : <div className="ignore-list">
                {[...ignored].map(name=>(
                  <div key={name} className="ignore-item">
                    <span>{name}</span>
                    <button type="button" className="ignore-remove" onClick={()=>removeIgnore(name)}
                      aria-label={`${t('settings_remove_author')}: ${name}`}>✕</button>
                  </div>
                ))}
              </div>
          }
          <div className="ignore-add">
            <label className="sr-only" htmlFor="ignore-author-input">{t('settings_add_author_label')}</label>
            <input id="ignore-author-input" className="ignore-input" placeholder={t('settings_add_author')}
              value={ignoreInput} onChange={e=>setIgnoreInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addIgnore(ignoreInput)}/>
            <button type="button" className="btn-sm" disabled={!ignoreInput.trim()}
              onClick={()=>addIgnore(ignoreInput)}>{t('settings_add_btn')}</button>
          </div>
        </section>

        <section className="sblock settings-card settings-links" aria-labelledby="settings-links-heading">
          <h3 className="sblock-title" id="settings-links-heading">↗ {t('settings_links')}</h3>
          <div className="settings-links-list">
            <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer">{t('settings_forum_thread')}</a>
            <a href="https://github.com/loremcdmx/romeoprotracker" target="_blank" rel="noreferrer">{t('settings_source')}</a>
          </div>
        </section>
      </div>
    </section>
  )
}

// ─── POST TEXT RENDERER ──────────────────────────────────────────────────────
function CollapsibleQuote({ author, date, body }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{borderLeft:'3px solid var(--border-quote)',background:'var(--bg-quote)',borderRadius:'0 4px 4px 0',padding:'6px 10px',margin:'2px 0 8px'}}>
      <div style={{fontSize:10,color:'var(--dim)',fontWeight:600,marginBottom:open?4:0,letterSpacing:'.04em',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}
        onClick={()=>setOpen(o=>!o)}>
        <span>↩ {author}{date ? ' · ' + date : ''}</span>
        <span style={{color:'var(--dim)',fontSize:9,opacity:.6}}>{open ? '▲' : `▼ ${_t('filter_show')}`}</span>
      </div>
      {open && (
        <div style={{color:'var(--text-quote)',fontSize:12,lineHeight:1.6,marginTop:4}}>
          {body
            ? body.replace(/\n{2,}/g,'\n').split('\n').filter(p=>/[^\s\u00a0]/.test(p)).map((p,j,arr)=>(
                <span key={j} style={{display:'block',marginBottom:j<arr.length-1?4:0}}>{p}</span>
              ))
            : <span style={{fontStyle:'italic',color:'var(--dim)'}}>↩ {_t('media_fallback')}</span>
          }
        </div>
      )}
    </div>
  )
}

function renderPostText(text, collapseQuotes=false) {
  if (!text) return null

  const parts = []
  // [VIDEO] markers are rendered as actual iframes by PostCard separately; strip
  // them from the body text so they don't appear as literal `[VIDEO]` strings.
  let remaining = autoCloseQuotes(text.trim()).replace(/\[VIDEO\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!remaining) return null

  while (remaining.length > 0) {
    // Формат из нового скрапера: [QUOTE]Автор|Автор @ дата\nтело цитаты[/QUOTE]ответ
    const qs = remaining.indexOf('[QUOTE]')
    const qe = remaining.indexOf('[/QUOTE]')

    if (qs !== -1 && qe > qs) {
      // Текст до цитаты
      if (qs > 0) {
        const before = remaining.slice(0, qs).trim()
        if (before) parts.push({ type:'text', text: before })
      }

      const inner = remaining.slice(qs + 7, qe)
      const nlIdx = inner.indexOf('\n')
      const header = nlIdx !== -1 ? inner.slice(0, nlIdx).trim() : ''
      const body   = nlIdx !== -1 ? inner.slice(nlIdx + 1).trim() : inner.trim()

      // header: "chup|chup @ 05.04.26" — берём часть до | как имя, после — дата
      const pipeIdx = header.indexOf('|')
      const author = pipeIdx !== -1 ? header.slice(0, pipeIdx).trim() : header.split('@')[0].trim()
      const dateStr = pipeIdx !== -1
        ? header.slice(pipeIdx + 1).replace(new RegExp('^' + author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*@\\s*'), '').trim()
        : (header.split('@')[1] || '').trim()

      // Пропускаем мусорные пустые цитаты (пустое тело + нет реального автора)
      const hasRealAuthor = author && author !== '|' && author.length > 1
      if (body || hasRealAuthor) {
        parts.push({ type:'quote', author, date: dateStr, body })
      }
      remaining = remaining.slice(qe + 8).trim()
      continue
    }

    if (remaining.trim()) parts.push({ type:'text', text: remaining })
    break
  }

  if (!parts.length) return <span style={{whiteSpace:'pre-wrap'}}>{text}</span>

  return parts.map((part, i) => {
    if (part.type === 'quote') {
      if (collapseQuotes) return <CollapsibleQuote key={i} author={part.author} date={part.date} body={part.body}/>
      return (
        <div key={i} style={{
          borderLeft:'3px solid var(--border-quote)', background:'var(--bg-quote)',
          borderRadius:'0 4px 4px 0', padding:'8px 12px', margin:'2px 0 8px',
        }}>
          {(part.author || part.date) && (
            <div style={{fontSize:10,color:'var(--dim)',fontWeight:600,marginBottom:4,letterSpacing:'.04em'}}>
              ↩ {part.author}{part.date ? ' · ' + part.date : ''}
            </div>
          )}
          <div style={{color:'var(--text-quote)',fontSize:12,lineHeight:1.6}}>
            {part.body
              ? part.body.replace(/\n{2,}/g,'\n').split('\n').filter(p=>/[^\s\u00a0]/.test(p)).map((p,j,arr)=>(
                  <span key={j} style={{display:'block',marginBottom:j<arr.length-1?4:0}}>{p}</span>
                ))
              : <span style={{fontStyle:'italic',color:'var(--dim)'}}>↩ {_t('media_fallback')}</span>
            }
          </div>
        </div>
      )
    }
    // Рендерим как абзацы с 6px отступом вместо пустых строк
    const rawText = collapseQuotes ? part.text.replace(/\n{2,}/g, '\n').trim() : part.text
    const paras = rawText.split('\n').filter(p => p.trim() !== '')
    if (paras.length === 0) return null
    if (paras.length === 1) return <span key={i} style={{display:'block'}}>{paras[0]}</span>
    return (
      <span key={i}>
        {paras.map((p, j) => (
          <span key={j} style={{display:'block', marginBottom: j < paras.length-1 ? 6 : 0}}>{p}</span>
        ))}
      </span>
    )
  })
}


// ─── POST CARD ────────────────────────────────────────────────────────────────
const S_MENU = {position:'absolute',top:44,left:12,background:'var(--bg-popup)',border:'1px solid var(--border-popup)',borderRadius:8,padding:'6px 0',zIndex:200,minWidth:160,boxShadow:'0 4px 20px rgba(0,0,0,.8)'}
const S_MENU_ITEM = {display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}
const S_FLEX1 = {flex:1,minWidth:0}
const S_EXPAND = {background:'none',border:'1px solid var(--border2)',borderRadius:20,color:'var(--dim2)',cursor:'pointer',fontFamily:'inherit',fontWeight:600,fontSize:11,padding:'3px 10px',display:'inline-flex',alignItems:'center',gap:4,marginLeft:4,transition:'all .15s'}
const S_ARROW = {fontSize:9,opacity:.7}
const S_TAGS_WRAP = {display:'inline-flex',gap:4,marginLeft:4}
const S_TAG = {fontSize:9,color:'var(--dim)',background:'var(--bg3)',borderRadius:10,padding:'2px 6px'}
const S_MONO = {fontFamily:"'Roboto Mono',monospace",fontWeight:700}
const menuHover = e => e.currentTarget.style.background = 'var(--bg3)'
const menuLeave = e => e.currentTarget.style.background = ''
// «16 лет на сайте» comes pre-formatted in Russian from the forum; translate
// number+unit for en/es, falling back to the raw string when unparseable.
function formatRegData(raw, lang) {
  if (!raw || lang === 'ru') return raw
  const m = String(raw).match(/(\d+)\s*(лет|год|мес|дн|час)/i)
  if (!m) return raw
  const n = +m[1]
  const u = m[2].toLowerCase()
  const unit = (u === 'лет' || u === 'год') ? ['years', 'años']
    : u === 'мес' ? ['months', 'meses']
    : u === 'дн' ? ['days', 'días'] : ['hours', 'horas']
  const label = lang === 'es' ? unit[1] : unit[0]
  return lang === 'es' ? `${n} ${label} en el foro` : `${n} ${label} on the site`
}

const PostCard = memo(function PostCard({ p, favorites, ignored, onFav, onIgnore, onUnignore, setLightbox, noClamp=false, tags=null, lang=_lang }) {
  const [exp, setExp]     = useState(false)
  const [menu, setMenu]   = useState(false)
  const [revealIgnored, setRevealIgnored] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const menuRef           = useRef(null)
  const bodyRef           = useRef(null)
  const isFav  = favorites?.has(p.author)
  const isIgnored = ignored?.has(p.author)

  if (isIgnored && !revealIgnored) {
    return (
      <div className="post-card" style={{opacity:.55,cursor:'pointer',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,fontSize:12,color:'var(--dim2)'}}
        onClick={()=>setRevealIgnored(true)}
        title={_t('pc_ignored_click_expand')}>
        <span style={{fontSize:16}}>🚫</span>
        <span style={S_FLEX1}>
          {_t('pc_ignored_prefix')} <b>{p.author}</b> · +{p.likes||0} 👍 · {_t('pc_ignored_body')}
        </span>
        {onUnignore && (
          <button className="btn-sm" onClick={e=>{e.stopPropagation();onUnignore(p.author)}}>{_t('pc_unignore')}</button>
        )}
      </div>
    )
  }

  useEffect(() => {
    if (!menu) return
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menu])
  const likes  = p.likes || 0
  const initial = (p.author||'?')[0].toUpperCase()
  const displayText = (lang !== 'ru' && p.translations?.[lang]) || p.text
  const isLong  = !noClamp && (displayText?.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').length || 0) > 720
  const [shouldClamp, setShouldClamp] = useState(isLong)
  useLayoutEffect(() => {
    if (!isLong || exp) { setShouldClamp(false); return }
    const el = bodyRef.current
    if (!el) return
    el.classList.add('clamped')
    const clampedH = el.clientHeight
    el.classList.remove('clamped')
    const fullH = el.scrollHeight
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 21
    const hiddenLines = (fullH - clampedH) / lineH
    if (hiddenLines > 2) {
      el.classList.add('clamped')
      setShouldClamp(true)
      setOverflows(true)
    } else {
      setShouldClamp(false)
      setOverflows(false)
    }
  }, [isLong, exp, displayText])

  // URL профиля на GT (по нику)
  const profileUrl = `https://www.gipsyteam.ru/profile/${encodeURIComponent(p.author)}`
  const ratingUrl  = `https://www.gipsyteam.ru/profile/${encodeURIComponent(p.author)}?tab=reputation`
  // Блог есть только у пользователей с blogId — определяем по наличию /blogs/ в известных ссылках
  // У Romeopro блог точно есть, у остальных определяем по msgCount > 100 как приближение
  // (точно не знаем без запроса к API форума)

  const isRomeo = ROMEO_RE.test(p.author)

  return (
    <div className={`post-card ${isFav?'faved':''} ${isRomeo?'romeo-post':''}`} onClick={()=>menu&&setMenu(false)}>
      <div className="pc-head">
        <button type="button" className="pc-avatar" data-avatar-initial={initial}
          aria-haspopup="menu" aria-expanded={menu} aria-label={p.author}
          onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
          <img src={p.avatar || GT_DEFAULT_AVATAR} alt="" referrerPolicy="no-referrer" onError={avatarError}/>
        </button>
        {/* Dropdown меню профиля */}
        {menu && (
          <div ref={menuRef} style={S_MENU}
            onClick={e=>e.stopPropagation()}>
            {ROMEO_RE.test(p.author) && (
              <a href="https://forum.gipsyteam.ru/index.php?showforum=141" target="_blank" rel="noreferrer"
                style={S_MENU_ITEM}
                onMouseEnter={menuHover}
                onMouseLeave={menuLeave}>
                📝 {_t('profile_blog')}
              </a>
            )}
            <a href={profileUrl} target="_blank" rel="noreferrer"
              style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e=>e.currentTarget.style.background=''}>
              👤 {_t('profile_profile')}
            </a>
            <a href={`https://forum.gipsyteam.ru/index.php?act=Msg&CODE=4&MID=${encodeURIComponent(p.author)}`}
              target="_blank" rel="noreferrer"
              style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e=>e.currentTarget.style.background=''}>
              ✉️ {_t('profile_pm')}
            </a>
          </div>
        )}
        <div style={S_FLEX1}>
          <button type="button" className="pc-author"
            aria-haspopup="menu" aria-expanded={menu}
            onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
            {p.author}
          </button>
          <div className="pc-author-meta">
            {p.msgCount && <span>{lang==='ru' ? `${fmtInt(p.msgCount)} ${plural(p.msgCount, ['пост','поста','постов'])}` : `${fmtInt(p.msgCount)} ${_t('posts_word')}`}</span>}
            {p.regData  && <span>· {formatRegData(p.regData, lang)}</span>}
            {p.rating != null && (
              <><span>·</span><a href={ratingUrl} target="_blank" rel="noreferrer"
                style={{color:p.rating>=0?'#4caf50':'#ff5252',display:'inline-flex',alignItems:'center',gap:2,textDecoration:'none'}}
                onClick={e=>e.stopPropagation()}>
                <svg viewBox="0 0 12 10" style={{width:11,height:10,fill:p.rating>=0?'#4caf50':'#ff5252',flexShrink:0,marginLeft:3}}>
                  <rect x="0" y="6" width="2.5" height="4"/>
                  <rect x="3.2" y="3" width="2.5" height="7"/>
                  <rect x="6.4" y="1" width="2.5" height="9"/>
                  <rect x="9.6" y="0" width="2.5" height="10"/>
                </svg>
                <span style={S_MONO}>{fmtInt(p.rating)}</span>
              </a></>
            )}
          </div>
        </div>
            <div className="pc-date" title={fmtDateTimeLang(p.timestamp, _lang)}>{timeAgo(p.timestamp, _lang) || fmtDateTimeLang(p.timestamp, _lang)}</div>
        <div className="pc-actions">
          <button type="button" className={`pc-action ${isFav?'on':''}`} onClick={()=>onFav(p.author)}
            title={isFav?_t('pc_fav_remove'):_t('pc_fav_add')}
            aria-label={isFav?_t('pc_fav_remove'):_t('pc_fav_add')} aria-pressed={isFav}>⭐</button>
          {lang === 'ru' && (
            <button type="button" className="pc-action" onClick={()=>onIgnore(p.author)}
              title={_t('pc_ignore')} aria-label={_t('pc_ignore')}>🚫</button>
          )}
        </div>
      </div>
      <div ref={bodyRef} className={`pc-body ${!exp && shouldClamp ? 'clamped' : ''}`}>{renderPostText(displayText)}</div>
      {p.images?.length>0 && (
        <div className="pc-images">
          {p.images.map((src,j)=>(
            <img key={j} className="pc-img" src={src} alt="" loading="lazy"
              onClick={()=>setLightbox(src)} onError={e=>e.target.style.display='none'}/>
          ))}
        </div>
      )}
      {p.videos?.length>0 && (
        <div className="pc-videos">
          {p.videos.map((src,j)=>(
            <div key={j} className="pc-video">
              <iframe src={src} title={_t('video_iframe_title')} loading="lazy" allowFullScreen frameBorder="0"
                style={{width:'100%',aspectRatio:'16/9',border:0,borderRadius:8,background:'#000'}}/>
            </div>
          ))}
        </div>
      )}
      {(() => {
        const stripped = stripQuoteTags(p.text || '').replace(/\[VIDEO\]/g, '').trim()
        if (stripped.length === 0 && !p.images?.length && !p.videos?.length) {
          return (
            <a href={p.url} target="_blank" rel="noreferrer" className="pc-broken-link"
              onClick={e=>e.stopPropagation()}>
              ⚠ {_t('pc_media_fail')} →
            </a>
          )
        }
        return null
      })()}
      <div className="pc-foot">
        <span className={`pc-likes ${likes>0?'pos':likes<0?'neg':'zero'}`}>{likes>0?'👍 +':likes<0?'👎 ':''}{likes}</span>
        {p.brAfter && <span className="pc-br">{_t('day_br_label')}: {fmtNum(p.brAfter)}</span>}
        {((shouldClamp && overflows) || (isLong && exp)) && (
          <button onClick={()=>setExp(s=>!s)} style={S_EXPAND}>
            <span style={S_ARROW}>{exp?'▲':'▼'}</span>
            {exp ? _t('pc_collapse') : _t('pc_expand')}
          </button>
        )}
        {tags && tags.length > 0 && (
          <span style={S_TAGS_WRAP}>
            {tags.map(tag=>(
              <span key={tag.id} style={S_TAG}>
                {tag.icon} {tag.label}
              </span>
            ))}
          </span>
        )}
        {p.url&&<a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ {FORUM_WORD[_lang] || 'forum'}</a>}
      </div>
    </div>
  )
})

// ─── TEMPO VALUE (animated, used in progress bar) ────────────────────────────
// Smoothly tweens `target` when it changes (e.g. user toggles chart period).
// Briefly pulses with a subtle highlight to draw the eye.
function TempoValue({ target, title, animate = true, suffix = '' }) {
  const v = useTweenValue(target, animate ? 700 : 0)
  const [pulse, setPulse] = useState(false)
  const prev = useRef(target)
  useEffect(() => {
    if (animate && prev.current !== target) {
      prev.current = target
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 700)
      return () => clearTimeout(t)
    }
    prev.current = target
  }, [animate, target])
  return (
    <span className={`mps-value tempo-val ${pulse?'pulse':''}`} title={title}>
      ~{fmtInt(Math.round(v))}{suffix && <span className="tempo-unit">{suffix}</span>}
    </span>
  )
}

// ─── PAGINATOR ────────────────────────────────────────────────────────────────
function Paginator({ page, totalPages, onPage, perPage, onPerPage, total, lang }) {
  const isMob = useIsMobile()
  const tr = createTranslator(lang || DEFAULT_LANG)
  const pages = []
  const delta = isMob ? 1 : 2
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      pages.push(i)
    } else if (pages[pages.length-1] !== '…') {
      pages.push('…')
    }
  }
  return (
    <nav className="pagination" aria-label={`${tr('tab_feed')}: ${tr('page_number')}`}>
      <button type="button" className="page-btn" disabled={page===1} onClick={()=>onPage(page-1)}
        aria-label={tr('page_previous')}>‹</button>
      {pages.map((p,i) => p === '…'
        ? <span key={`e${i}`} className="page-info">…</span>
        : <button type="button" key={p} className={`page-btn ${p===page?'active':''}`} onClick={()=>onPage(p)}
            aria-label={`${tr('page_number')} ${p}`} aria-current={p===page?'page':undefined}>{p}</button>
      )}
      <button type="button" className="page-btn" disabled={page===totalPages} onClick={()=>onPage(page+1)}
        aria-label={tr('page_next')}>›</button>
      {!isMob && <span className="page-info">{(page-1)*perPage+1}–{Math.min(page*perPage,total)} {lang==='ru'?'из':'/'} {total}</span>}
      <select className="perpage-select" aria-label={tr('per_page_label')} value={perPage}
        onChange={e=>{onPerPage(+e.target.value);onPage(1)}}>
        {[10,20,50,100].map(n=><option key={n} value={n}>{n} {lang==='ru'?'на стр.':lang==='es'?'/ pág.':'/ page'}</option>)}
      </select>
    </nav>
  )
}

// ─── SIDEBAR TOP LIST ─────────────────────────────────────────────────────────
export function SidebarTopList({ posts, setLightbox }) {
  const [hovered, setHovered] = useState(null)
  const [anchor, setAnchor] = useState(null)
  const [popupStyle, setPopupStyle] = useState(null)
  const hideTimerRef = useRef(null)
  const popupRef = useRef(null)
  const itemRefs = useRef(new Map())
  const closePopup = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    setHovered(null)
    setAnchor(null)
    setPopupStyle(null)
  }, [])
  const { announceOpen: announceHoverPopupOpen } = useExclusiveHoverPopup(closePopup)
  const scheduleHide = () => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(closePopup, 180)
  }
  const cancelHide = () => clearTimeout(hideTimerRef.current)
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  const setAnchorFromNode = useCallback((node) => {
    if (!node) return
    const rect = node.getBoundingClientRect()
    setAnchor({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
  }, [])

  const openItem = useCallback((index, node) => {
    if (index == null) return
    const nextNode = node ?? itemRefs.current.get(index)
    if (!nextNode) return
    cancelHide()
    announceHoverPopupOpen()
    setHovered(index)
    setAnchorFromNode(nextNode)
  }, [announceHoverPopupOpen, setAnchorFromNode])

  const syncHoverFromPoint = useCallback((clientX, clientY) => {
    const items = []
    itemRefs.current.forEach((node, index) => {
      if (!node) return
      const rect = node.getBoundingClientRect()
      items.push({
        index,
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      })
    })

    const nextIndex = findHoverListIndexAtPoint({
      items,
      point: { x: clientX, y: clientY },
      popupRect: popupRef.current
        ? popupRef.current.getBoundingClientRect()
        : null,
      edge: 6,
    })

    if (nextIndex === null || nextIndex === hovered) return
    openItem(nextIndex)
  }, [hovered, openItem])

  useLayoutEffect(() => {
    if (hovered === null || !anchor || !popupRef.current) {
      setPopupStyle(null)
      return
    }

    const nextStyle = computeFixedPopupLayout({
      anchorRect: anchor,
      panelRect: popupRef.current.getBoundingClientRect(),
      preferredWidth: 340,
      minWidth: 260,
      gap: 6,
      edge: 8,
      vertical: 'smart',
    })
    setPopupStyle(nextStyle)
  }, [hovered, anchor])

  useEffect(() => {
    if (hovered === null) return undefined

    const closeOnViewportChange = () => closePopup()
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [hovered, closePopup])

  const stripQuotes = stripQuoteTags

  return (
    <div style={{padding:'6px 14px'}}
      onMouseLeave={scheduleHide}
      onMouseMove={e => syncHoverFromPoint(e.clientX, e.clientY)}>

      {hovered !== null && anchor && (() => {
        const p = posts[hovered]
        if (!p) return null
        return (
          <div ref={popupRef} data-testid="sidebar-top-popup" className="sidebar-popup"
            onMouseEnter={cancelHide}
            onMouseMove={e => {
              cancelHide()
              syncHoverFromPoint(e.clientX, e.clientY)
            }}
            onMouseLeave={scheduleHide} style={{
            position:'fixed',
            left: popupStyle?.left ?? 0,
            top: popupStyle?.top ?? 0,
            width: popupStyle?.width ?? 340,
            background:'var(--bg-popup)', border:'1px solid var(--border-popup)', borderRight:'3px solid var(--red)',
            borderRadius:8, padding:14, zIndex:9999,
            boxShadow:'var(--shadow-popup)',
            pointerEvents:'auto',
            maxHeight: popupStyle?.maxHeight ?? 'calc(100vh - 16px)',
            display:'flex', flexDirection:'column',
            visibility: popupStyle ? 'visible' : 'hidden',
            transformOrigin: popupStyle?.transformOrigin ?? 'left top',
          }}>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:4}}>{p.author}</div>
            <div style={{fontSize:11,color:'var(--dim)',marginBottom:8,fontFamily:"'Roboto Mono',monospace"}}>
              <span style={{color:'var(--green)'}}>+{p.likes} 👍</span> · {fmtDateTimeLang(p.timestamp, _lang)}
            </div>
            <div style={{fontSize:12,color:'var(--text)',lineHeight:1.6,overflowY:'auto',flex:1,paddingRight:4}}>
              {!((p.text||'').includes('[QUOTE]')) && p.images?.[0] && (
                <img src={p.images[0]} alt=""
                  style={{maxWidth:'100%',maxHeight:260,width:'auto',height:'auto',objectFit:'contain',borderRadius:4,marginBottom:10,display:'block',cursor:'zoom-in'}}
                  onClick={e=>{e.stopPropagation();setLightbox(p.images[0])}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              {renderPostText(p.text, true)}
              {!stripQuotes(p.text) && p.text?.includes('[QUOTE]') && (
                <div style={{fontSize:11,color:'var(--dim)',fontStyle:'italic',marginTop:6}}>
                  ↩ {p.text.match(/\[QUOTE\]([^|\n]*)/)?.[1]?.trim() ? `${_t('quote_answer_to')} ${p.text.match(/\[QUOTE\]([^|\n]*)/)[1].trim()}` : _t('quote_generic')} — {_t('quote_full_on_forum')} ↗
                </div>
              )}
            </div>
            <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
              <a href={p.url} target="_blank" rel="noreferrer"
                style={{fontSize:11,color:'var(--red2)'}}>→ {_t('open_on_forum')}</a>
            </div>
          </div>
        )
      })()}

      {posts.map((p, i) => {
        const clean = stripQuotes(p.text)
        const hasQuote = (p.text||'').includes('[QUOTE]')
        const isQuoteOnly = !clean && hasQuote
        const quoteAuthor = hasQuote ? (p.text.match(/\[QUOTE\]([^|\n]*)/)?.[1]?.trim() || '') : ''
        const quoteBody = hasQuote ? extractQuoteBody(p.text) : ''
        const isShortQuote = hasQuote && quoteBody.length <= 150
        const preview = clean || ((!hasQuote && p.images?.[0]) ? `📷 ${_t('image_caption')}` : '')
        const initial = (p.author||'?')[0].toUpperCase()
        // Don't show images in sidebar for posts with quotes (image may be from the quote)
        const showImage = !hasQuote && p.images?.[0]
        return (
          <div key={i}
            ref={node => {
              if (node) itemRefs.current.set(i, node)
              else itemRefs.current.delete(i)
            }}
            data-testid={`sidebar-top-item-${i}`}
            style={{display:'flex',gap:10,padding:'9px 0',borderBottom:'1px solid var(--border)',
              alignItems:'flex-start',cursor:'pointer'}}
            role="link" tabIndex={0} aria-label={preview ? `${p.author}: ${preview.slice(0, 80)}` : (hasQuote && quoteAuthor ? `${p.author} → ${quoteAuthor}` : p.author)}
            onKeyDown={e=>{
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (p.url) window.open(p.url, '_blank', 'noopener')
            }}
            onClick={()=>p.url&&window.open(p.url,'_blank')}
            onMouseEnter={e => openItem(i, e.currentTarget)}
            onFocus={e => openItem(i, e.currentTarget)}>
            <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16,flexShrink:0,paddingTop:10}}>{i+1}</span>
            <div data-avatar-initial={initial} style={{width:28,height:28,borderRadius:'50%',background:'var(--red)',flexShrink:0,
              overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:700,color:'#fff',marginTop:2}}>
              <img src={p.avatar || GT_DEFAULT_AVATAR} alt="" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={avatarError}/>
            </div>
            <div style={S_FLEX1}>
              <div style={{fontSize:10,color:'var(--dim2)',fontWeight:600,marginBottom:2}}>{p.author}</div>
              {showImage && (
                <img src={p.images[0]} alt=""
                  style={{width:'100%',height:'auto',borderRadius:4,marginBottom:6,display:'block',cursor:'zoom-in'}}
                  onClick={e=>{e.stopPropagation();setLightbox(p.images[0])}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              {isShortQuote ? (
                <div style={{fontSize:11,color:'var(--text)',lineHeight:1.5}}>
                  {renderPostText(p.text, false)}
                </div>
              ) : isQuoteOnly ? (
                <div style={{fontSize:11,color:'var(--dim)',lineHeight:1.5,fontStyle:'italic'}}>
                  ↩ {quoteAuthor ? `${_t('quote_answer_to')} ${quoteAuthor}` : _t('quote_generic')} — <span style={{color:'var(--red2)',fontStyle:'normal',textDecoration:'underline'}}>{_t('open_on_forum')}</span>
                </div>
              ) : (
                <div style={{fontSize:11,color:'var(--text)',overflow:'hidden',lineHeight:1.5,
                  display:'-webkit-box',WebkitLineClamp:10,WebkitBoxOrient:'vertical'}}>
                  {quoteAuthor && <span style={{color:'var(--dim)',fontSize:10}}>↩ {quoteAuthor}: </span>}
                  {preview.substring(0,500)}
                </div>
              )}
            </div>
            <span style={{color:'var(--green)',fontSize:10,fontWeight:700,flexShrink:0,paddingTop:10}}>+{p.likes}</span>
          </div>
        )
      })}
    </div>
  )
}


const FF_URL = 'https://firstfund.pro/?utm_source=romeofish&utm_medium=referral&utm_campaign=romeofish'
const FF_CHIP_EDGES = 30 // cylindrical rim segments for the 3D coin

function FfLogo() {
  return (
    <svg className="ff-chip-logo" viewBox="0 0 443 240" aria-hidden="true">
      <path d="M210 0H0V239.999H82.4998V164.154H194.08V90.2182H82.4998V74.9998H210V0Z"/>
      <path d="M442.498 0.000513315H232.499V240H314.999V164.154H425.13V90.2187H314.999V75.0004H442.498V0.000513315Z"/>
    </svg>
  )
}

function FirstFundChip() {
  const chipRef = useRef(null)
  const rafRef = useRef(0)

  // The chip leans toward the cursor anywhere on the page; the idle tumble
  // keeps running underneath (tilt is on .ff-chip, spin on .ff-chip-spin).
  useEffect(() => {
    const clamp = (v, m) => Math.max(-m, Math.min(m, v))
    const onMove = (e) => {
      const el = chipRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const ry = clamp((e.clientX - cx) / 300 * 26, 26)
      const rx = clamp(-(e.clientY - cy) / 300 * 26, 26)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const node = chipRef.current
        if (!node) return
        node.style.setProperty('--rx', `${rx.toFixed(2)}deg`)
        node.style.setProperty('--ry', `${ry.toFixed(2)}deg`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const edges = Array.from({ length: FF_CHIP_EDGES }, (_, i) => (
    <span key={i} className={'ff-chip-edge' + (i % 5 < 2 ? ' ff-chip-edge--spot' : '')} style={{ '--i': i }} aria-hidden="true"/>
  ))

  return (
    <div className="ff-chip-stage" aria-hidden="true">
      <div className="ff-chip" ref={chipRef}>
        <div className="ff-chip-spin">
          <div className="ff-chip-face ff-chip-front">
            <span className="ff-chip-mono"><FfLogo/></span>
          </div>
          <div className="ff-chip-face ff-chip-back">
            <span className="ff-chip-mono"><FfLogo/></span>
          </div>
          <div className="ff-chip-rim">{edges}</div>
        </div>
      </div>
    </div>
  )
}

function FirstFundBanner({ t }) {
  const stats = [
    ['$92M', t('ff_stat_income')],
    ['1500+', t('ff_stat_players')],
    ['13', t('ff_stat_years')],
  ]
  return (
    <a className="ff-banner" href={FF_URL} target="_blank" rel="noreferrer">
      <span className="ff-banner-glow" aria-hidden="true"/>
      <span className="ff-banner-shine" aria-hidden="true"/>
      <FirstFundChip/>
      <span className="ff-banner-partner">{t('partner_label')}</span>
      <span className="ff-banner-kicker">FirstFund</span>
      <span className="ff-banner-headline">{t('ff_headline')}</span>
      <span className="ff-banner-sub">{t('ff_sub')}</span>
      <span className="ff-banner-stats">
        {stats.map(([v, l]) => (
          <span key={l} className="ff-banner-stat">
            <b className="ff-banner-stat-val">{v}</b>
            <span className="ff-banner-stat-label">{l}</span>
          </span>
        ))}
      </span>
      <span className="ff-banner-cta">{t('join_ff')} →</span>
    </a>
  )
}

// ─── SESSION MTT WIDGET ──────────────────────────────────────────────────────
// Bars of tournaments played per session (channel request). Follows the shared
// week/month/all chart period; average as a dashed guide, last session in gold.
function SessionMttChart({ meta, period, lang, t }) {
  const isMobile = useIsMobile()
  const rows = useMemo(() => {
    const hist = [...(meta?.brHistory || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const withMtt = hist.map((row, i) => {
      const prevTotal = i > 0 ? hist[i - 1]?.totalTournaments || 0 : 0
      const mtt = row.tournaments ?? (row.totalTournaments ? Math.max(0, row.totalTournaments - prevTotal) : 0)
      return { timestamp:row.timestamp || 0, mtt }
    }).filter(r => r.mtt > 0)
    if (period === 'all' || !withMtt.length) return withMtt
    const cutoff = Math.floor(Date.now() / 1000) - (period === 'week' ? 7 : 30) * 86400
    const filtered = withMtt.filter(r => r.timestamp >= cutoff)
    return filtered.length >= 2 ? filtered : withMtt
  }, [meta, period])

  if (rows.length < 2) return null

  const W = isMobile ? 340 : 640
  const H = isMobile ? 150 : 150
  const pad = { left:34, right:10, top:18, bottom:20 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const maxMtt = Math.max(...rows.map(r => r.mtt))
  const avg = rows.reduce((sum, r) => sum + r.mtt, 0) / rows.length
  const yOf = v => pad.top + (1 - v / maxMtt) * plotH
  const gap = rows.length > 60 ? .6 : 1.4
  const barW = Math.max(1.2, plotW / rows.length - gap)
  const xOf = i => pad.left + (i + .08) * (plotW / rows.length)
  const avgY = yOf(avg)
  const maxIdx = rows.reduce((best, r, i) => r.mtt > rows[best].mtt ? i : best, 0)
  const lastIdx = rows.length - 1

  return (
    <section className="pace-widget session-mtt-widget" data-testid="session-mtt-widget">
      <div className="pace-head">
        <h2 className="section-title">{t('smtt_title')}</h2>
        <span className="section-count">{plSessions ? plSessions(rows.length, lang) : rows.length}</span>
      </div>
      <div className="pace-chart-wrap">
        <svg className="pace-chart smtt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('smtt_title')}>
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} rx="10" className="pace-plot-bg"/>
          {[maxMtt, Math.round(maxMtt / 2)].map(v => (
            <g key={v}>
              <line className="pace-grid-line" x1={pad.left} x2={W - pad.right} y1={yOf(v)} y2={yOf(v)}/>
              <text className="pace-y-label" x={pad.left - 6} y={yOf(v) + 3}>{fmtInt(v)}</text>
            </g>
          ))}
          {rows.map((r, i) => (
            <rect key={`${r.timestamp}-${i}`}
              className={`smtt-bar ${i === lastIdx ? 'last' : ''} ${i === maxIdx ? 'max' : ''}`}
              x={xOf(i)} y={yOf(r.mtt)} width={barW} height={Math.max(1, pad.top + plotH - yOf(r.mtt))} rx={barW > 3 ? 1.2 : 0}>
              <title>{`${fmtDateShortLang(r.timestamp, lang)} — ${fmtInt(r.mtt)} ${t('sr_mtt_short')}`}</title>
            </rect>
          ))}
          <line className="smtt-avg-line" x1={pad.left} x2={W - pad.right} y1={avgY} y2={avgY}/>
          <text className="smtt-avg-label" x={W - pad.right - 2} y={avgY - 4}>
            {`${t('smtt_avg')}: ${fmtInt(Math.round(avg))}`}
          </text>
          <text className="smtt-last-label" x={Math.min(xOf(lastIdx) + barW / 2, W - pad.right - 14)} y={yOf(rows[lastIdx].mtt) - 5}>
            {fmtInt(rows[lastIdx].mtt)}
          </text>
        </svg>
      </div>
    </section>
  )
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { posts, meta, loading, error, newPostIds, refresh, clearNewPosts } = usePostsData()
  // Below 980px the sidebar is hidden and the FF banner moves into the feed.
  // Render only the visible one so the hidden copy doesn't mount a second chip.
  const isNarrow = useIsMobile(980)
  const [activeTab, setActiveTab] = useState('feed')
  const [lightbox,  setLightbox]  = useState(null)
  const mobileMenuRef = useRef(null)
  const [theme, setTheme] = usePersistentState('rpt_theme', 'dark', {
    serialize: String,
    deserialize: (raw) => raw || 'dark',
  })
  const [lang, setLang] = usePersistentState('rpt_lang', DEFAULT_LANG, {
    serialize: String,
    deserialize: (raw) => raw || DEFAULT_LANG,
  })
  const t = useMemo(() => createTranslator(lang), [lang])
  const appVersionLabel = `v${String(__APP_VERSION__).replace(/\.0$/, '')}`
  // Build date instead of a hand-edited literal, formatted for the active
  // locale (DD.MM.YYYY reads as a different day in en/es).
  const buildDateLabel = useMemo(() => {
    // Guarded: a missing build-time define must degrade to an empty label,
    // never throw and take the whole app down with it.
    const stamp = typeof __BUILD_DATE__ === 'undefined' ? null : __BUILD_DATE__
    if (!stamp) return ''
    const d = new Date(stamp)
    if (Number.isNaN(d.getTime())) return ''
    const locale = lang === 'ru' ? 'ru-RU' : lang === 'es' ? 'es-ES' : 'en-US'
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw',
    }).format(d)
  }, [lang])
  // Version the preference so existing visitors move off the former
  // "oldest first" default once, while future choices remain persistent.
  const [sortBy, setSortBy] = usePersistentState('rpt_sortby_v2', 'date_desc', {
    serialize: String,
    deserialize: (raw) => raw || 'date_desc',
  })
  const [search,  setSearch]  = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [romeoOnly, setRomeoOnly] = useState(false)
  const [page,    setPage]    = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [minLikes, setMinLikes] = usePersistentState('rpt_minlikes', 3, {
    serialize: (value) => String(value),
    deserialize: (raw) => {
      const parsed = parseInt(raw ?? '3', 10)
      return Number.isFinite(parsed) ? parsed : 3
    },
  })
  const [minRating, setMinRating] = usePersistentState('rpt_minrating', 0, {
    serialize: (value) => String(value),
    deserialize: (raw) => {
      const parsed = parseInt(raw ?? '0', 10)
      return Number.isFinite(parsed) ? parsed : 0
    },
  })

  // Позиция чтения — запоминаем последний прочитанный пост на каждой вкладке
  const [readPos, setReadPos] = usePersistentState('rpt_readpos', {})
  const [ignored, setIgnored] = usePersistentState('rpt_ignored', new Set(), {
    serialize: (value) => JSON.stringify([...value]),
    deserialize: (raw) => new Set(JSON.parse(raw || '[]')),
  })
  // favorites = per-author (Set of author names). Favorited authors' posts bypass like/rating filters.
  const [favorites, setFavorites] = usePersistentState('rpt_fav_authors', new Set(), {
    serialize: (value) => JSON.stringify([...value]),
    deserialize: (raw) => new Set(JSON.parse(raw || '[]')),
  })
  const [ignoreInput, setIgnoreInput] = useState('')

  // Apply theme class to root
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])
  // Keep <html lang> in sync so screen readers / auto-translate pick the right voice
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  // Esc closes the image lightbox
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])
  _lang = lang
  _translate = t

  // Auto-fit to screen: scale root so 1500px design fits user's desktop viewport.
  // Clamped so big monitors don't over-inflate and small ones don't shrink past readable.
  // Skipped on mobile — the ≤720px media query handles narrow layout separately.
  // rAF-throttled and only writes when the value actually changes, so live resize is smooth.
  useEffect(() => {
    let raf = 0
    let lastZ = ''
    // Apply zoom to #root rather than <html>: Chromium has paint bugs when
    // zoom toggles on documentElement during resize (content disappears until
    // F5). Keeping it on a regular element avoids the root-layer wedge.
    const root = document.getElementById('root')
    const fit = () => {
      raf = 0
      const vw = window.innerWidth
      const next = vw < 900
        ? ''
        : Math.min(1.25, Math.max(0.85, vw / 1500)).toFixed(2)
      if (next === lastZ) return
      lastZ = next
      if (root) root.style.zoom = next
    }
    const onResize = () => {
      if (raf) return
      raf = requestAnimationFrame(fit)
    }
    fit()
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Stats из постов Ромео
  const stats = useMemo(() => {
    const startBR = meta?.startBankroll || 10000

    // Точный БР из brHistory (приоритет)
    const brHistory = meta?.brHistory
    if (brHistory?.length) {
      const last = [...brHistory].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0)).slice(-1)[0]
      const br = last.brAfter
      const profit = br - startBR
      const totalTourneys = meta?.totalTournaments || null

      // Session-level stats
      const sessionsCount = brHistory.length
      const positiveSessions = brHistory.filter(h => (h.sessionResult||0) > 0).length
      const winRate = sessionsCount ? positiveSessions / sessionsCount : null
      const avgMTT = (totalTourneys && sessionsCount)
        ? Math.round(totalTourneys / sessionsCount)
        : null

      // День из текста постов Ромео (как он сам нумерует), fallback на кол-во сессий
      const romeoByDate = posts.filter(p => ROMEO_RE.test(p.author)).sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
      let day = null
      for (const p of romeoByDate) { day = extractDay(p.text); if (day) break }
      if (!day) day = brHistory.length

      return { br, profit, startBR, day, lastTs: last.timestamp, totalTourneys, sessionsCount, winRate, avgMTT }
    }

    if (!posts.length) return { startBR }
    const romeoByDate = posts
      .filter(p => ROMEO_RE.test(p.author))
      .sort((a,b) => (b.timestamp||0)-(a.timestamp||0))

    let day = null, br = null
    for (const p of romeoByDate) {
      if (!day) day = extractDay(p.text)
      if (!br)  br  = p.brAfter || extractBR(p.text)
      if (day && br) break
    }
    const profit = br ? br - startBR : null
    return { day, br, profit, startBR, lastTs: romeoByDate[0]?.timestamp, totalTourneys: null }
  }, [posts, meta])

  const [sidebarTopPeriod, setSidebarTopPeriod] = useState('all')

  // Period for marathon chart & tempo estimates — lifted up so progress bar can react.
  const [chartPeriod, setChartPeriod] = usePersistentState('rpt_chart_period', 'all', {
    serialize: String,
    deserialize: (raw) => raw || 'all',
  })

  // Session stats recomputed against the chart-period filter so МТТ/сессия
  // and % плюсовых react when the user toggles week/month/all.
  const periodStats = useMemo(() => {
    const hist = meta?.brHistory
    if (!hist?.length || chartPeriod === 'all') return null
    const now = Date.now() / 1000
    const cutoff = chartPeriod === 'week' ? now - 7*86400 : now - 30*86400
    const sorted = [...hist].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))
    const insideIdx = sorted.findIndex(h => (h.timestamp||0) >= cutoff)
    if (insideIdx < 0) return null
    const sub = sorted.slice(insideIdx)
    if (sub.length < 2) return null
    const positive = sub.filter(h => (h.sessionResult || 0) > 0).length
    let totalMTT = sub.reduce((s, h) => s + (h.tournaments || 0), 0)
    if (!totalMTT) {
      // Fallback when per-session tournament counts are missing: use the
      // delta of cumulative totalTournaments across the window.
      const baseTotal = insideIdx === 0 ? 0 : (sorted[insideIdx-1].totalTournaments||0)
      const lastTotal = sorted[sorted.length-1].totalTournaments||0
      totalMTT = Math.max(0, lastTotal - baseTotal)
    }
    const avgMTT = totalMTT ? Math.round(totalMTT / sub.length) : null
    const profit = sub.reduce((s, h) => s + (h.sessionResult || 0), 0)
    return {
      sessionsCount: sub.length,
      positiveSessions: positive,
      winRate: positive / sub.length,
      avgMTT,
      totalMTT: totalMTT || null,
      profit,
    }
  }, [meta, chartPeriod])

  const searchNeedle = useMemo(() => search.trim().toLowerCase(), [search])

  const passesLikeRating = (p) => {
    if (favorites.has(p.author)) return true
    if (minLikes  && (p.likes||0)  < minLikes)  return false
    if (minRating && (p.rating||0) < minRating) return false
    return true
  }
  const passesIgnored = (p) => !ignored.has(p.author)
  const passesFeedFilters = (p) => {
    const isRomeoPost = ROMEO_RE.test(p.author)

    if (lang !== 'ru') {
      if (!isRomeoPost) return false
      if (searchNeedle) {
        const haystack = (p.translations?.[lang] || p.text || '').toLowerCase()
        if (!haystack.includes(searchNeedle)) return false
      }
      return true
    }
    if (ignored.has(p.author)) return false
    if (romeoOnly && !isRomeoPost) return false
    if (favorites.has(p.author)) return true
    if (searchNeedle && !p.text?.toLowerCase().includes(searchNeedle)) return false
    return passesLikeRating(p)
  }

  // hotPosts — для сайдбара "Больше всего плюсиков"
  const hotPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author)) // top list never shows ignored
      .filter(p => lang !== 'ru' || favorites.has(p.author) || (!minRating || (p.rating||0) >= minRating))
      .filter(p => lang !== 'ru' || favorites.has(p.author) || (p.likes||0) >= Math.max(minLikes, 1))
      .sort((a,b) => (b.likes||0) - (a.likes||0))
  , [posts, ignored, favorites, minLikes, minRating, lang])

  const forumAuthorCount = useMemo(() => {
    const authors = new Set()
    posts.forEach((p) => {
      const author = (p.author || '').trim()
      if (author) authors.add(author.toLowerCase())
    })
    return authors.size
  }, [posts])

  const feedPosts = useMemo(() =>
    posts
      .filter(passesFeedFilters)
      .sort((a,b) => {
        if (sortBy==='date_desc') return (b.timestamp||0)-(a.timestamp||0)
        if (sortBy==='date_asc')  return (a.timestamp||0)-(b.timestamp||0)
        if (sortBy==='likes')     return (b.likes||0)-(a.likes||0)
        return 0
      }),
  [posts, favorites, ignored, lang, minLikes, minRating, romeoOnly, searchNeedle, sortBy])

  // При смене фильтров — умный сброс страницы
  // Если были в конце — остаёмся в конце, если в начале — в начале
  useEffect(() => {
    const currentTotal = Math.max(1, Math.ceil(feedPosts.length / perPage))
    if (page >= currentTotal - 1) {
      // Были близко к концу — идём на новый конец
      setPage(currentTotal)
    } else if (page > 1) {
      // Были в середине — пересчитываем позицию пропорционально
      const ratio = (page - 1) / Math.max(1, currentTotal - 1)
      setPage(Math.max(1, Math.round(ratio * currentTotal)))
    }
    // Если page === 1 — ничего не делаем, остаёмся на 1
  }, [ignored, favorites, search, sortBy, romeoOnly, minLikes, minRating]) // eslint-disable-line

  // Восстанавливаем позицию чтения при первой загрузке постов
  useEffect(() => {
    if (!feedPosts.length || !readPos.feed) return
    const idx = feedPosts.findIndex(p => p.id === readPos.feed)
    if (idx !== -1) setPage(Math.floor(idx / perPage) + 1)
  }, [feedPosts.length]) // только когда посты впервые появились

  const totalPages = Math.max(1, Math.ceil(feedPosts.length / perPage))
  const pagedPosts = useMemo(() =>
    feedPosts.slice((page-1)*perPage, page*perPage),
  [feedPosts, page, perPage])

  const goPage = p => {
    setPage(p)
    const filterBar = document.querySelector('.filter-bar')
    if (filterBar) {
      const top = filterBar.getBoundingClientRect().top + window.scrollY - 60
      window.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() })
    }
  }

  // Сохраняем позицию чтения
  const saveReadPos = (tab, postId) => {
    setReadPos(prev => {
      return { ...prev, [tab]: postId }
    })
  }

  const goToPost = useCallback((p) => {
    if (!p?.id) return
    const doScroll = () => {
      const el = document.getElementById(`post-${p.id}`)
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Place post ~80px from top of viewport (below topbar), not centered
      const target = window.scrollY + rect.top - 80
      window.scrollTo({ top: target, behavior: scrollBehavior() })
      el.classList.remove('post-highlight')
      void el.offsetWidth // reflow so animation restarts
      el.classList.add('post-highlight')
      setTimeout(() => el.classList.remove('post-highlight'), 2400)
    }
    if (activeTab !== 'feed') setActiveTab('feed')
    const idx = feedPosts.findIndex(x => x.id === p.id)
    if (idx !== -1) {
      const targetPage = Math.floor(idx / perPage) + 1
      if (targetPage !== page) setPage(targetPage)
    }
    // Double rAF lets React commit the page/tab change before we measure
    requestAnimationFrame(() => requestAnimationFrame(doScroll))
  }, [activeTab, feedPosts, perPage, page])

  const goToNewPosts = useCallback(() => {
    if (!newPostIds.length) return
    // Find the first new post in current feedPosts order
    const firstNewIdx = feedPosts.findIndex(p => newPostIds.includes(p.id))
    if (firstNewIdx !== -1) {
      const targetPage = Math.floor(firstNewIdx / perPage) + 1
      setPage(targetPage)
      // Mark as seen
      clearNewPosts(posts)
      // Scroll to the post after page renders
      const postId = feedPosts[firstNewIdx].id
      requestAnimationFrame(() => {
        const el = document.getElementById(`post-${postId}`)
        if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      })
    } else {
      // New posts might be filtered out — just dismiss
      clearNewPosts(posts)
    }
  }, [clearNewPosts, newPostIds, feedPosts, perPage, posts])

  // При смене вкладки сбрасываем на страницу с последним прочитанным постом
  const switchTab = (tab) => {
    setActiveTab(tab)
    setPage(1)
    mobileMenuRef.current?.removeAttribute('open')
  }

  const toggleFav = useCallback(author => {
    if (!author) return
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(author) ? next.delete(author) : next.add(author)
      return next
    })
  }, [setFavorites])

  const addIgnore = useCallback(name => {
    if (!name?.trim()) return
    setIgnored(prev => {
      const next = new Set(prev)
      next.add(name.trim())
      return next
    })
    setIgnoreInput('')
  }, [setIgnored])

  const removeIgnore = useCallback(name => {
    setIgnored(prev => {
      const next = new Set(prev)
      next.delete(name)
      return next
    })
  }, [setIgnored])

  // ── ANIMATED COUNTER ─────────────────────────────────────────────────────
  const brVal  = stats?.br || meta?.bankroll || 0
  // Remember the last BR the user saw on their previous visit, so the animation
  // starts from that value (not from marathon start) and highlights only what
  // changed since then. Captured once on mount; persisted after each animation.
  const [lastSeenBR, setLastSeenBR] = usePersistentState('rpt_last_seen_br', null, {
    serialize: (value) => (value == null ? '' : String(value)),
    deserialize: (raw) => {
      const value = parseFloat(raw)
      return Number.isFinite(value) ? value : null
    },
  })
  // Real BR trajectory for the hero counter, sliced to "since last visit".
  // If we have no prior seen value, we replay the full marathon from start.
  const brPath = useMemo(() => {
    const hist = meta?.brHistory
    if (!hist?.length || !brVal) return null
    const sorted = [...hist].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const full = [stats?.startBR || 10000, ...sorted.map(h => h.brAfter)]
    if (lastSeenBR == null) return full
    // Find waypoint closest by value to lastSeenBR and animate from there.
    let closestIdx = 0, best = Infinity
    for (let i = 0; i < full.length; i++) {
      const d = Math.abs(full[i] - lastSeenBR)
      if (d < best) { best = d; closestIdx = i }
    }
    if (closestIdx >= full.length - 1) return [lastSeenBR, brVal]
    return [lastSeenBR, ...full.slice(closestIdx + 1)]
  }, [meta, stats?.startBR, lastSeenBR, brVal])
  // Delta-aware dramatism: tiny change → slow + dramatic, big change → fast scrub.
  const brDuration = useMemo(() => {
    if (lastSeenBR == null || !brVal) return 4200
    const ratio = Math.abs(brVal - lastSeenBR) / brVal
    if (ratio < 0.005) return 5200
    if (ratio < 0.03)  return 4000
    if (ratio < 0.1)   return 3000
    return 2200
  }, [lastSeenBR, brVal])
  useEffect(() => {
    if (!brVal) return
    const t = setTimeout(() => {
      setLastSeenBR(brVal)
    }, brDuration + 250)
    return () => clearTimeout(t)
  }, [brVal, brDuration, setLastSeenBR])

  return (
    <>
      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('lightbox_label')}
          onClick={()=>setLightbox(null)}>
          <button type="button" className="lightbox-close" aria-label={t('close')}
            onClick={()=>setLightbox(null)}>✕</button>
          <img src={lightbox} alt=""/>
        </div>
      )}


      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            <div className="logo-badge" style={{padding:0,width:32,height:32,overflow:'hidden',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <img src="https://www.gipsyteam.ru/apple-touch-icon.png" alt="GT"
                referrerPolicy="no-referrer" style={{width:32,height:32,objectFit:'contain',borderRadius:6}}
                onError={e=>{e.target.style.display='none'}}/>
            </div>
            <div>
              <h1 className="logo-text">RomeoPro Marathon</h1>
              <div className="logo-sub">{t('marathon_sub')}</div>
            </div>
          </div>
          <nav className="topbar-tabs" aria-label={t('nav_primary')}>
            {[['feed',t('tab_feed')],['settings',t('tab_settings')]].map(([id,label])=>(
              <button type="button" key={id} className={`topbar-tab ${activeTab===id?'active':''}`}
                aria-current={activeTab===id?'page':undefined} onClick={()=>switchTab(id)}>{label}</button>
            ))}
          </nav>
          <div className="topbar-right">
            <button type="button" className="theme-toggle" onClick={()=>setTheme(tv=>tv==='dark'?'light':'dark')}
              title={theme==='dark'?t('theme_light'):t('theme_dark')}
              aria-label={theme==='dark'?t('theme_light'):t('theme_dark')}>
              {theme==='dark'?'☀️':'🌙'}
            </button>
            <div className="lang-switch" role="group" aria-label={t('lang_title')}>
              {['ru','en','es'].map(code => (
                <button type="button" key={code} aria-pressed={lang===code}
                  className={'lang-switch-btn'+(lang===code?' active':'')}
                  onClick={()=>setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <details className="mobile-menu" ref={mobileMenuRef}>
              <summary aria-label={t('menu')}>
                <span aria-hidden="true">•••</span>
                <span className="sr-only">{t('menu')}</span>
              </summary>
              <div className="mobile-menu-panel">
                <nav className="mobile-menu-nav" aria-label={t('nav_primary')}>
                  {[['feed',t('tab_feed')],['settings',t('tab_settings')]].map(([id,label])=>(
                    <button type="button" key={id} className={activeTab===id?'active':''}
                      aria-current={activeTab===id?'page':undefined} onClick={()=>switchTab(id)}>{label}</button>
                  ))}
                </nav>
                <button type="button" className="mobile-menu-action" onClick={()=>{
                  setTheme(tv=>tv==='dark'?'light':'dark')
                  mobileMenuRef.current?.removeAttribute('open')
                }}>
                  <span aria-hidden="true">{theme==='dark'?'☀️':'🌙'}</span>
                  {theme==='dark'?t('theme_light'):t('theme_dark')}
                </button>
                <div className="mobile-menu-languages" role="group" aria-label={t('lang_title')}>
                  {['ru','en','es'].map(code => (
                    <button type="button" key={code} className={lang===code?'active':''} aria-pressed={lang===code}
                      onClick={()=>{
                        setLang(code)
                        mobileMenuRef.current?.removeAttribute('open')
                      }}>{code.toUpperCase()}</button>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </div>
      </header>

      {/* PROGRESS BAR */}
      {!loading && stats?.br && (() => {
        const target = MARATHON_TARGET
        const raw = stats.br / target * 100
        const pct = Math.max(0, Math.min(100, raw))
        const remaining = Math.max(0, target - stats.br)

        const pace = computePaceMetrics({ meta, stats, period:chartPeriod, target })
        const isLosing = pace?.rate != null && pace.rate < 0
        const mttNeeded = pace?.finishMTT || null
        const mttToBust = pace?.bustMTT || null
        const dollarPerMTT = pace?.rate ?? null
        const tempoLabel = isLosing
          ? (chartPeriod === 'week' ? t('tempo_week_neg')
           : chartPeriod === 'month' ? t('tempo_month_neg')
           : t('tempo_now_neg'))
          : (chartPeriod === 'week' ? t('tempo_week')
           : chartPeriod === 'month' ? t('tempo_month')
           : t('tempo_now'))
        const tempoTitle = isLosing
          ? t('losing_warning')
          : (chartPeriod === 'all'
            ? t('tempo_tooltip_all')
            : t(chartPeriod==='week' ? 'tempo_tooltip_period_week' : 'tempo_tooltip_period_month'))
        return (
          <div className="marathon-progress">
            <div className="marathon-progress-inner">
              <div className="marathon-progress-main">
                <div className="marathon-progress-label">
                  <span>{t('progress_to')}</span><b>{pct.toFixed(2)}%</b>
                </div>
                <div className="marathon-progress-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Number(pct.toFixed(2))} aria-label={`${t('progress_to')}: ${pct.toFixed(2)}%`}>
                  <div className="marathon-progress-fill" style={{width:`${pct}%`}}/>
                </div>
              </div>
              <div className="marathon-progress-side">
                <div className="mps-item">
                  <span className="mps-label">{t('left')}</span>
                  <span className="mps-value">{fmtInt(remaining)}$</span>
                </div>
                {(mttNeeded || mttToBust) && <>
                  <div className="mps-divider"/>
                  <div className="mps-item">
                    <span className="mps-label">{tempoLabel}</span>
                    <span className="mps-value-row">
                      <TempoValue target={mttNeeded || mttToBust} title={tempoTitle}/>
                      {dollarPerMTT != null && (
                        <span className="mps-rate-inline" title={isLosing ? t('losing_warning') : t('dollar_per_mtt_title')}>
                          {(() => {
                            return formatDollarPerMTT(dollarPerMTT, t('sr_mtt_short'))
                          })()}
                        </span>
                      )}
                    </span>
                  </div>
                </>}
              </div>
            </div>
          </div>
        )
      })()}

      {error && !loading
        ? (
        <div className="loading" style={{display:'flex',flexDirection:'column',gap:12,alignItems:'center',textAlign:'center'}}>
          <div style={{fontWeight:700,color:'var(--white)'}}>{t('load_failed_title')}</div>
          <div style={{maxWidth:420,color:'var(--dim2)',lineHeight:1.6}}>{t('load_failed_body')}</div>
          <button className="btn-sm" onClick={() => refresh().catch(() => {})}>{t('retry')}</button>
        </div>
        )
        : loading
        ? <div className="loading">{t('loading')}</div>
        : (
        <main className={`page ${activeTab==='settings'?'wide':''}`}>
          <div>
            {/* HERO */}
            {activeTab==='feed' && <div className="hero">
              <div className="hero-top">
                <div className="hero-avatar" data-avatar-initial="R">
                  <img src="https://www.gipsyteam.ru/upload/Avatar/default/2/6/6/26670.jpg"
                    alt="Romeopro" referrerPolicy="no-referrer" onError={avatarError}/>
                </div>
                <div style={{flex:1, minWidth:0, overflow:'hidden'}}>
                  <div className="hero-name">Romeopro <span className="hero-badge">{t('hero_badge')}</span></div>
                  <div className="hero-desc">
                    From Hero to Zero · <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676"
                      target="_blank" rel="noreferrer" style={{color:'var(--dim2)'}}>GipsyTeam</a>
                    {stats.lastTs && <span> · {t('last_post')}: {fmtDateTimeLang(stats.lastTs, lang)}</span>}
                  </div>
                </div>
              </div>
              <div className="hero-stats">
                <div className="hstat">
                  <div className="hstat-label">{t('hs_br')}</div>
                  <div className="hstat-value br-anim">
                    <AnimatedValue
                      target={brVal}
                      path={brPath}
                      duration={brDuration}
                      format={fmtExact}
                      render={(v) => {
                        const up = v >= (stats.startBR || 10000)
                        const color = up ? '#66bb6a' : 'var(--red2)'
                        const glow  = up ? 'rgba(102,187,106,.28)' : 'rgba(239,83,80,.28)'
                        return (
                          <span style={{
                            color,
                            fontFamily:"'Roboto Mono',ui-monospace,monospace",
                            fontVariantNumeric:'tabular-nums',
                            fontWeight:700,
                            letterSpacing:'-0.02em',
                            textShadow:`0 0 14px ${glow}`,
                            transition:'color .2s, text-shadow .2s',
                          }}>
                            {fmtExact(v)}
                          </span>
                        )
                      }}
                    />
                  </div>
                  <div className="hstat-sub">{t('hs_start')}: {fmtExact(stats.startBR)}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">{t('hs_profit')}</div>
                  <div className={`hstat-value ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>
                    {fmtExactSigned(stats.profit)}
                  </div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">{t('hs_day')}</div>
                  <div className="hstat-value gold">#{stats.day||meta?.day||'—'}</div>
                  <div className="hstat-sub">{t('hs_since')}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">{t('hs_tourneys')}</div>
                  <div className="hstat-value">{fmtInt(meta?.totalTournaments ?? 3565)}</div>
                  <div className="hstat-sub">{t('hs_all_marathon')}</div>
                </div>
              </div>
            </div>}

            {/* ЛЕНТА */}
            {activeTab==='feed' && <>
              {/* Mobile-only stats strip */}
              <div className="mobile-stats">
                {[
                  [t('sr_br'),
                    <AnimatedValue key="br-anim" target={brVal} path={brPath} duration={brDuration}
                      format={fmtExact}
                      render={(v)=>{
                        const up = v >= (stats.startBR || 10000)
                        const color = up ? '#66bb6a' : 'var(--red2)'
                        const glow  = up ? 'rgba(102,187,106,.28)' : 'rgba(239,83,80,.28)'
                        return <span style={{color,fontVariantNumeric:'tabular-nums',letterSpacing:'-0.02em',textShadow:`0 0 12px ${glow}`,transition:'color .2s, text-shadow .2s'}}>{fmtExact(v)}</span>
                      }}/>,
                    ''],
                  (() => {
                    const pv = periodStats?.profit ?? stats.profit
                    return [t('sr_profit') + (periodStats?.profit != null ? '*' : ''),
                      fmtExactSigned(pv), !pv?'':pv>=0?'green':'red']
                  })(),
                  [t('sr_day'), `#${stats.day||meta?.day||'—'}`, 'gold'],
                  [t('sr_mtt_short') + (periodStats?.totalMTT != null ? '*' : ''),
                    fmtInt(periodStats?.totalMTT ?? meta?.totalTournaments ?? 3565), ''],
                  (periodStats?.avgMTT ?? stats.avgMTT) != null && [
                    t('sr_avg') + (periodStats?.avgMTT != null ? '*' : ''),
                    fmtInt(periodStats?.avgMTT ?? stats.avgMTT),
                    '',
                  ],
                  (periodStats?.winRate ?? stats.winRate) != null && [
                    t('sr_winrate') + (periodStats?.winRate != null ? '*' : ''),
                    `${Math.round((periodStats?.winRate ?? stats.winRate)*100)}%`,
                    '',
                  ],
                ].filter(Boolean).map(([k,v,cls])=>(
                  <div key={k} className="mobile-stat">
                    <div className="mobile-stat-label">{k}</div>
                    <div className={`mobile-stat-value ${cls}`}>{v}</div>
                  </div>
                ))}
              </div>
              {periodStats && (
                <div className="mobile-stats-note">{t('stats_note_filter')} ({t(chartPeriod==='week'?'period_week':'period_month')})</div>
              )}
              <MarathonChart posts={posts} meta={meta} startBR={stats.startBR} setLightbox={setLightbox}
                period={chartPeriod} setPeriod={setChartPeriod} lang={lang} t={t}/>
              {/* Mobile-only: sidebar is hidden <=980px, so surface the FF banner here in the feed */}
              {isNarrow && <div className="ff-banner-mobile-slot"><FirstFundBanner t={t}/></div>}
              <PaceWidget meta={meta} stats={stats} period={chartPeriod} setPeriod={setChartPeriod} lang={lang} t={t}/>
              <SessionMttChart meta={meta} period={chartPeriod} lang={lang} t={t}/>
              {/* Mobile-only top posts */}
              {lang==='ru' && hotPosts.length > 0 && (() => {
                const now = Date.now() / 1000
                const cutoffs = { day: now-86400, week: now-604800, month: now-2592000, all: 0 }
                const labels = { day:t('filter_day'), week:t('filter_week'), month:t('filter_month'), all:t('filter_all_short') }
                const filtered = hotPosts.filter(p => (p.timestamp||0) >= cutoffs[sidebarTopPeriod])
                const topList = (filtered.length ? filtered : hotPosts).slice(0,7)
                return (
                  <div className="mobile-top-posts">
                    <div className="mobile-top-header">
                      <span>{t('mobile_top_label')}</span>
                      <div className="mobile-top-periods">
                        {Object.keys(cutoffs).map(k => (
                          <button type="button" key={k} onClick={()=>setSidebarTopPeriod(k)}
                            className={`mobile-top-period ${sidebarTopPeriod===k?'active':''}`}
                            aria-pressed={sidebarTopPeriod===k}>
                            {labels[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mobile-top-list">
                      {topList.map((p, i) => (
                        <a key={p.id||i} href={p.url} target="_blank" rel="noreferrer" className="mobile-top-item">
                          <span className="mobile-top-rank">{i+1}</span>
                          <div className="mobile-top-body">
                            <span className="mobile-top-author">{p.author}</span>
                            <span className="mobile-top-text">{stripQuoteTags(p.text)?.substring(0,120) || `→ ${FORUM_WORD[lang] || 'forum'}`}</span>
                          </div>
                          <span className="mobile-top-likes">+{p.likes}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })()}
              <FilterBar
                sortBy={sortBy} setSortBy={setSortBy}
                search={search} setSearch={setSearch}
                showSearch={showSearch} setShowSearch={setShowSearch}
                romeoOnly={romeoOnly} setRomeoOnly={setRomeoOnly}
                minLikes={minLikes} setMinLikes={setMinLikes}
                minRating={minRating} setMinRating={setMinRating}
                count={feedPosts.length} showSort={true} t={t} lang={lang}
              />
              {newPostIds.length > 0 && activeTab === 'feed' && (
                <button className="new-posts-bubble" onClick={goToNewPosts}>
                  {newPostIds.length} {lang==='ru' ? plural(newPostIds.length, ['новый пост','новых поста','новых постов']) : (newPostIds.length === 1 ? t('new_posts_badge_singular') : t('new_posts_badge_many'))}!
                </button>
              )}
              {feedPosts.length===0
                ? <div className="empty-state">{t('empty_no_posts_filters')}</div>
                : <>
                  <Paginator page={page} totalPages={totalPages} onPage={goPage}
                    perPage={perPage} onPerPage={setPerPage} total={feedPosts.length} lang={lang} />
                  {pagedPosts.map((p,i)=>(
                    <div key={p.id||p.url} id={`post-${p.id}`}
                      onMouseEnter={()=>{ if(i===pagedPosts.length-1) saveReadPos('feed',p.id) }}>
                      <PostCard p={p}
                        favorites={favorites} onFav={toggleFav}
                        onIgnore={addIgnore} setLightbox={setLightbox} lang={lang}/>
                    </div>
                  ))}
                  <Paginator page={page} totalPages={totalPages} onPage={goPage}
                    perPage={perPage} onPerPage={setPerPage} total={feedPosts.length} lang={lang} />
                  {lang==='ru' && <ActivityChart posts={posts}
                    favorites={favorites} ignored={ignored} onFav={toggleFav}
                    onIgnore={addIgnore} onUnignore={removeIgnore} setLightbox={setLightbox}
                    minLikes={minLikes}
                    minRating={minRating}
                    search={search} onPostClick={goToPost} lang={lang} t={t}/>}
                </>
              }
            </>}

            {/* НАСТРОЙКИ */}
            {activeTab==='settings' && (
              <SettingsPanel theme={theme} setTheme={setTheme} lang={lang} setLang={setLang}
                sortBy={sortBy} setSortBy={setSortBy} ignored={ignored} removeIgnore={removeIgnore}
                ignoreInput={ignoreInput} setIgnoreInput={setIgnoreInput} addIgnore={addIgnore} t={t}/>
            )}
          </div>

          {/* SIDEBAR */}
          {activeTab!=='settings' && (
            <aside className="sidebar" aria-label={t('sidebar_label')}>
              <div className="sblock">
                <div className="sblock-title">📊 {t('stats')}</div>
                <div className="sblock-body">
                  {[
                    [t('sr_day'), <span key="d" className="srow-val gold">#{stats.day||meta?.day||'—'}</span>],
                    [t('sr_tourneys') + (periodStats?.totalMTT != null ? '*' : ''),
                      <span key="mtt" className="srow-val"
                        title={periodStats?.totalMTT != null ? t(chartPeriod==='week'?'for_period_week':'for_period_month') : undefined}>
                        {fmtInt(periodStats?.totalMTT ?? meta?.totalTournaments ?? 3565)}
                      </span>],
                    (periodStats?.avgMTT ?? stats.avgMTT) != null && [
                      t('sr_avg') + (periodStats?.avgMTT != null ? '*' : ''),
                      <span key="avg" className="srow-val" title={periodStats?.avgMTT != null ? t(chartPeriod==='week'?'for_period_week':'for_period_month') : undefined}>
                        {fmtInt(periodStats?.avgMTT ?? stats.avgMTT)}
                      </span>,
                    ],
                    (periodStats?.winRate ?? stats.winRate) != null && [
                      t('sr_winrate') + (periodStats?.winRate != null ? '*' : ''),
                      <span key="wr" className="srow-val"
                        title={periodStats
                          ? `${periodStats.positiveSessions} / ${periodStats.sessionsCount}`
                          : `${Math.round(stats.winRate*stats.sessionsCount)} / ${stats.sessionsCount}`}>
                        {Math.round((periodStats?.winRate ?? stats.winRate)*100)}%
                      </span>,
                    ],
                  ].filter(Boolean).map(([k,v])=>(
                    <div key={k} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
                  {periodStats && (
                    <div className="srow-note">{t('stats_note_filter')} ({t(chartPeriod==='week'?'period_week':'period_month')})</div>
                  )}
                </div>
              </div>

              {!isNarrow && <FirstFundBanner t={t}/>}

              <div className="sblock">
                <div className="sblock-title">🧵 {t('forum_stats')}</div>
                <div className="sblock-body">
                  {[
                    [t('sr_posts'), <span key="p" className="srow-val">{fmtInt(posts.length)}</span>],
                    [t('sr_authors'), <span key="a" className="srow-val">{fmtInt(forumAuthorCount)}</span>],
                    [t('sr_top'), <span key="l" className="srow-val">{hotPosts[0]?`+${hotPosts[0].likes}`:'—'}</span>],
                  ].map(([k,v])=>(
                    <div key={k} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
                </div>

                {lang==='ru' && hotPosts.length>0 && (() => {
                  const sideTopPeriod = sidebarTopPeriod
                  const now = Date.now() / 1000
                  const cutoffs = { day: now-86400, week: now-604800, month: now-2592000, all: 0 }
                  const labels = { day:t('filter_day'), week:t('filter_week'), month:t('filter_month'), all:t('filter_always') }
                  const filtered = hotPosts.filter(p => (p.timestamp||0) >= cutoffs[sideTopPeriod])
                  const topList = (filtered.length ? filtered : hotPosts).slice(0,10)
                  return (
                    <>
                      <div className="forum-top-head">
                        <span>{t('top_likes_header')}</span>
                        <div className="forum-top-periods">
                          {Object.keys(cutoffs).map(k => (
                            <button type="button" key={k} onClick={()=>setSidebarTopPeriod(k)}
                              aria-pressed={sideTopPeriod===k}
                              style={{background:sideTopPeriod===k?'var(--red)':'var(--bg3)',border:'1px solid '+(sideTopPeriod===k?'var(--red)':'var(--border2)'),borderRadius:4,color:sideTopPeriod===k?'#fff':'var(--dim2)',fontSize:10,padding:'3px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                              {labels[k]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <SidebarTopList posts={topList} setLightbox={setLightbox}/>
                    </>
                  )
                })()}
              </div>

              {ignored.size>0 && (
                <div className="sblock">
                  <div className="sblock-title">🚫 {t('settings_ignore_short')} ({ignored.size})</div>
                  <div className="sblock-body" style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {[...ignored].map(n=>(
                      <span key={n} style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:12,padding:'2px 8px',fontSize:11,display:'flex',gap:4,alignItems:'center'}}>
                        {n}
                        <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--dim)',fontSize:11,padding:0}} onClick={()=>removeIgnore(n)} aria-label={`${t('settings_remove_author')}: ${n}`}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="sblock">
                <div className="sblock-title">🔗 {t('settings_links')}</div>
                <div className="sblock-body" style={{display:'flex',flexDirection:'column',gap:8}}>
                  <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ {t('settings_forum_thread')}</a>
                  <a href="https://github.com/loremcdmx/romeoprotracker" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ {t('settings_source')}</a>
                </div>
              </div>
            </aside>
          )}
        </main>
      )}

      {/* FOOTER */}
      {!loading && (
        <footer style={{
          maxWidth:1480,margin:'0 auto',padding:'24px 16px 40px',
          borderTop:'1px solid var(--border)',marginTop:8,
        }}>
          <div style={{display:'flex',flexWrap:'wrap',gap:24,alignItems:'flex-start',justifyContent:'space-between'}}>
            {/* Левая часть — версия и автор */}
            <div>
              <div style={{fontSize:11,color:'var(--dim)',fontFamily:"'Roboto Mono',monospace",marginBottom:4}}>
                <span style={{color:'var(--dim2)',fontWeight:600}}>RomeoPro Marathon</span>
                {' '}
                  <span style={{color:'var(--dim)'}}>{appVersionLabel}</span>
              </div>
              <div style={{fontSize:10,color:'var(--dim)',marginBottom:4}}>
                {t('footer_made')}{' '}
                <a href="https://t.me/loremnopoker" target="_blank" rel="noreferrer"
                  style={{color:'var(--dim2)',textDecoration:'none'}}>LoremCDMX</a>
              </div>
              <div style={{fontSize:10,color:'var(--dim2)'}}>
                {t('footer_interface_updated')}: {buildDateLabel}
              </div>
              {(() => {
                const scrapeTs = meta?.lastScrapeRun
                  ? Date.parse(meta.lastScrapeRun)
                  : meta?.lastUpdated ? Date.parse(meta.lastUpdated) : 0
                const newestPostTs = posts?.length
                  ? Math.max(...posts.map(p => (p.timestamp || 0) * 1000))
                  : 0
                if (!scrapeTs && !newestPostTs) return null
                const localeMap = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' }
                const loc = localeMap[lang] || 'en-US'
                // Site policy: every timestamp is Europe/Warsaw, footer included
                const fmt = (ts) => {
                  const w = warsawParts(Math.floor(ts / 1000))
                  if (!w) return ''
                  const now = warsawParts(Math.floor(Date.now() / 1000))
                  const sameDay = now && w.day === now.day && w.month === now.month && w.year === now.year
                  const time = `${w.hour}:${w.minute}`
                  return sameDay
                    ? `${t('footer_today_at')} ${time}`
                    : `${w.day}.${w.month} ${t('footer_at')} ${time}`
                }
                const mins = Math.round((Date.now() - scrapeTs) / 60000)
                const fresh = mins < 20
                const stale = mins > 90
                const freshClass = fresh ? 'ok' : stale ? 'stale' : 'warn'
                return (
                  <>
                    <div className={`footer-fresh ${freshClass}`} style={{fontSize:10,marginTop:3,fontFamily:"'Roboto Mono',monospace"}}
                      title={fmtDateTimeLang(Math.floor(scrapeTs / 1000), lang)}>
                      <span className="footer-fresh-dot"/>
                      {t('footer_scraper_ran')}: {fmt(scrapeTs)}
                    </div>
                    {newestPostTs > 0 && (
                      <div style={{fontSize:10,color:'var(--dim)',marginTop:2,fontFamily:"'Roboto Mono',monospace",paddingLeft:11}}
                        title={fmtDateTimeLang(Math.floor(newestPostTs / 1000), lang)}>
                        {t('footer_freshest_post')}: {fmt(newestPostTs)}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Правая часть — чейнджлог */}
            {lang==='ru' && <div style={{maxWidth:420}}>
              <div style={{fontSize:10,color:'var(--dim)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8,fontWeight:600}}>
                {t('footer_changelog')}
              </div>
              {[
                ['02.07', 'v1.12', 'BR-апдейты больше не конфликтуют с номером дня, а тренд $/МТТ считается по завершённым отрезкам'],
                ['23.05', 'v1.11', '«Доллар с турнира» стал чище: точки по 2k МТТ, зелёный тренд, неполный отрезок приглушён, старт от нуля. Починены аватарки, favicon и узкая верстка'],
                ['15.05', 'v1.10', 'Появился виджет GGWF-лидербордов: три борда Low/Medium/High, лидеры, место Ромео, призы, сколько осталось до конца и тултип с формулой очков'],
                ['09.05', 'v1.9', 'График марафона стал крупнее и честнее читается на телефоне: точки объединяются по сессиям, попап показывает разбивку, а подписи оси X отмечают важные рубежи — $25k, $100k и крупные доезды'],
                ['19.04', 'v1.8', 'Попапы снова открываются рядом с нужным местом, не прилипают к верху и не дублируются при хаотичном наведении. У «Сыграно МТТ» теперь нейтральная иконка'],
                ['13.04', 'v1.7', 'Попапы активности и топ-постов больше не вылезают за границы экрана в любых положениях. Под капотом готовится переключатель языков'],
                ['13.04', 'v1.6', 'В активности — карточки дней с картинками, клик уносит к посту в ленте. Окошко топ-постов прилипает ближе и не дрожит. Длинные посты не режутся, если скрыта пара строк'],
                ['11.04', 'v1.5', 'Фильтры графика по неделе и месяцу. Избранное и игнор по авторам. В темах — интересные моменты и самые активные. Страница подгоняется под ширину окна'],
                ['09.04', 'v1.4', 'Можно плюсовать и минусовать посты прямо из трекера. Кнопка «новые посты» когда приходит свежак. Новые посты подтягиваются каждые 15 минут. График теперь на первом экране'],
                ['08.04', 'v1.3', 'Светлая тема. Новые посты подтягиваются автоматически'],
                ['07.04', 'v1.2', 'Плавные кривые на графике с анимацией. Версия для телефона'],
                ['06.04', 'v1.1', 'Блок активности по дням. Топ-10 самых плюсанутых постов. Страница обновляется без перезагрузки'],
                ['05.04', 'v1.0', 'Первый запуск — лента постов, цитаты, страницы, график марафона, тёмная и светлая тема, избранное, фильтры'],
              ].map(([date, ver, desc]) => (
                <div key={date+ver} style={{display:'flex',gap:8,marginBottom:6,alignItems:'baseline'}}>
                  <span style={{fontSize:9,color:'var(--dim)',fontFamily:"'Roboto Mono',monospace",minWidth:36,flexShrink:0}}>{date}</span>
                  <span style={{fontSize:9,color:'var(--red)',minWidth:28,flexShrink:0,fontFamily:"'Roboto Mono',monospace"}}>{ver}</span>
                  <span style={{fontSize:10,color:'var(--dim2)',lineHeight:1.5}}>{desc}</span>
                </div>
              ))}
            </div>}
          </div>
        </footer>
      )}
      {/* Vercel Analytics */}
      <Analytics />
    </>
  )
}
