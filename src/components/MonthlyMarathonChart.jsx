import { memo, useEffect, useMemo, useState } from 'react'
import { fmtInt, fmtExact, fmtExactSigned, warsawParts } from '../utils.js'
import { fmtDateShortLang } from '../i18n.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { groupMarathonMonths } from '../marathonMonths.js'
import MarathonChartControls from './MarathonChartControls.jsx'

const MONTHS = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}
const compactMTT = value => value == null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : String(value)
const monthNumber = point => Number(point.year) * 12 + point.month - 1
const monthName = (point, lang) => new Intl.DateTimeFormat(lang, { month:'long', year:'numeric', timeZone:'Europe/Warsaw' }).format(new Date(point.timestamp * 1000))

export default memo(function MonthlyMarathonChart({ allPoints, period, setPeriod, grouping, setGrouping, lang, t, light }) {
  const isMobile = useIsMobile()
  const normalized = allPoints
  const months = useMemo(() => {
    const cutoff = Date.now() / 1000 - (period === 'week' ? 7 : 30) * 86400
    return groupMarathonMonths(period === 'all' ? normalized : normalized.filter(point => point.timestamp >= cutoff))
  }, [normalized, period])
  const [activeKey, setActiveKey] = useState(null)
  useEffect(() => setActiveKey(null), [months])
  const active = months.find(point => point.key === activeKey) || months.at(-1)
  const today = warsawParts(Date.now() / 1000)
  const cutoffParts = warsawParts(Date.now() / 1000 - (period === 'week' ? 7 : 30) * 86400)
  const isCurrent = point => today && Number(point.year) === Number(today.year) && point.month === today.month
  const isPartial = point => isCurrent(point) || (period !== 'all' && cutoffParts && monthNumber(point) === monthNumber(cutoffParts))
  const W = isMobile ? 360 : 700
  const H = isMobile ? 405 : 335
  const left = isMobile ? 48 : 58
  const right = W - 18
  const top = 20
  const plotBottom = isMobile ? 225 : 190
  const volumeTop = isMobile ? 293 : 257
  const volumeBottom = isMobile ? 369 : 309
  const first = months[0]
  const last = months.at(-1)
  const monthSpan = first && last ? monthNumber(last) - monthNumber(first) + 1 : 1
  const cellWidth = (right - left) / monthSpan
  const x = point => left + (monthNumber(point) - monthNumber(first) + .5) * cellWidth
  const values = months.length ? [first.brPrev, ...months.map(point => point.br)] : [0, 1]
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const range = Math.max(1000, dataMax - dataMin)
  const min = Math.max(0, dataMin - range * .12)
  const max = dataMax + range * .12
  const y = value => top + (max - value) / Math.max(1, max - min) * (plotBottom - top)
  const niceStep = value => {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)))
    return ([1, 2, 5, 10].find(step => step * magnitude >= value) || 10) * magnitude
  }
  const tickStep = niceStep((max - min) / 5)
  const ticks = []
  for (let value = Math.ceil(min / tickStep) * tickStep; value < max; value += tickStep) ticks.push(value)
  const volumeMax = Math.max(1, ...months.map(point => point.tournaments || 0))
  const barWidth = Math.min(isMobile ? 22 : 30, cellWidth * .52)
  const hasMultipleYears = first && last && first.year !== last.year
  const minLabelGap = hasMultipleYears ? (isMobile ? 58 : 64) : (isMobile ? 36 : 42)
  const labelStride = Math.max(1, Math.ceil(minLabelGap / cellWidth))
  const keptLabels = months.filter((point, index) => index % labelStride === 0 || point === last)
    .filter((point, index, candidates) => point === last || !candidates[index + 1] || x(candidates[index + 1]) - x(point) >= minLabelGap)
  const label = point => `${(MONTHS[lang] || MONTHS.ru)[point.month - 1]}${hasMultipleYears ? ` ${String(point.year).slice(-2)}` : ''}`
  const unit = lang === 'ru' ? 'МТТ' : 'MTT'
  const periodDistance = months.every(point => point.tournaments != null) ? months.reduce((sum, point) => sum + point.tournaments, 0) : null
  const color = profit => profit >= 0 ? (light ? '#2e8b3a' : '#76d982') : (light ? '#c8362e' : '#ff665d')

  return <div className="marathon-chart mc-monthly" data-testid="marathon-monthly-chart">
    <MarathonChartControls {...{period, setPeriod, grouping, setGrouping, t}} count={`${months.length} ${t('chart_months_count')}`}/>
    <p className="mc-view-hint">{t(period === 'all' ? 'chart_month_hint' : 'chart_month_period_hint')}</p>
    {!months.length ? <div className="empty-state">{t('empty_data_scraper')}</div> : <>
      <svg className="mc-svg mc-month-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t('chart_marathon')}: ${t('chart_months')}`}>
        <rect x={left} y={top} width={right - left} height={plotBottom - top} rx="10" className="mc-plot-bg"/>
        {ticks.map(value => <g key={value}>
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="mc-grid"/>
          <text x={left - 10} y={y(value) + 3} className="mc-yaxis-label">{value >= 1000 ? `$${value / 1000}k` : `$${value}`}</text>
        </g>)}
        <line x1={left} x2={right} y1={plotBottom} y2={plotBottom} className="mc-axis-line"/>
        {months.map((point, index) => {
          const previous = months[index - 1]
          return <line key={point.key} className="mc-month-line-segment" data-start-br={point.brPrev} data-end-br={point.br}
            x1={previous ? x(previous) : left} y1={y(previous ? previous.br : point.brPrev)} x2={x(point)} y2={y(point.br)} stroke={color(point.profit)}/>
        })}
        <text x={left} y={volumeTop - 28} className="mc-distance-caption">{t(period === 'all' ? 'chart_month_distance' : 'chart_month_distance_filtered')} · {unit}</text>
        <line x1={left} x2={right} y1={volumeBottom} y2={volumeBottom} className="mc-axis-line"/>
        {months.map(point => {
          const selected = active.key === point.key
          const barHeight = point.tournaments == null ? 0 : point.tournaments / volumeMax * (volumeBottom - volumeTop)
          const showLabel = keptLabels.includes(point)
          return <g key={point.key} className={`mc-month-mark ${selected ? 'selected' : ''}`} role="button" tabIndex="0" data-month-key={point.key}
            aria-label={`${monthName(point, lang)}: ${fmtExact(point.br)}, ${fmtInt(point.tournaments)} ${unit}`}
            aria-pressed={selected} onMouseEnter={() => setActiveKey(point.key)} onFocus={() => setActiveKey(point.key)} onClick={() => setActiveKey(point.key)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveKey(point.key) } }}>
            <rect x={x(point) - cellWidth / 2} y={top} width={cellWidth} height={volumeBottom - top} fill="transparent" className="mc-month-hit"/>
            {selected && <line x1={x(point)} x2={x(point)} y1={top} y2={plotBottom} className="mc-month-guide"/>}
            <circle className="mc-month-dot" cx={x(point)} cy={y(point.br)} r={selected ? 5 : 3.8} fill={color(point.profit)}/>
            <rect className={`mc-month-volume ${isPartial(point) ? 'partial' : ''}`} data-mtt={point.tournaments} x={x(point) - barWidth / 2}
              y={volumeBottom - barHeight} width={barWidth} height={barHeight} rx="2"/>
            {showLabel && <>
              <text x={x(point)} y={plotBottom + 20} textAnchor="middle" className="mc-month-axis-label">{label(point)}</text>
              <text x={x(point)} y={volumeBottom - barHeight - 6} textAnchor="middle" className="mc-volume-label">{compactMTT(point.tournaments)}</text>
            </>}
          </g>
        })}
        <text x={right} y={H - 6} textAnchor="end" className="mc-distance-caption">{t('chart_total_distance')}: {fmtInt(last.totalTournaments)} {unit}</text>
      </svg>
      <div className="mc-month-details" data-testid="marathon-month-details" data-month-key={active.key} data-br={active.br} data-profit={active.profit} data-mtt={active.tournaments} data-total-mtt={active.totalTournaments} aria-live="polite">
        <div className="mc-month-details-head"><b>{monthName(active, lang)}</b><span>{fmtDateShortLang(active.firstTimestamp, lang)} — {fmtDateShortLang(active.lastTimestamp, lang)}{isPartial(active) ? ` · ${t('chart_partial_month')}` : ''}</span></div>
        <dl>
          <div><dt>{t('chart_month_br')}</dt><dd>{fmtExact(active.br)}</dd></div>
          <div><dt>{t('chart_br_change')}</dt><dd className={active.profit >= 0 ? 'mc-month-profit-pos' : 'mc-month-profit-neg'}>{fmtExactSigned(active.profit)}</dd></div>
          <div><dt>{period === 'all' ? t('chart_month_distance') : t('chart_period_distance')}</dt><dd>{fmtInt(active.tournaments)} {unit}</dd></div>
          <div><dt>{t('chart_total_distance')}</dt><dd>{fmtInt(active.totalTournaments)} {unit}</dd></div>
        </dl>
      </div>
      <div className="mc-distance-summary" data-testid="marathon-distance">{t('chart_period_distance')}: <b>{fmtInt(periodDistance)} {unit}</b></div>
    </>}
  </div>
})
