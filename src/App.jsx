import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { fetchPublicData } from './storage.js'
import { Analytics } from '@vercel/analytics/react'
import {
  timeAgo, fmtBR, fmtNum, fmtInt, fmtExact, extractDay, extractBR,
  fk, fkAbs, ROMEO_RE, autoCloseQuotes, stripQuoteTags, extractQuoteBody,
  makeBezierPath, makeBezierArea,
} from './utils.js'
import { useIsMobile } from './hooks/useIsMobile.js'
import AnimatedValue from './components/AnimatedValue.jsx'


// CSS moved to app.css (imported in main.jsx). Fonts via <link> in index.html.
// PLACEHOLDER_CSS_REMOVED

// ─── HELPERS (imported from utils.js) ────────────────────────────────────────

// AnimatedValue component imported from ./components/AnimatedValue.jsx

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
  { key:'gg',   label:'GG',    logo:'https://www.ggpoker.com/favicon.ico' },
  { key:'ps',   label:'Stars', logo:'https://www.pokerstars.com/favicon.ico' },
  { key:'king', label:'King',  logo:'https://www.pokerking.com/favicon.ico' },
  { key:'coin', label:'Coin',  logo:'https://coinpoker.com/favicon.ico' },
  { key:'lux',  label:'Lux',   logo:'https://luxon.poker/favicon.ico' },
]

