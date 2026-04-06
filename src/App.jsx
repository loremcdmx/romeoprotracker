import { useState, useEffect, useMemo, useRef } from 'react'
import { fetchPublicData } from './storage.js'


// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#111;--bg2:#1a1a1a;--bg3:#222;
    --border:#2d2d2d;--border2:#444;
    --red:#e53935;--red2:#ff5252;--red-dim:#2a1010;
    --text:#d4d4d4;--dim:#888;--dim2:#aaa;
    --green:#4caf50;--gold:#ffb300;--white:#f0f0f0;
    --r:6px;
  }
  html,body,#root{min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:12px;line-height:1.5}
  a{color:var(--red2);text-decoration:none}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:#333;border-radius:3px}

  /* TOPBAR */
  .topbar{background:#0a0a0a;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
  .topbar-inner{max-width:1280px;margin:0 auto;padding:0 16px;display:flex;align-items:center;height:40px;gap:16px}
  .logo{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .logo-badge{background:var(--red);color:#fff;font-size:11px;font-weight:800;width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center}
  .logo-text{font-size:13px;font-weight:700;color:var(--white)}
  .logo-sub{font-size:10px;color:var(--dim)}
  .topbar-tabs{display:flex;gap:2px;flex:1;justify-content:center}
  .topbar-tab{padding:4px 11px;border-radius:20px;font-size:11px;font-weight:500;color:var(--dim2);cursor:pointer;transition:all .15s}
  .topbar-tab:hover{color:var(--text);background:var(--bg3)}
  .topbar-tab.active{color:var(--white);background:var(--bg3)}
  .topbar-right{margin-left:auto;display:flex;align-items:center;gap:6px}

  /* ADMIN */
  .admin-lock{background:none;border:none;cursor:pointer;color:var(--dim);font-size:14px;padding:4px;opacity:.4;transition:opacity .2s}
  .admin-lock:hover{opacity:.8}
  @media(max-width:720px){.admin-lock{display:none}}

  /* LAYOUT */
  .page{max-width:1280px;margin:0 auto;padding:10px 16px 60px;display:grid;grid-template-columns:1fr 240px;gap:12px;align-items:start}
  .page.wide{grid-template-columns:1fr}

  /* HERO */
  .hero{background:linear-gradient(135deg,#1a0a0a 0%,#1a1a1a 100%);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px;position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,#e5393520,transparent 70%);pointer-events:none}
  .hero-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:16px}
  .hero-avatar{width:40px;height:40px;border-radius:50%;background:var(--red);flex-shrink:0;border:2px solid #e5393540;overflow:hidden}
  .hero-avatar img{width:100%;height:100%;object-fit:cover}
  .hero-name{font-size:15px;font-weight:700;color:var(--white);display:flex;align-items:center;gap:8px}
  .hero-badge{background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase}
  .hero-desc{font-size:11px;color:var(--dim2);margin-top:2px}
  .hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .hstat{background:#ffffff08;border:1px solid var(--border);border-radius:5px;padding:12px}
  .hstat-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
  .hstat-value{font-size:16px;font-weight:700;color:var(--white);font-family:'Roboto Mono',monospace;line-height:1.2}
  .hstat-value.green{color:#66bb6a}.hstat-value.gold{color:var(--gold)}.hstat-value.red{color:var(--red2)}
  .hstat-sub{font-size:10px;color:var(--dim);margin-top:3px}

  /* SECTION */
  .section-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .section-title{font-size:12px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.1em}
  .section-count{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--dim)}

  /* MARATHON CHART */
  .marathon-chart{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px;position:relative}
  .mc-svg{width:100%;overflow:visible}
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
  .chart-tooltip{position:absolute;background:#1c1c1c;border:1px solid #3a3a3a;border-radius:6px;padding:10px 12px;pointer-events:none;z-index:20;min-width:220px;max-width:300px;box-shadow:0 4px 20px rgba(0,0,0,.6)}

  /* GLOBAL FILTER BAR */
  .filter-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;margin-bottom:14px}
  .filter-bar label{font-size:11px;color:var(--dim);white-space:nowrap}
  .filter-num{width:70px;background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:4px 10px;outline:none;text-align:center}
  .filter-num:focus{border-color:#444}
  .filter-pill{padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .filter-pill.off{background:var(--bg3);color:var(--dim2);border:1px solid var(--border)}
  .filter-pill.off:hover{border-color:#444;color:var(--text)}
  .filter-pill.on{background:var(--red);color:#fff;border:1px solid var(--red)}
  .filter-active-count{font-size:11px;color:var(--dim);margin-left:auto;white-space:nowrap}
  .feed-filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
  .feed-select{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 10px;outline:none;cursor:pointer}
  .feed-search{background:var(--bg3);border:1px solid var(--border);border-radius:20px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 12px;outline:none;flex:1;min-width:140px}
  .feed-search:focus,.feed-select:focus{border-color:#444}
  .feed-count{font-size:11px;color:var(--dim);margin-left:auto;white-space:nowrap}

  /* TOPIC TABS */
  .topic-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
  .topic-tab{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg2);color:var(--dim2);transition:all .15s;white-space:nowrap}
  .topic-tab:hover{border-color:#444;color:var(--text)}
  .topic-tab.active{border-color:var(--red);color:#fff;background:var(--red-dim)}
  .topic-tab .tc{background:var(--bg3);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--dim);margin-left:2px}
  .topic-tab.active .tc{background:#ffffff20;color:#ffaaaa}

  /* PAGINATION */
  .pagination{display:flex;align-items:center;justify-content:center;gap:6px;padding:14px 0;flex-wrap:wrap}
  .page-btn{min-width:32px;height:32px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:var(--bg2);color:var(--dim2);font-family:inherit;transition:all .15s;display:flex;align-items:center;justify-content:center}
  .page-btn:hover{border-color:#444;color:var(--text)}
  .page-btn.active{background:var(--red);border-color:var(--red);color:#fff}
  .page-btn:disabled{opacity:.3;cursor:default;pointer-events:none}
  .page-info{font-size:11px;color:var(--dim);padding:0 8px}
  .perpage-select{background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit;font-size:11px;padding:4px 8px;outline:none;cursor:pointer}

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
  .pc-body{padding:10px 14px;font-size:12px;color:var(--text);line-height:1.6}
  .pc-body.clamped{display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}
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

  /* QUOTE */
  .pc-quote{background:var(--bg3);border-left:3px solid var(--border2);border-radius:0 4px 4px 0;padding:8px 12px;margin-bottom:8px;font-size:12px;color:var(--dim2)}
  .pc-quote-author{font-size:10px;color:var(--dim);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .admin-modal{position:fixed;inset:0;background:#000b;z-index:200;display:flex;align-items:center;justify-content:center}
  .admin-box{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;width:420px;max-width:95vw}
  .admin-title{font-size:14px;font-weight:700;color:var(--white);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
  .admin-log{background:#111;border-radius:6px;padding:10px 12px;font-family:'Roboto Mono',monospace;font-size:11px;max-height:180px;overflow-y:auto;margin-top:12px}
  .al-ok{color:#4caf50}.al-err{color:#f44336}.al-dim{color:#555}.al-warn{color:#ff9800}
  .admin-input{width:100%;background:#111;border:1px solid #333;border-radius:5px;color:var(--text);font-family:inherit;font-size:12px;padding:8px 12px;outline:none;margin-bottom:8px}
  .admin-input:focus{border-color:#444}
  .admin-btn{width:100%;padding:9px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;border:none;transition:all .15s}
  .admin-btn.primary{background:var(--red);color:#fff}
  .admin-btn.primary:hover{background:#c62828}
  .admin-btn.primary:disabled{background:#333;color:var(--dim);cursor:default}
  .admin-btn.secondary{background:var(--bg3);color:var(--dim2);border:1px solid var(--border);margin-top:6px}
  .admin-btn.secondary:hover{color:var(--text)}

  .lightbox{position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;z-index:500;cursor:zoom-out}
  .lightbox img{max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 0 60px rgba(0,0,0,.8)}

  /* MISC */
  .loading{padding:80px;text-align:center;color:var(--dim);font-size:13px}
  .empty-state{padding:30px;text-align:center;color:var(--dim);font-size:12px}

  @media(max-width:720px){
    html,body,#root{font-size:14px}
    .page{grid-template-columns:1fr;padding:8px 10px 90px}
    .hero-stats{grid-template-columns:1fr 1fr}
    .hero{padding:12px}
    .hero-top{gap:10px;margin-bottom:12px}
    .hstat{padding:10px}
    .hstat-value{font-size:14px}
    .topbar-inner{padding:0 10px;gap:8px}
    .topbar-tabs{display:none}
    .logo-text{font-size:12px}
    .logo-sub{display:none}

    /* Bottom nav for mobile */
    .mobile-nav{display:flex !important}

    /* Filters */
    .filter-bar{gap:6px;padding:8px 10px}
    .filter-num{width:56px;font-size:10px;padding:3px 6px}
    .filter-pill{padding:4px 8px;font-size:10px}
    .feed-search{font-size:10px}

    /* Post card */
    .pc-head{padding:8px 10px}
    .pc-body{padding:8px 10px;font-size:12px}
    .pc-foot{padding:6px 10px;flex-wrap:wrap;gap:6px}
    .pc-images{padding:0 10px 8px;gap:4px}
    .pc-img{max-width:120px;max-height:90px}
    .pc-author{font-size:12px}

    /* Topic tabs */
    .topic-tabs{gap:4px}
    .topic-tab{padding:5px 10px;font-size:11px}

    /* Sidebar hides on mobile */
    .sidebar{display:none}

    /* Marathon chart */
    .marathon-chart{padding:10px}
    .mc-label,.mc-ylabel{font-size:8px}

    /* Pagination */
    .pagination{gap:3px;padding:10px 0}
    .page-btn{min-width:28px;height:28px;font-size:11px}
    .page-info{font-size:10px}
    .perpage-select{font-size:10px;padding:3px 5px}

    /* Admin */
    .admin-box{width:95vw;padding:16px}
  }

  /* Mobile bottom nav — sits above iOS browser chrome */
  .mobile-nav{
    display:none;
    position:fixed;bottom:0;left:0;right:0;
    background:#0a0a0a;border-top:1px solid var(--border);
    z-index:150;
    padding:8px 0;
    padding-bottom:calc(8px + env(safe-area-inset-bottom, 0px));
    justify-content:space-around;
  }
  .mobile-nav-btn{
    display:flex;flex-direction:column;align-items:center;gap:2px;
    background:none;border:none;cursor:pointer;color:var(--dim);
    font-family:inherit;font-size:9px;padding:4px 12px;
    transition:color .15s;min-width:60px;
  }
  .mobile-nav-btn.active{color:var(--red)}
  .mobile-nav-btn span:first-child{font-size:18px;line-height:1}
`

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function timeAgo(timestamp) {
  if (!timestamp) return null
  const sec  = Math.floor((Date.now() / 1000) - timestamp)
  if (sec < 60)   return 'только что'
  if (sec < 3600) return Math.floor(sec/60) + ' мин назад'
  if (sec < 86400) return Math.floor(sec/3600) + ' ч назад'
  if (sec < 2592000) return Math.floor(sec/86400) + ' дн назад'
  if (sec < 31536000) return Math.floor(sec/2592000) + ' мес назад'
  return Math.floor(sec/31536000) + ' г назад'
}
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

// Целое число с тонким пробелом как разделитель тысяч
const fmtInt = n => {
  if (n == null || n === '') return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')
}

// Точный формат БР до доллара
const fmtExact = n => {
  if (!n && n !== 0) return '—'
  const rounded = Math.round(n)
  if (rounded >= 1000) return '$' + Math.floor(rounded / 1000) + '\u202F' + String(rounded % 1000).padStart(3, '0')
  return '$' + rounded
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

// Компактный формат числа со знаком (для P&L внутри компонентов)
const fk = (n, withSign = true) => {
  const a = Math.abs(n)
  const s = withSign ? (n < 0 ? '-' : n > 0 ? '+' : '') : ''
  return a >= 1000 ? s + '$' + (a / 1000).toFixed(1) + 'k' : s + '$' + a
}

const b64enc = s => btoa(unescape(encodeURIComponent(
  typeof s === 'string' ? s : JSON.stringify(s, null, 2)
)))

const ROMEO_RE = /romeopro/i

// ─── MARATHON CHART ───────────────────────────────────────────────────────────
function MarathonChart({ posts, meta, startBR, setLightbox }) {
  const [tip, setTip] = useState(null)

  const points = useMemo(() => {
    // Приоритет: meta.brHistory (уже готовые данные) → posts с brAfter (из OCR)
    if (meta?.brHistory?.length) {
      return meta.brHistory
        .sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
        .map((h, i, arr) => ({
          br:     h.brAfter,
          brPrev: i === 0 ? startBR : arr[i-1].brAfter,
          date:   h.date,
          text:   h.text || '',
          url:    h.url,
          images: [],
          sessionResult: h.sessionResult,
          rooms:  h.rooms || null,
        }))
    }
    return posts
      .filter(p => /romeopro/i.test(p.author) && p.brAfter)
      .sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
      .map((p, i, arr) => ({
        br:     p.brAfter,
        brPrev: i === 0 ? startBR : arr[i-1].brAfter,
        date:   p.date,
        text:   p.text,
        url:    p.url,
        images: p.images || [],
        sessionResult: p.sessionResult,
      }))
  }, [posts, meta, startBR])

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
  const fkAbs = v => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`

  return (
    <div className="marathon-chart">
      <div className="section-head" style={{marginBottom:12}}>
        <span className="section-title">📈 График марафона</span>
        <span className="section-count">{points.length} сессий</span>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--dim)'}}>
          {fkAbs(startBR)} → {fkAbs(points[points.length-1]?.br)}
        </span>
      </div>
      <svg className="mc-svg" viewBox={`0 0 ${W} ${H+22}`} onMouseLeave={()=>setTip(null)}>
        <defs>
          <linearGradient id="mcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e53935" stopOpacity=".5"/>
            <stop offset="100%" stopColor="#e53935" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {yTicks.map(({v,y},i) => (
          <g key={i}>
            <line x1={pL} y1={y} x2={W-pR} y2={y} className="mc-grid"/>
            <text x={pL-5} y={y+3} className="mc-ylabel">{fkAbs(v)}</text>
          </g>
        ))}
        <line x1={pL} y1={yOf(startBR)} x2={W-pR} y2={yOf(startBR)} className="mc-zero"/>
        <path d={area} className="mc-area"/>
        <polyline points={poly} className="mc-line"/>
        {points.map((p,i) => {
          const profit = p.br - p.brPrev
          const showL = i===0 || i===points.length-1 || i%Math.max(1,Math.ceil(points.length/8))===0
          return (
            <g key={i}>
              <circle cx={xOf(i)} cy={yOf(p.br)} r={4} className="mc-dot"
                fill={profit>=0?'#4caf50':'#e53935'}
                onMouseEnter={()=>setTip({p,profit,x:xOf(i),y:yOf(p.br)})}
                onClick={()=>p.url&&window.open(p.url,'_blank')}
              />
              {showL && <text x={Math.min(Math.max(xOf(i), pL), W-pR)} y={H+16} className="mc-label">{p.date?.slice(0,5)}</text>}
            </g>
          )
        })}
      </svg>
      {tip && (() => {
        const pct = (tip.x/W)*100
        const right = pct>60
        const rooms = tip.p.rooms
        const roomDeltas = rooms ? [
          {name:'ГГ',   v: rooms.after.gg   - rooms.before.gg},
          {name:'ПС',   v: rooms.after.ps   - rooms.before.ps},
          {name:'Кинг', v: rooms.after.king - rooms.before.king},
          {name:'Коин', v: rooms.after.coin - rooms.before.coin},
        ].filter(r => r.v !== 0) : []
        return (
          <div className="mc-tooltip" style={{
            bottom: (H-tip.y+16)+'px',
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:13,marginBottom:5}}>{tip.p.date}</div>
            <div style={{display:'flex',gap:12,fontSize:12,marginBottom:roomDeltas.length?8:4}}>
              <span style={{color:'#888'}}>БР: <b style={{color:'#fff'}}>{fkAbs(tip.p.br)}</b></span>
              <span style={{color:tip.profit>=0?'#66bb6a':'#ff5252',fontWeight:700}}>
                {fk(tip.profit)}
              </span>
            </div>
            {roomDeltas.length > 0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:'3px 10px',marginBottom:8}}>
                {roomDeltas.map(r => (
                  <span key={r.name} style={{fontSize:11,color:r.v>=0?'#66bb6a':'#ff5252'}}>
                    {r.name}: {fk(r.v)}
                  </span>
                ))}
              </div>
            )}
            {tip.p.text && (
              <div style={{fontSize:11,color:'#bbb',lineHeight:1.6,
                display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                {tip.p.text.substring(0,180)}
              </div>
            )}
            <div style={{fontSize:10,color:'#555',marginTop:5}}>кликни на точку → форум</div>
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
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 720

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

  const scrollRef = useRef(null)
  useEffect(() => {
    if (isMobile && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isMobile, data.length])

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
        <div style={{fontSize:11,color:'#444',textAlign:'center',padding:'4px 0 6px'}}>← скролль для старых дней · тап = детали</div>

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
          const bw = (W-pad*(data.length-1))/data.length
          const x  = i*(bw+pad)
          const bh = Math.max(3,(count/max)*H)
          const maxLabels = Math.floor(W / 50)
          const step = Math.max(1, Math.ceil(data.length / maxLabels))
          const showL = i % step === 0 || i === data.length - 1
          const isSelected = selected?.date === date
          return (
            <g key={date} style={{cursor:'pointer'}}
              onMouseEnter={()=>setTip({date,count,posts:dp,x:x+bw/2})}
              onClick={()=>setSelected(selected?.date===date ? null : {date,posts:dp})}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2}
                fill={isSelected?'#e53935':tip?.date===date?'#e5393570':'#e5393530'}
                style={{transition:'fill .1s'}}/>
              {showL&&<text x={Math.min(x+bw/2, W-16)} y={H+16} className="chart-label">{date.slice(5)}</text>}
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
                    <span style={{color:'#4caf50',fontSize:10,fontFamily:"'Roboto Mono',monospace"}}>⭐{fmtInt(rating)}</span>
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
          setRomeoOnly(false); setMinLikes(15); setMinRating(0); setSearch(''); setShowSearch(false);
        }}>✕</button>
      )}
      <span className="filter-active-count">{count} постов</span>
    </div>
  )
}

// ─── POST TEXT RENDERER ──────────────────────────────────────────────────────
function renderPostText(text) {
  if (!text) return null

  const parts = []
  let remaining = text.trim()

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

      parts.push({ type:'quote', author, date: dateStr, body })
      remaining = remaining.slice(qe + 8).trim()
      continue
    }

    parts.push({ type:'text', text: remaining })
    break
  }

  if (!parts.length) return <span style={{whiteSpace:'pre-wrap'}}>{text}</span>

  return parts.map((part, i) => {
    if (part.type === 'quote') return (
      <div key={i} style={{
        borderLeft:'3px solid #2a2a2a', background:'#151515',
        borderRadius:'0 4px 4px 0', padding:'8px 12px', margin:'2px 0 8px',
      }}>
        {(part.author || part.date) && (
          <div style={{fontSize:10,color:'#555',fontWeight:600,marginBottom:4,letterSpacing:'.04em'}}>
            ↩ {part.author}{part.date ? ' · ' + part.date : ''}
          </div>
        )}
        <div style={{color:'#5a5a5a',fontSize:12,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{part.body}</div>
      </div>
    )
    return <span key={i} style={{whiteSpace:'pre-wrap'}}>{part.text}</span>
  })
}


// ─── POST CARD ────────────────────────────────────────────────────────────────
function PostCard({ p, favorites, onFav, onIgnore, setLightbox, noClamp=false }) {
  const [exp, setExp] = useState(false)
  const isFav = favorites.has(p.id)
  const likes = p.likes || 0
  const initial = (p.author||'?')[0].toUpperCase()
  const isLong = !noClamp && (p.text?.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').length || 0) > 600

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
            {p.msgCount && <span>{fmtInt(p.msgCount)} постов</span>}
            {p.regData  && <span>· {p.regData}</span>}
            {p.rating != null && (
              <span style={{color:'#4caf50',display:'inline-flex',alignItems:'center',gap:2}}>·
                <svg viewBox="0 0 12 10" style={{width:11,height:10,fill:'#4caf50',flexShrink:0}}>
                  <rect x="0" y="6" width="2.5" height="4"/>
                  <rect x="3.2" y="3" width="2.5" height="7"/>
                  <rect x="6.4" y="1" width="2.5" height="9"/>
                  <rect x="9.6" y="0" width="2.5" height="10"/>
                </svg>
                <span style={{fontFamily:"'Roboto Mono',monospace",fontWeight:700}}>{p.rating.toLocaleString()}</span>
              </span>
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
            <img key={j} className="pc-img" src={src} alt=""
              onClick={()=>setLightbox(src)} onError={e=>e.target.style.display='none'}/>
          ))}
        </div>
      )}
      <div className="pc-foot">
        <span className={`pc-likes ${likes>0?'pos':likes<0?'neg':'zero'}`}>{likes>0?'+':''}{likes} 👍</span>
        {p.brAfter && <span className="pc-br">БР: {fmtNum(p.brAfter)}</span>}
        {isLong && (
          <button className="btn-expand" style={{marginLeft:4}} onClick={()=>setExp(s=>!s)}>
            {exp?'▲ свернуть':'▼ читать'}
          </button>
        )}
        {p.url&&<a className="pc-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
      </div>
    </div>
  )
}

// ─── PAGINATOR ────────────────────────────────────────────────────────────────
function Paginator({ page, totalPages, onPage, perPage, onPerPage, total }) {
  const pages = []
  const delta = 2
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      pages.push(i)
    } else if (pages[pages.length-1] !== '…') {
      pages.push('…')
    }
  }
  return (
    <div className="pagination">
      <button className="page-btn" disabled={page===1} onClick={()=>onPage(1)}>«</button>
      <button className="page-btn" disabled={page===1} onClick={()=>onPage(page-1)}>‹</button>
      {pages.map((p,i) => p === '…'
        ? <span key={`e${i}`} className="page-info">…</span>
        : <button key={p} className={`page-btn ${p===page?'active':''}`} onClick={()=>onPage(p)}>{p}</button>
      )}
      <button className="page-btn" disabled={page===totalPages} onClick={()=>onPage(page+1)}>›</button>
      <button className="page-btn" disabled={page===totalPages} onClick={()=>onPage(totalPages)}>»</button>
      <span className="page-info">{(page-1)*perPage+1}–{Math.min(page*perPage,total)} из {total}</span>
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

  const stripQuotes = t => (t||'')
    .replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'')
    .replace(/\[QUOTE\][^\]]*\]/gi,'')
    .replace(/\[\/QUOTE\]/gi,'')
    .replace(/\[QUOTE\]/gi,'')
    .trim()

  return (
    <div style={{padding:'6px 14px'}}>
      {/* Fixed popup — позиция фиксируется при наведении, не двигается */}
      {hovered !== null && (() => {
        const p = posts[hovered]
        if (!p) return null
        const full = stripQuotes(p.text)
        const left = Math.max(8, Math.min(popupPos.x - 310, window.innerWidth - 320))
        const top  = Math.max(8, Math.min(popupPos.y - 40, window.innerHeight - 420))
        return (
          <div style={{
            position:'fixed', left, top,
            width:300, background:'#1c1c1c', border:'1px solid #3a3a3a',
            borderRadius:8, padding:14, zIndex:9999,
            boxShadow:'0 8px 32px rgba(0,0,0,.9)',
            pointerEvents:'auto',  // позволяет скроллить попап
            maxHeight: Math.min(window.innerHeight - top - 16, 480),
            display:'flex', flexDirection:'column',
          }}
          onMouseLeave={()=>setHovered(null)}>
            <div style={{fontWeight:700,color:'var(--white)',fontSize:13,marginBottom:4}}>{p.author}</div>
            <div style={{fontSize:11,color:'var(--green)',marginBottom:8,fontFamily:"'Roboto Mono',monospace"}}>
              +{p.likes} 👍 · {p.date}
            </div>
            {p.images?.[0] && (
              <img src={p.images[0]} alt="" style={{maxWidth:'100%',borderRadius:4,marginBottom:8,display:'block'}}
                onError={e=>e.target.style.display='none'}/>
            )}
            <div style={{fontSize:12,color:'var(--text)',lineHeight:1.7,overflowY:'auto',flex:1,paddingRight:4}}>
              {full || '→ открыть на форуме'}
            </div>
            <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #2a2a2a'}}>
              <a href={p.url} target="_blank" rel="noreferrer"
                style={{fontSize:11,color:'var(--red2)'}}>→ открыть на форуме</a>
            </div>
          </div>
        )
      })()}

      {posts.map((p, i) => {
        const clean = stripQuotes(p.text)
        const preview = clean || (p.images?.[0] ? '→ форум' : '↩ цитата')
        const initial = (p.author||'?')[0].toUpperCase()
        return (
          <div key={i}
            style={{display:'flex',gap:8,padding:'7px 0',borderBottom:'1px solid var(--border)',
              alignItems:'flex-start',cursor:'pointer'}}
            onClick={()=>p.url&&window.open(p.url,'_blank')}
            onMouseEnter={e=>{
              setHovered(i)
              // Фиксируем позицию один раз при входе мыши
              setPopupPos({x: e.clientX, y: e.clientY})
            }}
            onMouseLeave={e=>{
              // Не скрываем если мышь ушла к попапу
              const related = e.relatedTarget
              if (related?.closest?.('[data-popup]')) return
              setHovered(null)
            }}>
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
              <div style={{fontSize:11,color:'var(--text)',overflow:'hidden',
                display:'-webkit-box',WebkitLineClamp:4,WebkitBoxOrient:'vertical'}}>
                {preview.substring(0,80)}
              </div>
            </div>
            <span style={{color:'var(--green)',fontSize:10,fontWeight:700,flexShrink:0,paddingTop:10}}>+{p.likes}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
const ADMIN_HASH = '407b01cfc12336c25bb7978682cfc41584e14a7558ad502daa3e3dbc4c71e49e'
const FORUM_BASE = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const REPO       = 'loremcdmx/romeoprotracker'

function AdminPanel() {
  const [step, setStep] = useState('lock')
  const [pass, setPass] = useState('')
  const [token, setToken] = useState('')
  const [log, setLog] = useState([])
  const L = (msg, cls='dim') => setLog(prev => [...prev, { msg, cls }])

  const tryAuth = async () => {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass.trim()))
    const hash = Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('')
    if (hash === ADMIN_HASH) {
      setStep('panel')
      setPass('')
      setLog([])
    } else {
      setPass('')
      L('Неверный пароль', 'err')
    }
  }


  const getScript = () => {
    const t = token.trim()
    return `(async()=>{
const REPO='${REPO}';
const TOKEN='${t}';
const FORUM='https://forum.gipsyteam.ru/index.php?viewtopic=181676';
const b64=s=>btoa(unescape(encodeURIComponent(typeof s==='string'?s:JSON.stringify(s,null,2))));

async function scrape(){
const ts=new Date().toLocaleTimeString();
console.log('%c🕷 Скрапер '+ts,'color:#e53935;font-weight:bold');
const r=await fetch('https://raw.githubusercontent.com/'+REPO+'/main/data/posts.json?t='+Date.now());
const existing=await r.json();
const knownIds=new Set(existing.map(p=>p.id).filter(Boolean));
console.log('Известно: '+knownIds.size+' постов');
const newPosts=[];
const visited=new Set();
let url=FORUM;
const lastKnown=[...existing].filter(p=>p.url).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0))[0];
const lastSt=lastKnown?.url?.match(/st=(\\d+)/)?.[1];
if(lastSt){url=FORUM+'&st='+lastSt;console.log('📌 Стартую со st='+lastSt);}
else{const fp=await fetch(FORUM);const fh=await fp.text();const fd=new DOMParser().parseFromString(fh,'text/html');const ll=[...fd.querySelectorAll('a.theme-pagination--pager')].reverse().find(a=>/\\d+/.test(a.textContent));const st=ll?.href?.match(/st=(\\d+)/)?.[1];if(st)url=FORUM+'&st='+st;}
let page=1;
while(url){
  const normUrl=url.split('#')[0];
  if(visited.has(normUrl))break;
  visited.add(normUrl);
  console.log('📄 Стр '+page+': '+normUrl);
  const res=await fetch(normUrl);
  if(!res.ok){console.error('HTTP '+res.status);break;}
  const html=await res.text();
  const doc=new DOMParser().parseFromString(html,'text/html');
  let foundOld=false;
  for(const b of doc.querySelectorAll('li.post')){
    const anchor=b.querySelector('a.anchor');
    const postId=anchor?.getAttribute('data-pid');
    if(!postId)continue;
    if(knownIds.has(postId)){foundOld=true;continue;}
    const authorEl=b.querySelector('.post-author--link');
    const bodyEl=b.querySelector('.comment_text');
    if(!authorEl||!bodyEl)continue;
    const tmp=document.createElement('div');
    tmp.innerHTML=bodyEl.innerHTML;
    tmp.querySelectorAll('blockquote').forEach(bq=>{
      const cite=bq.querySelector('em.cite,.cite');
      const author=cite?.querySelector('strong,b')?.textContent?.trim()||'';
      const dateRaw=cite?.querySelector('.em-cite,span')?.textContent?.trim()||'';
      if(cite)cite.remove();
      const body=bq.innerText?.trim()||'';
      const mk=document.createElement('div');
      mk.textContent='[QUOTE]'+author+'|'+dateRaw+'\\n'+body+'[/QUOTE]';
      bq.replaceWith(mk);
    });
    const dateEl=b.querySelector('.post-date--item');
    const likesEl=b.querySelector('.post-vote--rating');
    const avatarEl=b.querySelector('.post-author--avatar img');
    const ratingEl=b.querySelector('.post-author--rating');
    const msgEl=b.querySelector('.post-author--messages');
    const regEl=b.querySelector('.post-author--regdata');
    const imgs=[...b.querySelectorAll('.comment_text img')].map(i=>i.src).filter(s=>s?.startsWith('http')&&!s.includes('smil'));
    newPosts.push({id:postId,author:authorEl.textContent.trim(),avatar:avatarEl?.src||null,
      rating:ratingEl?parseInt(ratingEl.textContent.replace(/[^\\d-]/g,''))||null:null,
      msgCount:msgEl?parseInt(msgEl.textContent.replace(/[^\\d]/g,''))||null:null,
      regData:regEl?regEl.textContent.trim():null,date:dateEl?.textContent.trim()||'',
      timestamp:dateEl?.getAttribute('data-timestamp')?parseInt(dateEl.getAttribute('data-timestamp')):null,
      text:tmp.innerText?.trim().substring(0,1200)||'',
      likes:likesEl?parseInt(likesEl.textContent.trim())||0:0,images:imgs,
      brBefore:null,brAfter:null,sessionResult:null,
      url:'https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p='+postId});
  }
  console.log('  +'+newPosts.length+' новых');
  if(foundOld&&newPosts.length>0){console.log('✓ Нашли известные — стоп');break;}
  const nextLink=[...doc.querySelectorAll('a.theme-pagination--pager')].find(a=>a.textContent.trim()==='→');
  if(!nextLink||visited.has(nextLink.href.split('#')[0]))break;
  url=nextLink.href;page++;
  await new Promise(r=>setTimeout(r,400));
}
if(!newPosts.length){console.log('⚠️ Новых постов нет');return;}
console.log('💾 Сохраняю '+newPosts.length+'...');
const merged=[...existing,...newPosts];
const shaRes=await fetch('https://api.github.com/repos/'+REPO+'/contents/data/posts.json',{headers:{Authorization:'token '+TOKEN,Accept:'application/vnd.github.v3+json'}});
const {sha}=await shaRes.json();
const putRes=await fetch('https://api.github.com/repos/'+REPO+'/contents/data/posts.json',{method:'PUT',headers:{Authorization:'token '+TOKEN,'Content-Type':'application/json',Accept:'application/vnd.github.v3+json'},body:JSON.stringify({message:'scraper: +'+newPosts.length+' new posts',content:b64(merged),sha})});
if(putRes.ok)console.log('%c✅ +'+newPosts.length+' постов (всего '+merged.length+')','color:#4caf50;font-weight:bold');
else console.error('❌ Ошибка: '+putRes.status);
}

await scrape();
const id=setInterval(scrape,30*60*1000);
window._scraperInterval=id;

// Плавающий виджет с таймером
const widget=document.createElement('div');
widget.id='_scraper_widget';
widget.style.cssText='position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:1px solid #e53935;border-radius:10px;padding:12px 16px;z-index:99999;font-family:monospace;font-size:13px;color:#fff;min-width:220px;box-shadow:0 4px 20px rgba(0,0,0,.6);user-select:none';
document.body.appendChild(widget);

let nextRun=Date.now()+30*60*1000;
function updateWidget(status='⏳ ожидание'){
  const left=Math.max(0,nextRun-Date.now());
  const m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);
  widget.innerHTML='<div style="color:#e53935;font-weight:bold;margin-bottom:6px">🕷 Scraper</div>'
    +'<div style="color:#aaa;font-size:11px">'+status+'</div>'
    +'<div style="margin-top:8px;color:#fff">⏱ следующий запуск: <b>'+m+'м '+String(s).padStart(2,'0')+'с</b></div>'
    +'<div style="margin-top:6px;display:flex;gap:6px">'
    +'<button onclick="scrape().then(()=>{nextRun=Date.now()+30*60*1000})" style="background:#e53935;border:none;border-radius:5px;color:#fff;padding:4px 10px;cursor:pointer;font-size:11px">▶ сейчас</button>'
    +'<button onclick="clearInterval(window._scraperInterval);clearInterval(window._timerInterval);document.getElementById(\'_scraper_widget\').remove()" style="background:#333;border:none;border-radius:5px;color:#aaa;padding:4px 10px;cursor:pointer;font-size:11px">✕ стоп</button>'
    +'</div>';
}
updateWidget('активен');
window._timerInterval=setInterval(updateWidget,1000);
const _origScrape=scrape;
scrape=async function(){nextRun=Date.now()+30*60*1000;updateWidget('🔄 скрапим...');await _origScrape();updateWidget('✅ готово');};
console.log('%c⏱ Автозапуск каждые 30 мин. Виджет на странице. Остановить: clearInterval(window._scraperInterval)','color:#ff9800;font-weight:bold');
})();`
  }

  const copyScript = () => {
    if (!token.trim()) { L('Введите GitHub токен', 'err'); return }
    navigator.clipboard.writeText(getScript())
      .then(() => L('✓ Скрипт скопирован! Открой форум и вставь в консоль (F12)', 'ok'))
      .catch(() => L('Ошибка копирования — попробуй ещё раз', 'err'))
  }

  if (step === 'lock') return (
    <button className="admin-lock" title="Админ" onClick={() => setStep('auth')}>🔒</button>
  )

  return (
    <div className="admin-modal" onClick={e => e.target.className==='admin-modal'&&setStep('lock')}>
      <div className="admin-box">
        {step === 'auth' ? <>
          <div className="admin-title">🔒 Доступ</div>
          <input className="admin-input" type="password" placeholder="Пароль"
            value={pass} onChange={e=>setPass(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&tryAuth()} autoFocus/>
          <button className="admin-btn primary" onClick={tryAuth}>Войти</button>
          {log.map((l,i)=><div key={i} className={`al-${l.cls}`} style={{fontSize:11,marginTop:4}}>{l.msg}</div>)}
        </> : <>
          <div className="admin-title" style={{display:'flex',justifyContent:'space-between'}}>
            ⚙️ Скрапер
            <button onClick={()=>setStep('lock')} style={{background:'none',border:'none',color:'var(--dim)',cursor:'pointer',fontSize:16}}>✕</button>
          </div>
          <input className="admin-input" type="password" placeholder="GitHub токен (ghp_...)"
            value={token} onChange={e=>setToken(e.target.value)}/>
          <div style={{fontSize:10,color:'var(--dim)',marginBottom:8}}>
            Вставь токен → скопируй скрипт → открой форум GT → F12 → Console → вставь и Enter
          </div>
          <button className="admin-btn primary" onClick={copyScript}>
            📋 Скопировать скрипт
          </button>
          <a className="admin-btn secondary" href="https://forum.gipsyteam.ru/index.php?viewtopic=181676"
            target="_blank" rel="noreferrer"
            style={{display:'block',textAlign:'center',textDecoration:'none',marginTop:6}}>
            🌐 Открыть форум
          </a>
          <button className="admin-btn secondary" onClick={()=>setStep('lock')}>Закрыть</button>
          {log.length > 0 && (
            <div className="admin-log">
              {log.map((l,i)=><div key={i} className={`al-${l.cls}`}>{l.msg}</div>)}
            </div>
          )}
        </>}
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
  const [sortBy,  setSortBy]  = useState('date_asc')   // старые сначала по умолчанию
  const [search,  setSearch]  = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [romeoOnly, setRomeoOnly] = useState(false)
  const [page,    setPage]    = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [minLikes,  setMinLikes]  = useState(15)       // дефолт 15
  const [minRating, setMinRating] = useState(0)        // дефолт 0 (скрывает отриц. репу)

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
    fetchPublicData()
      .then(({posts, meta}) => { setPosts(posts||[]); setMeta(meta||{}) })
      .catch(() => setMeta({}))
      .finally(() => setLoading(false))

    // Обновляем данные каждые 5 минут (лайки обновляются скрапером)
    const interval = setInterval(() => {
      fetchPublicData()
        .then(({posts, meta}) => { setPosts(posts||[]); setMeta(meta||{}) })
        .catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
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

  // Сбрасываем страницу при смене фильтров (правильный способ — useEffect)
  useEffect(() => { setPage(1) },
    [ignored, search, sortBy, romeoOnly, minLikes, minRating]) // eslint-disable-line

  // Восстанавливаем позицию чтения при первой загрузке постов
  useEffect(() => {
    if (!feedPosts.length || !readPos.feed) return
    const idx = feedPosts.findIndex(p => p.id === readPos.feed)
    if (idx !== -1) setPage(Math.floor(idx / perPage) + 1)
  }, [feedPosts.length > 0]) // только когда посты впервые появились

  const totalPages = Math.max(1, Math.ceil(feedPosts.length / perPage))
  const pagedPosts = feedPosts.slice((page-1)*perPage, page*perPage)

  // ── КЛАССИФИКАЦИЯ ПО ТЕМАМ (один проход) ────────────────────────────────
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
        result.marathon.push(p)
      } else if (ROMEO_RE.test(text)) {
        result.discussion.push(p)
      } else if (text.length > 300 && likes >= 20) {
        result.debate.push(p)
      } else {
        result.flood.push(p)
      }
    })

    const byDate = (a,b) => (b.timestamp||0)-(a.timestamp||0)
    Object.keys(result).forEach(k => result[k].sort(byDate))
    return result
  }, [posts, ignored, minLikes, minRating, search])

  const [topicTab, setTopicTab] = useState('marathon')
  const [topicPage, setTopicPage] = useState(1)
  const TOPIC_PER_PAGE = 20

  const currentTopicPosts = useMemo(() => {
    let all = [...(classifiedPosts[topicTab] || [])]
    if (sortBy === 'date_asc')  all.sort((a,b) => (a.timestamp||0) - (b.timestamp||0))
    else if (sortBy === 'date_desc') all.sort((a,b) => (b.timestamp||0) - (a.timestamp||0))
    else if (sortBy === 'likes') all.sort((a,b) => (b.likes||0) - (a.likes||0))
    return {
      all,
      paged: all.slice((topicPage-1)*TOPIC_PER_PAGE, topicPage*TOPIC_PER_PAGE),
      totalPages: Math.max(1, Math.ceil(all.length / TOPIC_PER_PAGE))
    }
  }, [classifiedPosts, topicTab, topicPage, sortBy])

  const goTopicPage = p => {
    setTopicPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goPage = p => {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
            <AdminPanel />
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
                  <div className={`hstat-value ${stats.br?'green':''}`} style={{fontSize:18}}>
                    {fmtExact(stats.br||meta?.bankroll)}
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
                { id:'marathon',   icon:'📈', label:'Марафон',    desc:'Посты Ромео' },
                { id:'discussion', icon:'💬', label:'Обсуждение', desc:'Реакции на Ромео' },
                { id:'debate',     icon:'🔥', label:'Дебаты',     desc:'Топ-контент' },
                { id:'flood',      icon:'💨', label:'Флуд',       desc:'Прочее' },
              ]
              const { paged, totalPages: tpg, all } = currentTopicPosts
              return <>
                <FilterBar
                  sortBy={sortBy} setSortBy={setSortBy}
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
                      onClick={()=>{ setTopicTab(t.id); setTopicPage(1) }}>
                      {t.icon} {t.label}
                      <span className="tc">{classifiedPosts[t.id]?.length||0}</span>
                    </div>
                  ))}
                </div>

                {/* Описание текущей темы */}
                <div style={{fontSize:12,color:'var(--dim)',marginBottom:10}}>
                  {TABS.find(t=>t.id===topicTab)?.desc} · {all.length} постов
                  {topicTab==='marathon' && <span style={{marginLeft:8,color:'var(--dim2)'}}>— только апдейты Ромео о ходе марафона</span>}
                  {topicTab==='discussion' && <span style={{marginLeft:8,color:'var(--dim2)'}}>— посты цитирующие или упоминающие Ромео</span>}
                  {topicTab==='debate' && <span style={{marginLeft:8,color:'var(--dim2)'}}>{'— длинные посты с лайками (>300 симв, >20 👍)'}</span>}
                  {topicTab==='flood' && <span style={{marginLeft:8,color:'var(--dim2)'}}>— короткие посты без явной связи с марафоном</span>}
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
              <MarathonChart posts={posts} meta={meta} startBR={stats.startBR} setLightbox={setLightbox}/>
              <ActivityChart posts={posts}
                favorites={favorites} onFav={toggleFav}
                onIgnore={addIgnore} setLightbox={setLightbox}
                sortBy={sortBy} setSortBy={setSortBy}
                minLikes={minLikes} setMinLikes={setMinLikes}
                minRating={minRating} setMinRating={setMinRating}
                search={search}/>
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
