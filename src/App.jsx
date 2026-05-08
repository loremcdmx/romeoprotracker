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
  const [pathLen, setPathLen] = useState(null)
  const setPeriodPersist = (p) => {
    setPeriod(p)
  }
  const pathRef = useRef(null)
  const chartRef = useRef(null)
  const isMobile = useIsMobile()
  const { announceOpen: announceHoverPopupOpen } = useExclusiveHoverPopup(() => setTip(null))

  // Close tooltip on click outside chart
  useEffect(() => {
    if (!tip) return
    const handler = (e) => {
      if (chartRef.current && !chartRef.current.contains(e.target)) setTip(null)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [tip])

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
  }, [points.length])

  const W = isMobile ? 520 : 700
  const H = isMobile ? 400 : 240
  const pL = isMobile ? 48 : 52
  const pR = isMobile ? 16 : 20
  const pT = isMobile ? 18 : 14
  const pB = isMobile ? 62 : 44
  const dataMin = Math.min(...points.map(p=>p.br), startBR)
  const dataMax = Math.max(...points.map(p=>p.br), startBR)
  const minV = Math.max(0, Math.floor(dataMin * 0.7 / 1000) * 1000)
  const maxV = dataMax * 1.05
  const yOf  = v => pT + (1-(v-minV)/(maxV-minV)) * (H-pT-pB)

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
  const areaPath = makeBezierArea(coords, H - pB)
  // Y ticks: ~4 evenly spaced round values
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

  // ── Mobile: long-press (300ms) to show tooltip ──
  const longPressTimer = useRef(null)
  const handleTouchStart = e => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const tx = (touch.clientX - rect.left) * (W / rect.width)
    const sy = touch.clientY
    longPressTimer.current = setTimeout(() => {
      let nearest=0, minD=Infinity
      coords.forEach((c,i) => { const d=Math.abs(c.x-tx); if(d<minD){minD=d;nearest=i} })
      const p = points[nearest]
      announceHoverPopupOpen()
      setTip({ p, profit:p.br-p.brPrev, x:coords[nearest].x, y:coords[nearest].y, screenY: sy })
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
    <div className="marathon-chart" ref={chartRef} onClick={tip?()=>setTip(null):undefined}>
      <div className="section-head" style={{marginBottom:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span className="section-title">{t('chart_marathon')}</span>
        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          {[['week',t('period_week')],['month',t('period_month')],['all',t('period_all')]].map(([k,label])=>(
            <button key={k} onClick={()=>setPeriodPersist(k)}
              style={{
                background: period===k?'var(--red)':'var(--bg3)',
                border:'1px solid '+(period===k?'var(--red)':'var(--border2)'),
                borderRadius:4,
                color: period===k?'#fff':'var(--dim2)',
                fontSize:10,
                padding:'3px 8px',
                cursor:'pointer',
                fontFamily:'inherit',
                fontWeight:600,
                textTransform:'uppercase',
                letterSpacing:'.04em',
              }}>
              {label}
            </button>
          ))}
        </div>
        <span className="section-count">{plSessions(points.length, lang)}</span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H+pB}`}
        onMouseLeave={(e)=>{
          // Don't close tooltip if mouse moved to the tooltip itself
          const related = e.relatedTarget
          if (related && chartRef.current?.contains(related)) return
          setTip(null)
        }}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        style={{touchAction:'pan-y',WebkitUserSelect:'none',userSelect:'none',WebkitTouchCallout:'none'}}>
        <defs>
          <linearGradient id="mcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ff6b6b" stopOpacity=".45"/>
            <stop offset="70%"  stopColor="#ff6b6b" stopOpacity=".08"/>
            <stop offset="100%" stopColor="#ff6b6b" stopOpacity="0"/>
          </linearGradient>
          <filter id="mcGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {yTicks.map(({v,y},i) => (
          <g key={i}>
            <line x1={pL} y1={y} x2={W-pR} y2={y} className="mc-grid"/>
            <text x={pL-5} y={y+3} className="mc-ylabel">{v >= 1000 ? `$${v/1000%1===0?(v/1000)+'k':(v/1000).toFixed(1)+'k'}` : `$${v}`}</text>
          </g>
        ))}
        <line x1={pL} y1={yOf(startBR)} x2={W-pR} y2={yOf(startBR)} className="mc-zero"/>
        <path d={areaPath} fill="url(#mcGrad)"/>
        <path ref={pathRef} d={linePath} fill="none" stroke="#ff6b6b" strokeWidth={isMobile ? 3.2 : 2.5}
          strokeLinecap="round" strokeLinejoin="round" filter="url(#mcGlow)"
          style={pathLen!=null ? {
            strokeDasharray: pathLen,
            strokeDashoffset: 0,
            animation: 'drawLine 1.4s cubic-bezier(.4,0,.2,1) forwards',
          } : {}}
        />
        {/* Pick evenly spaced labels with minimum gap enforcement */}
        {(() => {
          // Precompute which points get labels: ~8 evenly spaced, min 55px apart
          const labelSet = new Set([0, points.length - 1])
          const totalW = coords.length > 1 ? coords[coords.length-1].x - coords[0].x : 0
          if (totalW > 0) {
            const nLabels = Math.min(8, points.length)
            const step = totalW / (nLabels - 1)
            for (let s = 1; s < nLabels - 1; s++) {
              const targetX = coords[0].x + s * step
              let bestIdx = -1, bestDist = Infinity
              for (let j = 1; j < points.length - 1; j++) {
                const d = Math.abs(coords[j].x - targetX)
                if (d < bestDist) { bestDist = d; bestIdx = j }
              }
              if (bestIdx >= 0) labelSet.add(bestIdx)
            }
          }
          // Remove labels that are too close to neighbors (min 55px gap)
          const sorted = [...labelSet].sort((a,b) => a - b)
          const finalLabels = new Set()
          let prevX = -Infinity
          for (const idx of sorted) {
            if (coords[idx].x - prevX >= 55 || idx === points.length - 1) {
              // For the last point, remove previous if too close
              if (idx === points.length - 1 && coords[idx].x - prevX < 55) {
                for (const prev of [...finalLabels].reverse()) {
                  if (prev !== 0) { finalLabels.delete(prev); break }
                }
              }
              finalLabels.add(idx)
              prevX = coords[idx].x
            }
          }
          return points.map((p,i) => ({ p, i, showL: finalLabels.has(i) }))
        })().map(({ p, i, showL }) => {
          const isLast = i===points.length-1
          const cx=coords[i].x, cy=coords[i].y, profit=p.br-p.brPrev
          const isHovered = tip?.p === p
          const dotR = isMobile
            ? (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : 3.6))
            : (isHovered ? (isLast ? 8 : 6) : (isLast ? 6 : 4))
          return (
            <g key={i}>
              {!isMobile && <circle cx={cx} cy={cy} r={isLast?14:10} fill="transparent"
                onMouseEnter={()=>{
                  announceHoverPopupOpen()
                  setTip({p,profit,x:cx,y:cy})
                }}/>}
              <circle cx={cx} cy={cy} r={dotR}
                className={isLast?'mc-dot mc-dot-last':'mc-dot'}
                fill={profit>=0?'#4caf50':'#e53935'}
                style={{transition:'r .12s', ...(isLast?{color:profit>=0?'#4caf50':'#e53935'}:{})}}/>
              {showL && (() => {
                const lx = Math.min(Math.max(cx,pL),W-pR)
                return (
                  <g>
                    <line x1={lx} y1={cy + (isLast?6:4) + 3} x2={lx} y2={H+pB-32}
                      stroke="var(--border2)" strokeWidth="1" strokeDasharray="1 3" opacity="0.55"/>
                    <text x={lx} y={H+pB-22} textAnchor="middle" fontFamily="'Roboto Mono',monospace"
                      fontSize="11" fontWeight="600" fill="var(--dim)">
                      {cumMTT[i] ? fmtInt(cumMTT[i]) : '—'}
                    </text>
                    <text x={lx} y={H+pB-8} textAnchor="middle" fontFamily="'Roboto Mono',monospace"
                      fontSize="8" fill="var(--dim)">
                      {fmtDateShortLang(p.timestamp, lang)}
                    </text>
                  </g>
                )
              })()}
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
        } : {
          position:'absolute',
          bottom:(H-tip.y+24)+'px',
          left:right?'auto':`calc(${pct}% - 8px)`,
          right:right?`calc(${100-pct}% - 8px)`:'auto',
        }
        return (
          <div className="mc-tooltip" style={{...mobileStyle, position: isMobile ? 'fixed' : 'absolute', pointerEvents: isMobile ? 'auto' : 'none'}}
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
              <span style={{cursor:'pointer'}} onClick={()=>setTip(null)}>{t('close')}</span>
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
              {labelSet.has(i) && <text x={x+bw/2} y={H+16} className="chart-label">{date.slice(5)}</text>}
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
  const { posts, meta, loading, error, newPostIds, refresh, clearNewPosts } = usePostsData()
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

  // ── КЛАССИФИКАЦИЯ ПО ТЕМАМ ──────────────────────────────────────────────
  const TAG_RULES = [
    { id:'staking',    icon:'💰', label:t('tc_staking'),    re:/стейкинг|стейк|бекинг|бек\b|доли\b|доля\b|продаж.*дол|конюшн|инвестор|инвестиц|кэф.*дол/i },
    { id:'debt',       icon:'🔴', label:t('tc_debt'),       re:/долг|должен|кредит|занял|отдаст|должник/i },
    { id:'money',      icon:'💵', label:t('tc_money'),      re:/банкролл|\bбр\b|депозит|вывод|кэшаут|cashout|10\s*млн|миллион|проигрыш|выигрыш|прибыль|убыт/i },
    { id:'strategy',   icon:'📊', label:t('tc_strategy'),   re:/стратег|рои\b|roi\b|abi\b|аби\b|скилл|brm|эдж|солвер|ренж|рейнж|префлоп|постфлоп|\bev\b|рейк|ракебек|загрузк/i },
    { id:'variance',   icon:'🎲', label:t('tc_variance'),   re:/дисперси|даунстрик|апстрик|свинг|вариан/i },
    { id:'psychology', icon:'🧠', label:t('tc_psychology'), re:/психолог|тилт\b|tilt\b|эмоц|дисциплин|мышлени|менталь|мотивац|выгоран|депресс|стресс/i },
    { id:'mtt',        icon:'🏆', label:t('tc_mtt'),        re:/мтт|турнир|mystery|мистери|баунти|фризаут|сателлит/i },
    { id:'rooms',      icon:'🏷', label:t('tc_rooms'),      re:/\bgg\b|pokerstars|\bps\b|старз|покерок|покерки|king|кинг|coin|coinpoker|ipoker|partypoker|winamax|888poker/i },
    { id:'content',    icon:'📺', label:t('tc_content'),    re:/стрим|твич|twitch|ютуб|youtube|подкаст|видео|контент|блог|донат/i },
    { id:'chess',      icon:'♟',  label:t('tc_chess'),      re:/шахмат|гнат\b|gnat\b|фишер.*шахмат|карлсен/i },
    { id:'life',       icon:'🏠', label:t('tc_life'),       re:/жизн|семь[яи]|жен[аеыщ]|муж\b|дет[яиейс]|ребен|здоров|работ[аеу]|карьер|образован|универ|учеб/i },
    { id:'live',       icon:'🎰', label:t('tc_live'),       re:/офлайн|оффлайн|кеш\s*гейм|cash.*game|живая.*игр|живой.*покер|казино|вегас|серия\b/i },
    { id:'critique',   icon:'⚡', label:t('tc_critique'),   re:/хайп|развод|скам|скептич|не\s*верю|обман|фейк|пиар\b|нерельно|мечт|утопи/i },
    { id:'goal',       icon:'🎯', label:t('tc_goal'),       re:/успеет|не\s*успеет|дойдёт|дойдет|не\s*дойд|прогноз|шансы|ставк.*на/i },
  ]

  const detectTags = (text) => {
    const tags = []
    TAG_RULES.forEach(r => { if (r.re.test(text)) tags.push(r.id) })
    return tags
  }

  const classifiedPosts = useMemo(() => {
    const empty = { marathon:[], discussion:[], debate:[], highlikes:[], byTag:{}, authorStats:[] }
    if (!posts.length) return empty
    const result = { marathon:[], discussion:[], debate:[], highlikes:[], byTag:{}, authorStats:[] }
    TAG_RULES.forEach(r => { result.byTag[r.id] = [] })
    const byAuthor = new Map() // author -> { count, likes, posts:[] }

    posts.forEach(p => {
      if (!passesIgnored(p)) return
      if (!passesLikeRating(p)) return
      if (search && !p.text?.toLowerCase().includes(search.toLowerCase())) return
      const text = p.text || ''
      const likes = p.likes || 0
      const tags = detectTags(text)
      const tagged = { ...p, _tags: tags }

      if (ROMEO_RE.test(p.author)) {
        result.marathon.push(tagged)
      } else {
        // Про Ромео — обсуждения с упоминанием
        if (ROMEO_RE.test(text) && (text.length > 80 || likes >= 5)) {
          result.discussion.push(tagged)
        }
        // Дебаты — длинный качественный контент
        if (text.length > 300 && likes >= 20) {
          result.debate.push(tagged)
        }
        // Хайлайты — посты с ≥10 лайков от не-Ромео (короткие вайбы тоже ок)
        if (likes >= 10) {
          result.highlikes.push(tagged)
        }
        // Статистика авторов
        const a = byAuthor.get(p.author) || { count:0, likes:0, posts:[] }
        a.count++; a.likes += likes; a.posts.push(tagged)
        byAuthor.set(p.author, a)
      }

      // Теги — пост может попасть в несколько тегов
      tags.forEach(tag => {
        if (result.byTag[tag]) result.byTag[tag].push(tagged)
      })
    })

    result.marathon.sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
    result.discussion.sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
    result.debate.sort((a,b) => (b.likes||0)-(a.likes||0))
    result.highlikes.sort((a,b) => (b.likes||0)-(a.likes||0))
    TAG_RULES.forEach(r => {
      result.byTag[r.id].sort((a,b) => (b.likes||0)-(a.likes||0))
    })

    // Топ-авторы (≥3 постов или ≥10 суммарных лайков), сортировка по суммарным лайкам
    result.authorStats = [...byAuthor.entries()]
      .map(([name, v]) => ({ name, count:v.count, likes:v.likes, posts:v.posts.sort((a,b)=>(b.likes||0)-(a.likes||0)) }))
      .filter(a => a.count >= 3 || a.likes >= 10)
      .sort((a,b) => b.likes - a.likes)

    return result
  }, [posts, ignored, favorites, minLikes, minRating, search])

  const [topicTab, setTopicTab] = useState('marathon')
  const [topicPage, setTopicPage] = useState(1)
  const [topicTag, setTopicTag] = useState(null)
  const [topicSortByRaw, setTopicSortBy] = usePersistentState('rpt_topic_sortby', 'date_desc', {
    serialize: String,
    deserialize: (raw) => raw || 'date_desc',
  })
  const TOPIC_PER_PAGE = 20

  const currentTopicPosts = useMemo(() => {
    let all
    if (topicTab === 'tags' && topicTag) {
      all = [...(classifiedPosts.byTag[topicTag] || [])]
    } else {
      all = [...(classifiedPosts[topicTab] || [])]
    }
    if (topicSortByRaw === 'date_asc')  all.sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
    else if (topicSortByRaw === 'likes') all.sort((a,b) => (b.likes||0) - (a.likes||0))
    else all.sort((a,b) => (b.timestamp||0) - (a.timestamp||0))
    return {
      all,
      paged: all.slice((topicPage-1)*TOPIC_PER_PAGE, topicPage*TOPIC_PER_PAGE),
      totalPages: Math.max(1, Math.ceil(all.length / TOPIC_PER_PAGE))
    }
  }, [classifiedPosts, topicTab, topicTag, topicPage, topicSortByRaw])

  const goTopicPage = p => {
    setTopicPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
    setTopicPage(1)
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
            {(lang==='ru' ? [['feed',t('tab_feed')],['topics',t('tab_topics')],['settings',t('tab_settings')]] : [['feed',t('tab_feed')]]).map(([id,label])=>(
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
        const target = 10_000_000
        const start  = stats.startBR || 10000
        const raw = stats.br / target * 100
        const pct = Math.max(0, Math.min(100, raw))
        const remaining = Math.max(0, target - stats.br)

        // Темп зависит от выбранного периода графика:
        //   week  → $/MTT за последние 7 дней сессий
        //   month → за последние 30 дней
        //   all   → за весь марафон (как раньше)
        const hist = meta?.brHistory
        let periodProfit = null, periodMTT = null
        if (hist?.length) {
          if (chartPeriod === 'all') {
            periodProfit = stats.br - start
            periodMTT    = stats.totalTourneys || meta?.totalTournaments || null
          } else {
            const now = Date.now() / 1000
            const cutoff = chartPeriod === 'week' ? now - 7*86400 : now - 30*86400
            const sorted = [...hist].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))
            const insideIdx = sorted.findIndex(h => (h.timestamp||0) >= cutoff)
            if (insideIdx >= 0) {
              const firstInside = sorted[insideIdx]
              const baseBR = insideIdx === 0 ? start : sorted[insideIdx-1].brAfter
              const lastBR = sorted[sorted.length-1].brAfter
              periodProfit = lastBR - baseBR
              periodMTT = sorted.slice(insideIdx).reduce((s,h)=>s+(h.tournaments||0), 0) || null
              if (!periodMTT) {
                // fallback: delta of cumulative totalTournaments
                const baseTotal = insideIdx === 0 ? 0 : (sorted[insideIdx-1].totalTournaments||0)
                const lastTotal = sorted[sorted.length-1].totalTournaments||0
                periodMTT = Math.max(0, lastTotal - baseTotal) || null
              }
            }
          }
        }
        const isLosing = periodProfit != null && periodProfit < 0 && periodMTT > 0
        const mttNeeded = (periodProfit > 0 && periodMTT)
          ? Math.ceil(remaining * periodMTT / periodProfit)
          : null
        const mttToBust = isLosing
          ? Math.ceil(stats.br * periodMTT / Math.abs(periodProfit))
          : null
        const dollarPerMTT = (periodMTT && periodProfit != null && periodProfit !== 0)
          ? periodProfit / periodMTT
          : null
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
                <div className="marathon-progress-track">
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

            {/* ТЕМЫ */}
            {activeTab==='topics' && (() => {
              const MAIN_TABS = [
                { id:'marathon',   icon:'📈', label:t('topic_marathon'),   desc:t('topic_marathon_desc') },
                { id:'discussion', icon:'💬', label:t('topic_discussion'), desc:t('topic_discussion_desc') },
                { id:'debate',     icon:'🔥', label:t('topic_debate'),     desc:t('topic_debate_desc') },
                { id:'highlikes',  icon:'⭐', label:t('topic_highlikes'),  desc:t('topic_highlikes_desc') },
                { id:'authors',    icon:'👥', label:t('topic_authors'),    desc:t('topic_authors_desc') },
                { id:'tags',       icon:'🏷', label:t('topic_tags'),       desc:t('topic_tags_desc') },
              ]
              const { paged, totalPages: tpg, all } = currentTopicPosts
              const isTagMode = topicTab === 'tags'
              const isAuthorsMode = topicTab === 'authors'
              const activeTagRule = isTagMode && topicTag ? TAG_RULES.find(r=>r.id===topicTag) : null
              return <>
                <FilterBar
                  sortBy={topicSortByRaw} setSortBy={setTopicSortBy}
                  search={search} setSearch={setSearch}
                  showSearch={showSearch} setShowSearch={setShowSearch}
                  romeoOnly={false} setRomeoOnly={()=>{}}
                  minLikes={minLikes} setMinLikes={setMinLikes}
                  minRating={minRating} setMinRating={setMinRating}
                  count={all.length} showSort={true} t={t} lang={lang}
                />
                {/* Основные разделы */}
                <div className="topic-tabs">
                  {MAIN_TABS.map(mt => (
                    <div key={mt.id}
                      className={`topic-tab ${topicTab===mt.id?'active':''}`}
                      onClick={()=>{ setTopicTab(mt.id); setTopicPage(1); setTopicTag(mt.id==='tags' ? TAG_RULES[0].id : null) }}>
                      {mt.icon} {mt.label}
                      <span className="tc">{
                        mt.id === 'tags'
                          ? Object.values(classifiedPosts.byTag).reduce((s,a)=>s+a.length, 0)
                          : mt.id === 'authors'
                            ? (classifiedPosts.authorStats?.length || 0)
                            : (classifiedPosts[mt.id]?.length || 0)
                      }</span>
                    </div>
                  ))}
                </div>

                {/* Теги — сетка тем */}
                {isTagMode && (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',margin:'8px 0',padding:'2px 0'}}>
                    {TAG_RULES.map(r => {
                      const count = classifiedPosts.byTag[r.id]?.length || 0
                      if (!count) return null
                      const active = topicTag === r.id
                      return (
                        <button key={r.id} onClick={()=>{ setTopicTag(r.id); setTopicPage(1) }}
                          style={{
                            background: active ? 'var(--red)' : 'var(--bg3)',
                            border: '1px solid ' + (active ? 'var(--red)' : 'var(--border)'),
                            borderRadius:20, color: active ? '#fff' : 'var(--dim2)',
                            fontSize:11, padding:'5px 12px', cursor:'pointer', fontFamily:'inherit',
                            transition:'all .15s', whiteSpace:'nowrap', flexShrink:0,
                          }}>
                          {r.icon} {r.label} <span style={{opacity:.6,fontSize:10}}>{count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Описание */}
                <div style={{fontSize:12,color:'var(--dim)',marginBottom:10}}>
                  {isTagMode
                    ? (activeTagRule ? `${activeTagRule.icon} ${activeTagRule.label}` : t('topics_select_topic'))
                    : isAuthorsMode
                      ? `${t('topics_top_contributors')} (${classifiedPosts.authorStats?.length||0})`
                      : MAIN_TABS.find(mt=>mt.id===topicTab)?.desc
                  }{!isAuthorsMode && ` · ${plPosts(all.length, lang)}`}
                </div>

                {/* Авторы-режим */}
                {isAuthorsMode
                  ? ((classifiedPosts.authorStats?.length||0)===0
                      ? <div className="empty-state">{t('topics_no_data')}</div>
                      : <AuthorsPanel authors={classifiedPosts.authorStats}
                          favorites={favorites}
                          onFav={toggleFav} onIgnore={addIgnore}
                          setLightbox={setLightbox} t={t}/>)
                  : all.length===0
                  ? <div className="empty-state">{isTagMode && !topicTag ? t('topics_select_topic_above') : t('topics_no_posts')}</div>
                  : <>
                    <Paginator page={topicPage} totalPages={tpg} onPage={goTopicPage}
                      perPage={TOPIC_PER_PAGE} onPerPage={()=>{}} total={all.length}/>
                    {paged.map(p=>(
                      <PostCard key={p.id||p.url} p={p}
                        favorites={favorites} onFav={toggleFav}
                        onIgnore={addIgnore} setLightbox={setLightbox}
                        noClamp={topicTab==='marathon'}
                        tags={p._tags && isTagMode ? p._tags.filter(tid=>tid!==topicTag).map(tid=>TAG_RULES.find(r=>r.id===tid)).filter(Boolean) : null} lang={lang}/>
                    ))}
                    <Paginator page={topicPage} totalPages={tpg} onPage={goTopicPage}
                      perPage={TOPIC_PER_PAGE} onPerPage={()=>{}} total={all.length}/>
                  </>
                }
              </>
            })()}

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
              {lang==='ru' && <ActivityChart posts={posts}
                favorites={favorites} ignored={ignored} onFav={toggleFav}
                onIgnore={addIgnore} onUnignore={removeIgnore} setLightbox={setLightbox}
                minLikes={minLikes}
                minRating={minRating}
                search={search} onPostClick={goToPost} lang={lang} t={t}/>}
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
                    [t('sr_br'), <span key="br" className={`srow-val ${stats.br?'green':''}`}>{fmtExact(stats.br||meta?.bankroll)}</span>],
                    (() => {
                      const pv = periodStats?.profit ?? stats.profit
                      return [t('sr_profit') + (periodStats?.profit != null ? '*' : ''),
                        <span key="pr" className={`srow-val ${!pv?'':pv>=0?'green':'red'}`}
                          title={periodStats?.profit != null ? `${t('for_period')} ${t(chartPeriod==='week'?'period_week':'period_month').toLowerCase()}` : undefined}>{fmtBR(pv)}</span>]
                    })(),
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