function MarathonChart({ posts, meta, startBR, setLightbox, day }) {
  const [tip, setTip]     = useState(null)
  const [pathLen, setPathLen] = useState(null)
  const pathRef = useRef(null)
  const isMobile = useIsMobile()

  const points = useMemo(() => {
    if (meta?.brHistory?.length) {
      return meta.brHistory
        .slice()
        .sort((a,b) => (a.timestamp||0)-(b.timestamp||0))
        .map((h,i,arr) => ({
          br:h.brAfter, brPrev:i===0?startBR:arr[i-1].brAfter,
          date:h.date, text:h.text||'', url:h.url,
          images:[], sessionResult:h.sessionResult, rooms:h.rooms||null,
          tournaments:h.tournaments||null,
        }))
    }
    return posts
      .filter(p => /romeopro/i.test(p.author) && p.brAfter)
      .sort((a,b) => (a.timestamp||0)-(b.timestamp||0))
      .map((p,i,arr) => ({
        br:p.brAfter, brPrev:i===0?startBR:arr[i-1].brAfter,
        date:p.date, text:p.text, url:p.url,
        images:p.images||[], sessionResult:p.sessionResult,
      }))
  }, [posts, meta, startBR])

  useEffect(() => {
    if (pathRef.current) setPathLen(pathRef.current.getTotalLength())
  }, [points.length])

  if (!points.length) return (
    <div className="marathon-chart">
      <div className="section-head"><span className="section-title">📈 График марафона</span></div>
      <div className="empty-state">Данных пока нет — запустите скрапер</div>
    </div>
  )

  const W=700, H=160, pL=52, pR=20, pT=14, pB=44
  const minV = Math.min(...points.map(p=>p.br), startBR) * 0.97
  const maxV = Math.max(...points.map(p=>p.br), startBR) * 1.03
  const yOf  = v => pT + (1-(v-minV)/(maxV-minV)) * (H-pT-pB)

  // X-позиция пропорциональна накопленным МТТ если данные есть, иначе равномерно
  const hasMTT = points.length > 1 && points.some(p => p.tournaments)
  const cumMTT = (() => {
    let acc = 0
    return points.map(p => { acc += (p.tournaments || 0); return acc })
  })()
  const totalMTT = cumMTT[cumMTT.length - 1] || 1

  const xOf = (() => {
    if (!hasMTT || totalMTT === 0)
      return i => pL + (i / Math.max(points.length - 1, 1)) * (W - pL - pR)

    // Сырые позиции по МТТ
    const raw = cumMTT.map(c => pL + (c / totalMTT) * (W - pL - pR))

    // Минимальный отступ между соседними точками — иначе кривая схлопывается
    const minGap = 20
    const pos = [...raw]
    for (let i = 1; i < pos.length; i++) {
      if (pos[i] - pos[i-1] < minGap) pos[i] = pos[i-1] + minGap
    }
    // Если вышли за правый край — масштабируем назад
    const overflow = pos[pos.length-1] - (W - pR)
    if (overflow > 0) {
      const span = pos[pos.length-1] - pos[0]
      const target = W - pR - pos[0]
      for (let i = 1; i < pos.length; i++)
        pos[i] = pos[0] + (pos[i] - pos[0]) * (target / span)
    }
    return i => pos[i]
  })()
  const coords = points.map((p,i) => ({ x:xOf(i), y:yOf(p.br) }))
  const linePath = makeBezierPath(coords)
  const areaPath = makeBezierArea(coords, H)
  const yTicks = [0,.33,.67,1].map(t => ({ v:minV+(maxV-minV)*t, y:yOf(minV+(maxV-minV)*t) }))

  const handleTouch = e => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const tx = (touch.clientX - rect.left) * (W / rect.width)
    let nearest=0, minD=Infinity
    coords.forEach((c,i) => { const d=Math.abs(c.x-tx); if(d<minD){minD=d;nearest=i} })
    const p = points[nearest]
    // На мобиле сохраняем screen-координаты для fixed позиционирования
    setTip({ p, profit:p.br-p.brPrev, x:coords[nearest].x, y:coords[nearest].y,
      screenY: touch.clientY })
  }

  return (
    <div className="marathon-chart" onClick={tip?()=>setTip(null):undefined}>
      <div className="section-head" style={{marginBottom:12}}>
        <span className="section-title">📈 График марафона</span>
        <span className="section-count">{day?`день #${day}`:`${points.length} сессий`}</span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H+pB}`}
        onMouseLeave={()=>setTip(null)} onTouchStart={handleTouch} onTouchMove={handleTouch}
        style={{touchAction:'none'}}>
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
            <text x={pL-5} y={y+3} className="mc-ylabel">{fkAbs(v)}</text>
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
        {/* Pick ~8 evenly spaced labels by X position, not by index */}
        {points.map((p,i) => {
          const showL = (() => {
            if (i === 0 || i === points.length - 1) return true
            const totalW = coords[coords.length-1].x - coords[0].x
            if (totalW <= 0) return false
            const nLabels = Math.min(8, points.length)
            const step = totalW / (nLabels - 1)
            const slot = Math.round((coords[i].x - coords[0].x) / step)
            // This point is the closest to its slot
            const slotX = coords[0].x + slot * step
            let bestIdx = i
            let bestDist = Math.abs(coords[i].x - slotX)
            for (let j = Math.max(1, i-2); j <= Math.min(points.length-2, i+2); j++) {
              const d = Math.abs(coords[j].x - slotX)
              if (d < bestDist) { bestDist = d; bestIdx = j }
            }
            return bestIdx === i
          })()
          const isLast = i===points.length-1
          const cx=coords[i].x, cy=coords[i].y, profit=p.br-p.brPrev
          const isHovered = tip?.p === p
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={isLast?14:10} fill="transparent"
                onMouseEnter={()=>setTip({p,profit,x:cx,y:cy})}/>
              <circle cx={cx} cy={cy} r={isHovered?(isLast?8:6):(isLast?6:4)}
                className={isLast?'mc-dot mc-dot-last':'mc-dot'}
                fill={profit>=0?'#4caf50':'#e53935'}
                style={{transition:'r .12s', ...(isLast?{color:profit>=0?'#4caf50':'#e53935'}:{})}}/>
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
                      fontSize="7" fill="#444">
                      {p.date?.slice(0,5)}
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
          <div className="mc-tooltip" style={{...mobileStyle, position: isMobile ? 'fixed' : 'absolute'}}>
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
                    {r.logo && <img src={r.logo} alt={r.label} style={{width:12,height:12,objectFit:'contain',borderRadius:2}} onError={e=>e.target.style.display='none'}/>}
                    <span style={{color:'var(--dim)'}}>{r.label}:</span>
                    <span style={{color:r.v>=0?'#66bb6a':'#ff5252',fontWeight:600}}>{fk(r.v)}</span>
                  </span>
                ))}
              </div>
            )}
            {tip.p.text && <div style={{fontSize:11,color:'var(--dim2)',lineHeight:1.6,display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{tip.p.text.substring(0,180)}</div>}
            <div style={{fontSize:10,color:'var(--dim)',marginTop:5,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>закрыть</span>
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
  if (romeoCount) summary += `Ромео: ${romeoCount} пост${romeoCount > 1 ? 'а' : ''}. `
  if (topLikes > 0) summary += `Топ: +${topLikes} 👍. `
  if (popular.length) summary += `${popular.length} постов набрали 20+ лайков. `
  if (topAuthors.length) summary += `Активные: ${topAuthors.join(', ')}.`
  return summary || `${ps.length} постов.`
}

function ActivityChart({ posts, favorites, onFav, onIgnore, setLightbox,
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
          <span className="section-count">{data.length} дней</span>
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
                📅 {selected.date} — {selected.posts.length} постов
              </div>
              <div style={{fontSize:11,color:'var(--text)',lineHeight:1.5,padding:'8px 10px',background:'var(--bg3)',borderRadius:'var(--r)',marginBottom:8,borderLeft:'3px solid var(--red)'}}>
                {summary}
              </div>
              {dayPosts.length === 0
                ? <div className="empty-state">Нет постов по фильтрам</div>
                : dayPosts.map(p => (
                  <PostCard key={p.id||p.url} p={p}
                    favorites={favorites||new Set()} onFav={onFav||(() =>{})}
                    onIgnore={onIgnore||(() =>{})} setLightbox={setLightbox||(() =>{})}/>
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
        <span className="section-count">последние {data.length} дней</span>
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
        // Топ авторов по репе
        const byAuthor = {}
        tip.posts.filter(p=>p.author).forEach(p => {
          if (!byAuthor[p.author] || (p.rating||0) > (byAuthor[p.author]||0))
            byAuthor[p.author] = p.rating||0
        })
        const topAuthors = Object.entries(byAuthor)
          .filter(([,r]) => r >= 10000)
          .sort((a,b) => b[1]-a[1])
        return (
          <div className="chart-tooltip" style={{
            bottom:52,
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:12,marginBottom:4}}>📅 {tip.date}</div>
            <div style={{fontSize:11,color:'#888',marginBottom:6}}>
              {tip.count} постов
              {romeoPs.length ? ` · Ромео: ${romeoPs.length}` : ''}
              {topPost?.likes >= 5 ? ` · топ +${topPost.likes} 👍` : ''}
            </div>
            {topAuthors.length > 0 && (
              <div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>авторитетные авторы</div>
                {topAuthors.map(([name, rating]) => (
                  <div key={name} style={{fontSize:11,color:'#bbb',display:'flex',justifyContent:'space-between',gap:8,lineHeight:1.6}}>
                    <span style={{color:'#ddd'}}>{name}</span>
                    <span style={{color:'#4caf50',fontSize:10,fontFamily:"'Roboto Mono',monospace",display:'inline-flex',alignItems:'center',gap:2}}>
                      <svg viewBox="0 0 12 10" style={{width:9,height:8,fill:'#4caf50',flexShrink:0}}>
                        <rect x="0" y="6" width="2.5" height="4"/>
                        <rect x="3.2" y="3" width="2.5" height="7"/>
                        <rect x="6.4" y="1" width="2.5" height="9"/>
                        <rect x="9.6" y="0" width="2.5" height="10"/>
                      </svg>
                      {fmtInt(rating)}
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
              📅 {selected.date} — {selected.posts.length} постов
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
                <input type="number" min="0" value={minLikes} onChange={e=>setMinLikes?.(+e.target.value||0)}
                  style={{width:52,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:20,color:'var(--text)',fontFamily:'inherit',fontSize:11,padding:'4px 8px',outline:'none',textAlign:'center'}}/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11,color:'var(--dim)'}}>⭐ репа</span>
                <input type="number" min="0" step="100" value={minRating} onChange={e=>setMinRating?.(+e.target.value||0)}
                  style={{width:62,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:20,color:'var(--text)',fontFamily:'inherit',fontSize:11,padding:'4px 8px',outline:'none',textAlign:'center'}}/>
              </div>
              <span style={{fontSize:11,color:'var(--dim)',marginLeft:'auto'}}>{dayPosts.length} постов</span>
            </div>
            <div style={{marginTop:4}}>
              {dayPosts.length === 0
                ? <div className="empty-state">Нет постов по текущим фильтрам</div>
                : dayPosts.map(p => (
                  <PostCard key={p.id||p.url} p={p}
                    favorites={favorites||new Set()} onFav={onFav||(() =>{})}
                    onIgnore={onIgnore||(() =>{})} setLightbox={setLightbox||(() =>{})}/>
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
            onChange={e=>setMinLikes(+e.target.value||0)} title="Минимум лайков на посте"/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:3}} title="Минимальная репутация автора">
            <img src="https://www.gipsyteam.ru/public/style_images/master/reputation_pos.png" alt="rep"
              style={{width:12,height:12,objectFit:'contain'}} onError={e=>{e.target.style.display='none'}}/>
            репа
          </label>
          <input className="filter-num" type="number" min="0" step="100" value={minRating}
            onChange={e=>setMinRating(+e.target.value||0)} title="Минимальная репутация автора"/>
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
      <span className="filter-active-count">{count} постов</span>
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
const PostCard = memo(function PostCard({ p, favorites, onFav, onIgnore, setLightbox, noClamp=false }) {
  const [exp, setExp]     = useState(false)
  const [menu, setMenu]   = useState(false)
  const menuRef           = useRef(null)
  const isFav  = favorites.has(p.id)

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
            ? <img src={p.avatar} alt={p.author} onError={e=>{e.target.style.display='none'}}/>
            : initial}
        </div>
        {/* Dropdown меню профиля */}
        {menu && (
          <div ref={menuRef} style={{position:'absolute',top:44,left:12,background:'var(--bg-popup)',border:'1px solid var(--border-popup)',
            borderRadius:8,padding:'6px 0',zIndex:200,minWidth:160,boxShadow:'0 4px 20px rgba(0,0,0,.8)'}}
            onClick={e=>e.stopPropagation()}>
            {ROMEO_RE.test(p.author) && (
              <a href="https://forum.gipsyteam.ru/index.php?showforum=141" target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',color:'var(--dim2)',fontSize:12,textDecoration:'none'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
                onMouseLeave={e=>e.currentTarget.style.background=''}>
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
        <div style={{flex:1,minWidth:0}}>
          <div className="pc-author" style={{cursor:'pointer'}}
            onClick={e=>{e.stopPropagation();setMenu(m=>!m)}}>
            {p.author}
          </div>
          <div className="pc-author-meta">
            {p.msgCount && <span>{fmtInt(p.msgCount)} постов</span>}
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
                <span style={{fontFamily:"'Roboto Mono',monospace",fontWeight:700}}>{p.rating.toLocaleString()}</span>
              </a></>
            )}
          </div>
        </div>
        <div className="pc-date" title={p.date}>{timeAgo(p.timestamp) || p.date}</div>
        <div className="pc-actions">
          <button className={`pc-action ${isFav?'on':''}`} onClick={()=>onFav(p.id)} title="Избранное">⭐</button>
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
        <span className={`pc-likes ${likes>0?'pos':likes<0?'neg':'zero'}`}>{likes>0?'+':''}{likes} 👍</span>
        {p.brAfter && <span className="pc-br">БР: {fmtNum(p.brAfter)}</span>}
        {isLong && (
          <button onClick={()=>setExp(s=>!s)} style={{
            background:'none',border:'1px solid var(--border2)',borderRadius:20,
            color:'var(--dim2)',cursor:'pointer',fontFamily:'inherit',fontWeight:600,
            fontSize:11,padding:'3px 10px',display:'inline-flex',alignItems:'center',gap:4,
            marginLeft:4,transition:'all .15s',
          }}>
            <span style={{fontSize:9,opacity:.7}}>{exp?'▲':'▼'}</span>
            {exp ? 'свернуть' : 'читать'}
          </button>
        )}
        {p.url&&<a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
      </div>
    </div>
  )
})

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
  const extractBody = extractQuoteBody

  return (
    <div style={{padding:'6px 14px'}}
      onMouseLeave={()=>setHovered(null)}>

      {hovered !== null && (() => {
        const p = posts[hovered]
        if (!p) return null
        const left = Math.max(8, Math.min(popupPos.x - 310, window.innerWidth - 320))
        const top  = Math.max(8, Math.min(popupPos.y - 40, window.innerHeight - 420))
        return (
          <div className="sidebar-popup" style={{
            position:'fixed', left, top,
            width:300, background:'var(--bg-popup)', border:'1px solid var(--border-popup)',
            borderRadius:8, padding:14, zIndex:9999,
            boxShadow:'var(--shadow-popup)',
            pointerEvents:'auto',
            maxHeight: Math.min(window.innerHeight - top - 16, 480),
            display:'flex', flexDirection:'column',
          }}>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:4}}>{p.author}</div>
            <div style={{fontSize:11,color:'var(--green)',marginBottom:8,fontFamily:"'Roboto Mono',monospace"}}>
              +{p.likes} 👍 · {p.date}
            </div>
            <div style={{fontSize:12,color:'var(--text)',lineHeight:1.6,overflowY:'auto',flex:1,paddingRight:4}}>
              {p.images?.[0] && (
                <img src={p.images[0]} alt="" style={{maxWidth:'100%',borderRadius:4,marginBottom:10,display:'block'}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              {renderPostText(p.text, true)}
              {!stripQuotes(p.text) && p.text?.includes('[QUOTE]') && (
                <div style={{fontSize:11,color:'var(--dim)',fontStyle:'italic',marginTop:6}}>
                  ответ обрезан — полный текст на форуме
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
        const preview = clean || (p.images?.[0] ? '📷 изображение' : '↩ цитата')
        const initial = (p.author||'?')[0].toUpperCase()
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
                ? <img src={p.avatar} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
                : initial}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,color:'var(--dim2)',fontWeight:600,marginBottom:2}}>{p.author}</div>
              {p.images?.[0] && !clean && (
                <img src={p.images[0]} alt=""
                  style={{width:48,height:36,objectFit:'cover',borderRadius:3,marginBottom:3,display:'block'}}
                  onClick={e=>{e.stopPropagation();setLightbox(p.images[0])}}
                  onError={e=>e.target.style.display='none'}/>
              )}
              <div style={{fontSize:11,color:'var(--text)',overflow:'hidden',lineHeight:1.5,
                display:'-webkit-box',WebkitLineClamp:4,WebkitBoxOrient:'vertical'}}>
                {preview.substring(0,160)}
              </div>
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
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_favs')||'[]')) } catch { return new Set() }
  })
  const [ignoreInput, setIgnoreInput] = useState('')

  useEffect(() => {
    const loadData = () =>
      fetchPublicData()
        .then(({posts, meta}) => { setPosts(posts||[]); setMeta(meta||{}) })
        .catch(() => {})

    loadData().finally(() => setLoading(false))
    const interval = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Apply theme class to root
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    try { localStorage.setItem('rpt_theme', theme) } catch {}
  }, [theme])

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

      // День из текста постов Ромео (как он сам нумерует), fallback на кол-во сессий
      const romeoByDate = posts.filter(p => ROMEO_RE.test(p.author)).sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
      let day = null
      for (const p of romeoByDate) { day = extractDay(p.text); if (day) break }
      if (!day) day = brHistory.length

      return { br, profit, startBR, day, lastDate: last.date, totalTourneys }
    }

    if (!posts.length) return { startBR }
    const romeoByDate = posts
      .filter(p => /romeopro/i.test(p.author))
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

  // hotPosts — для сайдбара "Больше всего плюсиков"
  const hotPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author))
      .filter(p => !minRating || (p.rating||0) >= minRating)
      .filter(p => (p.likes||0) >= Math.max(minLikes, 1))
      .sort((a,b) => (b.likes||0) - (a.likes||0))
  , [posts, ignored, minLikes, minRating])

  const feedPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author))
      .filter(p => !romeoOnly || /romeopro/i.test(p.author))
      .filter(p => !search || p.text?.toLowerCase().includes(search.toLowerCase()))
      .filter(p => !minLikes  || (p.likes||0)  >= minLikes)
      .filter(p => !minRating || (p.rating||0) >= minRating)
      .sort((a,b) => {
        if (sortBy==='date_desc') return (b.timestamp||0)-(a.timestamp||0)
        if (sortBy==='date_asc')  return (a.timestamp||0)-(b.timestamp||0)
        if (sortBy==='likes')     return (b.likes||0)-(a.likes||0)
        return 0
      }),
  [posts, ignored, search, sortBy, romeoOnly, minLikes, minRating])

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
  }, [ignored, search, sortBy, romeoOnly, minLikes, minRating]) // eslint-disable-line

  // Восстанавливаем позицию чтения при первой загрузке постов
  useEffect(() => {
    if (!feedPosts.length || !readPos.feed) return
    const idx = feedPosts.findIndex(p => p.id === readPos.feed)
    if (idx !== -1) setPage(Math.floor(idx / perPage) + 1)
  }, [feedPosts.length]) // только когда посты впервые появились

  const totalPages = Math.max(1, Math.ceil(feedPosts.length / perPage))
  const pagedPosts = feedPosts.slice((page-1)*perPage, page*perPage)

  // ── КЛАССИФИКАЦИЯ ПО ТЕМАМ (один проход) ────────────────────────────────
  // ── Детектор подтем ──────────────────────────────────────────────────────────
  const detectSubtopic = (text, likes) => {
    const t = text || ''
    if (/шахмат|гнат\b|gnat\b/i.test(t))                                            return 'chess'
    if (/долг|должен|кредит|занял|мистер|инвестор|отдаст|бекер|должник/i.test(t))  return 'debt'
    if (/стратег|дисперси|рои\b|roi\b|abi\b|аби\b|скилл|brm\b/i.test(t))           return 'strategy'
    if (/психолог|тилт\b|tilt\b|эмоц|дисциплин|мышлени/i.test(t))                  return 'psychology'
    if (/стрим|твич|twitch|ютуб|youtube|блог|донат/i.test(t))                       return 'stream'
    if (likes >= 50)                                                                  return 'hot'
    return 'other'
  }

  const classifiedPosts = useMemo(() => {
    if (!posts.length) return { marathon:[], discussion:[], debate:[], flood:[] }
    const result = { marathon:[], discussion:[], debate:[], flood:[] }

    posts.forEach(p => {
      if (ignored.has(p.author)) return
      if (minLikes  && (p.likes||0)  < minLikes)  return
      if (minRating && (p.rating||0) < minRating) return
      if (search && !p.text?.toLowerCase().includes(search.toLowerCase())) return
      const text = p.text || ''
      const likes = p.likes || 0

      if (ROMEO_RE.test(p.author)) {
        // Марафон = все посты Ромео + обсуждение его постов
        result.marathon.push(p)
      } else if (ROMEO_RE.test(text) && (text.length > 80 || likes >= 5)) {
        // Обсуждение = упоминают Ромео, отвечают на него
        result.discussion.push({ ...p, _subtopic: detectSubtopic(text, likes) })
      } else if (text.length > 300 && likes >= 20) {
        // Дебаты = длинный контент с лайками, разбитый по темам
        result.debate.push({ ...p, _subtopic: detectSubtopic(text, likes) })
      } else {
        result.flood.push({ ...p, _subtopic: detectSubtopic(text, likes) })
      }
    })

    const byLikes = (a,b) => (b.likes||0)-(a.likes||0)
    const byDate  = (a,b) => (b.timestamp||0)-(a.timestamp||0)
    result.marathon.sort(byDate)
    result.discussion.sort(byDate)
    result.debate.sort(byLikes)   // дебаты по лайкам — лучший контент сверху
    result.flood.sort(byDate)
    return result
  }, [posts, ignored, minLikes, minRating, search])

  const [topicTab, setTopicTab] = useState('marathon')
  const [topicPage, setTopicPage] = useState(1)
  const [topicSubtopic, setTopicSubtopic] = useState(null)
  const [topicSortByRaw, setTopicSortByRaw] = useState(() => { try { return localStorage.getItem('rpt_topic_sortby') || 'date_desc' } catch { return 'date_desc' } })
  const setTopicSortBy = v => { setTopicSortByRaw(v); try { localStorage.setItem('rpt_topic_sortby', v) } catch {} }
  const TOPIC_PER_PAGE = 20

  const currentTopicPosts = useMemo(() => {
    let all = [...(classifiedPosts[topicTab] || [])]
    if (topicSubtopic) all = all.filter(p => p._subtopic === topicSubtopic)
    if (topicSortByRaw === 'date_asc')  all.sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
    else if (topicSortByRaw === 'likes') all.sort((a,b) => (b.likes||0) - (a.likes||0))
    else all.sort((a,b) => (b.timestamp||0) - (a.timestamp||0)) // date_desc по умолчанию
    return {
      all,
      paged: all.slice((topicPage-1)*TOPIC_PER_PAGE, topicPage*TOPIC_PER_PAGE),
      totalPages: Math.max(1, Math.ceil(all.length / TOPIC_PER_PAGE))
    }
  }, [classifiedPosts, topicTab, topicPage, topicSubtopic, topicSortByRaw])

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

  // При смене вкладки сбрасываем на страницу с последним прочитанным постом
  const switchTab = (tab) => {
    setActiveTab(tab)
    setPage(1)
    setTopicPage(1)
  }

  const toggleFav = useCallback(id => {
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem('rpt_favs', JSON.stringify([...next]))
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

  // ── ANIMATED COUNTER ─────────────────────────────────────────────────────
  const brVal  = stats?.br || meta?.bankroll || 0

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

      <div className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            <div className="logo-badge" style={{background:'var(--red)',padding:0,width:32,height:32,overflow:'hidden',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <img src="https://www.gipsyteam.ru/favicon.ico" alt="GT"
                style={{width:32,height:32,objectFit:'contain'}}
                onError={e=>{e.target.style.display='none'}}/>
              <span style={{position:'absolute',color:'#fff',fontWeight:900,fontSize:14,fontFamily:'Arial,sans-serif',display:'none'}} className="_gt_fallback">G</span>
            </div>
            <div>
              <div className="logo-text">RomeoPro Tracker</div>
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
        // Логарифмический прогресс: выглядит честнее на длинных дистанциях
        const logProgress = Math.max(0.003,
          Math.log10(Math.max(1, stats.br) / start) / Math.log10(target / start)
        )
        const pct = Math.min(100, logProgress * 100)
        return (
          <div className="marathon-progress" title={`Прогресс к $10M: ${(pct).toFixed(3)}%`}>
            <div className="marathon-progress-fill" style={{width:`${pct}%`}}/>
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
                    alt="Romeopro" onError={e=>e.target.style.display='none'}/>
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
                  <div className={`hstat-value ${brVal?'green':''}`} style={{fontSize:18}}>
                    <AnimatedValue target={brVal} format={fmtExact} />
                  </div>
                  <div className="hstat-sub">старт: {fmtExact(stats.startBR)}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Профит</div>
                  <div className={`hstat-value ${!stats.profit?'':stats.profit>=0?'green':'red'}`} style={{fontSize:18}}>
                    {fmtBR(stats.profit)}
                  </div>
                  {stats.totalTourneys != null && (
                    <div className="hstat-sub">{fmtInt(stats.totalTourneys)} турниров</div>
                  )}
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
              const TABS = [
                { id:'marathon',   icon:'📈', label:'Марафон',    desc:'Посты Ромео + реакции на него' },
                { id:'discussion', icon:'💬', label:'Обсуждение', desc:'Реакции форумчан на Ромео' },
                { id:'debate',     icon:'🔥', label:'Дебаты',     desc:'Топ-контент по темам' },
                { id:'flood',      icon:'💨', label:'Флуд',       desc:'Прочее' },
              ]
              const SUBTOPICS = {
                debate: [
                  { id:null,         label:'Все' },
                  { id:'debt',       label:'💰 Долги/Мистеры' },
                  { id:'strategy',   label:'📊 Стратегия' },
                  { id:'psychology', label:'🧠 Психология' },
                  { id:'chess',      label:'♟ Шахматы/Гнат' },
                  { id:'stream',     label:'📺 Стримы' },
                  { id:'hot',        label:'🔥 Горячие' },
                ],
                flood: [
                  { id:null,       label:'Все' },
                  { id:'chess',    label:'♟ Шахматы/Гнат' },
                  { id:'stream',   label:'📺 Стримы' },
                  { id:'debt',     label:'💰 Долги' },
                  { id:'hot',      label:'🔥 Горячие' },
                ],
                discussion: [
                  { id:null,         label:'Все' },
                  { id:'debt',       label:'💰 Долги' },
                  { id:'strategy',   label:'📊 Стратегия' },
                  { id:'psychology', label:'🧠 Психология' },
                ],
              }
              const { paged, totalPages: tpg, all } = currentTopicPosts
              const subtopics = SUBTOPICS[topicTab]
              const hasSub = subtopics && subtopics.length > 1
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
                {/* Выбор темы */}
                <div className="topic-tabs">
                  {TABS.map(t => (
                    <div key={t.id}
                      className={`topic-tab ${topicTab===t.id?'active':''}`}
                      onClick={()=>{ setTopicTab(t.id); setTopicPage(1); setTopicSubtopic(null) }}>
                      {t.icon} {t.label}
                      <span className="tc">{classifiedPosts[t.id]?.length||0}</span>
                    </div>
                  ))}
                </div>

                {/* Подтемы */}
                {hasSub && (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',margin:'8px 0',padding:'2px 0'}}>
                    {subtopics.map(s => {
                      const count = s.id
                        ? classifiedPosts[topicTab]?.filter(p => p._subtopic === s.id).length || 0
                        : classifiedPosts[topicTab]?.length || 0
                      if (count === 0 && s.id) return null
                      return (
                        <button key={String(s.id)} onClick={()=>{ setTopicSubtopic(s.id); setTopicPage(1) }}
                          style={{
                            background: topicSubtopic===s.id ? 'var(--red)' : 'var(--bg3)',
                            border: '1px solid ' + (topicSubtopic===s.id ? 'var(--red)' : 'var(--border)'),
                            borderRadius:20, color: topicSubtopic===s.id ? '#fff' : 'var(--dim2)',
                            fontSize:11, padding:'4px 10px', cursor:'pointer', fontFamily:'inherit',
                          }}>
                          {s.label} <span style={{opacity:.6,fontSize:10}}>{count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Описание */}
                <div style={{fontSize:12,color:'var(--dim)',marginBottom:10}}>
                  {TABS.find(t=>t.id===topicTab)?.desc} · {all.length} постов
                </div>

                {all.length===0
                  ? <div className="empty-state">Постов в этой категории нет</div>
                  : <>
                    <Paginator page={topicPage} totalPages={tpg} onPage={goTopicPage}
                      perPage={TOPIC_PER_PAGE} onPerPage={()=>{}} total={all.length}/>
                    {paged.map(p=>(
                      <PostCard key={p.id||p.url} p={p}
                        favorites={favorites} onFav={toggleFav}
                        onIgnore={addIgnore} setLightbox={setLightbox}
                        noClamp={topicTab==='marathon'}/>
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
                  ['БР', fmtExact(stats.br||meta?.bankroll), stats.br?'green':''],
                  ['Профит', fmtBR(stats.profit), !stats.profit?'':stats.profit>=0?'green':'red'],
                  ['День', `#${stats.day||meta?.day||'—'}`, 'gold'],
                  ['МТТ', fmtInt(meta?.totalTournaments ?? 3565), ''],
                ].map(([k,v,cls])=>(
                  <div key={k} className="mobile-stat">
                    <div className="mobile-stat-label">{k}</div>
                    <div className={`mobile-stat-value ${cls}`}>{v}</div>
                  </div>
                ))}
              </div>
              <MarathonChart posts={posts} meta={meta} startBR={stats.startBR} setLightbox={setLightbox} day={stats.day}/>
              <ActivityChart posts={posts}
                favorites={favorites} onFav={toggleFav}
                onIgnore={addIgnore} setLightbox={setLightbox}
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
                const topList = (filtered.length ? filtered : hotPosts).slice(0,5)
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
                            <span className="mobile-top-text">{stripQuoteTags(p.text)?.substring(0,60) || '→ форум'}</span>
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
              {feedPosts.length===0
                ? <div className="empty-state">Постов нет — смягчите фильтры или запустите скрапер</div>
                : <>
                  <Paginator page={page} totalPages={totalPages} onPage={goPage}
                    perPage={perPage} onPerPage={setPerPage} total={feedPosts.length} />
                  {pagedPosts.map((p,i)=>(
                    <div key={p.id||p.url} id={`post-${p.id}`}
                      onMouseEnter={()=>{ if(i===pagedPosts.length-1) saveReadPos('feed',p.id) }}>
                      <PostCard p={p}
                        favorites={favorites} onFav={toggleFav}
                        onIgnore={addIgnore} setLightbox={setLightbox}/>
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
                    ['Постов', <span key="p" className="srow-val">{fmtInt(posts.length)}</span>],
                    ['Топ лайков', <span key="l" className="srow-val">{hotPosts[0]?`+${hotPosts[0].likes}`:'—'}</span>],
                  ].map(([k,v])=>(
                    <div key={k} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
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
                <span style={{color:'var(--dim2)',fontWeight:600}}>RomeoPro Tracker</span>
                {' '}
                <span style={{color:'#444'}}>v2.1</span>
              </div>
              <div style={{fontSize:10,color:'#444',marginBottom:4}}>
                made by{' '}
                <a href="https://t.me/loremnopoker" target="_blank" rel="noreferrer"
                  style={{color:'var(--dim)',textDecoration:'none'}}>LoremCDMX</a>
              </div>
              <div style={{fontSize:10,color:'#333'}}>
                обновлено: 08.04.2025
              </div>
            </div>

            {/* Правая часть — чейнджлог */}
            <div style={{maxWidth:420}}>
              <div style={{fontSize:10,color:'#444',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8,fontWeight:600}}>
                Changelog
              </div>
              {[
                ['08.04', 'v2.1', 'Автоскрапер через GitHub Actions (каждые 30 мин). Авторазбор скриншотов БР через Claude API. Мобилка: статистика и топ постов прямо в ленте. Широкий макет сайта. Пунктирные направляющие на графике'],
                ['08.04', 'v2.0', 'Полный рефакторинг: стили, компоненты, хуки вынесены из App.jsx. Быстрая загрузка. Плавные кривые без горбов. Белая тема. Анимированный счётчик БР. Прогресс-бар $10k→$10M'],
                ['07.04', 'v1.3', 'График с bezier-кривыми и анимацией. Мобильная вёрстка'],
                ['06.04', 'v1.2', 'Виджет активности по дням. Топ-10 постов. Автообновление'],
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
