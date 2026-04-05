import { useState, useEffect, useMemo, useRef } from 'react'
import { fetchPublicData } from './storage.js'

const REPO = 'loremcdmx/romeoprotracker'

// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#111;--bg2:#1a1a1a;--bg3:#222;
    --border:#2d2d2d;--border2:#383838;
    --red:#e53935;--red2:#ff5252;--red-dim:#2a1010;
    --text:#d4d4d4;--dim:#666;--dim2:#888;
    --green:#4caf50;--gold:#ffb300;--white:#f0f0f0;
    --r:6px;
  }
  html,body,#root{min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5}
  a{color:var(--red2);text-decoration:none}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:#333;border-radius:3px}

  /* TOPBAR */
  .topbar{background:#0a0a0a;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
  .topbar-inner{max-width:1100px;margin:0 auto;padding:0 16px;display:flex;align-items:center;height:46px;gap:16px}
  .logo{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .logo-badge{background:var(--red);color:#fff;font-size:12px;font-weight:800;width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center}
  .logo-text{font-size:14px;font-weight:700;color:var(--white)}
  .logo-sub{font-size:10px;color:var(--dim)}
  .topbar-tabs{display:flex;gap:2px;flex:1;justify-content:center}
  .topbar-tab{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;color:var(--dim2);cursor:pointer;transition:all .15s}
  .topbar-tab:hover{color:var(--text);background:var(--bg3)}
  .topbar-tab.active{color:var(--white);background:var(--bg3)}
  .topbar-right{margin-left:auto;display:flex;align-items:center;gap:6px}
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  .live-label{font-size:11px;color:var(--green);font-weight:600}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}

  /* LAYOUT */
  .page{max-width:1100px;margin:0 auto;padding:16px 16px 60px;display:grid;grid-template-columns:1fr 268px;gap:16px;align-items:start}
  .page.wide{grid-template-columns:1fr}

  /* HERO */
  .hero{background:linear-gradient(135deg,#1a0a0a 0%,#1a1a1a 100%);border:1px solid var(--border);border-radius:var(--r);padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,#e5393520,transparent 70%);pointer-events:none}
  .hero-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:16px}
  .hero-avatar{width:52px;height:52px;border-radius:50%;background:var(--red);flex-shrink:0;border:2px solid #e5393540;overflow:hidden}
  .hero-avatar img{width:100%;height:100%;object-fit:cover}
  .hero-name{font-size:18px;font-weight:700;color:var(--white);display:flex;align-items:center;gap:8px}
  .hero-badge{background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase}
  .hero-desc{font-size:11px;color:var(--dim2);margin-top:2px}
  .hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .hstat{background:#ffffff08;border:1px solid var(--border);border-radius:5px;padding:12px}
  .hstat-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
  .hstat-value{font-size:20px;font-weight:700;color:var(--white);font-family:'Roboto Mono',monospace;line-height:1.2}
  .hstat-value.green{color:#66bb6a}.hstat-value.gold{color:var(--gold)}.hstat-value.red{color:var(--red2)}
  .hstat-sub{font-size:10px;color:var(--dim);margin-top:3px}

  /* SECTION */
  .section-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .section-title{font-size:12px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.1em}
  .section-count{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--dim)}

  /* MARATHON CHART */
  .marathon-chart{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:20px;margin-bottom:16px;position:relative}
  .mc-svg{width:100%;overflow:visible;cursor:crosshair}
  .mc-area{fill:url(#mcGrad);opacity:.25}
  .mc-line{fill:none;stroke:#e53935;stroke-width:2;stroke-linejoin:round}
  .mc-dot{stroke:#111;stroke-width:2;cursor:pointer;transition:r .1s}
  .mc-label{font-size:9px;fill:#555;text-anchor:middle;font-family:'Roboto Mono',monospace}
  .mc-ylabel{font-size:9px;fill:#555;text-anchor:end;font-family:'Roboto Mono',monospace}
  .mc-zero{stroke:#2a2a2a;stroke-width:1;stroke-dasharray:4 3}
  .mc-grid{stroke:#1e1e1e;stroke-width:1}
  .mc-tooltip{position:absolute;background:#1c1c1c;border:1px solid #3a3a3a;border-radius:8px;padding:12px 14px;pointer-events:none;z-index:20;min-width:220px;max-width:270px;box-shadow:0 8px 32px rgba(0,0,0,.7)}

  /* ACTIVITY CHART */
  .chart-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:16px;position:relative}
  .chart-svg{width:100%;overflow:visible}
  .chart-label{font-size:9px;fill:#555;text-anchor:middle;font-family:'Roboto Mono',monospace}
  .chart-tooltip{position:absolute;background:#1c1c1c;border:1px solid #3a3a3a;border-radius:6px;padding:10px 12px;pointer-events:none;z-index:20;min-width:180px;max-width:240px;box-shadow:0 4px 20px rgba(0,0,0,.6)}

  /* HOT POSTS */
  .hot-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
  .hot-item{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;transition:border-color .15s}
  .hot-item:hover{border-color:var(--border2)}
  .hot-head{display:flex;gap:10px;align-items:flex-start;padding:14px 14px 10px}
  .hot-rank{font-size:22px;font-weight:800;color:var(--border2);font-family:'Roboto Mono',monospace;min-width:28px;flex-shrink:0;line-height:1.1}
  .hot-rank.top3{color:var(--gold)}
  .hot-body{flex:1;min-width:0}
  .hot-text{font-size:13px;color:var(--text);line-height:1.65}
  .hot-images{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 10px}
  .hot-img{max-width:200px;max-height:150px;border-radius:4px;border:1px solid var(--border);object-fit:cover;cursor:pointer;transition:border-color .15s}
  .hot-img:hover{border-color:#555}
  .hot-foot{display:flex;gap:10px;padding:8px 14px;border-top:1px solid var(--border);align-items:center;background:#ffffff03}
  .hot-likes{font-size:12px;color:var(--green);font-weight:700;font-family:'Roboto Mono',monospace}
  .hot-date{font-size:11px;color:var(--dim)}
  .hot-br-tag{background:var(--red-dim);color:var(--red2);border:1px solid #e5393540;border-radius:3px;padding:2px 8px;font-size:11px;font-weight:700;font-family:'Roboto Mono',monospace}
  .hot-link{font-size:11px;color:var(--dim);margin-left:auto}.hot-link:hover{color:var(--red2)}
  .btn-expand{background:none;border:none;color:var(--dim);font-size:11px;cursor:pointer;font-family:inherit;padding:0;margin-top:4px;display:block}
  .btn-expand:hover{color:var(--text)}

  /* FEED */
  .feed-filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
  .feed-select{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 10px;outline:none;cursor:pointer}
  .feed-search{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 12px;outline:none;flex:1;min-width:140px}
  .feed-search:focus,.feed-select:focus{border-color:#444}
  .feed-count{font-size:11px;color:var(--dim);margin-left:auto;white-space:nowrap}

  /* POST CARD */
  .post-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;overflow:hidden;transition:border-color .15s}
  .post-card:hover{border-color:var(--border2)}
  .post-card.faved{border-left:3px solid var(--gold)}
  .pc-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)}
  .pc-avatar{width:32px;height:32px;border-radius:50%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden}
  .pc-avatar img{width:100%;height:100%;object-fit:cover}
  .pc-author{font-weight:600;color:var(--white);font-size:13px}
  .pc-author-meta{font-size:10px;color:var(--dim);display:flex;gap:6px;flex-wrap:wrap;margin-top:1px}
  .pc-date{margin-left:auto;font-size:10px;color:var(--dim);font-family:'Roboto Mono',monospace;flex-shrink:0}
  .pc-actions{display:flex;gap:4px;flex-shrink:0}
  .pc-action{background:none;border:none;cursor:pointer;font-size:14px;padding:2px 3px;opacity:.35;transition:opacity .15s;color:var(--text)}
  .pc-action:hover,.pc-action.on{opacity:1}
  .pc-body{padding:10px 14px;font-size:13px;color:var(--text);line-height:1.65}
  .pc-body.clamped{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
  .pc-images{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
  .pc-img{max-width:160px;max-height:120px;border-radius:4px;cursor:pointer;border:1px solid var(--border);object-fit:cover;transition:border-color .15s}
  .pc-img:hover{border-color:#555}
  .pc-foot{display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid var(--border)}
  .pc-likes{font-size:12px;font-weight:600;font-family:'Roboto Mono',monospace}
  .pc-likes.pos{color:var(--green)}.pc-likes.neg{color:var(--red2)}.pc-likes.zero{color:var(--dim)}
  .pc-br{background:var(--red-dim);color:var(--red2);border:1px solid #e5393540;border-radius:3px;padding:1px 7px;font-size:11px;font-weight:700;font-family:'Roboto Mono',monospace}
  .pc-link{font-size:11px;color:var(--dim);margin-left:auto}.pc-link:hover{color:var(--red2)}

  /* SIDEBAR */
  .sidebar{display:flex;flex-direction:column;gap:12px}
  .sblock{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .sblock-title{padding:10px 14px;font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border);background:var(--bg3)}
  .sblock-body{padding:12px 14px}
  .srow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
  .srow:last-child{border-bottom:none}
  .srow-key{color:var(--dim2)}
  .srow-val{font-weight:600;font-family:'Roboto Mono',monospace;color:var(--white)}
  .srow-val.green{color:#66bb6a}.srow-val.gold{color:var(--gold)}.srow-val.red{color:var(--red2)}

  /* SETTINGS */
  .ignore-empty{font-size:12px;color:var(--dim);padding:12px 14px}
  .ignore-list{padding:8px 14px;display:flex;flex-direction:column;gap:5px}
  .ignore-item{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg3);border-radius:4px;font-size:12px}
  .ignore-remove{background:none;border:none;color:var(--dim);cursor:pointer;font-size:13px;line-height:1;padding:0}
  .ignore-remove:hover{color:var(--red2)}
  .ignore-add{display:flex;gap:6px;padding:6px 14px 12px}
  .ignore-input{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:12px;padding:6px 10px;outline:none}
  .ignore-input:focus{border-color:#444}
  .btn-sm{padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-family:inherit;transition:all .15s}
  .btn-sm:hover{border-color:#555;color:var(--white)}

  /* LIGHTBOX */
  .lightbox{position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:500;cursor:zoom-out}
  .lightbox img{max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 0 60px rgba(0,0,0,.8)}

  /* MISC */
  .loading{padding:80px;text-align:center;color:var(--dim);font-size:13px}
  .empty-state{padding:30px;text-align:center;color:var(--dim);font-size:12px}

  @media(max-width:720px){
    .page{grid-template-columns:1fr}
    .hero-stats{grid-template-columns:1fr 1fr}
    .topbar-tabs{display:none}
  }
`

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtBR = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : n > 0 ? '+' : ''
  if (abs >= 1_000_000) return s + '$' + (abs/1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return s + '$' + (abs/1_000).toFixed(1) + 'k'
  return s + '$' + abs
}

const fmtNum = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (abs/1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return '$' + (abs/1_000).toFixed(1) + 'k'
  return '$' + abs
}

function extractDay(text) {
  const m = text?.match(/(?:[Дд]ень|[Dd]ay)\s*#?\s*(\d+)/i)
  return m ? parseInt(m[1]) : null
}

function extractBR(text) {
  if (!text) return null
  // "после сессии: 9957"
  const m1 = text.match(/(?:после сессии|бр после)[:\s]+(\d[\d\s,]+)/i)
  if (m1) { const n = parseInt(m1[1].replace(/[\s,]/g,'')); if (n > 500 && n < 10_000_000) return n }
  // "$9.9k" формат
  const m2 = text.match(/\$\s?([\d.]+)\s*[kK]/)
  if (m2) { const n = parseFloat(m2[1]) * 1000; if (n > 500 && n < 10_000_000) return n }
  // "банкролл 9957"
  const m3 = text.match(/(?:банкролл|бр)[^\d]{0,20}(\d{4,6})/i)
  if (m3) { const n = parseInt(m3[1]); if (n > 500 && n < 10_000_000) return n }
  return null
}

// ─── MARATHON CHART ───────────────────────────────────────────────────────────
function MarathonChart({ posts, startBR, setLightbox }) {
  const [tip, setTip] = useState(null)

  const points = useMemo(() => {
    return posts
      .filter(p => p.author?.toLowerCase().includes('romeopro') && p.brAfter)
      .sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
      .map((p, i, arr) => ({
        br:     p.brAfter,
        brPrev: i === 0 ? startBR : arr[i-1].brAfter,
        date:   p.date,
        text:   p.text,
        url:    p.url,
        images: p.images || [],
      }))
  }, [posts, startBR])

  if (!points.length) return (
    <div className="marathon-chart">
      <div className="section-head"><span className="section-title">📈 График марафона</span></div>
      <div className="empty-state">
        Данных пока нет — запустите скрапер с OCR чтобы автоматически читать БР из таблиц Ромео
      </div>
    </div>
  )

  const W = 700, H = 160, pL = 52, pR = 16, pT = 12, pB = 28
  const minV = Math.min(...points.map(p=>p.br), startBR) * 0.97
  const maxV = Math.max(...points.map(p=>p.br), startBR) * 1.03
  const xOf  = i => pL + (i / Math.max(points.length-1, 1)) * (W-pL-pR)
  const yOf  = v => pT + (1 - (v-minV)/(maxV-minV)) * (H-pT-pB)
  const poly = points.map((p,i) => `${xOf(i)},${yOf(p.br)}`).join(' ')
  const area = `M${pL},${pT+H-pT-pB} ` + points.map((p,i)=>`L${xOf(i)},${yOf(p.br)}`).join(' ') + ` L${xOf(points.length-1)},${pT+H-pT-pB} Z`
  const yTicks = [0,.25,.5,.75,1].map(t => ({ v: minV+(maxV-minV)*t, y: yOf(minV+(maxV-minV)*t) }))
  const fk = v => v>=1000?`$${(v/1000).toFixed(1)}k`:`$${Math.round(v)}`

  return (
    <div className="marathon-chart">
      <div className="section-head" style={{marginBottom:12}}>
        <span className="section-title">📈 График марафона</span>
        <span className="section-count">{points.length} сессий</span>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--dim)'}}>
          {fk(startBR)} → {fk(points[points.length-1]?.br)}
        </span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H}`} onMouseLeave={()=>setTip(null)}>
        <defs>
          <linearGradient id="mcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e53935" stopOpacity=".5"/>
            <stop offset="100%" stopColor="#e53935" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {yTicks.map(({v,y},i) => (
          <g key={i}>
            <line x1={pL} y1={y} x2={W-pR} y2={y} className="mc-grid"/>
            <text x={pL-5} y={y+3} className="mc-ylabel">{fk(v)}</text>
          </g>
        ))}
        <line x1={pL} y1={yOf(startBR)} x2={W-pR} y2={yOf(startBR)} className="mc-zero"/>
        <path d={area} className="mc-area"/>
        <polyline points={poly} className="mc-line"/>
        {points.map((p,i) => {
          const profit = p.br - p.brPrev
          const showL = i===0 || i===points.length-1 || i%Math.ceil(points.length/8)===0
          return (
            <g key={i}>
              <circle cx={xOf(i)} cy={yOf(p.br)} r={4} className="mc-dot"
                fill={profit>=0?'#4caf50':'#e53935'}
                onMouseEnter={()=>setTip({p,profit,x:xOf(i),y:yOf(p.br)})}
                onClick={()=>p.url&&window.open(p.url,'_blank')}
              />
              {showL && <text x={xOf(i)} y={H-4} className="mc-label">{p.date?.slice(0,5)}</text>}
            </g>
          )
        })}
      </svg>
      {tip && (() => {
        const pct = (tip.x/W)*100
        const right = pct>60
        return (
          <div className="mc-tooltip" style={{
            bottom: (H-tip.y+16)+'px',
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:13,marginBottom:5}}>{tip.p.date}</div>
            <div style={{display:'flex',gap:12,fontSize:12,marginBottom:8}}>
              <span style={{color:'#888'}}>БР: <b style={{color:'#fff'}}>{fk(tip.p.br)}</b></span>
              <span style={{color:tip.profit>=0?'#66bb6a':'#ff5252',fontWeight:700}}>
                {tip.profit>=0?'+':''}{fk(tip.profit)}
              </span>
            </div>
            {tip.p.text && (
              <div style={{fontSize:11,color:'#bbb',lineHeight:1.6,
                display:'-webkit-box',WebkitLineClamp:4,WebkitBoxOrient:'vertical',overflow:'hidden',
                marginBottom:tip.p.images.length?8:0}}>
                {tip.p.text.substring(0,200)}
              </div>
            )}
            {tip.p.images[0] && (
              <img src={tip.p.images[0]} alt="" onClick={()=>setLightbox(tip.p.images[0])}
                style={{maxWidth:'100%',maxHeight:90,objectFit:'cover',borderRadius:4,cursor:'pointer',marginTop:4}}
                onError={e=>e.target.style.display='none'} />
            )}
            <div style={{fontSize:10,color:'#555',marginTop:6}}>кликни на точку → форум</div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── ACTIVITY CHART ───────────────────────────────────────────────────────────
function ActivityChart({ posts }) {
  const [tip, setTip] = useState(null)

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

  if (!data.length) return null
  const max = Math.max(...data.map(d=>d[1].count), 1)
  const W=600, H=70, pad=3

  return (
    <div className="chart-wrap">
      <div className="section-head" style={{marginBottom:8}}>
        <span className="section-title">Активность постов</span>
        <span className="section-count">последние {data.length} дней</span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H+18}`} onMouseLeave={()=>setTip(null)}>
        {data.map(([date, {count, posts:dp}], i) => {
          const bw = (W-pad*(data.length-1))/data.length
          const x  = i*(bw+pad)
          const bh = Math.max(3,(count/max)*H)
          const showL = i===0||i===data.length-1||i%Math.ceil(data.length/6)===0
          const top   = [...dp].sort((a,b)=>(b.likes||0)-(a.likes||0))[0]
          return (
            <g key={date} style={{cursor:'pointer'}}
              onMouseEnter={()=>setTip({date,count,top,x:x+bw/2})}
              onClick={()=>top?.url&&window.open(top.url,'_blank')}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2}
                fill={tip?.date===date?'#e5393570':'#e5393530'} style={{transition:'fill .1s'}}/>
              {showL&&<text x={x+bw/2} y={H+14} className="chart-label">{date.slice(5)}</text>}
            </g>
          )
        })}
      </svg>
      {tip && (() => {
        const pct = (tip.x/W)*100
        const right = pct>65
        return (
          <div className="chart-tooltip" style={{
            bottom:52,
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:12,marginBottom:5}}>📅 {tip.date}</div>
            <div style={{fontSize:11,color:'#888',marginBottom:tip.top?6:0}}>
              {tip.count} {tip.count===1?'пост':'постов'}
            </div>
            {tip.top&&<>
              <div style={{fontSize:11,color:'#e53935',fontWeight:600,marginBottom:3}}>
                🔥 Топ {tip.top.likes>0?`+${tip.top.likes} 👍`:''}
              </div>
              <div style={{fontSize:11,color:'#bbb',lineHeight:1.5,
                display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                {tip.top.text?.substring(0,120)}
              </div>
              <div style={{fontSize:10,color:'#555',marginTop:5}}>кликни → форум</div>
            </>}
          </div>
        )
      })()}
    </div>
  )
}

// ─── HOT POST CARD ────────────────────────────────────────────────────────────
function HotPostCard({ p, rank, setLightbox }) {
  const [exp, setExp] = useState(false)
  return (
    <div className="hot-item">
      <div className="hot-head">
        <div className={`hot-rank ${rank<3?'top3':''}`}>{rank+1}</div>
        <div className="hot-body">
          <div className="hot-text">{exp ? p.text : p.text?.substring(0,300)}{!exp&&p.text?.length>300?'…':''}</div>
          {p.text?.length>300 && (
            <button className="btn-expand" onClick={()=>setExp(s=>!s)}>
              {exp?'▲ свернуть':'▼ читать полностью'}
            </button>
          )}
        </div>
      </div>
      {p.images?.length>0 && (
        <div className="hot-images">
          {p.images.map((src,j)=>(
            <img key={j} className="hot-img" src={src} alt=""
              onClick={()=>setLightbox(src)} onError={e=>e.target.style.display='none'}/>
          ))}
        </div>
      )}
      <div className="hot-foot">
        <span className="hot-likes">+{p.likes||0} 👍</span>
        {p.brAfter && <span className="hot-br-tag">БР: {fmtNum(p.brAfter)}</span>}
        <span className="hot-date">{p.date}</span>
        {p.url&&<a className="hot-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
      </div>
    </div>
  )
}

// ─── POST CARD ────────────────────────────────────────────────────────────────
function PostCard({ p, favorites, onFav, onIgnore, setLightbox }) {
  const [exp, setExp] = useState(false)
  const isFav = favorites.has(p.id)
  const likes = p.likes || 0
  const initial = (p.author||'?')[0].toUpperCase()

  return (
    <div className={`post-card ${isFav?'faved':''}`}>
      <div className="pc-head">
        <div className="pc-avatar">
          {p.avatar
            ? <img src={p.avatar} alt={p.author} onError={e=>{e.target.style.display='none'}}/>
            : initial}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div className="pc-author">{p.author}</div>
          <div className="pc-author-meta">
            {p.msgCount && <span>{p.msgCount.toLocaleString()} постов</span>}
            {p.regData  && <span>· {p.regData}</span>}
            {p.rating != null && <span>· ⭐{p.rating}</span>}
          </div>
        </div>
        <div className="pc-date">{p.date}</div>
        <div className="pc-actions">
          <button className={`pc-action ${isFav?'on':''}`} onClick={()=>onFav(p.id)} title="Избранное">⭐</button>
          <button className="pc-action" onClick={()=>onIgnore(p.author)} title="Игнорировать">🚫</button>
        </div>
      </div>
      <div className={`pc-body ${!exp?'clamped':''}`}>{p.text}</div>
      {p.images?.length>0 && (
        <div className="pc-images">
          {p.images.map((src,j)=>(
            <img key={j} className="pc-img" src={src} alt=""
              onClick={()=>setLightbox(src)} onError={e=>e.target.style.display='none'}/>
          ))}
        </div>
      )}
      <div className="pc-foot">
        <span className={`pc-likes ${likes>0?'pos':likes<0?'neg':'zero'}`}>{likes>0?'+':''}{likes} 👍</span>
        {p.brAfter && <span className="pc-br">БР: {fmtNum(p.brAfter)}</span>}
        <button className="btn-expand" style={{marginLeft:4}} onClick={()=>setExp(s=>!s)}>
          {exp?'▲ свернуть':'▼ читать'}
        </button>
        {p.url&&<a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
      </div>
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
  const [sortBy,  setSortBy]  = useState('date_desc')
  const [search,  setSearch]  = useState('')
  const [ignored, setIgnored] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_ignored')||'[]')) } catch { return new Set() }
  })
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_favs')||'[]')) } catch { return new Set() }
  })
  const [ignoreInput, setIgnoreInput] = useState('')

  useEffect(() => {
    fetchPublicData()
      .then(({posts, meta}) => { setPosts(posts||[]); setMeta(meta||{}) })
      .catch(() => setMeta({}))
      .finally(() => setLoading(false))
  }, [])

  // Stats из постов Ромео
  const stats = useMemo(() => {
    const startBR = meta?.startBankroll || 10000
    if (!posts.length) return { startBR }
    const romeoByDate = posts
      .filter(p => p.author?.toLowerCase().includes('romeopro'))
      .sort((a,b) => (b.timestamp||0)-(a.timestamp||0))

    let day = null, br = null
    for (const p of romeoByDate) {
      if (!day) day = extractDay(p.text)
      if (!br)  br  = p.brAfter || extractBR(p.text)
      if (day && br) break
    }
    const profit = br ? br - startBR : null
    return { day, br, profit, startBR, lastDate: romeoByDate[0]?.date }
  }, [posts, meta])

  const hotPosts = useMemo(() =>
    [...posts].filter(p=>(p.likes||0)>0).sort((a,b)=>(b.likes||0)-(a.likes||0)).slice(0,10),
  [posts])

  const feedPosts = useMemo(() =>
    posts
      .filter(p => !ignored.has(p.author))
      .filter(p => !search || p.text?.toLowerCase().includes(search.toLowerCase()))
      .sort((a,b) => {
        if (sortBy==='date_desc') return (b.timestamp||0)-(a.timestamp||0)
        if (sortBy==='date_asc')  return (a.timestamp||0)-(b.timestamp||0)
        if (sortBy==='likes')     return (b.likes||0)-(a.likes||0)
        return 0
      }),
  [posts, ignored, search, sortBy])

  const toggleFav = id => {
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem('rpt_favs', JSON.stringify([...next]))
      return next
    })
  }

  const addIgnore = name => {
    if (!name?.trim()) return
    setIgnored(prev => {
      const next = new Set(prev)
      next.add(name.trim())
      localStorage.setItem('rpt_ignored', JSON.stringify([...next]))
      return next
    })
    setIgnoreInput('')
  }

  const removeIgnore = name => {
    setIgnored(prev => {
      const next = new Set(prev)
      next.delete(name)
      localStorage.setItem('rpt_ignored', JSON.stringify([...next]))
      return next
    })
  }

  return (
    <>
      <style>{css}</style>

      {lightbox && (
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt=""/>
        </div>
      )}

      <div className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            <div className="logo-badge">GT</div>
            <div>
              <div className="logo-text">RomeoPro Tracker</div>
              <div className="logo-sub">марафон $10k → $10M</div>
            </div>
          </div>
          <div className="topbar-tabs">
            {[['feed','Лента'],['hot','Топ постов'],['settings','Настройки']].map(([id,label])=>(
              <div key={id} className={`topbar-tab ${activeTab===id?'active':''}`} onClick={()=>setActiveTab(id)}>{label}</div>
            ))}
          </div>
          <div className="topbar-right">
            <div className="live-dot"/><span className="live-label">LIVE</span>
          </div>
        </div>
      </div>

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
                <div style={{flex:1}}>
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
                  <div className={`hstat-value ${stats.br?'green':''}`}>{fmtNum(stats.br||meta?.bankroll)}</div>
                  <div className="hstat-sub">старт: {fmtNum(stats.startBR)}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Профит</div>
                  <div className={`hstat-value ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>
                    {fmtBR(stats.profit)}
                  </div>
                  <div className="hstat-sub">от старта марафона</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">День марафона</div>
                  <div className="hstat-value gold">#{stats.day||meta?.day||'—'}</div>
                  <div className="hstat-sub">с 10 марта 2026</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Постов собрано</div>
                  <div className="hstat-value">{posts.length}</div>
                  <div className="hstat-sub">из темы на GT</div>
                </div>
              </div>
            </div>

            {/* ТОП ПОСТОВ */}
            {activeTab==='hot' && <>
              <div className="section-head">
                <span className="section-title">🔥 Топ постов по лайкам</span>
                <span className="section-count">{hotPosts.length}</span>
              </div>
              <div className="hot-grid">
                {hotPosts.length===0
                  ? <div className="empty-state">Нет постов с лайками — запустите скрапер</div>
                  : hotPosts.map((p,i)=>(
                    <HotPostCard key={p.id||i} p={p} rank={i} setLightbox={setLightbox}/>
                  ))
                }
              </div>
              <ActivityChart posts={posts}/>
            </>}

            {/* ЛЕНТА */}
            {activeTab==='feed' && <>
              <MarathonChart posts={posts} startBR={stats.startBR} setLightbox={setLightbox}/>
              <ActivityChart posts={posts}/>
              <div className="feed-filters">
                <select className="feed-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                  <option value="date_desc">Новые сначала</option>
                  <option value="date_asc">Старые сначала</option>
                  <option value="likes">По лайкам</option>
                </select>
                <input className="feed-search" placeholder="Поиск по тексту…" value={search} onChange={e=>setSearch(e.target.value)}/>
                <span className="feed-count">{feedPosts.length} постов</span>
              </div>
              {feedPosts.length===0
                ? <div className="empty-state">Постов нет — запустите console_scraper_all.js</div>
                : feedPosts.map(p=>(
                  <PostCard key={p.id||p.url} p={p}
                    favorites={favorites} onFav={toggleFav}
                    onIgnore={addIgnore} setLightbox={setLightbox}/>
                ))
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
                    ['БР', <span key="br" className={`srow-val ${stats.br?'green':''}`}>{fmtNum(stats.br||meta?.bankroll)}</span>],
                    ['Профит', <span key="pr" className={`srow-val ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>{fmtBR(stats.profit)}</span>],
                    ['День', <span key="d" className="srow-val gold">#{stats.day||meta?.day||'—'}</span>],
                    ['Постов', <span key="p" className="srow-val">{posts.length}</span>],
                    ['Топ лайков', <span key="l" className="srow-val">{hotPosts[0]?`+${hotPosts[0].likes}`:'—'}</span>],
                  ].map(([k,v])=>(
                    <div key={k} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
                </div>
              </div>

              {hotPosts.length>0 && (
                <div className="sblock">
                  <div className="sblock-title">🔥 Топ 5</div>
                  <div className="sblock-body" style={{padding:'6px 14px'}}>
                    {hotPosts.slice(0,5).map((p,i)=>(
                      <div key={i} style={{display:'flex',gap:8,padding:'6px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}
                        onClick={()=>p.url&&window.open(p.url,'_blank')}>
                        <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16,flexShrink:0}}>{i+1}</span>
                        <span style={{fontSize:11,color:'var(--text)',flex:1,overflow:'hidden',
                          display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{p.text?.substring(0,80)}</span>
                        <span style={{color:'var(--green)',fontSize:10,fontWeight:700,flexShrink:0}}>+{p.likes}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                  <a href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Исходный код</a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
