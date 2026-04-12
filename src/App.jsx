import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { fetchPublicData } from './storage.js'
import { Analytics } from '@vercel/analytics/react'
import {
  timeAgo, fmtBR, fmtNum, fmtInt, fmtExact, fmtDateShort, extractDay, extractBR,
  fk, fkAbs, ROMEO_RE, autoCloseQuotes, stripQuoteTags, extractQuoteBody,
  makeBezierPath, makeBezierArea, pl, plural,
} from './utils.js'
import { useIsMobile } from './hooks/useIsMobile.js'
import AnimatedValue, { useTweenValue } from './components/AnimatedValue.jsx'


// ─── HELPERS (imported from utils.js) ────────────────────────────────────────

// Dedup brHistory: consecutive entries with same totalTournaments are the same session
// reported at two states (interim + final). Keep only the final, merge session window.
function dedupBrHistory(hist) {
  if (!hist?.length) return hist
  const sorted = [...hist].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))
  const out = []
  for (const h of sorted) {
    const prev = out[out.length-1]
    const sameSession = prev
      && (h.totalTournaments||0) > 0
      && h.totalTournaments === prev.totalTournaments
    if (sameSession) {
      out[out.length-1] = {
        ...h,
        brBefore: prev.brBefore ?? h.brBefore,
        sessionResult: (h.brAfter||0) - (prev.brBefore ?? h.brBefore ?? 0),
        tournaments: Math.max(prev.tournaments||0, h.tournaments||0),
        _mergedFrom: [...(prev._mergedFrom||[prev.id]).filter(Boolean), h.id].filter(Boolean),
      }
    } else {
      out.push(h)
    }
  }
  return out
}

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

