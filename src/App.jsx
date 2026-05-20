import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react'
import { Analytics } from '@vercel/analytics/react'
import {
  timeAgo, fmtBR, fmtNum, fmtInt, fmtExact, fmtDateShort, extractDay, extractBR,
  fk, fkAbs, ROMEO_RE, autoCloseQuotes, stripQuoteTags, extractQuoteBody,
  makeBezierPath, makeBezierArea, pl, plural,
  warsawDayKey, fmtDateTimeLang,
} from './utils.js'
import { createTranslator, DEFAULT_LANG, FORUM_WORD, fmtDateShortLang } from './i18n.js'
import { computeFixedPopupLayout, findHoverListIndexAtPoint } from './floating.js'
import { useIsMobile } from './hooks/useIsMobile.js'
import { useExclusiveHoverPopup } from './hooks/useExclusiveHoverPopup.js'
import { usePersistentState } from './hooks/usePersistentState.js'
import { usePostsData } from './hooks/usePostsData.js'
import AnimatedValue, { useTweenValue } from './components/AnimatedValue.jsx'

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

const LEADERBOARD_TIERS = ['Low', 'Medium', 'High']
const LEADERBOARD_META = {
  Low: { label:'Low', pool:'$300K', tone:'low' },
  Medium: { label:'Medium', pool:'$700K', tone:'medium' },
  High: { label:'High', pool:'$1M', tone:'high' },
}

function formatLeaderboardPrize(row) {
  const value = row?.prizeValue
  if (value == null) return '—'
  const rounded = Math.round(value)
  const currency = row?.prizeCurrency || 'USD'
  if (currency === 'USD') return `$${fmtInt(rounded)}`
  if (currency === 'GCD') return `GCD ${fmtInt(rounded)}`
  return `${currency} ${fmtInt(rounded)}`
}

