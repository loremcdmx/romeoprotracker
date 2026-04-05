import { useState, useEffect, useMemo } from 'react'
import { loadConfig, fetchPublicData } from './storage.js'

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#111;--bg2:#1a1a1a;--bg3:#222;--bg4:#2a2a2a;
    --border:#2d2d2d;--border2:#383838;
    --red:#e53935;--red2:#ff5252;--red-dim:#2a1010;
    --text:#d4d4d4;--dim:#666;--dim2:#888;
    --green:#4caf50;--gold:#ffb300;--blue:#42a5f5;--white:#f0f0f0;
    --r:6px;
  }
  html,body,#root{min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5}
  a{color:var(--red2);text-decoration:none}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:#333;border-radius:3px}

  /* ─── TOPBAR ─── */
  .topbar{background:#0a0a0a;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
  .topbar-inner{max-width:1100px;margin:0 auto;padding:0 16px;display:flex;align-items:center;height:46px;gap:16px}
  .logo{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .logo-badge{background:var(--red);color:#fff;font-size:12px;font-weight:800;width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;letter-spacing:-.5px}
  .logo-text{font-size:14px;font-weight:700;color:var(--white);letter-spacing:-.3px}
  .logo-sub{font-size:10px;color:var(--dim)}
  .topbar-tabs{display:flex;gap:2px;flex:1;justify-content:center}
  .topbar-tab{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;color:var(--dim2);cursor:pointer;transition:all .15s}
  .topbar-tab:hover{color:var(--text);background:var(--bg3)}
  .topbar-tab.active{color:var(--white);background:var(--bg3)}
  .topbar-right{margin-left:auto;display:flex;align-items:center;gap:8px}
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}
  .live-label{font-size:11px;color:var(--green);font-weight:600}

  /* ─── LAYOUT ─── */
  .page{max-width:1100px;margin:0 auto;padding:16px 16px 60px;display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start}
  .page.wide{grid-template-columns:1fr}

  /* ─── HERO STATS ─── */
  .hero{background:linear-gradient(135deg,#1a0a0a 0%,#1a1a1a 100%);border:1px solid var(--border);border-radius:var(--r);padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,#e5393520 0%,transparent 70%);pointer-events:none}
  .hero-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:16px}
  .hero-avatar{width:52px;height:52px;border-radius:50%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;border:2px solid #e5393540}
  .hero-info{flex:1}
  .hero-name{font-size:18px;font-weight:700;color:var(--white);display:flex;align-items:center;gap:8px}
  .hero-name-badge{background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.05em}
  .hero-desc{font-size:11px;color:var(--dim2);margin-top:2px}
  .hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .hstat{background:#ffffff08;border:1px solid var(--border);border-radius:5px;padding:12px}
  .hstat-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
  .hstat-value{font-size:20px;font-weight:700;color:var(--white);font-family:'Roboto Mono',monospace;line-height:1.2}
  .hstat-value.green{color:#66bb6a}
  .hstat-value.gold{color:var(--gold)}
  .hstat-value.red{color:var(--red2)}
  .hstat-sub{font-size:10px;color:var(--dim);margin-top:3px}
  .hero-link{font-size:11px;color:var(--dim);margin-top:12px;display:flex;align-items:center;gap:6px}
  .hero-link a{color:var(--red2)}

  /* ─── SECTION TITLE ─── */
  .section-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .section-title{font-size:12px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.1em}
  .section-count{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--dim)}

  /* ─── HOT POSTS ─── */
  .hot-grid{display:flex;flex-direction:column;gap:6px;margin-bottom:20px}
  .hot-item{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;display:flex;gap:12px;align-items:flex-start;cursor:pointer;transition:border-color .15s}
  .hot-item:hover{border-color:var(--border2)}
  .hot-rank{font-size:18px;font-weight:800;color:var(--border2);font-family:'Roboto Mono',monospace;min-width:24px;text-align:right;flex-shrink:0;line-height:1}
  .hot-rank.top3{color:var(--gold)}
  .hot-body{flex:1;min-width:0}
  .hot-text{font-size:12px;color:var(--text);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .hot-meta{display:flex;gap:10px;margin-top:6px;align-items:center}
  .hot-likes{font-size:11px;color:var(--green);font-weight:600;font-family:'Roboto Mono',monospace}
  .hot-date{font-size:10px;color:var(--dim)}
  .hot-br{background:var(--red-dim);color:var(--red2);border:1px solid #e5393540;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:700;font-family:'Roboto Mono',monospace}

  /* ─── CHART ─── */
  .chart-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:20px}
  .chart-svg{width:100%;overflow:visible}
  .chart-bar{fill:#e5393530;rx:2}
  .chart-bar:hover{fill:#e5393560}
  .chart-label{font-size:9px;fill:var(--dim);text-anchor:middle}

  /* ─── FEED ─── */
  .feed-filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
  .feed-select{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:4px 10px;outline:none;cursor:pointer}
  .feed-search{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:4px 12px;outline:none;flex:1;min-width:120px}
  .feed-search:focus,.feed-select:focus{border-color:#444}
  .feed-count{font-size:11px;color:var(--dim);margin-left:auto}

  .post-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;overflow:hidden;transition:border-color .15s}
  .post-card:hover{border-color:var(--border2)}
  .post-card.faved{border-left:3px solid var(--gold)}
  .post-card.ignored{display:none}
  .pc-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)}
  .pc-avatar{width:32px;height:32px;border-radius:50%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;font-family:'Roboto Mono',monospace}
  .pc-author{font-weight:600;color:var(--white);font-size:13px}
  .pc-author-sub{font-size:10px;color:var(--dim)}
  .pc-date{margin-left:auto;font-size:10px;color:var(--dim);font-family:'Roboto Mono',monospace;flex-shrink:0}
  .pc-actions{display:flex;gap:6px}
  .pc-action-btn{background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;opacity:.4;transition:opacity .15s;color:var(--text)}
  .pc-action-btn:hover{opacity:1}
  .pc-action-btn.active{opacity:1}
  .pc-body{padding:10px 14px;font-size:13px;color:var(--text);line-height:1.65}
  .pc-body.clamped{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .pc-images{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
  .pc-img{max-width:160px;max-height:120px;border-radius:4px;cursor:pointer;border:1px solid var(--border);object-fit:cover;transition:border-color .15s}
  .pc-img:hover{border-color:#555}
  .pc-foot{display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid var(--border)}
  .pc-likes{font-size:12px;font-weight:600;font-family:'Roboto Mono',monospace}
  .pc-likes.pos{color:var(--green)}.pc-likes.neg{color:var(--red2)}.pc-likes.zero{color:var(--dim)}
  .pc-br{background:var(--red-dim);color:var(--red2);border:1px solid #e5393540;border-radius:3px;padding:1px 7px;font-size:11px;font-weight:700;font-family:'Roboto Mono',monospace}
  .pc-expand{background:none;border:none;color:var(--dim);font-size:11px;cursor:pointer;font-family:inherit;transition:color .15s}
  .pc-expand:hover{color:var(--text)}
  .pc-link{font-size:11px;color:var(--dim);margin-left:auto}
  .pc-link:hover{color:var(--red2)}

  /* ─── SIDEBAR ─── */
  .sidebar{display:flex;flex-direction:column;gap:12px}
  .sblock{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .sblock-title{padding:10px 14px;font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border);background:var(--bg3)}
  .sblock-body{padding:12px 14px}
  .srow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
  .srow:last-child{border-bottom:none}
  .srow-key{color:var(--dim2)}
  .srow-val{font-weight:600;font-family:'Roboto Mono',monospace;color:var(--white)}
  .srow-val.green{color:#66bb6a}.srow-val.gold{color:var(--gold)}.srow-val.red{color:var(--red2)}

  /* ─── IGNORE SETTINGS ─── */
  .settings-panel{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .ignore-list{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
  .ignore-item{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg3);border-radius:4px;font-size:12px}
  .ignore-remove{background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px;transition:color .15s}
  .ignore-remove:hover{color:var(--red2)}
  .ignore-empty{font-size:12px;color:var(--dim);padding:12px 14px}
  .ignore-add{display:flex;gap:6px;padding:0 14px 12px}
  .ignore-input{flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:12px;padding:6px 10px;outline:none}
  .ignore-input:focus{border-color:#444}
  .btn-sm{padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-family:inherit;transition:all .15s}
  .btn-sm:hover{border-color:#555;color:var(--white)}
  .btn-sm.red{border-color:var(--red);color:var(--red2);background:var(--red-dim)}

  /* ─── LIGHTBOX ─── */
  .lightbox{position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:500;cursor:pointer}
  .lightbox img{max-width:90vw;max-height:90vh;border-radius:4px}

  /* ─── LOADING ─── */
  .loading{padding:60px;text-align:center;color:var(--dim);font-size:13px}

  @media(max-width:720px){
    .page{grid-template-columns:1fr}
    .hero-stats{grid-template-columns:1fr 1fr}
    .sidebar{order:-1}
    .topbar-tabs{display:none}
  }
`

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : n > 0 ? '+' : ''
  if (abs >= 1_000_000) return sign + '$' + (abs/1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return sign + '$' + (abs/1_000).toFixed(1) + 'k'
  return sign + '$' + abs
}
const fmtPlain = n => {
  if (!n && n !== 0) return '—'
  if (Math.abs(n) >= 1_000_000) return '$' + (n/1_000_000).toFixed(2) + 'M'
  if (Math.abs(n) >= 1_000)     return '$' + (n/1_000).toFixed(1) + 'k'
  return '$' + n
}

// Извлекаем БР из текста поста
function extractBR(text) {
  const m = text?.match(/\$\s?([\d,]+(?:\.\d+)?)\s*[kK]/)
  if (m) return parseFloat(m[1].replace(',','')) * 1000
  const m2 = text?.match(/банкролл[^$\d]*\$?\s*([\d,]+)/i)
  if (m2) return parseFloat(m2[1].replace(',',''))
  return null
}

// Извлекаем день марафона из текста
function extractDay(text) {
  const m = text?.match(/[Дд]ень\s*#?\s*(\d+)/i) || text?.match(/[Dd]ay\s*#?\s*(\d+)/i)
  return m ? parseInt(m[1]) : null
}

// График активности
function ActivityChart({ posts }) {
  const data = useMemo(() => {
    const counts = {}
    posts.forEach(p => {
      if (!p.timestamp) return
      const d = new Date(p.timestamp * 1000)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      counts[key] = (counts[key] || 0) + 1
    })
    const sorted = Object.entries(counts).sort((a,b) => a[0] > b[0] ? 1 : -1)
    return sorted.slice(-30) // последние 30 дней
  }, [posts])

  if (!data.length) return null
  const max = Math.max(...data.map(d=>d[1]), 1)
  const W = 600, H = 60, pad = 2

  return (
    <div className="chart-wrap">
      <div className="section-head" style={{marginBottom:8}}>
        <span className="section-title">Активность постов</span>
        <span className="section-count">последние {data.length} дней</span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H+16}`}>
        {data.map(([date, count], i) => {
          const bw = (W - pad*(data.length-1)) / data.length
          const x = i * (bw + pad)
          const bh = Math.max(2, (count/max) * H)
          const showLabel = i === 0 || i === data.length-1 || i % Math.ceil(data.length/6) === 0
          return (
            <g key={date}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2} fill="#e5393540">
                <title>{date}: {count} постов</title>
              </rect>
              {showLabel && (
                <text x={x+bw/2} y={H+12} className="chart-label">
                  {date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [posts, setPosts]   = useState([])
  const [meta, setMeta]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('feed')
  const [expanded, setExpanded]   = useState({})
  const [lightbox, setLightbox]   = useState(null)
  const [sortBy, setSortBy]       = useState('date_desc')
  const [search, setSearch]       = useState('')
  const [ignoreInput, setIgnoreInput] = useState('')
  const [ignored, setIgnored] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_ignored')||'[]')) } catch { return new Set() }
  })
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rpt_favs')||'[]')) } catch { return new Set() }
  })

  const cfg = loadConfig() || { repo: 'loremcdmx/romeoprotracker' }

  useEffect(() => {
    fetchPublicData(cfg.repo || 'loremcdmx/romeoprotracker')
      .then(({ posts, meta }) => { setPosts(posts||[]); setMeta(meta||{}) })
      .catch(() => setMeta({}))
      .finally(() => setLoading(false))
  }, [])

  // Вычисляем stats из постов
  const stats = useMemo(() => {
    if (!posts.length) return {}
    const byDate = [...posts].sort((a,b) => (b.timestamp||0)-(a.timestamp||0))
    const last = byDate[0]

    // День и БР из последнего поста
    let day = null, br = null
    for (const p of byDate) {
      if (!day) day = extractDay(p.text)
      if (!br)  br  = extractBR(p.text)
      if (day && br) break
    }

    const startBR = meta?.startBankroll || 10000
    const profit = br ? br - startBR : null

    return { day, br, profit, startBR, lastDate: last?.date }
  }, [posts, meta])

  // Топ-10 постов по лайкам
  const hotPosts = useMemo(() => {
    return [...posts]
      .filter(p => (p.likes||0) > 0)
      .sort((a,b) => (b.likes||0)-(a.likes||0))
      .slice(0,10)
  }, [posts])

  // Лента с фильтрами
  const feedPosts = useMemo(() => {
    return posts
      .filter(p => !ignored.has(p.author))
      .filter(p => !search || p.text?.toLowerCase().includes(search.toLowerCase()))
      .sort((a,b) => {
        if (sortBy==='date_desc') return (b.timestamp||0)-(a.timestamp||0)
        if (sortBy==='date_asc')  return (a.timestamp||0)-(b.timestamp||0)
        if (sortBy==='likes')     return (b.likes||0)-(a.likes||0)
        return 0
      })
  }, [posts, ignored, search, sortBy])

  const toggleFav = id => {
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem('rpt_favs', JSON.stringify([...next]))
      return next
    })
  }

  const addIgnore = (name) => {
    if (!name.trim()) return
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

  const PostCard = ({ p }) => {
    const exp = expanded[p.id]
    const isFav = favorites.has(p.id)
    const likes = p.likes || 0
    const likesClass = likes > 0 ? 'pos' : likes < 0 ? 'neg' : 'zero'
    const initial = (p.author||'R')[0].toUpperCase()

    return (
      <div className={`post-card ${isFav?'faved':''}`}>
        <div className="pc-head">
          <div className="pc-avatar">{initial}</div>
          <div>
            <div className="pc-author">{p.author||'Romeopro'}</div>
            <div className="pc-author-sub">Легенда форума</div>
          </div>
          <div className="pc-date">{p.date}</div>
          <div className="pc-actions">
            <button
              className={`pc-action-btn ${isFav?'active':''}`}
              onClick={()=>toggleFav(p.id)}
              title={isFav?'Убрать из избранного':'В избранное'}
            >⭐</button>
            <button
              className="pc-action-btn"
              onClick={()=>addIgnore(p.author)}
              title="Игнорировать автора"
            >🚫</button>
          </div>
        </div>
        <div className={`pc-body ${!exp?'clamped':''}`}>{p.text}</div>
        {(p.images||[]).length > 0 && (
          <div className="pc-images">
            {p.images.map((src,j)=>(
              <img key={j} className="pc-img" src={src} alt="" onClick={()=>setLightbox(src)} />
            ))}
          </div>
        )}
        <div className="pc-foot">
          <span className={`pc-likes ${likesClass}`}>{likes>0?'+':''}{likes} 👍</span>
          {p.bankroll && <span className="pc-br">{p.bankroll}</span>}
          <button className="pc-expand" onClick={()=>setExpanded(s=>({...s,[p.id]:!s[p.id]}))}>
            {exp ? '▲ свернуть' : '▼ читать'}
          </button>
          {p.url && <a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{css}</style>

      {lightbox && (
        <div className="lightbox" onClick={()=>setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}

      {/* TOPBAR */}
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
            <div className="live-dot" />
            <span className="live-label">LIVE</span>
          </div>
        </div>
      </div>

      {loading ? <div className="loading">Загружаем данные марафона…</div> : (
        <div className={`page ${activeTab==='settings'?'wide':''}`}>
          <div>
            {/* HERO */}
            <div className="hero">
              <div className="hero-top">
                <div className="hero-avatar">🎲</div>
                <div className="hero-info">
                  <div className="hero-name">
                    Romeopro
                    <span className="hero-name-badge">Автор</span>
                  </div>
                  <div className="hero-desc">
                    From Hero to Zero · <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer" style={{color:'var(--dim2)'}}>GipsyTeam</a>
                    {stats.lastDate && <span style={{marginLeft:8}}>· последний пост: {stats.lastDate}</span>}
                  </div>
                </div>
              </div>
              <div className="hero-stats">
                <div className="hstat">
                  <div className="hstat-label">Банкролл</div>
                  <div className={`hstat-value ${stats.br ? 'green' : ''}`}>{stats.br ? fmtPlain(stats.br) : fmtPlain(meta?.bankroll)}</div>
                  <div className="hstat-sub">старт: {fmtPlain(stats.startBR)}</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Профит</div>
                  <div className={`hstat-value ${!stats.profit ? '' : stats.profit >= 0 ? 'green' : 'red'}`}>
                    {stats.profit != null ? fmt(stats.profit) : '—'}
                  </div>
                  <div className="hstat-sub">от старта марафона</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">День марафона</div>
                  <div className="hstat-value gold">#{stats.day || meta?.day || '—'}</div>
                  <div className="hstat-sub">с 10 марта 2026</div>
                </div>
                <div className="hstat">
                  <div className="hstat-label">Постов собрано</div>
                  <div className="hstat-value">{posts.length}</div>
                  <div className="hstat-sub">с GipsyTeam</div>
                </div>
              </div>
            </div>

            {/* ТОП ПОСТОВ */}
            {activeTab === 'hot' && (
              <>
                <div className="section-head">
                  <span className="section-title">🔥 Топ постов по лайкам</span>
                  <span className="section-count">{hotPosts.length}</span>
                </div>
                <div className="hot-grid">
                  {hotPosts.length === 0 && <div style={{color:'var(--dim)',fontSize:12,padding:12}}>Лайков пока нет — запустите скрапер</div>}
                  {hotPosts.map((p,i) => (
                    <div key={p.id||i} className="hot-item" onClick={()=>p.url&&window.open(p.url,'_blank')}>
                      <div className={`hot-rank ${i<3?'top3':''}`}>{i+1}</div>
                      <div className="hot-body">
                        <div className="hot-text">{p.text}</div>
                        <div className="hot-meta">
                          <span className="hot-likes">+{p.likes} 👍</span>
                          {p.bankroll && <span className="hot-br">{p.bankroll}</span>}
                          <span className="hot-date">{p.date}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CHART */}
                <ActivityChart posts={posts} />
              </>
            )}

            {/* ЛЕНТА */}
            {activeTab === 'feed' && (
              <>
                <ActivityChart posts={posts} />

                <div className="feed-filters">
                  <select className="feed-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                    <option value="date_desc">Новые сначала</option>
                    <option value="date_asc">Старые сначала</option>
                    <option value="likes">По лайкам</option>
                  </select>
                  <input className="feed-search" placeholder="Поиск по тексту..." value={search} onChange={e=>setSearch(e.target.value)} />
                  <span className="feed-count">{feedPosts.length} постов</span>
                </div>

                {feedPosts.length === 0
                  ? <div style={{color:'var(--dim)',fontSize:12,padding:20,textAlign:'center'}}>Постов нет — запустите console_scraper.js</div>
                  : feedPosts.map(p => <PostCard key={p.id||p.url} p={p} />)
                }
              </>
            )}

            {/* НАСТРОЙКИ */}
            {activeTab === 'settings' && (
              <div className="settings-panel">
                <div className="sblock-title">🚫 Игнорируемые авторы</div>
                {ignored.size === 0
                  ? <div className="ignore-empty">Список пуст — нажмите 🚫 на посте чтобы скрыть автора</div>
                  : <div className="ignore-list">
                      {[...ignored].map(name => (
                        <div key={name} className="ignore-item">
                          <span>{name}</span>
                          <button className="ignore-remove" onClick={()=>removeIgnore(name)}>✕</button>
                        </div>
                      ))}
                    </div>
                }
                <div className="ignore-add">
                  <input
                    className="ignore-input"
                    placeholder="Добавить автора вручную..."
                    value={ignoreInput}
                    onChange={e=>setIgnoreInput(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&addIgnore(ignoreInput)}
                  />
                  <button className="btn-sm" onClick={()=>addIgnore(ignoreInput)}>Добавить</button>
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          {activeTab !== 'settings' && (
            <div className="sidebar">
              <div className="sblock">
                <div className="sblock-title">📊 Статистика</div>
                <div className="sblock-body">
                  {[
                    ['БР', <span className={`srow-val ${stats.br?'green':''}`}>{fmtPlain(stats.br||meta?.bankroll)}</span>],
                    ['Профит', <span className={`srow-val ${!stats.profit?'':stats.profit>=0?'green':'red'}`}>{fmt(stats.profit)}</span>],
                    ['День', <span className="srow-val gold">#{stats.day||meta?.day||'—'}</span>],
                    ['Постов', <span className="srow-val">{posts.length}</span>],
                    ['Топ лайков', <span className="srow-val">{hotPosts[0]?'+'+hotPosts[0].likes:'—'}</span>],
                  ].map(([k,v],i)=>(
                    <div key={i} className="srow"><span className="srow-key">{k}</span>{v}</div>
                  ))}
                </div>
              </div>

              {hotPosts.length > 0 && (
                <div className="sblock">
                  <div className="sblock-title">🔥 Топ постов</div>
                  <div className="sblock-body" style={{padding:'8px 14px'}}>
                    {hotPosts.slice(0,5).map((p,i)=>(
                      <div key={i} style={{display:'flex',gap:8,padding:'5px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>p.url&&window.open(p.url,'_blank')}>
                        <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16}}>{i+1}</span>
                        <span style={{fontSize:11,color:'var(--text)',flex:1,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{p.text?.substring(0,80)}…</span>
                        <span style={{color:'var(--green)',fontSize:10,fontWeight:600,flexShrink:0}}>+{p.likes}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="sblock">
                <div className="sblock-title">🔗 Ссылки</div>
                <div className="sblock-body" style={{display:'flex',flexDirection:'column',gap:8}}>
                  <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Тема на GipsyTeam</a>
                  <a href={`https://github.com/${cfg.repo||'loremcdmx/romeoprotracker'}`} target="_blank" rel="noreferrer" style={{fontSize:12}}>→ GitHub репо</a>
                </div>
              </div>

              {ignored.size > 0 && (
                <div className="sblock">
                  <div className="sblock-title">🚫 Игнор-лист ({ignored.size})</div>
                  <div className="sblock-body" style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {[...ignored].map(n=>(
                      <span key={n} style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:12,padding:'2px 8px',fontSize:11,display:'flex',gap:4,alignItems:'center'}}>
                        {n}<button style={{background:'none',border:'none',cursor:'pointer',color:'var(--dim)',fontSize:11}} onClick={()=>removeIgnore(n)}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