function MarathonChart({ posts, meta, startBR, setLightbox, period, setPeriod }) {
  const [tip, setTip]     = useState(null)
  const [pathLen, setPathLen] = useState(null)
  const setPeriodPersist = (p) => {
    setPeriod(p)
  }
  const pathRef = useRef(null)
  const chartRef = useRef(null)
  const isMobile = useIsMobile()

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

  if (!points.length) return (
    <div className="marathon-chart">
      <div className="section-head"><span className="section-title">📈 График марафона</span></div>
      <div className="empty-state">Данных пока нет — запустите скрапер</div>
    </div>
  )

  const W=700, H=240, pL=52, pR=20, pT=14, pB=44
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

  // ── Mobile: show only significant points (big swings), hide flat stretches ──
  const mobileVisible = useMemo(() => {
    const vis = new Set([0, points.length-1]) // always show first & last
    const brRange = maxV/1.03 - minV/0.97 // un-padded range
    const threshold = brRange * 0.03 // 3% of range = significant move
    for (let i = 1; i < points.length - 1; i++) {
      const delta = Math.abs(points[i].br - points[i].brPrev)
      if (delta >= threshold) { vis.add(i); vis.add(i-1) } // show swing + its predecessor for context
    }
    // Ensure no gap longer than 5 points (keep at least one representative dot)
    let lastVis = 0
    for (let i = 1; i < points.length; i++) {
      if (vis.has(i)) { lastVis = i; continue }
      if (i - lastVis >= 5) { vis.add(i); lastVis = i }
    }
    return vis
  }, [points, minV, maxV])

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
      setTip({ p, profit:p.br-p.brPrev, x:coords[nearest].x, y:coords[nearest].y, screenY: sy })
    }, 300)
  }
  const handleTouchEnd = () => { clearTimeout(longPressTimer.current) }
  const handleTouchMove = () => { clearTimeout(longPressTimer.current) }

  return (
    <div className="marathon-chart" ref={chartRef} onClick={tip?()=>setTip(null):undefined}>
      <div className="section-head" style={{marginBottom:6,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span className="section-title">📈 График марафона</span>
        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          {[['week','Неделя'],['month','Месяц'],['all','Всё время']].map(([k,label])=>(
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
        <span className="section-count">{pl(points.length, ['сессия','сессии','сессий'])}</span>
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
            <stop offset="0%"   stopColor="#e53935" stopOpacity=".45"/>
            <stop offset="70%"  stopColor="#e53935" stopOpacity=".08"/>
            <stop offset="100%" stopColor="#e53935" stopOpacity="0"/>
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
        <path ref={pathRef} d={linePath} fill="none" stroke="#e53935" strokeWidth="2.5"
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
          const showDot = !isMobile || mobileVisible.has(i)
          const isLast = i===points.length-1
          const cx=coords[i].x, cy=coords[i].y, profit=p.br-p.brPrev
          const isHovered = tip?.p === p
          return (
            <g key={i}>
              {!isMobile && <circle cx={cx} cy={cy} r={isLast?14:10} fill="transparent"
                onMouseEnter={()=>setTip({p,profit,x:cx,y:cy})}/>}
              {showDot && <circle cx={cx} cy={cy} r={isHovered?(isLast?8:6):(isLast?6:4)}
                className={isLast?'mc-dot mc-dot-last':'mc-dot'}
                fill={profit>=0?'#4caf50':'#e53935'}
                style={{transition:'r .12s', ...(isLast?{color:profit>=0?'#4caf50':'#e53935'}:{})}}/>}
              {showL && (() => {
                const lx = Math.min(Math.max(cx,pL),W-pR)
                return (
                  <g>
                    <line x1={lx} y1={cy} x2={lx} y2={H+pB-32}
                      stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="2 3"/>
                    <text x={lx} y={H+pB-22} textAnchor="middle" fontFamily="'Roboto Mono',monospace"
                      fontSize="11" fontWeight="600" fill="#888">
                      {cumMTT[i] ? fmtInt(cumMTT[i]) : '—'}
                    </text>
                    <text x={lx} y={H+pB-8} textAnchor="middle" fontFamily="'Roboto Mono',monospace"
                      fontSize="8" fill="#444">
                      {fmtDateShort(p.timestamp)}
                    </text>
                  </g>
                )
              })()}
            </g>
          )
        })}
        {tip && <line x1={tip.x} y1={pT} x2={tip.x} y2={H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3"/>}
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
          <div className="mc-tooltip" style={{...mobileStyle, position: isMobile ? 'fixed' : 'absolute'}}
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
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:5,paddingRight:64}}>{tip.p.date}</div>
            <div style={{display:'flex',gap:12,fontSize:12,marginBottom:tip.p.tournaments?4:roomDeltas.length?8:4}}>
              <span style={{color:'var(--dim)'}}>БР: <b style={{color:'var(--white)'}}>{fkAbs(tip.p.br)}</b></span>
            </div>
            {tip.p.tournaments && (
              <div style={{fontSize:11,color:'var(--dim)',marginBottom:roomDeltas.length?8:4}}>
                🃏 сыграно МТТ с последнего отчёта: <b style={{color:'var(--dim2)'}}>{fmtInt(tip.p.tournaments)}</b>
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
            <div style={{fontSize:10,color:'var(--dim)',marginTop:5,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{cursor:'pointer'}} onClick={()=>setTip(null)}>закрыть</span>
              {tip.p.url && <a href={tip.p.url} target="_blank" rel="noreferrer"
                onClick={e=>e.stopPropagation()}
                style={{color:'var(--red2)',fontSize:11}}>→ форум</a>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}


// ─── ROOM WIDGET ─────────────────────────────────────────────────────────────
// ─── ACTIVITY CHART ───────────────────────────────────────────────────────────

function makeDaySummary(ps) {
  const withAuthor = ps.filter(p => p.author)
  const totalUniq  = new Set(withAuthor.map(p => p.author)).size
  const popular    = ps.filter(p => (p.likes||0) >= 20).sort((a,b) => (b.likes||0)-(a.likes||0))
  const topLikes   = ps.reduce((m,p) => Math.max(m, p.likes||0), 0)
  const romeoCount = ps.filter(p => ROMEO_RE.test(p.author)).length

  const byAuthor = {}
  withAuthor.forEach(p => {
    if (!byAuthor[p.author] || (p.rating||0) > (byAuthor[p.author].rating||0))
      byAuthor[p.author] = { rating: p.rating||0, posts: 0 }
    byAuthor[p.author].posts++
  })
  const topAuthors = Object.entries(byAuthor)
    .sort((a,b) => b[1].rating - a[1].rating)
    .slice(0, 3)
    .map(([name, d]) => `${name}${d.rating ? ' ⭐'+d.rating : ''}`)

  let summary = ''
  if (romeoCount) summary += `Ромео: ${pl(romeoCount, ['пост','поста','постов'])}. `
  if (topLikes > 0) summary += `Топ: +${topLikes} 👍. `
  if (popular.length) summary += `${pl(popular.length, ['пост набрал','поста набрали','постов набрали'])} 20+ лайков. `
  if (topAuthors.length) summary += `Активные: ${topAuthors.join(', ')}.`
  return summary || `${pl(ps.length, ['пост','поста','постов'])}.`
}

function ActivityChart({ posts, favorites, ignored, onFav, onIgnore, onUnignore, setLightbox,
                         sortBy, setSortBy, minLikes, setMinLikes, minRating, setMinRating, search }) {
  const [tip,      setTip]      = useState(null)
  const [selected, setSelected] = useState(null)
  const isMobile = useIsMobile()

  const data = useMemo(() => {
    const byDate = {}
    posts.forEach(p => {
      if (!p.timestamp) return
      const d = new Date(p.timestamp * 1000)
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      if (!byDate[k]) byDate[k] = { count:0, posts:[] }
      byDate[k].count++
      byDate[k].posts.push(p)
    })
    return Object.entries(byDate).sort((a,b)=>a[0]>b[0]?1:-1).slice(-30)
  }, [posts])

  const scrollRef = useRef(null)
  useEffect(() => {
    if (isMobile && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isMobile, data.length])

  if (!data.length) return null
  const max = Math.max(...data.map(d=>d[1].count), 1)

  // ── MOBILE: горизонтальный скролл, последние 7 дней видны сразу ─────────────
  if (isMobile) {
    const BAR_W = 36
    const BAR_MAX_H = 80

    return (
      <div className="chart-wrap">
        <div className="section-head" style={{marginBottom:8}}>
          <span className="section-title">Активность постов</span>
          <span className="section-count">{pl(data.length, ['день','дня','дней'])}</span>
          {selected && (
            <button onClick={()=>setSelected(null)}
              style={{marginLeft:'auto',background:'none',border:'none',color:'var(--dim)',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
              ✕ закрыть
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
                  <span style={{fontSize:10,color:isSelected?'#fff':'#666',fontFamily:"'Roboto Mono',monospace",fontWeight:isSelected?700:400}}>
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
                  <span style={{fontSize:11,color:isSelected?'var(--text)':'#666',fontFamily:"'Roboto Mono',monospace",whiteSpace:'nowrap'}}>
                    {date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{fontSize:11,color:'#444',textAlign:'center',padding:'4px 0 6px'}}>← листай для старых дней · нажми = детали</div>

        {/* Selected day posts */}
        {/* Selected day posts */}
        {selected && (() => {
          const summary = makeDaySummary(selected.posts)
          let dayPosts = [...selected.posts]
            .filter(p => !minLikes  || (p.likes||0)  >= minLikes)
            .filter(p => !minRating || (p.rating||0) >= minRating)
            .filter(p => !search    || p.text?.toLowerCase().includes(search?.toLowerCase()))
          dayPosts.sort((a,b) => (b.likes||0)-(a.likes||0))
          return (
            <div style={{marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--dim2)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:6}}>
                📅 {selected.date} — {pl(selected.posts.length, ['пост','поста','постов'])}
              </div>
              <div style={{fontSize:11,color:'var(--text)',lineHeight:1.5,padding:'8px 10px',background:'var(--bg3)',borderRadius:'var(--r)',marginBottom:8,borderLeft:'3px solid var(--red)'}}>
                {summary}
              </div>
              {dayPosts.length === 0
                ? <div className="empty-state">Нет постов по фильтрам</div>
                : dayPosts.map(p => (
                  <PostCard key={p.id||p.url} p={p}
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
      <div className="section-head" style={{marginBottom:8}}>
        <span className="section-title">Активность постов</span>
        <span className="section-count">последние {pl(data.length, ['день','дня','дней'])}</span>
        {selected && (
          <button onClick={()=>setSelected(null)}
            style={{marginLeft:'auto',background:'none',border:'none',color:'var(--dim)',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            ✕ закрыть
          </button>
        )}
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H+22}`} onMouseLeave={()=>setTip(null)}>
        {data.map(([date, {count, posts:dp}], i) => {
          const x  = i * (bw + pad)
          const bh = Math.max(3, (count / max) * H)
          const isSelected = selected?.date === date
          return (
            <g key={date} style={{cursor:'pointer'}}
              onMouseEnter={()=>setTip({date,count,posts:dp,x:x+bw/2})}
              onClick={()=>setSelected(selected?.date===date ? null : {date,posts:dp})}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2}
                fill={isSelected?'#e53935':tip?.date===date?'#e5393570':'#e5393530'}
                style={{transition:'fill .1s'}}/>
              {labelSet.has(i) && <text x={x+bw/2} y={H+16} className="chart-label">{date.slice(5)}</text>}
            </g>
          )
        })}
      </svg>

      {/* HOVER TOOLTIP */}
      {tip && !selected && (() => {
        const pct = (tip.x/W)*100
        const right = pct>65
        const romeoPs   = tip.posts.filter(p => ROMEO_RE.test(p.author))
        const topPost   = [...tip.posts].sort((a,b) => (b.likes||0)-(a.likes||0))[0]
        const topClean  = (topPost?.text||'').replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'').replace(/\[QUOTE\]/gi,'').replace(/\[\/QUOTE\]/gi,'').trim()
        // "Авторитетные авторы": репутация — жёсткий гейт, лайки — модификатор.
        //  - rating < MIN_RATING → вообще не в списке (мало репы ≠ авторитет, сколько бы лайков ни было)
        //  - очень авторитетный (>= VIP_RATING) + пост не-хуйня (> 5 лайков) → крупный буст, гарантированно в топе
        //  - uniqueBonus: редкий гость в треде ценнее регулярного флудера
        const MIN_RATING = 15000
        const VIP_RATING = 25000
        const byAuthor = {}
        tip.posts.filter(p=>p.author && !ROMEO_RE.test(p.author)).forEach(p => {
          const a = p.author
          if (!byAuthor[a]) byAuthor[a] = { rating: p.rating||0, bestLikes: 0, count: 0 }
          byAuthor[a].count++
          if ((p.likes||0) > byAuthor[a].bestLikes) byAuthor[a].bestLikes = p.likes||0
          if ((p.rating||0) > byAuthor[a].rating) byAuthor[a].rating = p.rating||0
        })
        // Считаем общее кол-во постов автора во всём треде для бонуса уникальности
        const globalCounts = {}
        posts?.forEach(p => { if (p.author) globalCounts[p.author] = (globalCounts[p.author]||0)+1 })
        const topAuthors = Object.entries(byAuthor)
          .filter(([, {rating}]) => rating >= MIN_RATING)
          .map(([name, {rating, bestLikes, count}]) => {
            const gc = globalCounts[name] || count
            const uniqueBonus = gc <= 3 ? 10 : gc <= 10 ? 4 : 0
            // log10(1+r)*20: 500→54, 1k→60, 5k→74, 10k→80, 50k→94
            const authority = Math.log10(rating + 1) * 20
            const likeScore = (bestLikes || 0) * 2
            // VIP-буст: авторитет + пост реально зашёл → автоматом в топ
            const vipBoost = (rating >= VIP_RATING && bestLikes > 5) ? 80 : 0
            const score = authority + likeScore + vipBoost + uniqueBonus
            return [name, rating, score, bestLikes]
          })
          .sort((a,b) => b[2]-a[2])
          .slice(0, 6)
        return (
          <div className="chart-tooltip" style={{
            bottom:52,
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:12,marginBottom:4}}>📅 {tip.date}</div>
            <div style={{fontSize:11,color:'#888',marginBottom:6}}>
              {pl(tip.count, ['пост','поста','постов'])}
              {romeoPs.length ? ` · Ромео: ${romeoPs.length}` : ''}
              {topPost?.likes >= 5 ? ` · топ +${topPost.likes} 👍` : ''}
            </div>
            {topAuthors.length > 0 && (
              <div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>авторитетные авторы</div>
                {topAuthors.map(([name, rating, , bestLikes]) => (
                  <div key={name} style={{fontSize:11,color:'#bbb',display:'flex',justifyContent:'space-between',gap:8,lineHeight:1.6}}>
                    <span style={{color:'#ddd'}}>{name}</span>
                    <span style={{fontSize:10,fontFamily:"'Roboto Mono',monospace",display:'inline-flex',alignItems:'center',gap:4}}>
                      {bestLikes > 0 && <span style={{color:'#ffb74d'}}>+{bestLikes} 👍</span>}
                      <span style={{color:rating>=0?'#4caf50':'#ff5252',display:'inline-flex',alignItems:'center',gap:2}}>
                        <svg viewBox="0 0 12 10" style={{width:9,height:8,fill:rating>=0?'#4caf50':'#ff5252',flexShrink:0}}>
                          <rect x="0" y="6" width="2.5" height="4"/>
                          <rect x="3.2" y="3" width="2.5" height="7"/>
                          <rect x="6.4" y="1" width="2.5" height="9"/>
                          <rect x="9.6" y="0" width="2.5" height="10"/>
                        </svg>
                        {fmtInt(rating)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {topClean && (
              <div style={{fontSize:11,color:'#bbb',lineHeight:1.6,borderTop:'1px solid #2a2a2a',paddingTop:6,marginTop:2}}>
                <div style={{color:'#666',fontSize:10,marginBottom:3}}>{topPost.author} · <span style={{color:'#4caf50',fontWeight:700}}>+{topPost.likes} 👍</span></div>
                <div style={{display:'-webkit-box',WebkitLineClamp:5,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                  {topClean.substring(0,300)}
                </div>
              </div>
            )}
            <div style={{fontSize:10,color:'#444',marginTop:5}}>кликни → детали дня</div>
          </div>
        )
      })()}

      {/* EXPANDED DAY VIEW */}
      {selected && (() => {
        const summary = makeDaySummary(selected.posts)
        let dayPosts = [...selected.posts]
          .filter(p => !minLikes  || (p.likes||0)  >= minLikes)
          .filter(p => !minRating || (p.rating||0) >= minRating)
          .filter(p => !search    || p.text?.toLowerCase().includes(search?.toLowerCase()))
        if (sortBy === 'likes')          dayPosts.sort((a,b) => (b.likes||0)-(a.likes||0))
        else if (sortBy === 'date_asc')  dayPosts.sort((a,b) => (a.timestamp||0)-(b.timestamp||0))
        else                             dayPosts.sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
        const btnStyle = (active) => ({
          background: active ? 'var(--red)' : 'var(--bg3)',
          border: '1px solid ' + (active ? 'var(--red)' : 'var(--border)'),
          borderRadius: 20, color: active ? '#fff' : 'var(--dim2)',
          fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
        })
        return (
          <div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--dim2)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>
              📅 {selected.date} — {pl(selected.posts.length, ['пост','поста','постов'])}
            </div>
            <div style={{fontSize:12,color:'var(--text)',lineHeight:1.6,padding:'10px 12px',background:'var(--bg3)',borderRadius:'var(--r)',marginBottom:10,borderLeft:'3px solid var(--red)'}}>{summary}</div>
            {/* Мини-фильтры */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:10,padding:'8px 0'}}>
              <button style={btnStyle(sortBy==='date_desc')} onClick={()=>setSortBy?.('date_desc')}>Новые</button>
              <button style={btnStyle(sortBy==='date_asc')}  onClick={()=>setSortBy?.('date_asc')}>Старые</button>
              <button style={btnStyle(sortBy==='likes')}     onClick={()=>setSortBy?.('likes')}>По лайкам</button>
              <div style={{width:1,height:16,background:'var(--border)',margin:'0 4px'}}/>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11,color:'var(--dim)'}}>👍 мин.</span>
                <input className="filter-num" type="number" min="0" value={minLikes} onChange={e=>setMinLikes?.(+e.target.value||0)}
                  onFocus={e=>e.target.select()}/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11,color:'var(--dim)'}}>⭐ репа</span>
                <input className="filter-num" type="number" min="0" step="100" value={minRating} onChange={e=>setMinRating?.(+e.target.value||0)}
                  onFocus={e=>e.target.select()}/>
              </div>
              <span style={{fontSize:11,color:'var(--dim)',marginLeft:'auto'}}>{pl(dayPosts.length, ['пост','поста','постов'])}</span>
            </div>
            <div style={{marginTop:4}}>
              {dayPosts.length === 0
                ? <div className="empty-state">Нет постов по текущим фильтрам</div>
                : dayPosts.map(p => (
                  <PostCard key={p.id||p.url} p={p}
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

function FilterBar({ sortBy, setSortBy, search, setSearch, showSearch, setShowSearch,
                     romeoOnly, setRomeoOnly, minLikes, setMinLikes,
                     minRating, setMinRating, count, showSort=true }) {
  const hasFilters = romeoOnly || minLikes !== 15 || minRating !== 0 || search
  return (
    <div className="filter-bar">
      {showSort && (
        <select className="feed-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="date_asc">Старые сначала</option>
          <option value="date_desc">Новые сначала</option>
          <option value="likes">По лайкам</option>
        </select>
      )}
      <button className={`filter-pill ${romeoOnly?'on':'off'}`} onClick={()=>setRomeoOnly(s=>!s)}
        title="Показывать только посты Romeopro" style={{display:'flex',alignItems:'center',gap:5}}>
        <img src={ROMEO_AVATAR} alt="" style={{width:15,height:15,borderRadius:'50%',objectFit:'cover'}}
          onError={e=>e.target.style.display='none'} />
        Ромео
      </button>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'nowrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap'}} title="Минимум лайков на посте">👍 мин.</label>
          <input className="filter-num" type="number" min="0" value={minLikes}
            onChange={e=>setMinLikes(+e.target.value||0)} onFocus={e=>e.target.select()} title="Минимум лайков на посте"/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:3}} title="Минимальная репутация автора">
            <img src="https://www.gipsyteam.ru/public/style_images/master/reputation_pos.png" alt="rep"
              referrerPolicy="no-referrer" style={{width:12,height:12,objectFit:'contain'}} onError={e=>{e.target.style.display='none'}}/>
            репа
          </label>
          <input className="filter-num" type="number" min="0" step="100" value={minRating}
            onChange={e=>setMinRating(+e.target.value||0)} onFocus={e=>e.target.select()} title="Минимальная репутация автора"/>
        </div>
      </div>
      <button className={`filter-pill ${showSearch?'on':'off'}`}
        onClick={()=>setShowSearch(s=>!s)} title="Поиск по тексту постов">🔍</button>
      {showSearch && (
        <input className="feed-search" style={{minWidth:140}} placeholder="Поиск…"
          value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
      )}
      {hasFilters && (
        <button className="filter-pill off" title="Сбросить все фильтры" onClick={()=>{
          setRomeoOnly(false); setMinLikes(3); setMinRating(0); setSearch(''); setShowSearch(false);
        }}>✕</button>
      )}
      <span className="filter-active-count">{pl(count, ['пост','поста','постов'])}</span>
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
        <span style={{color:'var(--dim)',fontSize:9,opacity:.6}}>{open ? '▲' : '▼ показать'}</span>
      </div>
      {open && (
        <div style={{color:'var(--text-quote)',fontSize:12,lineHeight:1.6,marginTop:4}}>
          {body
            ? body.replace(/\n{2,}/g,'\n').split('\n').filter(p=>/[^\s\u00a0]/.test(p)).map((p,j,arr)=>(
                <span key={j} style={{display:'block',marginBottom:j<arr.length-1?4:0}}>{p}</span>
              ))
            : <span style={{fontStyle:'italic',color:'#444'}}>↩ изображение или медиа</span>
          }
        </div>
      )}
    </div>
  )
}

function renderPostText(text, collapseQuotes=false) {
  if (!text) return null

  const parts = []
  let remaining = autoCloseQuotes(text.trim()).replace(/\n{3,}/g, '\n\n')

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
              : <span style={{fontStyle:'italic',color:'#444'}}>↩ изображение или медиа</span>
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
const PostCard = memo(function PostCard({ p, favorites, ignored, onFav, onIgnore, onUnignore, onVote, setLightbox, noClamp=false, tags=null }) {
  const [exp, setExp]     = useState(false)
  const [menu, setMenu]   = useState(false)
  const [revealIgnored, setRevealIgnored] = useState(false)
  const menuRef           = useRef(null)
  const isFav  = favorites?.has(p.author)
  const isIgnored = ignored?.has(p.author)

  if (isIgnored && !revealIgnored) {
    return (
      <div className="post-card" style={{opacity:.55,cursor:'pointer',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,fontSize:12,color:'var(--dim2)'}}
        onClick={()=>setRevealIgnored(true)}
        title="Нажмите, чтобы развернуть">
        <span style={{fontSize:16}}>🚫</span>
        <span style={S_FLEX1}>
          Пост от <b>{p.author}</b> (в игноре) · +{p.likes||0} 👍 · нажмите, чтобы посмотреть
        </span>
        {onUnignore && (
          <button className="btn-sm" onClick={e=>{e.stopPropagation();onUnignore(p.author)}}>Вернуть</button>
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
  const isLong  = !noClamp && (p.text?.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').length || 0) > 600

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
            ? <img src={p.avatar} alt={p.author} referrerPolicy="no-referrer" onError={e=>{e.target.style.display='none'}}/>
            : initial}
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
                📝 Блог
              </a>
            )}
            <a href={profileUrl} target="_blank" rel="noreferrer"
              style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e=>e.currentTarget.style.background=''}>
              👤 Профиль
            </a>
            <a href={`https://forum.gipsyteam.ru/index.php?act=Msg&CODE=4&MID=${encodeURIComponent(p.author)}`}
              target="_blank" rel="noreferrer"
              style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e=>e.currentTarget.style.background=''}>
              ✉️ Личное сообщение
            </a>
          </div>
        )}
        <div style={S_FLEX1}>
          <div className="pc-author" style={{cursor:'pointer'}}
            onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
            {p.author}
          </div>
          <div className="pc-author-meta">
            {p.msgCount && <span>{fmtInt(p.msgCount)} {plural(p.msgCount, ['пост','поста','постов'])}</span>}
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
        <div className="pc-date" title={p.date}>{timeAgo(p.timestamp) || p.date}</div>
        <div className="pc-actions">
          <button className={`pc-action ${isFav?'on':''}`} onClick={()=>onFav(p.author)} title={isFav?'Убрать автора из избранного':'Добавить автора в избранное'}>⭐</button>
          <button className="pc-action" onClick={()=>onIgnore(p.author)} title="Игнорировать">🚫</button>
        </div>
      </div>
      <div className={`pc-body ${!exp && isLong ? 'clamped' : ''}`}>{renderPostText(p.text)}</div>
      {p.images?.length>0 && (
        <div className="pc-images">
          {p.images.map((src,j)=>(
            <img key={j} className="pc-img" src={src} alt="" loading="lazy"
              onClick={()=>setLightbox(src)} onError={e=>e.target.style.display='none'}/>
          ))}
        </div>
      )}
      <div className="pc-foot">
        {onVote && <button className="pc-vote-btn" onClick={e=>{e.stopPropagation();onVote(p.id,1)}} title="Лайк">👍</button>}
        <span className={`pc-likes ${likes>0?'pos':likes<0?'neg':'zero'}`}>{likes>0?'+':''}{likes}</span>
        {onVote && <button className="pc-vote-btn" onClick={e=>{e.stopPropagation();onVote(p.id,-1)}} title="Дизлайк">👎</button>}
        {p.brAfter && <span className="pc-br">БР: {fmtNum(p.brAfter)}</span>}
        {isLong && (
          <button onClick={()=>setExp(s=>!s)} style={S_EXPAND}>
            <span style={S_ARROW}>{exp?'▲':'▼'}</span>
            {exp ? 'свернуть' : 'читать'}
          </button>
        )}
        {tags && tags.length > 0 && (
          <span style={S_TAGS_WRAP}>
            {tags.map(t=>(
              <span key={t.id} style={S_TAG}>
                {t.icon} {t.label}
              </span>
            ))}
          </span>
        )}
        {p.url&&<a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
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
function AuthorsPanel({ authors, favorites, ignored, onFav, onIgnore, onUnignore, onVote, setLightbox }) {
  const [expanded, setExpanded] = useState(null)
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
                  ? <img src={a.posts[0].avatar} alt="" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
                  : a.name[0]?.toUpperCase()}
              </div>
              <div style={S_FLEX1}>
                <div style={{fontWeight:700,color:'var(--white)',fontSize:13}}>{a.name} {isFav && <span title="В избранном">⭐</span>}</div>
                <div style={{fontSize:11,color:'var(--dim)',fontFamily:"'Roboto Mono',monospace"}}>
                  {pl(a.count, ['пост','поста','постов'])} · <span style={{color:'var(--green)'}}>+{a.likes}</span> 👍
                </div>
              </div>
              <button className="pc-action" onClick={e=>{e.stopPropagation();onFav?.(a.name)}} title="В избранное">⭐</button>
              <span style={{fontSize:11,color:'var(--dim)',opacity:.7}}>{open ? '▲' : '▼'}</span>
            </div>
            {open && (
              <div style={{borderTop:'1px solid var(--border)',padding:'8px 10px'}}>
                {a.posts.slice(0, 20).map(p => (
                  <PostCard key={p.id||p.url} p={p}
                    favorites={favorites} ignored={ignored} onFav={onFav}
                    onIgnore={onIgnore} onUnignore={onUnignore} onVote={onVote} setLightbox={setLightbox}/>
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
function Paginator({ page, totalPages, onPage, perPage, onPerPage, total }) {
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
      {!isMob && <span className="page-info">{(page-1)*perPage+1}–{Math.min(page*perPage,total)} из {total}</span>}
      <select className="perpage-select" value={perPage} onChange={e=>{onPerPage(+e.target.value);onPage(1)}}>
        {[10,20,50,100].map(n=><option key={n} value={n}>{n} на стр.</option>)}
      </select>
    </div>
  )
}

// ─── SIDEBAR TOP LIST ─────────────────────────────────────────────────────────
function SidebarTopList({ posts, setLightbox }) {
  const [hovered, setHovered] = useState(null)
  const [popupPos, setPopupPos] = useState({x:0, y:0})

  const stripQuotes = stripQuoteTags

  return (
    <div style={{padding:'6px 14px'}}
      onMouseLeave={()=>setHovered(null)}>

      {hovered !== null && (() => {
        const p = posts[hovered]
        if (!p) return null
        const left = Math.max(8, Math.min(popupPos.x - 310, window.innerWidth - 320))
        // If mouse is in lower half of screen, show popup above cursor
        const flipUp = popupPos.y > window.innerHeight * 0.55
        const top = flipUp
          ? Math.max(8, popupPos.y - 420)
          : Math.max(8, Math.min(popupPos.y - 40, window.innerHeight - 480))
        const maxH = flipUp
          ? Math.min(popupPos.y - 16, 560)
          : Math.min(window.innerHeight - top - 16, 560)
        return (
          <div className="sidebar-popup" style={{
            position:'fixed', left, top,
            width:300, background:'var(--bg-popup)', border:'1px solid var(--border-popup)',
            borderRadius:8, padding:14, zIndex:9999,
            boxShadow:'var(--shadow-popup)',
            pointerEvents:'auto',
            maxHeight: maxH,
            display:'flex', flexDirection:'column',
          }}>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:4}}>{p.author}</div>
            <div style={{fontSize:11,color:'var(--green)',marginBottom:8,fontFamily:"'Roboto Mono',monospace"}}>
              +{p.likes} 👍 · {p.date}
            </div>
            <div style={{fontSize:12,color:'var(--text)',lineHeight:1.6,overflowY:'auto',flex:1,paddingRight:4}}>
              {!((p.text||'').includes('[QUOTE]')) && p.images?.[0] && (
                <img src={p.images[0]} alt="" style={{maxWidth:'100%',borderRadius:4,marginBottom:10,display:'block'}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              {renderPostText(p.text, true)}
              {!stripQuotes(p.text) && p.text?.includes('[QUOTE]') && (
                <div style={{fontSize:11,color:'var(--dim)',fontStyle:'italic',marginTop:6}}>
                  ↩ {p.text.match(/\[QUOTE\]([^|\n]*)/)?.[1]?.trim() ? `ответ на ${p.text.match(/\[QUOTE\]([^|\n]*)/)[1].trim()}` : 'цитата'} — полный текст на форуме ↗
                </div>
              )}
            </div>
            <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
              <a href={p.url} target="_blank" rel="noreferrer"
                style={{fontSize:11,color:'var(--red2)'}}>→ открыть на форуме</a>
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
        const preview = clean || ((!hasQuote && p.images?.[0]) ? '📷 изображение' : '')
        const initial = (p.author||'?')[0].toUpperCase()
        // Don't show images in sidebar for posts with quotes (image may be from the quote)
        const showImage = !hasQuote && p.images?.[0]
        return (
          <div key={i}
            style={{display:'flex',gap:10,padding:'9px 0',borderBottom:'1px solid var(--border)',
              alignItems:'flex-start',cursor:'pointer'}}
            onClick={()=>p.url&&window.open(p.url,'_blank')}
            onMouseEnter={e=>{ setHovered(i); setPopupPos({x:e.clientX, y:e.clientY}) }}>
            <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16,flexShrink:0,paddingTop:10}}>{i+1}</span>
            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--red)',flexShrink:0,
              overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:700,color:'#fff',marginTop:2}}>
              {p.avatar
                ? <img src={p.avatar} alt="" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
                : initial}
            </div>
            <div style={S_FLEX1}>
              <div style={{fontSize:10,color:'var(--dim2)',fontWeight:600,marginBottom:2}}>{p.author}</div>
              {showImage && (
                <img src={p.images[0]} alt=""
                  style={{width:'100%',maxHeight:160,objectFit:'cover',borderRadius:4,marginBottom:6,display:'block',cursor:'zoom-in'}}
                  onClick={e=>{e.stopPropagation();setLightbox(p.images[0])}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              {isShortQuote ? (
                <div style={{fontSize:11,color:'var(--text)',lineHeight:1.5}}>
                  {renderPostText(p.text, false)}
                </div>
              ) : isQuoteOnly ? (
                <div style={{fontSize:11,color:'var(--dim)',lineHeight:1.5,fontStyle:'italic'}}>
                  ↩ {quoteAuthor ? `ответ на ${quoteAuthor}` : 'цитата'} — <span style={{color:'var(--red2)',fontStyle:'normal',textDecoration:'underline'}}>открыть на форуме</span>
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
  const [posts, setPosts]   = useState([])
  const [meta,  setMeta]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('feed')
  const [lightbox,  setLightbox]  = useState(null)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('rpt_theme') || 'dark' } catch { return 'dark' } })
  const [sortBy,  setSortByRaw]  = useState(() => { try { return localStorage.getItem('rpt_sortby') || 'date_asc' } catch { return 'date_asc' } })
  const [search,  setSearch]  = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [romeoOnly, setRomeoOnly] = useState(false)
  const [page,    setPage]    = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [minLikes,  setMinLikesRaw]  = useState(() => { try { return parseInt(localStorage.getItem('rpt_minlikes') ?? '3') } catch { return 3 } })
  const [minRating, setMinRatingRaw] = useState(() => { try { return parseInt(localStorage.getItem('rpt_minrating') ?? '0') } catch { return 0 } })

  const setSortBy   = v => { setSortByRaw(v);   try { localStorage.setItem('rpt_sortby', v) }   catch {} }
  const setMinLikes  = v => { setMinLikesRaw(v);  try { localStorage.setItem('rpt_minlikes', v) }  catch {} }
  const setMinRating = v => { setMinRatingRaw(v); try { localStorage.setItem('rpt_minrating', v) } catch {} }

  // Позиция чтения — запоминаем последний прочитанный пост на каждой вкладке
  const [readPos, setReadPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rpt_readpos')||'{}') } catch { return {} }
  })

  const [ignored, setIgnored] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_ignored')||'[]')) } catch { return new Set() }
  })
  // favorites = per-author (Set of author names). Favorited authors' posts bypass like/rating filters.
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_fav_authors')||'[]')) } catch { return new Set() }
  })
  const [ignoreInput, setIgnoreInput] = useState('')

  const knownIdsRef = useRef(null)
  const [newPostIds, setNewPostIds] = useState([])

  useEffect(() => {
    const enrichPosts = (posts, meta) => {
      // Merge same-session duplicate brHistory entries before anything else touches it.
      if (meta?.brHistory?.length) meta.brHistory = dedupBrHistory(meta.brHistory)
      const brHistory = meta?.brHistory
      if (brHistory?.length) {
        const brById = new Map(brHistory.filter(h=>h.id).map(h=>[h.id, h]))
        const brByTs = [...brHistory].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))
        posts?.forEach(p => {
          if (!ROMEO_RE.test(p.author) || p.brAfter) return
          const byId = brById.get(p.id)
          if (byId) { p.brAfter = byId.brAfter; return }
          if (!p.timestamp) return
          let best = null, bestDiff = Infinity
          for (const h of brByTs) {
            const diff = Math.abs((h.timestamp||0) - p.timestamp)
            if (diff < bestDiff) { bestDiff = diff; best = h }
          }
          if (best && bestDiff < 7200) p.brAfter = best.brAfter
        })
      }
    }

    const loadData = () =>
      fetchPublicData()
        .then(({posts, meta}) => {
          enrichPosts(posts, meta)
          // Detect new posts after initial load
          if (knownIdsRef.current) {
            const fresh = (posts||[]).filter(p => !knownIdsRef.current.has(p.id))
            if (fresh.length > 0) setNewPostIds(fresh.map(p => p.id))
          } else {
            knownIdsRef.current = new Set((posts||[]).map(p => p.id))
          }
          setPosts(posts||[]); setMeta(meta||{})
        })
        .catch(() => {})

    loadData().finally(() => setLoading(false))
    // Poll every 2 min, but only while tab is visible; refetch immediately on focus.
    let interval = null
    const start = () => {
      if (interval) return
      interval = setInterval(loadData, 2 * 60 * 1000)
    }
    const stop = () => {
      if (!interval) return
      clearInterval(interval); interval = null
    }
    const onVisibility = () => {
      if (document.hidden) { stop() }
      else { loadData(); start() }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Apply theme class to root
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    try { localStorage.setItem('rpt_theme', theme) } catch {}
  }, [theme])

  // Auto-fit to screen: scale root so 1500px design fits user's desktop viewport.
  // Clamped so big monitors don't over-inflate and small ones don't shrink past readable.
  // Skipped on mobile — the ≤720px media query handles narrow layout separately.
  // rAF-throttled and only writes when the value actually changes, so live resize is smooth.
  useEffect(() => {
    let raf = 0
    let lastZ = ''
    const fit = () => {
      raf = 0
      const vw = window.innerWidth
      const next = vw < 900
        ? ''
        : Math.min(1.25, Math.max(0.85, vw / 1500)).toFixed(2)
      if (next === lastZ) return
      lastZ = next
      document.documentElement.style.zoom = next
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

      return { br, profit, startBR, day, lastDate: last.date, totalTourneys, sessionsCount, winRate, avgMTT }
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
    return { day, br, profit, startBR, lastDate: romeoByDate[0]?.date, totalTourneys: null }
  }, [posts, meta])

  const [sidebarTopPeriod, setSidebarTopPeriod] = useState('all')

  // Period for marathon chart & tempo estimates — lifted up so progress bar can react.
  const [chartPeriod, setChartPeriodRaw] = useState(() => {
    try { return localStorage.getItem('rpt_chart_period') || 'all' } catch { return 'all' }
  })
  const setChartPeriod = (p) => {
    setChartPeriodRaw(p); try { localStorage.setItem('rpt_chart_period', p) } catch {}
  }

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
    return {
      sessionsCount: sub.length,
      positiveSessions: positive,
      winRate: positive / sub.length,
      avgMTT,
    }
  }, [meta, chartPeriod])
  const periodLabel = chartPeriod === 'week' ? 'неделю' : chartPeriod === 'month' ? 'месяц' : null

  // Favorited authors bypass like/rating filters entirely.
  // Ignored authors are hidden unless post has >=30 likes (then PostCard shows a placeholder).
  const IGNORED_THRESHOLD = 30
  const passesLikeRating = (p) => {
    if (favorites.has(p.author)) return true
    if (minLikes  && (p.likes||0)  < minLikes)  return false
    if (minRating && (p.rating||0) < minRating) return false
    return true
  }
  const passesIgnored = (p) => !ignored.has(p.author) || (p.likes||0) >= IGNORED_THRESHOLD

  // hotPosts — для сайдбара "Больше всего плюсиков"
  const hotPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author)) // top list never shows ignored
      .filter(p => favorites.has(p.author) || (!minRating || (p.rating||0) >= minRating))
      .filter(p => favorites.has(p.author) || (p.likes||0) >= Math.max(minLikes, 1))
      .sort((a,b) => (b.likes||0) - (a.likes||0))
  , [posts, ignored, favorites, minLikes, minRating])

  const feedPosts = useMemo(() =>
    posts
      .filter(passesIgnored)
      .filter(p => !romeoOnly || ROMEO_RE.test(p.author))
      .filter(p => !search || p.text?.toLowerCase().includes(search.toLowerCase()))
      .filter(passesLikeRating)
      .sort((a,b) => {
        if (sortBy==='date_desc') return (b.timestamp||0)-(a.timestamp||0)
        if (sortBy==='date_asc')  return (a.timestamp||0)-(b.timestamp||0)
        if (sortBy==='likes')     return (b.likes||0)-(a.likes||0)
        return 0
      }),
  [posts, ignored, favorites, search, sortBy, romeoOnly, minLikes, minRating])

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
    { id:'staking',    icon:'💰', label:'Стейкинг',          re:/стейкинг|стейк|бекинг|бек\b|доли\b|доля\b|продаж.*дол|конюшн|инвестор|инвестиц|кэф.*дол/i },
    { id:'debt',       icon:'🔴', label:'Долги',             re:/долг|должен|кредит|занял|отдаст|должник/i },
    { id:'money',      icon:'💵', label:'Деньги/Банкролл',   re:/банкролл|\bбр\b|депозит|вывод|кэшаут|cashout|10\s*млн|миллион|проигрыш|выигрыш|прибыль|убыт/i },
    { id:'strategy',   icon:'📊', label:'Стратегия',         re:/стратег|рои\b|roi\b|abi\b|аби\b|скилл|brm|эдж|солвер|ренж|рейнж|префлоп|постфлоп|\bev\b|рейк|ракебек|загрузк/i },
    { id:'variance',   icon:'🎲', label:'Дисперсия',         re:/дисперси|даунстрик|апстрик|свинг|вариан/i },
    { id:'psychology', icon:'🧠', label:'Психология',        re:/психолог|тилт\b|tilt\b|эмоц|дисциплин|мышлени|менталь|мотивац|выгоран|депресс|стресс/i },
    { id:'mtt',        icon:'🏆', label:'МТТ/Турниры',       re:/мтт|турнир|mystery|мистери|баунти|фризаут|сателлит/i },
    { id:'rooms',      icon:'🏷', label:'Румы/Софт',         re:/\bgg\b|pokerstars|\bps\b|старз|покерок|покерки|king|кинг|coin|coinpoker|ipoker|partypoker|winamax|888poker/i },
    { id:'content',    icon:'📺', label:'Стримы/Контент',    re:/стрим|твич|twitch|ютуб|youtube|подкаст|видео|контент|блог|донат/i },
    { id:'chess',      icon:'♟',  label:'Шахматы/Гнат',      re:/шахмат|гнат\b|gnat\b|фишер.*шахмат|карлсен/i },
    { id:'life',       icon:'🏠', label:'Жизнь/Офтоп',       re:/жизн|семь[яи]|жен[аеыщ]|муж\b|дет[яиейс]|ребен|здоров|работ[аеу]|карьер|образован|универ|учеб/i },
    { id:'live',       icon:'🎰', label:'Лайв/Кеш',          re:/офлайн|оффлайн|кеш\s*гейм|cash.*game|живая.*игр|живой.*покер|казино|вегас|серия\b/i },
    { id:'critique',   icon:'⚡', label:'Критика/Скепсис',    re:/хайп|развод|скам|скептич|не\s*верю|обман|фейк|пиар\b|нерельно|мечт|утопи/i },
    { id:'goal',       icon:'🎯', label:'Цель/Прогноз',       re:/успеет|не\s*успеет|дойдёт|дойдет|не\s*дойд|прогноз|шансы|ставк.*на/i },
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
  const [topicSortByRaw, setTopicSortByRaw] = useState(() => { try { return localStorage.getItem('rpt_topic_sortby') || 'date_desc' } catch { return 'date_desc' } })
  const setTopicSortBy = v => { setTopicSortByRaw(v); try { localStorage.setItem('rpt_topic_sortby', v) } catch {} }
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
      const next = {...prev, [tab]: postId}
      localStorage.setItem('rpt_readpos', JSON.stringify(next))
      return next
    })
  }

  const goToNewPosts = useCallback(() => {
    if (!newPostIds.length) return
    // Find the first new post in current feedPosts order
    const firstNewIdx = feedPosts.findIndex(p => newPostIds.includes(p.id))
    if (firstNewIdx !== -1) {
      const targetPage = Math.floor(firstNewIdx / perPage) + 1
      setPage(targetPage)
      // Mark as seen
      knownIdsRef.current = new Set(posts.map(p => p.id))
      setNewPostIds([])
      // Scroll to the post after page renders
      const postId = feedPosts[firstNewIdx].id
      requestAnimationFrame(() => {
        const el = document.getElementById(`post-${postId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    } else {
      // New posts might be filtered out — just dismiss
      knownIdsRef.current = new Set(posts.map(p => p.id))
      setNewPostIds([])
    }
  }, [newPostIds, feedPosts, perPage, posts])

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
      localStorage.setItem('rpt_fav_authors', JSON.stringify([...next]))
      return next
    })
  }, [])

  const addIgnore = useCallback(name => {
    if (!name?.trim()) return
    setIgnored(prev => {
      const next = new Set(prev)
      next.add(name.trim())
      localStorage.setItem('rpt_ignored', JSON.stringify([...next]))
      return next
    })
    setIgnoreInput('')
  }, [])

  const removeIgnore = useCallback(name => {
    setIgnored(prev => {
      const next = new Set(prev)
      next.delete(name)
      localStorage.setItem('rpt_ignored', JSON.stringify([...next]))
      return next
    })
  }, [])

  // ─── LIKE (GipsyTeam vote) ──────────────────────────────────────────────────
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = useCallback((msg, type='info') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  const handleVote = useCallback(async (postId, value) => {
    const isLike = value === 1
    const label = isLike ? 'Лайк' : 'Дизлайк'
    // Optimistic UI update
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: (p.likes||0) + value } : p))
    showToast(`Открываем GipsyTeam...`, 'info')

    try {
      const before = await fetch(`/api/check-likes?pid=${postId}`).then(r => r.json())
      const likesBefore = before.likes

      const popup = window.open(
        `https://forum.gipsyteam.ru/index.php?autocom=postvote&pid=${postId}&value=${value}`,
        'gt_vote',
        'width=600,height=400,scrollbars=yes'
      )

      await new Promise(r => setTimeout(r, 3000))
      if (popup && !popup.closed) popup.close()

      const after = await fetch(`/api/check-likes?pid=${postId}`).then(r => r.json())
      const likesAfter = after.likes

      if (likesAfter !== likesBefore) {
        const beforeSet = new Set(before.voters || [])
        const newVoter = (after.voters || []).find(v => !beforeSet.has(v))
        showToast(newVoter ? `${label} проставлен, ${newVoter}!` : `${label} проставлен!`, 'success')
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: likesAfter } : p))
      } else {
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: likesBefore } : p))
        showToast('Не засчитан — нужно быть залогиненным на GipsyTeam', 'error')
      }
    } catch (e) {
      showToast('Ошибка проверки', 'error')
    }
  }, [showToast])

  // ── ANIMATED COUNTER ─────────────────────────────────────────────────────
  const brVal  = stats?.br || meta?.bankroll || 0
  // Remember the last BR the user saw on their previous visit, so the animation
  // starts from that value (not from marathon start) and highlights only what
  // changed since then. Captured once on mount; persisted after each animation.
  const [lastSeenBR] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('rpt_last_seen_br')); return Number.isFinite(v) ? v : null }
    catch { return null }
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
      try { localStorage.setItem('rpt_last_seen_br', String(brVal)) } catch {}
    }, brDuration + 250)
    return () => clearTimeout(t)
  }, [brVal, brDuration])

  return (
    <>
      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-nav">
        {[
          ['feed',     '🏠', 'Лента'],
          ['topics',   '📂', 'Темы'],
          ['settings', '⚙️', 'Настройки'],
        ].map(([id, icon, label]) => (
          <button key={id} className={`mobile-nav-btn ${activeTab===id?'active':''}`} onClick={()=>switchTab(id)}>
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {lightbox && (
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt=""/>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} onClick={()=>setToast(null)}>
          {toast.type==='success' && '✓ '}{toast.type==='error' && '✗ '}{toast.msg}
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
              <div className="logo-sub">марафон $10k → $10M</div>
            </div>
          </div>
          <div className="topbar-tabs">
            {[['feed','Лента'],['topics','Темы'],['settings','Настройки']].map(([id,label])=>(
              <div key={id} className={`topbar-tab ${activeTab===id?'active':''}`} onClick={()=>switchTab(id)}>{label}</div>
            ))}
          </div>
          <div className="topbar-right">
            <button className="theme-toggle" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}
              title={theme==='dark'?'Светлая тема':'Тёмная тема'}>
              {theme==='dark'?'☀️':'🌙'}
            </button>
          </div>
        </div>
      </div>

      {/* PROGRESS BAR */}
      {!loading && stats?.br && (() => {
        const target = 10_000_000
        const start  = stats.startBR || 10000
        const raw = (stats.br - start) / (target - start) * 100
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
        const mttNeeded = (periodProfit > 0 && periodMTT)
          ? Math.ceil(remaining * periodMTT / periodProfit)
          : null
        const dollarPerMTT = (periodProfit > 0 && periodMTT)
          ? periodProfit / periodMTT
          : null
        const tempoLabel = chartPeriod === 'week'  ? 'МТТ темпом недели'
                         : chartPeriod === 'month' ? 'МТТ темпом месяца'
                         : 'МТТ текущим темпом'
        const tempoTitle = chartPeriod === 'all'
          ? 'Сколько МТТ нужно сыграть до $10M при среднем $/МТТ за весь марафон'
          : `Темп оценён по профиту и МТТ за выбранный период на графике (${chartPeriod==='week'?'7':'30'} дней)`
        return (
          <div className="marathon-progress">
            <div className="marathon-progress-inner">
              <div className="marathon-progress-main">
                <div className="marathon-progress-label">
                  <span>Прогресс к $10M</span><b>{pct.toFixed(2)}%</b>
                </div>
                <div className="marathon-progress-track">
                  <div className="marathon-progress-fill" style={{width:`${pct}%`}}/>
                </div>
              </div>
              <div className="marathon-progress-side">
                <div className="mps-item">
                  <span className="mps-label">Осталось</span>
                  <span className="mps-value">{fmtInt(remaining)}$</span>
                </div>
                {mttNeeded && <>
                  <div className="mps-divider"/>
                  <div className="mps-item">
                    <span className="mps-label">{tempoLabel}</span>
                    <span className="mps-value-row">
                      <TempoValue target={mttNeeded} title={tempoTitle}/>
                      {dollarPerMTT != null && (
                        <span className="mps-rate-inline" title="Текущий $/МТТ за выбранный период">
                          {(() => {
                            const r = Math.round(dollarPerMTT * 2) / 2
                            return (Number.isInteger(r) ? r : r.toFixed(1)) + '$/МТТ'
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

      {loading
        ? <div className="loading">Загружаем данные марафона…</div>
        : (
        <div className={`page ${activeTab==='settings'?'wide':''}`}>
          <div>
            {/* HERO */}
            <div className="hero">
              <div className="hero-top">
                <div className="hero-avatar">
                  <img src="https://www.gipsyteam.ru/upload/Avatar/default/2/6/6/26670.jpg"
                    alt="Romeopro" referrerPolicy="no-referrer" onError={e=>e.target.style.display='none'}/>
                </div>
                <div style={{flex:1, minWidth:0, overflow:'hidden'}}>
                  <div className="hero-name">Romeopro <span className="hero-badge">Автор</span></div>
                  <div className="hero-desc">
                    From Hero to Zero · <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676"
                      target="_blank" rel="noreferrer" style={{color:'var(--dim2)'}}>GipsyTeam</a>
                    {stats.lastDate && <span> · последний пост: {stats.lastDate}</span>}
                  </div>
                </div>
              </div>
              <div className="hero-stats">
                <div className="hstat">
                  <div className="hstat-label">Банкролл</div>
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
                  <div className="hstat-sub">старт: {fmtExact(stats.startBR)}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Профит</div>
                  <div className={`hstat-value ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>
                    {fmtBR(stats.profit)}
                  </div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">День марафона</div>
                  <div className="hstat-value gold">#{stats.day||meta?.day||'—'}</div>
                  <div className="hstat-sub">с 10 марта 2026</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Сыграно МТТ</div>
                  <div className="hstat-value">{fmtInt(meta?.totalTournaments ?? 3565)}</div>
                  <div className="hstat-sub">всего за марафон</div>
                </div>
              </div>
            </div>

            {/* ТЕМЫ */}
            {activeTab==='topics' && (() => {
              const MAIN_TABS = [
                { id:'marathon',   icon:'📈', label:'Марафон',     desc:'Все посты Ромео' },
                { id:'discussion', icon:'💬', label:'Про Ромео',   desc:'Обсуждение и реакции на Ромео' },
                { id:'debate',     icon:'🔥', label:'Длинные посты', desc:'Серьёзный контент (300+ символов, 20+ лайков)' },
                { id:'highlikes',  icon:'⭐', label:'Хайлайты',    desc:'Самые залайканные посты форума' },
                { id:'authors',    icon:'👥', label:'Авторы',      desc:'Топ-контрибьюторы треда' },
                { id:'tags',       icon:'🏷', label:'По темам',    desc:'Все посты по тематикам' },
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
                  count={all.length} showSort={true}
                />
                {/* Основные разделы */}
                <div className="topic-tabs">
                  {MAIN_TABS.map(t => (
                    <div key={t.id}
                      className={`topic-tab ${topicTab===t.id?'active':''}`}
                      onClick={()=>{ setTopicTab(t.id); setTopicPage(1); setTopicTag(t.id==='tags' ? TAG_RULES[0].id : null) }}>
                      {t.icon} {t.label}
                      <span className="tc">{
                        t.id === 'tags'
                          ? Object.values(classifiedPosts.byTag).reduce((s,a)=>s+a.length, 0)
                          : t.id === 'authors'
                            ? (classifiedPosts.authorStats?.length || 0)
                            : (classifiedPosts[t.id]?.length || 0)
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
                    ? (activeTagRule ? `${activeTagRule.icon} ${activeTagRule.label}` : 'Выберите тему')
                    : isAuthorsMode
                      ? `Топ-контрибьюторы (${classifiedPosts.authorStats?.length||0})`
                      : MAIN_TABS.find(t=>t.id===topicTab)?.desc
                  }{!isAuthorsMode && ` · ${pl(all.length, ['пост','поста','постов'])}`}
                </div>

                {/* Авторы-режим */}
                {isAuthorsMode
                  ? ((classifiedPosts.authorStats?.length||0)===0
                      ? <div className="empty-state">Пока нет данных</div>
                      : <AuthorsPanel authors={classifiedPosts.authorStats}
                          favorites={favorites} ignored={ignored}
                          onFav={toggleFav} onIgnore={addIgnore} onUnignore={removeIgnore}
                          onVote={handleVote} setLightbox={setLightbox}/>)
                  : all.length===0
                  ? <div className="empty-state">{isTagMode && !topicTag ? 'Выберите тему выше' : 'Постов не найдено'}</div>
                  : <>
                    <Paginator page={topicPage} totalPages={tpg} onPage={goTopicPage}
                      perPage={TOPIC_PER_PAGE} onPerPage={()=>{}} total={all.length}/>
                    {paged.map(p=>(
                      <PostCard key={p.id||p.url} p={p}
                        favorites={favorites} ignored={ignored} onFav={toggleFav}
                        onIgnore={addIgnore} onUnignore={removeIgnore} onVote={handleVote} setLightbox={setLightbox}
                        noClamp={topicTab==='marathon'}
                        tags={p._tags && isTagMode ? p._tags.filter(t=>t!==topicTag).map(t=>TAG_RULES.find(r=>r.id===t)).filter(Boolean) : null}/>
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
                  ['БР',
                    <AnimatedValue key="br-anim" target={brVal} path={brPath} duration={brDuration}
                      format={fmtExact}
                      render={(v)=>{
                        const up = v >= (stats.startBR || 10000)
                        const color = up ? '#66bb6a' : 'var(--red2)'
                        const glow  = up ? 'rgba(102,187,106,.28)' : 'rgba(239,83,80,.28)'
                        return <span style={{color,fontVariantNumeric:'tabular-nums',letterSpacing:'-0.02em',textShadow:`0 0 12px ${glow}`,transition:'color .2s, text-shadow .2s'}}>{fmtExact(v)}</span>
                      }}/>,
                    ''],
                  ['Профит', fmtBR(stats.profit), !stats.profit?'':stats.profit>=0?'green':'red'],
                  ['День', `#${stats.day||meta?.day||'—'}`, 'gold'],
                  ['МТТ', fmtInt(meta?.totalTournaments ?? 3565), ''],
                  (periodStats?.avgMTT ?? stats.avgMTT) != null && [
                    'МТТ / сессия' + (periodStats?.avgMTT != null ? '*' : ''),
                    fmtInt(periodStats?.avgMTT ?? stats.avgMTT),
                    '',
                  ],
                  (periodStats?.winRate ?? stats.winRate) != null && [
                    'Плюсовых сессий' + (periodStats?.winRate != null ? '*' : ''),
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
                <div className="mobile-stats-note">* с учётом фильтра на графике ({periodLabel})</div>
              )}
              <MarathonChart posts={posts} meta={meta} startBR={stats.startBR} setLightbox={setLightbox}
                period={chartPeriod} setPeriod={setChartPeriod}/>
              <ActivityChart posts={posts}
                favorites={favorites} ignored={ignored} onFav={toggleFav}
                onIgnore={addIgnore} onUnignore={removeIgnore} setLightbox={setLightbox}
                sortBy={sortBy} setSortBy={setSortBy}
                minLikes={minLikes} setMinLikes={setMinLikes}
                minRating={minRating} setMinRating={setMinRating}
                search={search}/>
              {/* Mobile-only top posts */}
              {hotPosts.length > 0 && (() => {
                const now = Date.now() / 1000
                const cutoffs = { day: now-86400, week: now-604800, month: now-2592000, all: 0 }
                const labels = { day:'День', week:'Неделя', month:'Месяц', all:'Все' }
                const filtered = hotPosts.filter(p => (p.timestamp||0) >= cutoffs[sidebarTopPeriod])
                const topList = (filtered.length ? filtered : hotPosts).slice(0,7)
                return (
                  <div className="mobile-top-posts">
                    <div className="mobile-top-header">
                      <span>🔥 Топ</span>
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
                            <span className="mobile-top-text">{stripQuoteTags(p.text)?.substring(0,120) || '→ форум'}</span>
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
                count={feedPosts.length} showSort={true}
              />
              {newPostIds.length > 0 && activeTab === 'feed' && (
                <button className="new-posts-bubble" onClick={goToNewPosts}>
                  {newPostIds.length} {plural(newPostIds.length, ['новый пост','новых поста','новых постов'])}!
                </button>
              )}
              {feedPosts.length===0
                ? <div className="empty-state">Постов нет — смягчите фильтры или запустите скрапер</div>
                : <>
                  <Paginator page={page} totalPages={totalPages} onPage={goPage}
                    perPage={perPage} onPerPage={setPerPage} total={feedPosts.length} />
                  {pagedPosts.map((p,i)=>(
                    <div key={p.id||p.url} id={`post-${p.id}`}
                      onMouseEnter={()=>{ if(i===pagedPosts.length-1) saveReadPos('feed',p.id) }}>
                      <PostCard p={p}
                        favorites={favorites} ignored={ignored} onFav={toggleFav}
                        onIgnore={addIgnore} onUnignore={removeIgnore} onVote={handleVote} setLightbox={setLightbox}/>
                    </div>
                  ))}
                  <Paginator page={page} totalPages={totalPages} onPage={goPage}
                    perPage={perPage} onPerPage={setPerPage} total={feedPosts.length} />
                </>
              }
            </>}

            {/* НАСТРОЙКИ */}
            {activeTab==='settings' && (
              <div className="sblock">
                <div className="sblock-title">🚫 Игнорируемые авторы</div>
                {ignored.size===0
                  ? <div className="ignore-empty">Список пуст — нажмите 🚫 на любом посте чтобы скрыть автора</div>
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
                  <input className="ignore-input" placeholder="Добавить автора вручную…"
                    value={ignoreInput} onChange={e=>setIgnoreInput(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&addIgnore(ignoreInput)}/>
                  <button className="btn-sm" onClick={()=>addIgnore(ignoreInput)}>Добавить</button>
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          {activeTab!=='settings' && (
            <div className="sidebar">
              <div className="sblock">
                <div className="sblock-title">📊 Статистика</div>
                <div className="sblock-body">
                  {[
                    ['БР', <span key="br" className={`srow-val ${stats.br?'green':''}`}>{fmtExact(stats.br||meta?.bankroll)}</span>],
                    ['Профит', <span key="pr" className={`srow-val ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>{fmtBR(stats.profit)}</span>],
                    ['День', <span key="d" className="srow-val gold">#{stats.day||meta?.day||'—'}</span>],
                    ['Сыграно МТТ', <span key="mtt" className="srow-val">{fmtInt(meta?.totalTournaments ?? 3565)}</span>],
                    (periodStats?.avgMTT ?? stats.avgMTT) != null && [
                      'МТТ / сессия' + (periodStats?.avgMTT != null ? '*' : ''),
                      <span key="avg" className="srow-val" title={periodStats?.avgMTT != null ? `За ${periodLabel}` : 'Среднее число турниров за сессию'}>
                        {fmtInt(periodStats?.avgMTT ?? stats.avgMTT)}
                      </span>,
                    ],
                    (periodStats?.winRate ?? stats.winRate) != null && [
                      'Плюсовых сессий' + (periodStats?.winRate != null ? '*' : ''),
                      <span key="wr" className="srow-val"
                        title={periodStats
                          ? `${periodStats.positiveSessions} из ${periodStats.sessionsCount} за ${periodLabel}`
                          : `${Math.round(stats.winRate*stats.sessionsCount)} из ${stats.sessionsCount}`}>
                        {Math.round((periodStats?.winRate ?? stats.winRate)*100)}%
                      </span>,
                    ],
                    ['Постов', <span key="p" className="srow-val">{fmtInt(posts.length)}</span>],
                    ['Топ лайков', <span key="l" className="srow-val">{hotPosts[0]?`+${hotPosts[0].likes}`:'—'}</span>],
                  ].filter(Boolean).map(([k,v])=>(
                    <div key={k} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
                  {periodStats && (
                    <div className="srow-note">* с учётом фильтра на графике ({periodLabel})</div>
                  )}
                </div>
              </div>

              {hotPosts.length>0 && (() => {
                const [sideTopPeriod, setSideTopPeriod] = [sidebarTopPeriod, setSidebarTopPeriod]
                const now = Date.now() / 1000
                const cutoffs = { day: now-86400, week: now-604800, month: now-2592000, all: 0 }
                const labels = { day:'День', week:'Неделя', month:'Месяц', all:'Всегда' }
                const filtered = hotPosts.filter(p => (p.timestamp||0) >= cutoffs[sideTopPeriod])
                const topList = (filtered.length ? filtered : hotPosts).slice(0,10)
                return (
                  <div className="sblock">
                    <div className="sblock-title" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'10px 14px'}}>
                      <span>🔥 Больше всего плюсиков</span>
                      <div style={{display:'flex',gap:4}}>
                        {Object.keys(cutoffs).map(k => (
                          <button key={k} onClick={()=>setSidebarTopPeriod(k)}
                            style={{background:sideTopPeriod===k?'var(--red)':'var(--bg3)',border:'1px solid '+(sideTopPeriod===k?'var(--red)':'var(--border2)'),borderRadius:4,color:sideTopPeriod===k?'#fff':'var(--dim2)',fontSize:10,padding:'3px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                            {labels[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SidebarTopList posts={topList} setLightbox={setLightbox}/>
                  </div>
                )
              })()}

              {ignored.size>0 && (
                <div className="sblock">
                  <div className="sblock-title">🚫 Игнор ({ignored.size})</div>
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
                <div className="sblock-title">🔗 Ссылки</div>
                <div className="sblock-body" style={{display:'flex',flexDirection:'column',gap:8}}>
                  <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Тема на GipsyTeam</a>
                  <a href="https://github.com/loremcdmx/romeoprotracker" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Исходный код</a>
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
                <span style={{color:'#444'}}>v1.5</span>
              </div>
              <div style={{fontSize:10,color:'#444',marginBottom:4}}>
                made by{' '}
                <a href="https://t.me/loremnopoker" target="_blank" rel="noreferrer"
                  style={{color:'var(--dim)',textDecoration:'none'}}>LoremCDMX</a>
              </div>
              <div style={{fontSize:10,color:'#333'}}>
                обновлено: 11.04.2026
              </div>
              {(() => {
                // lastScrapeRun: heartbeat from scraper, bumped every run (even no-op).
                // Fallback to lastUpdated (bumped only on real changes) for old data.
                const scrapeTs = meta?.lastScrapeRun
                  ? Date.parse(meta.lastScrapeRun)
                  : meta?.lastUpdated ? Date.parse(meta.lastUpdated) : 0
                const newestPostTs = posts?.length
                  ? Math.max(...posts.map(p => (p.timestamp || 0) * 1000))
                  : 0
                if (!scrapeTs && !newestPostTs) return null
                const fmt = (ts) => {
                  const d = new Date(ts)
                  const sameDay = d.toDateString() === new Date().toDateString()
                  const time = d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })
                  return sameDay
                    ? `сегодня в ${time}`
                    : `${d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})} в ${time}`
                }
                const mins = Math.round((Date.now() - scrapeTs) / 60000)
                const fresh = mins < 20
                const stale = mins > 90
                const color = fresh ? '#4caf5099' : stale ? '#ff525299' : '#998866'
                return (
                  <>
                    <div style={{fontSize:10,color,marginTop:3,fontFamily:"'Roboto Mono',monospace"}}
                      title={`Последний прогон скрапера: ${new Date(scrapeTs).toLocaleString('ru-RU')}`}>
                      <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:color,marginRight:5,verticalAlign:'middle'}}/>
                      скрапер бегал: {fmt(scrapeTs)}
                    </div>
                    {newestPostTs > 0 && (
                      <div style={{fontSize:10,color:'#666',marginTop:2,fontFamily:"'Roboto Mono',monospace",paddingLeft:11}}
                        title={`Timestamp самого свежего поста на форуме: ${new Date(newestPostTs).toLocaleString('ru-RU')}`}>
                        самый свежий пост: {fmt(newestPostTs)}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Правая часть — чейнджлог */}
            <div style={{maxWidth:420}}>
              <div style={{fontSize:10,color:'#444',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8,fontWeight:600}}>
                Changelog
              </div>
              {[
                ['11.04', 'v1.5', 'Фильтры неделя/месяц на графике — темп МТТ до $10M теперь считается по выбранному отрезку. Избранное и игнор теперь по авторам. Новые разделы в темах: Хайлайты и Авторы. % плюсовых сессий и среднее МТТ/сессия в статистике (учитывают выбранный фильтр на графике). Фикс графика: последняя точка показывала неверное кол-во МТТ. Auto fit-to-screen под ширину окна. Рефакторинг: чистка мёртвого кода, фикс утечек raf в анимациях'],
                ['09.04', 'v1.4', 'Лайки/дизлайки через GipsyTeam. Баббл новых постов. Скрапер каждые 15 мин. График в первый экран'],
                ['08.04', 'v1.3', 'Белая тема. Автоскрапер через GitHub Actions'],
                ['07.04', 'v1.2', 'График с bezier-кривыми и анимацией. Мобильная вёрстка'],
                ['06.04', 'v1.1', 'Виджет активности по дням. Топ-10 постов. Автообновление'],
                ['05.04', 'v1.0', 'Первый запуск — лента, цитаты, пагинация, график марафона, темы, избранное, фильтры'],
              ].map(([date, ver, desc]) => (
                <div key={date+ver} style={{display:'flex',gap:8,marginBottom:6,alignItems:'baseline'}}>
                  <span style={{fontSize:9,color:'#444',fontFamily:"'Roboto Mono',monospace",minWidth:36,flexShrink:0}}>{date}</span>
                  <span style={{fontSize:9,color:'var(--red)',minWidth:28,flexShrink:0,fontFamily:"'Roboto Mono',monospace"}}>{ver}</span>
                  <span style={{fontSize:10,color:'#555',lineHeight:1.5}}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </footer>
      )}
      {/* Vercel Analytics */}
      <Analytics />
    </>
  )
}