function formatLeaderboardPoints(value) {
  if (value == null) return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function LeaderboardPoints({ value, className = '' }) {
  return (
    <span className={className}>
      <b>{formatLeaderboardPoints(value)}</b>
      <small>pts</small>
    </span>
  )
}

function leaderboardGapText(board, lang) {
  const target = board?.target
  if (!target) return ''
  if (target.rank <= 3) return ''
  const topThree = (board?.top || []).find(row => row.rank === 3) || board?.top?.[2]
  if (!topThree?.point || target.point == null) return ''
  const gap = topThree.point - target.point
  if (!(gap > 0)) return ''
  const label = lang === 'ru' ? 'до топ-3' : lang === 'es' ? 'al top 3' : 'to top 3'
  return `${label}: ${formatLeaderboardPoints(gap)} pts`
}

function formatLeaderboardTimeLeft(finishedAt, lang) {
  const end = Date.parse(finishedAt || '')
  if (!Number.isFinite(end)) return '—'
  const diff = end - Date.now()
  if (diff <= 0) return lang === 'ru' ? 'завершён' : lang === 'es' ? 'terminado' : 'finished'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (lang === 'ru') return days > 0 ? `${days}д ${hours}ч` : `${hours}ч`
  if (lang === 'es') return days > 0 ? `${days}d ${hours}h` : `${hours}h`
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

function formatLeaderboardUpdated(ts, lang) {
  const value = Date.parse(ts || '')
  if (!Number.isFinite(value)) return '—'
  return fmtDateTimeLang(value / 1000, lang)
}

function sampleLeaderboardPoints({ pool, place, field }) {
  return Math.round(Math.log(pool) / Math.sqrt(place / field))
}

function leaderboardRowsForDisplay(board, targetNick) {
  const rows = []
  const seen = new Set()
  const targetKey = String(targetNick || '').toLowerCase()
  const add = (row, role = 'leader') => {
    if (!row?.nickname) return
    const key = `${row.rank}:${row.nickname}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    rows.push({
      ...row,
      role:String(row.nickname).toLowerCase() === targetKey ? 'romeo' : role,
    })
  }

  ;(board?.top || []).slice(0, 3).forEach(row => add(row, 'leader'))
  if (board?.target) add(board.target, 'romeo')
  for (const row of (board?.top || []).slice(3)) {
    if (rows.length >= 4) break
    add(row, 'leader')
  }
  return rows
}

const MARATHON_TARGET = 10_000_000
const PACE_PERIOD_SECONDS = { week:7 * 86400, month:30 * 86400 }
const PACE_BIN_SIZE = 1000

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
  let tournaments = indexed.reduce((sum, { row }) => sum + (row.tournaments || 0), 0)

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

function historySessionTournaments(row, sorted, idx) {
  if (row?.tournaments) return row.tournaments
  const prevTotal = idx === 0 ? 0 : sorted[idx - 1]?.totalTournaments || 0
  const total = row?.totalTournaments || 0
  return Math.max(0, total - prevTotal)
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
    if (!tournaments) return

    // Reports are session-level, so split session profit proportionally when it crosses a 1k-MTT bin.
    const profit = historySessionProfit(row, sorted, idx, startBR)
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

  return {
    period,
    target,
    current,
    previous,
    segments:buildPaceSegments(sorted, currentPredicate, startBR, PACE_BIN_SIZE),
    binSize:PACE_BIN_SIZE,
    rate,
    deltaRate,
    finishMTT,
    bustMTT,
    remaining,
  }
}

function PaceRateValue({ value, unit, className = '' }) {
  const animated = useTweenValue(value ?? 0, 620)
  const [pulse, setPulse] = useState(false)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 650)
      return () => clearTimeout(t)
    }
  }, [value])
  if (value == null) return <span className={className}>—</span>
  const tone = value > 0 ? 'pos' : value < 0 ? 'neg' : ''
  return <span className={`pace-rate-value ${tone} ${pulse ? 'pulse' : ''} ${className}`}>{formatDollarPerMTT(animated, unit)}</span>
}

function PaceMiniChart({ segments, unit, t }) {
  const [hovered, setHovered] = useState(null)
  if (!segments?.length) return <div className="pace-chart-empty">{t('pace_chart_empty')}</div>

  const width = 640
  const height = 210
  const pad = { left:44, right:12, top:28, bottom:44 }
  const gridLeft = pad.left
  const gridRight = width - pad.right
  const basePlotW = gridRight - gridLeft
  const plotH = height - pad.top - pad.bottom
  const maxAbs = Math.max(5, ...segments.map(seg => Math.abs(seg.rate || 0)))
  const zeroY = pad.top + plotH / 2
  const barW = Math.max(12, Math.min(34, basePlotW / Math.max(1, segments.length) * .48))
  const pointLeft = gridLeft + barW / 2
  const pointRight = gridRight - barW / 2
  const pointW = pointRight - pointLeft
  const xStep = pointW / Math.max(1, segments.length - 1)
  const x = idx => pointLeft + (segments.length === 1 ? pointW / 2 : idx * xStep)
  const y = value => pad.top + (maxAbs - value) / (maxAbs * 2) * plotH
  const linePath = segments
    .map((seg, idx) => `${idx ? 'L' : 'M'} ${x(idx).toFixed(1)} ${y(seg.rate).toFixed(1)}`)
    .join(' ')
  const areaPath = `${linePath} L ${x(segments.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`
  const bestIdx = segments.reduce((best, seg, idx) => seg.rate > segments[best].rate ? idx : best, 0)
  const worstIdx = segments.reduce((worst, seg, idx) => seg.rate < segments[worst].rate ? idx : worst, 0)
  const labelIndexes = new Set([segments.length - 1, bestIdx, worstIdx])
  if (segments.length <= 3) segments.forEach((_, idx) => labelIndexes.add(idx))
  const xLabelIndexes = new Set()
  segments.forEach((_, idx) => {
    if (segments.length <= 8 || idx % 2 === 0 || idx === segments.length - 1) xLabelIndexes.add(idx)
  })
  const lineStops = segments.map((seg, idx) => {
    const offset = segments.length === 1 ? '0%' : `${idx / (segments.length - 1) * 100}%`
    return { offset, color:seg.rate >= 0 ? '#4caf50' : '#e53935' }
  })
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
          <radialGradient id="pacePlotGlow" cx="85%" cy="18%" r="72%">
            <stop offset="0%" stopColor="#ffb300" stopOpacity=".10"/>
            <stop offset="55%" stopColor="#e53935" stopOpacity=".03"/>
            <stop offset="100%" stopColor="#e53935" stopOpacity="0"/>
          </radialGradient>
          <filter id="paceGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect x={gridLeft} y={pad.top} width={basePlotW} height={plotH} rx="10" className="pace-plot-bg"/>
        <rect x={gridLeft} y={pad.top} width={basePlotW} height={plotH} rx="10" fill="url(#pacePlotGlow)" className="pace-plot-glow"/>
        <line className="pace-grid-line" x1={gridLeft} x2={gridRight} y1={pad.top} y2={pad.top}/>
        <line className="pace-grid-line pace-zero" x1={gridLeft} x2={gridRight} y1={zeroY} y2={zeroY}/>
        <line className="pace-grid-line" x1={gridLeft} x2={gridRight} y1={pad.top + plotH} y2={pad.top + plotH}/>
        <text className="pace-axis-caption" x={gridLeft} y="16">{t('pace_axis_caption')}</text>
        <text className="pace-goal-caption" x={(gridLeft + gridRight) / 2} y="16">{t('pace_goal_caption')}</text>
        <text className="pace-y-label" x="8" y={pad.top + 4}>+{Math.round(maxAbs)}$</text>
        <text className="pace-y-label zero" x="20" y={zeroY + 4}>0</text>
        <text className="pace-y-label" x="8" y={pad.top + plotH + 4}>-{Math.round(maxAbs)}$</text>
        <path className="pace-area" d={areaPath}/>
        {segments.length > 1 && <path className="pace-line-aura" d={linePath}/>}
        {segments.length > 1 && <path className="pace-line" d={linePath}/>}
        {segments.length > 1 && <path className="pace-line-highlight" d={linePath}/>}
        <text className="pace-x-caption" x={(gridLeft + gridRight) / 2} y={height - 1}>{t('pace_x_caption')}</text>
        {segments.map((seg, idx) => {
          const cx = x(idx)
          const rateY = y(seg.rate)
          const tone = seg.rate >= 0 ? 'pos' : 'neg'
          const showRateLabel = labelIndexes.has(idx) && (idx === segments.length - 1 || Math.abs(seg.rate) >= Math.max(1, maxAbs * .08))
          const isPartial = !seg.full
          return (
            <g key={`${idx}-${seg.endMtt}`} className={`pace-segment ${tone} ${isPartial ? 'partial' : ''}`}
              onMouseEnter={() => openTooltip(seg, idx, cx, rateY)}
              onMouseMove={() => openTooltip(seg, idx, cx, rateY)}
              onPointerEnter={() => openTooltip(seg, idx, cx, rateY)}
              onPointerMove={() => openTooltip(seg, idx, cx, rateY)}
              onFocus={() => openTooltip(seg, idx, cx, rateY)}
              onBlur={closeTooltip}
              onClick={(e) => { e.stopPropagation(); openTooltip(seg, idx, cx, rateY) }}
              tabIndex="0" role="button" aria-label={`${seg.label}: ${formatDollarPerMTT(seg.rate, unit)}${isPartial ? `, ${t('pace_tip_partial')}` : ''}`}>
              <circle className="pace-dot-hit" cx={cx} cy={rateY} r="12"/>
              {isPartial && <circle className="pace-dot-partial-ring" cx={cx} cy={rateY} r="8.2"/>}
              <circle className="pace-dot" cx={cx} cy={rateY} r={idx === segments.length - 1 ? 5.2 : 3.9}/>
              {showRateLabel && (
                <text className={`pace-chart-value ${tone}`} x={cx} y={rateY + (seg.rate >= 0 ? -11 : 17)}>
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
          <div className="pace-point-tooltip-row">
            <span>{t('pace_tip_net')}</span>
            <b className={hovered.seg.profit >= 0 ? 'pos' : 'neg'}>{formatPaceMoney(hovered.seg.profit)}</b>
          </div>
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

function LeaderboardsWidget({ snapshot, lang, t }) {
  const boards = snapshot?.leaderboards || []
  const byTier = new Map(boards.map(board => [board.tier, board]))
  const finishedAt = snapshot?.finishedAt
  const remaining = formatLeaderboardTimeLeft(finishedAt, lang)
  const fetchedAt = formatLeaderboardUpdated(snapshot?.fetchedAt, lang)
  const sourceUrl = snapshot?.officialPage || 'https://ggpoker.com/tournaments/ggpoker-world-festival/'
  const examples = [
    `$100K · 1/1000 ≈ ${sampleLeaderboardPoints({ pool:100000, place:1, field:1000 })}`,
    `$100K · 10/1000 ≈ ${sampleLeaderboardPoints({ pool:100000, place:10, field:1000 })}`,
    `$100K · 100/1000 ≈ ${sampleLeaderboardPoints({ pool:100000, place:100, field:1000 })}`,
    `$1M · 1/5000 ≈ ${sampleLeaderboardPoints({ pool:1000000, place:1, field:5000 })}`,
  ]

  return (
    <section className="leaderboard-widget">
      <div className="leaderboard-head">
        <div>
          <div className="section-title">{t('leaderboards_title')}</div>
          <div className="leaderboard-sub">
            {t('leaderboards_updated')}: {fetchedAt}
          </div>
        </div>
        <div className="leaderboard-head-actions">
          <div className="leaderboard-countdown" title={finishedAt ? new Date(finishedAt).toLocaleString() : undefined}>
            <span>{t('leaderboards_left')}</span>
            <b>{remaining}</b>
          </div>
          <div className="leaderboard-help-wrap">
            <button className="leaderboard-help" aria-label={t('leaderboards_points_help')}>?</button>
            <div className="leaderboard-tooltip" role="tooltip">
              <b>{t('leaderboards_points_help')}</b>
              <span>{t('leaderboards_points_formula')}</span>
              <div className="leaderboard-tooltip-grid">
                {examples.map(example => <span key={example}>{example}</span>)}
              </div>
              <span>{t('leaderboards_points_note')}</span>
            </div>
          </div>
        </div>
      </div>

      {!boards.length ? (
        <div className="leaderboard-empty">{t('leaderboards_empty')}</div>
      ) : (
        <div className="leaderboard-grid">
          {LEADERBOARD_TIERS.map(tier => {
            const board = byTier.get(tier)
            const meta = LEADERBOARD_META[tier]
            const rows = leaderboardRowsForDisplay(board, snapshot?.targetNick)
            const chase = leaderboardGapText(board, lang)
            return (
              <div key={tier} className={`leaderboard-card ${meta.tone}`}>
                <div className="leaderboard-card-head">
                  <div>
                    <span className="leaderboard-tier">{meta.label}</span>
                  </div>
                  <span className="leaderboard-pool">{meta.pool}</span>
                </div>
                {board?.target && (
                  <div className="leaderboard-romeo-panel">
                    <div className="leaderboard-romeo-main">
                      <span>Romeo</span>
                      <b>#{board.target.rank}</b>
                    </div>
                    <div className="leaderboard-romeo-metrics">
                      <LeaderboardPoints value={board.target.point} className="leaderboard-romeo-points"/>
                      <strong>{formatLeaderboardPrize(board.target)}</strong>
                    </div>
                    <div className={`leaderboard-chase ${chase ? '' : 'placeholder'}`} aria-hidden={!chase}>{chase || '\u00a0'}</div>
                  </div>
                )}
                <div className="leaderboard-table">
                  <div className="leaderboard-table-head">
                    <span>#</span>
                    <span>{t('leaderboards_player')}</span>
                    <span>{t('leaderboards_points')}</span>
                    <span>{t('leaderboards_prize')}</span>
                  </div>
                  {rows.map((row, idx) => (
                    <div key={`${tier}-${row.rank}-${row.nickname}`} className={`leaderboard-row ${row.role === 'romeo' ? 'romeo' : ''} ${row.rank <= 3 ? 'top-leader' : ''} ${idx === 3 ? 'after-top' : ''}`}>
                      <span className={`leaderboard-rank ${row.rank <= 3 ? `top-${row.rank}` : ''}`}>{row.rank}</span>
                      <span className="leaderboard-player">
                        <span className="leaderboard-name">{row.nickname}</span>
                      </span>
                      <LeaderboardPoints value={row.point} className="leaderboard-points"/>
                      <span className="leaderboard-prize">{formatLeaderboardPrize(row)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <a className="leaderboard-source" href={sourceUrl} target="_blank" rel="noreferrer">
        {t('leaderboards_source')} →
      </a>
    </section>
  )
}

function PaceWidget({ meta, stats, period, setPeriod, lang, t }) {
  const pace = useMemo(() => computePaceMetrics({ meta, stats, period }), [meta, stats, period])
  if (!pace?.current) return null

  const currentRate = pace.rate
  const prevRate = pace.previous?.rate
  const deltaRate = pace.deltaRate
  const isNegative = currentRate != null && currentRate < 0
  const periodLabel = t(period === 'week' ? 'period_week' : period === 'month' ? 'period_month' : 'period_all')
  const mttUnit = t('sr_mtt_short')
  const finishTarget = pace.finishMTT || pace.bustMTT || null
  const finishSteps = finishTarget ? Math.ceil(finishTarget / pace.binSize) : null

  return (
    <section className={`pace-widget ${isNegative ? 'negative' : currentRate > 0 ? 'positive' : ''}`} data-testid="pace-widget">
      <div className="pace-head">
        <div>
          <div className="section-title">{t('pace_title')}</div>
          <div className="pace-sub">{t('pace_sub')} · {periodLabel.toLowerCase()}</div>
        </div>
        <div className="pace-periods">
          {[['week', t('period_week')], ['month', t('period_month')], ['all', t('period_all')]].map(([key, label]) => (
            <button key={key} className={`mc-period ${period === key ? 'active' : ''}`} onClick={() => setPeriod(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pace-dashboard">
        <div className="pace-summary-panel marathon-progress-side">
          <div className="mps-item pace-rate-item">
            <span className="mps-label">{t('pace_rate_now')}</span>
            <span className="mps-value-row">
              <PaceRateValue value={currentRate} unit={mttUnit} className="mps-value"/>
            </span>
            <span className="pace-summary-note">{fmtBR(pace.current.profit)} / {fmtInt(pace.current.tournaments)} {mttUnit}</span>
          </div>
          <div className="mps-divider"/>
          <div className="mps-item pace-projection-item">
            <span className="mps-label">{isNegative ? t('pace_to_zero') : t('pace_finish')}</span>
            {finishTarget ? <TempoValue target={finishTarget} title={t('pace_at_current')}/> : <span className="mps-value">—</span>}
            <span className="pace-summary-note">{finishSteps ? `${t('pace_at_current')} · ${fmtInt(finishSteps)} × ${fmtInt(pace.binSize)} ${mttUnit}` : t('pace_no_finish')}</span>
          </div>
          <div className="mps-divider"/>
          <div className="mps-item pace-history-item">
            <span className="mps-label">{t('pace_rate_prev')}</span>
            <span className="mps-value">
              <PaceRateValue value={prevRate} unit={mttUnit}/>
            </span>
            <span className="pace-summary-note">{prevRate == null ? t(period === 'all' ? 'pace_all_note' : 'pace_no_prev') : `${t('pace_delta')}: ${formatDollarPerMTT(deltaRate, mttUnit)}`}</span>
          </div>
        </div>
        <div className="pace-chart-title">
          <div>
            <span>{t('pace_chart_title')}</span>
            <small>{t('pace_chart_hint')}</small>
          </div>
          <b>{t('pace_chart_step')}: {fmtInt(pace.binSize)} {mttUnit}</b>
        </div>
        <div className="pace-speed-legend" aria-hidden="true">
          <span className="pos">{t('pace_speed_positive')}</span>
          <span className="neg">{t('pace_speed_negative')}</span>
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

  const W = isMobile ? 520 : 700
  const H = isMobile ? (period === 'all' ? 520 : 420) : 240
  const pL = isMobile ? 60 : 58
  const pR = isMobile ? 18 : 22
  const pT = isMobile ? 18 : 14
  const pB = isMobile ? 58 : 44
  const plotBottom = H - pB
  const dataMin = Math.min(...points.map(p=>p.br), startBR)
  const dataMax = Math.max(...points.map(p=>p.br), startBR)
  const minV = Math.max(0, Math.floor(dataMin * 0.7 / 1000) * 1000)
  const maxV = dataMax * 1.05
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
    const maxSoFar = norm[norm.length - 1] || 1
    const nudge = Math.max(1, maxSoFar * 0.008)
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
  const linePath = makeBezierPath(coords)
  const areaPath = makeBezierArea(coords, plotBottom)
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

    return groups
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
      main:cumMTT[points.length - 1] ? fmtInt(cumMTT[points.length - 1]) : 'сейчас',
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
        main:`${eventLabel('worst')} ${fk(worstDay.profit)}`,
        priority:126,
        note:`${eventLabel('worst').toLowerCase()} ${fk(worstDay.profit)}`,
      })
    }

    let selected = []
    const maxLabels = isMobile ? 7 : 9
    const minGap = isMobile ? 78 : 68
    const labelWidth = item => {
      const notes = uniq(item.notes || [])
      const mainWidth = String(item.main || '').length * (isMobile ? 7.4 : 7.1)
      const noteWidth = notes.reduce((max, note) => Math.max(max, String(note || '').length * (isMobile ? 4.9 : 4.7)), 0)
      return Math.min(isMobile ? 138 : 176, Math.max(48, mainWidth, noteWidth))
    }
    const gapFor = (a, b) => Math.max(minGap, (labelWidth(a) + labelWidth(b)) / 2 + (isMobile ? 16 : 14))
    const candidates = [...byIndex.values()].sort((a,b) => b.priority - a.priority)
    for (const candidate of candidates) {
      const conflicts = selected.filter(item =>
        Math.abs(item.x - candidate.x) < gapFor(item, candidate)
      )
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
        const stillFits = withoutWeakest.every(item =>
          Math.abs(item.x - candidate.x) >= gapFor(item, candidate)
        )
        if (weakest && candidate.priority > weakest.priority && stillFits) {
          selected = [...withoutWeakest, candidate]
        }
      }
    }

    return selected
      .sort((a,b) => a.x - b.x)
      .map(item => ({
        ...item,
        sub:uniq(item.notes || [])
          .filter(note => note !== item.main)
          .filter(note => !(item.kind.includes('best') && String(note).trim().startsWith('$')))
          .sort((a, b) => {
            const rank = note => {
              const lower = String(note).toLowerCase()
              if (lower.includes('пик') || lower.includes('peak') || lower.includes('pico')) return 0
              if (lower.includes('мтт') || lower.includes('mtt')) return 0
              if (lower.includes('$100k')) return 1
              if (lower.startsWith('$')) return 2
              return 3
            }
            return rank(a) - rank(b)
          })
          .slice(0, item.kind.includes('range-start') ? 2 : 1)
          .concat(fmtDateShortLang(item.p.timestamp, lang))
          .join(' · '),
      }))
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
      { dx:-nearX, dy:nearY, affinity:18 },
      { dx:-nearX, dy:0, affinity:12 },
      { dx:-nearX, dy:-nearY, affinity:4 },
      { dx:-farX, dy:nearY, affinity:7 },
      { dx:-farX, dy:farY, affinity:2 },
      { dx:0, dy:farY, affinity:3 },
      { dx:nearX, dy:nearY, affinity:0 },
      { dx:nearX, dy:-nearY, affinity:-4 },
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
      const lineIntersections = lineSegments.filter(({ a, b }) => segmentIntersectsRect(a, b, padded)).length
      const anchor = anchorForRect(rect)
      const leaderLength = Math.hypot(cx - point.x, cy - point.y)
      const leaderDistance = leaderDangerPoints.length
        ? Math.min(...leaderDangerPoints.map(p => distanceToSegment(p, point, anchor)))
        : 32
      const leaderCrowding = Math.max(0, 14 - leaderDistance)
      const clampPenalty = Math.hypot(cx - targetCx, cy - targetCy)
      const topAir = Math.max(0, rect.top - pT)
      const farLeaderPenalty = Math.max(0, leaderLength - (isMobile ? 230 : 210))
      const clearRectScore = Math.min(minDistance, isMobile ? 96 : 110)
      const clearPaddedScore = Math.min(minPaddedDistance, isMobile ? 74 : 84)
      const edgePenalty = rect.top < pT + 7 || rect.right > W - pR - 7 || rect.left < pL + 7 ? 8 : 0
      return {
        cx,
        cy,
        rect,
        anchor,
        score:clearRectScore * 2.4 + clearPaddedScore * 2 + Math.min(leaderDistance, 34) * .8
          + affinity - overlaps * 220 - lineIntersections * 180 - leaderLength * .12
          - farLeaderPenalty * 1.7 - leaderCrowding * 4 - clampPenalty * 1.8 - topAir * .18 - edgePenalty,
      }
    }).sort((a,b) => b.score - a.score)
    const { cx, cy, anchor } = candidates[0]
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
  const markerVisuals = markerGroups.map((marker, idx, arr) => {
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
      markerGroups.forEach(m => { const d=Math.abs(m.x-tx); if(d<minD){minD=d;nearest=m} })
      if (!nearest) return
      const p = nearest.p
      announceHoverPopupOpen()
      openTipState({ p, profit:nearest.profit, x:nearest.x, y:nearest.y, screenY: sy, groupCount:nearest.count, sessions:nearest.sessions })
    }, 300)
  }
  const handleTouchEnd = () => { clearTimeout(longPressTimer.current) }
  const handleTouchMove = () => { clearTimeout(longPressTimer.current) }

  if (!points.length) return (
    <div className="marathon-chart">
      <div className="section-head"><span className="section-title">{t('chart_marathon')}</span></div>
      <div className="empty-state">{t('empty_data_scraper')}</div>
    </div>
  )

  return (
    <div className="marathon-chart" ref={chartRef} onClick={tip ? closeTip : undefined}>
      <div className="section-head" style={{marginBottom:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span className="section-title">{t('chart_marathon')}</span>
        <div className="mc-periods">
          {[['week',t('period_week')],['month',t('period_month')],['all',t('period_all')]].map(([k,label])=>(
            <button key={k} onClick={()=>setPeriodPersist(k)}
              className={`mc-period ${period===k?'active':''}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="section-count">{plSessions(points.length, lang)}</span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H+pB+xLabelExtraBottom}`}
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
        <line x1={pL} y1={yOf(startBR)} x2={W-pR} y2={yOf(startBR)} className="mc-zero"/>
        <line x1={pL} y1={plotBottom} x2={W-pR} y2={plotBottom} className="mc-axis-line"/>
        <line x1={pL} y1={pT} x2={pL} y2={plotBottom} className="mc-axis-line mc-axis-line-y"/>
        <path d={areaPath} fill="url(#mcGrad)"/>
        <path d={linePath} fill="none" stroke="url(#mcLineGrad)" className="mc-line-aura" strokeWidth={isMobile ? 8.5 : 6.5}/>
        <path ref={pathRef} d={linePath} fill="none" stroke="url(#mcLineGrad)" className="mc-line-main" strokeWidth={isMobile ? 3.1 : 2.6}
          strokeLinecap="round" strokeLinejoin="round" filter="url(#mcGlow)"
          style={pathLen!=null ? {
            strokeDasharray: pathLen,
            strokeDashoffset: 0,
            animation: 'drawLine 1.4s cubic-bezier(.4,0,.2,1) forwards',
          } : {}}
        />
        <path d={linePath} fill="none" className="mc-line-highlight" strokeWidth={isMobile ? 1.1 : .9}/>
        {markerVisuals.map(({ p, start, end, x, y, profit, count, sessions, isCrowded }) => {
          const i=end
          const isLast = i===points.length-1
          const cx=x, cy=y
          const isHovered = tip?.p === p
          const isGrouped = count > 1
          const baseDotR = isMobile
            ? (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : isGrouped ? 4.5 : 3.4))
            : (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : isGrouped ? 4.6 : 3.8))
          const dotR = isCrowded
            ? Math.min(baseDotR, isLast ? (isMobile ? 4.8 : 4.6) : (isMobile ? 3.4 : 3.5))
            : baseDotR
          const openTip = () => {
            announceHoverPopupOpen()
            openTipState({p,profit,x:cx,y:cy,groupCount:count,sessions})
          }
          return (
            <g key={`marker-${start}-${end}`} onMouseEnter={!isMobile ? openTip : undefined}
              onClick={!isMobile ? e => { e.stopPropagation(); openTip() } : undefined}
              data-start={start} data-end={end} data-count={count}>
              {!isMobile && <circle cx={cx} cy={cy} r={isLast?14:10} fill="transparent"
                />}
              {isGrouped && <circle cx={cx} cy={cy} r={dotR + 2.6}
                className="mc-dot-grouped-ring"
                stroke={profit>=0?'#4caf50':'#e53935'}/>}
              <circle cx={cx} cy={cy} r={dotR}
                className={`mc-dot ${isLast && !isCrowded ? 'mc-dot-last' : ''} ${isGrouped?'mc-dot-grouped':''} ${isCrowded?'mc-dot-crowded':''}`}
                fill={profit>=0?'#4caf50':'#e53935'}
                style={{transition:'r .12s', ...(isLast?{color:profit>=0?'#4caf50':'#e53935'}:{})}}/>
            </g>
          )
        })}
        {peakCallout && (
          <g className="mc-peak-callout" data-idx={peakCallout.idx}>
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
          </g>
        )}
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
            <div style={{display:'flex',gap:12,fontSize:12,marginBottom:tip.p.tournaments?4:roomDeltas.length?8:4}}>
              <span style={{color:'var(--dim)'}}>{t('tip_br')}: <b style={{color:'var(--white)'}}>{fkAbs(tip.p.br)}</b></span>
            </div>
            {tip.p.tournaments && (
              <div style={{fontSize:11,color:'var(--dim)',marginBottom:roomDeltas.length?8:4}}>
                {t('tip_mtt_since')}: <b style={{color:'var(--dim2)'}}>{fmtInt(tip.p.tournaments)}</b>
              </div>
            )}
            {tip.groupCount > 1 && (
              <div style={{fontSize:10,color:'var(--dim)',marginBottom:6}}>
                {lang === 'ru' ? 'точка объединяет' : lang === 'es' ? 'punto agrupado' : 'merged point'}: <b style={{color:'var(--dim2)'}}>{plSessions(tip.groupCount, lang)}</b>
              </div>
            )}
            {tip.groupCount > 1 && tip.sessions?.length > 0 && (
              <div className="mc-session-breakdown">
                {tip.sessions.map((s, idx) => (
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
                    <span style={{color:r.v>=0?'#66bb6a':'#ff5252',fontWeight:600}}>{fk(r.v)}</span>
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
  el.scrollIntoView({ behavior:'smooth', block:'center' })
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
          <span className="section-title">{t('chart_activity')}</span>
          <span className="section-count">{plDays(data.length, lang)}</span>
          <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
            {Object.keys(PERIOD_DAYS).map(k => (
              <button key={k} onClick={()=>setPeriod(k)}
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
                  <span style={{fontSize:11,color:isSelected?'var(--text)':'var(--dim)',fontFamily:"'Roboto Mono',monospace",whiteSpace:'nowrap'}}>
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
  const step = Math.max(1, Math.ceil(36 / (bw + pad)))
  // Строим индексы лейблов заранее — без принудительного последнего если он слишком близко
  const labelSet = new Set()
  for (let i = 0; i < data.length; i += step) labelSet.add(i)
  const lastShown = [...labelSet].filter(i => i < data.length - 1).at(-1) ?? -Infinity
  if (data.length - 1 - lastShown >= step * 0.6) labelSet.add(data.length - 1)

  return (
    <div className="chart-wrap">
      <div className="section-head" style={{marginBottom:8,gap:10}}>
        <span className="section-title">{t('chart_activity')}</span>
        <span className="section-count">{period==='all' ? `${t('chart_whole_marathon')} · ${plDays(data.length, lang)}` : `${t('chart_last_period')} ${plDays(data.length, lang)}`}</span>
        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          {Object.keys(PERIOD_DAYS).map(k => (
            <button key={k} onClick={()=>setPeriod(k)}
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
          const labelEdge = 40
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
const DEFAULT_AVATAR = 'https://forum.gipsyteam.ru/img/imguser.png'
const avatarError = e => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR }

function FilterBar({ sortBy, setSortBy, search, setSearch, showSearch, setShowSearch,
                     romeoOnly, setRomeoOnly, minLikes, setMinLikes,
                     minRating, setMinRating, count, showSort=true, t, lang }) {
  const tr = t || (k => k)
  const isRu = lang === 'ru' || !lang
  const hasFilters = romeoOnly || minLikes !== 3 || minRating !== 0 || search
  return (
    <div className="filter-bar">
      {showSort && (
        <select className="feed-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="date_asc">{tr('sort_date_asc')}</option>
          <option value="date_desc">{tr('sort_date_desc')}</option>
          <option value="likes">{tr('sort_likes')}</option>
        </select>
      )}
      {isRu && <>
        <button className={`filter-pill ${romeoOnly?'on':'off'}`} onClick={()=>setRomeoOnly(s=>!s)}
          title={tr('filter_romeo_title')} style={{display:'flex',alignItems:'center',gap:5}}>
          <img src={ROMEO_AVATAR} alt="" style={{width:15,height:15,borderRadius:'50%',objectFit:'cover'}}
            onError={e=>e.target.style.display='none'} />
          {tr('day_romeo')}
        </button>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'nowrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap'}} title={tr('filter_min_likes')}>👍 мин.</label>
            <input className="filter-num" type="number" min="0" value={minLikes}
              onChange={e=>setMinLikes(+e.target.value||0)} onFocus={e=>e.target.select()} title={tr('filter_min_likes')}/>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:3}} title={tr('filter_min_rep')}>
              <img src="https://www.gipsyteam.ru/public/style_images/master/reputation_pos.png" alt="rep"
                referrerPolicy="no-referrer" style={{width:12,height:12,objectFit:'contain'}} onError={e=>{e.target.style.display='none'}}/>
              {tr('filter_rep_label')}
            </label>
            <input className="filter-num" type="number" min="0" step="100" value={minRating}
              onChange={e=>setMinRating(+e.target.value||0)} onFocus={e=>e.target.select()} title={tr('filter_min_rep')}/>
          </div>
        </div>
      </>}
      <button className={`filter-pill ${showSearch?'on':'off'}`}
        onClick={()=>setShowSearch(s=>!s)} title={tr('filter_search_title')}>🔍</button>
      {showSearch && (
        <input className="feed-search" style={{minWidth:140}} placeholder={tr('filter_search_placeholder')}
          value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
      )}
      {isRu && hasFilters && (
        <button className="filter-pill off" title={tr('filter_reset')} onClick={()=>{
          setRomeoOnly(false); setMinLikes(3); setMinRating(0); setSearch(''); setShowSearch(false);
        }}>✕</button>
      )}
      <span className="filter-active-count">{plPosts(count, lang || 'ru')}</span>
    </div>
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
  const profileUrl = `https://forum.gipsyteam.ru/index.php?showuser=${encodeURIComponent(p.author)}`
  const ratingUrl  = `https://forum.gipsyteam.ru/index.php?showuser=${encodeURIComponent(p.author)}&tab=reputation`
  // Блог есть только у пользователей с blogId — определяем по наличию /blogs/ в известных ссылках
  // У Romeopro блог точно есть, у остальных определяем по msgCount > 100 как приближение
  // (точно не знаем без запроса к API форума)

  const isRomeo = ROMEO_RE.test(p.author)

  return (
    <div className={`post-card ${isFav?'faved':''} ${isRomeo?'romeo-post':''}`} onClick={()=>menu&&setMenu(false)}>
      <div className="pc-head">
        <div className="pc-avatar" style={{cursor:'pointer'}} onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
          {p.avatar
            ? <img src={p.avatar} alt={p.author} referrerPolicy="no-referrer" onError={avatarError}/>
            : <img src={DEFAULT_AVATAR} alt={p.author} referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}}/>}
        </div>
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
          <div className="pc-author" style={{cursor:'pointer'}}
            onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
            {p.author}
          </div>
          <div className="pc-author-meta">
            {p.msgCount && <span>{lang==='ru' ? `${fmtInt(p.msgCount)} ${plural(p.msgCount, ['пост','поста','постов'])}` : `${fmtInt(p.msgCount)} ${_t('posts_word')}`}</span>}
            {p.regData  && <span>· {p.regData}</span>}
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
                <span style={S_MONO}>{p.rating.toLocaleString()}</span>
              </a></>
            )}
          </div>
        </div>
            <div className="pc-date" title={fmtDateTimeLang(p.timestamp, _lang)}>{timeAgo(p.timestamp, _lang) || fmtDateTimeLang(p.timestamp, _lang)}</div>
        <div className="pc-actions">
          <button className={`pc-action ${isFav?'on':''}`} onClick={()=>onFav(p.author)} title={isFav?_t('pc_fav_remove'):_t('pc_fav_add')}>⭐</button>
          <button className="pc-action" onClick={()=>onIgnore(p.author)} title={_t('pc_ignore')}>🚫</button>
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
              <iframe src={src} loading="lazy" allowFullScreen frameBorder="0"
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
function TempoValue({ target, title }) {
  const v = useTweenValue(target, 700)
  const [pulse, setPulse] = useState(false)
  const prev = useRef(target)
  useEffect(() => {
    if (prev.current !== target) {
      prev.current = target
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 700)
      return () => clearTimeout(t)
    }
  }, [target])
  return (
    <span className={`mps-value tempo-val ${pulse?'pulse':''}`} title={title}>
      ~{fmtInt(Math.round(v))}
    </span>
  )
}

// ─── AUTHORS PANEL ────────────────────────────────────────────────────────────
function AuthorsPanel({ authors, favorites, onFav, onIgnore, setLightbox, t }) {
  const [expanded, setExpanded] = useState(null)
  const tr = t || _t
  return (
    <div>
      {authors.map(a => {
        const open = expanded === a.name
        const isFav = favorites?.has(a.name)
        return (
          <div key={a.name} className="author-row" style={{marginBottom:6,border:'1px solid var(--border)',borderRadius:8,background:'var(--bg2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer'}}
              onClick={()=>setExpanded(open ? null : a.name)}>
              <div style={{width:28,height:28,borderRadius:'50%',background:'var(--red)',overflow:'hidden',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff'}}>
                {a.posts[0]?.avatar
                  ? <img src={a.posts[0].avatar} alt="" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={avatarError}/>
                  : a.name[0]?.toUpperCase()}
              </div>
              <div style={S_FLEX1}>
                <div style={{fontWeight:700,color:'var(--white)',fontSize:13}}>{a.name} {isFav && <span title={tr('author_fav_label')}>⭐</span>}</div>
                <div style={{fontSize:11,color:'var(--dim)',fontFamily:"'Roboto Mono',monospace"}}>
                  {plPosts(a.count, _lang)} · <span style={{color:'var(--green)'}}>+{a.likes}</span> 👍
                </div>
              </div>
              <button className="pc-action" onClick={e=>{e.stopPropagation();onFav?.(a.name)}} title={tr('author_fav_add')}>⭐</button>
              <span style={{fontSize:11,color:'var(--dim)',opacity:.7}}>{open ? '▲' : '▼'}</span>
            </div>
            {open && (
              <div style={{borderTop:'1px solid var(--border)',padding:'8px 10px'}}>
                {a.posts.slice(0, 20).map(p => (
                  <PostCard key={p.id||p.url} p={p}
                    favorites={favorites} onFav={onFav}
                    onIgnore={onIgnore} setLightbox={setLightbox} lang={_lang}/>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── PAGINATOR ────────────────────────────────────────────────────────────────
function Paginator({ page, totalPages, onPage, perPage, onPerPage, total, lang }) {
  const isMob = useIsMobile()
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
    <div className="pagination">
      <button className="page-btn" disabled={page===1} onClick={()=>onPage(page-1)}>‹</button>
      {pages.map((p,i) => p === '…'
        ? <span key={`e${i}`} className="page-info">…</span>
        : <button key={p} className={`page-btn ${p===page?'active':''}`} onClick={()=>onPage(p)}>{p}</button>
      )}
      <button className="page-btn" disabled={page===totalPages} onClick={()=>onPage(page+1)}>›</button>
      {!isMob && <span className="page-info">{(page-1)*perPage+1}–{Math.min(page*perPage,total)} {lang==='ru'?'из':'/'} {total}</span>}
      <select className="perpage-select" value={perPage} onChange={e=>{onPerPage(+e.target.value);onPage(1)}}>
        {[10,20,50,100].map(n=><option key={n} value={n}>{n} {lang==='ru'?'на стр.':lang==='es'?'/ pág.':'/ page'}</option>)}
      </select>
    </div>
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
            onClick={()=>p.url&&window.open(p.url,'_blank')}
            onMouseEnter={e => openItem(i, e.currentTarget)}>
            <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16,flexShrink:0,paddingTop:10}}>{i+1}</span>
            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--red)',flexShrink:0,
              overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:700,color:'#fff',marginTop:2}}>
              {p.avatar
                ? <img src={p.avatar} alt="" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={avatarError}/>
                : initial}
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


// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { posts, meta, leaderboards, loading, error, newPostIds, refresh, clearNewPosts } = usePostsData()
  const [activeTab, setActiveTab] = useState('feed')
  const [lightbox,  setLightbox]  = useState(null)
  const [theme, setTheme] = usePersistentState('rpt_theme', 'dark', {
    serialize: String,
    deserialize: (raw) => raw || 'dark',
  })
  const [lang, setLang] = usePersistentState('rpt_lang', DEFAULT_LANG, {
    serialize: String,
    deserialize: (raw) => raw || DEFAULT_LANG,
  })
  const t = createTranslator(lang)
  const appVersionLabel = `v${String(__APP_VERSION__).replace(/\.0$/, '')}`
  const [sortBy, setSortBy] = usePersistentState('rpt_sortby', 'date_asc', {
    serialize: String,
    deserialize: (raw) => raw || 'date_asc',
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
  _lang = lang
  _translate = t
  useEffect(() => { if (lang !== DEFAULT_LANG && activeTab !== 'feed') setActiveTab('feed') }, [lang, activeTab])

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
    const sub = hist.filter(h => (h.timestamp || 0) >= cutoff)
    if (sub.length < 2) return null
    const positive = sub.filter(h => (h.sessionResult || 0) > 0).length
    const totalMTT = sub.reduce((s, h) => s + (h.tournaments || 0), 0)
    const avgMTT = totalMTT ? Math.round(totalMTT / sub.length) : null
    const profit = sub.reduce((s, h) => s + (h.sessionResult || 0), 0)
    return {
      sessionsCount: sub.length,
      positiveSessions: positive,
      winRate: positive / sub.length,
      avgMTT,
      profit,
    }
  }, [meta, chartPeriod])

  const passesLikeRating = (p) => {
    if (favorites.has(p.author)) return true
    if (minLikes  && (p.likes||0)  < minLikes)  return false
    if (minRating && (p.rating||0) < minRating) return false
    return true
  }
  const passesIgnored = (p) => !ignored.has(p.author)
  const passesFeedFilters = (p) => {
    const isRomeoPost = ROMEO_RE.test(p.author)

    if (lang !== 'ru') return isRomeoPost
    if (ignored.has(p.author)) return false
    if (romeoOnly && !isRomeoPost) return false
    if (favorites.has(p.author)) return true
    if (search && !p.text?.toLowerCase().includes(search.toLowerCase())) return false
    return passesLikeRating(p)
  }

  // hotPosts — для сайдбара "Больше всего плюсиков"
  const hotPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author)) // top list never shows ignored
      .filter(p => favorites.has(p.author) || (!minRating || (p.rating||0) >= minRating))
      .filter(p => favorites.has(p.author) || (p.likes||0) >= Math.max(minLikes, 1))
      .sort((a,b) => (b.likes||0) - (a.likes||0))
  , [posts, ignored, favorites, minLikes, minRating])

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
  [posts, favorites, ignored, lang, minLikes, minRating, romeoOnly, search, sortBy])

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
  const pagedPosts = feedPosts.slice((page-1)*perPage, page*perPage)

  const goPage = p => {
    setPage(p)
    const filterBar = document.querySelector('.filter-bar')
    if (filterBar) {
      const top = filterBar.getBoundingClientRect().top + window.scrollY - 60
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
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
      window.scrollTo({ top: target, behavior: 'smooth' })
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
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt=""/>
        </div>
      )}


      <div className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            <div className="logo-badge" style={{padding:0,width:32,height:32,overflow:'hidden',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <img src="https://www.gipsyteam.ru/apple-touch-icon.png" alt="GT"
                referrerPolicy="no-referrer" style={{width:32,height:32,objectFit:'contain',borderRadius:6}}
                onError={e=>{e.target.style.display='none'}}/>
            </div>
            <div>
              <div className="logo-text">RomeoPro Marathon</div>
              <div className="logo-sub">{t('marathon_sub')}</div>
            </div>
          </div>
          <div className="topbar-tabs">
            {(lang==='ru' ? [['feed',t('tab_feed')],['settings',t('tab_settings')]] : [['feed',t('tab_feed')]]).map(([id,label])=>(
              <div key={id} className={`topbar-tab ${activeTab===id?'active':''}`} onClick={()=>switchTab(id)}>{label}</div>
            ))}
          </div>
          <div className="topbar-right">
            <button className="theme-toggle" onClick={()=>setTheme(tv=>tv==='dark'?'light':'dark')}
              title={theme==='dark'?t('theme_light'):t('theme_dark')}>
              {theme==='dark'?'☀️':'🌙'}
            </button>
            <div className="lang-switch" role="group" title={t('lang_title')}>
              {['ru','en','es'].map(code => (
                <button key={code}
                  className={'lang-switch-btn'+(lang===code?' active':'')}
                  onClick={()=>setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

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
                            const r = Math.round(dollarPerMTT * 2) / 2
                            return (Number.isInteger(r) ? r : r.toFixed(1)) + `$/${t('sr_mtt_short')}`
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
        <div className={`page ${activeTab==='settings'?'wide':''}`}>
          <div>
            {/* HERO */}
            <div className="hero">
              <div className="hero-top">
                <div className="hero-avatar">
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
                    {fmtBR(stats.profit)}
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
            </div>

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
                      fmtBR(pv), !pv?'':pv>=0?'green':'red']
                  })(),
                  [t('sr_day'), `#${stats.day||meta?.day||'—'}`, 'gold'],
                  [t('sr_mtt_short'), fmtInt(meta?.totalTournaments ?? 3565), ''],
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
              <LeaderboardsWidget snapshot={leaderboards} lang={lang} t={t}/>
              <PaceWidget meta={meta} stats={stats} period={chartPeriod} setPeriod={setChartPeriod} lang={lang} t={t}/>
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
                          <button key={k} onClick={()=>setSidebarTopPeriod(k)}
                            className={`mobile-top-period ${sidebarTopPeriod===k?'active':''}`}>
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
              <div className="sblock">
                <div className="sblock-title">🚫 {t('settings_ignored_authors')}</div>
                {ignored.size===0
                  ? <div className="ignore-empty">{t('settings_ignored_empty')}</div>
                  : <div className="ignore-list">
                      {[...ignored].map(n=>(
                        <div key={n} className="ignore-item">
                          <span>{n}</span>
                          <button className="ignore-remove" onClick={()=>removeIgnore(n)}>✕</button>
                        </div>
                      ))}
                    </div>
                }
                <div className="ignore-add">
                  <input className="ignore-input" placeholder={t('settings_add_author')}
                    value={ignoreInput} onChange={e=>setIgnoreInput(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&addIgnore(ignoreInput)}/>
                  <button className="btn-sm" onClick={()=>addIgnore(ignoreInput)}>{t('settings_add_btn')}</button>
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          {activeTab!=='settings' && (
            <div className="sidebar">
              <div className="sblock">
                <div className="sblock-title">📊 {t('stats')}</div>
                <div className="sblock-body">
                  {[
                    [t('sr_day'), <span key="d" className="srow-val gold">#{stats.day||meta?.day||'—'}</span>],
                    [t('sr_tourneys'), <span key="mtt" className="srow-val">{fmtInt(meta?.totalTournaments ?? 3565)}</span>],
                    (periodStats?.avgMTT ?? stats.avgMTT) != null && [
                      t('sr_avg') + (periodStats?.avgMTT != null ? '*' : ''),
                      <span key="avg" className="srow-val" title={periodStats?.avgMTT != null ? `${t('for_period')} ${t(chartPeriod==='week'?'period_week':'period_month').toLowerCase()}` : undefined}>
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
                            <button key={k} onClick={()=>setSidebarTopPeriod(k)}
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
                        <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--dim)',fontSize:11,padding:0}} onClick={()=>removeIgnore(n)}>✕</button>
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
            </div>
          )}
        </div>
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
                {t('footer_updated')}: 19.04.2026
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
                const fmt = (ts) => {
                  const d = new Date(ts)
                  const sameDay = d.toDateString() === new Date().toDateString()
                  const time = d.toLocaleTimeString(loc, { hour:'2-digit', minute:'2-digit' })
                  return sameDay
                    ? `${t('footer_today_at')} ${time}`
                    : `${d.toLocaleDateString(loc,{day:'2-digit',month:'2-digit'})} ${t('footer_at')} ${time}`
                }
                const mins = Math.round((Date.now() - scrapeTs) / 60000)
                const fresh = mins < 20
                const stale = mins > 90
                const color = fresh ? '#4caf5099' : stale ? '#ff525299' : '#998866'
                return (
                  <>
                    <div style={{fontSize:10,color,marginTop:3,fontFamily:"'Roboto Mono',monospace"}}
                      title={new Date(scrapeTs).toLocaleString(loc)}>
                      <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:color,marginRight:5,verticalAlign:'middle'}}/>
                      {t('footer_scraper_ran')}: {fmt(scrapeTs)}
                    </div>
                    {newestPostTs > 0 && (
                      <div style={{fontSize:10,color:'var(--dim)',marginTop:2,fontFamily:"'Roboto Mono',monospace",paddingLeft:11}}
                        title={new Date(newestPostTs).toLocaleString(loc)}>
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
