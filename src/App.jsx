import { useState, useEffect, useMemo } from 'react'
import { fetchPublicData } from './storage.js'


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

  /* PERIOD TABS */
  .period-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
  .period-tab{padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg2);color:var(--dim2);transition:all .15s;white-space:nowrap}
  .period-tab:hover{border-color:#444;color:var(--text)}
  .period-tab.active{border-color:var(--red);color:#fff;background:var(--red-dim)}

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

  /* CHART DAY TILES */
  .day-posts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:10px}
  .day-tile{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;cursor:pointer;transition:border-color .15s}
  .day-tile:hover{border-color:var(--border2)}
  .day-tile-author{font-size:11px;font-weight:600;color:var(--white);margin-bottom:3px}
  .day-tile-text{font-size:11px;color:var(--dim2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .day-tile-likes{font-size:11px;color:var(--green);font-weight:700;margin-top:5px}
  .day-summary{font-size:12px;color:var(--text);line-height:1.6;padding:10px 12px;background:var(--bg3);border-radius:var(--r);margin-bottom:10px;border-left:3px solid var(--red)}

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
    .page{grid-template-columns:1fr}
    .hero-stats{grid-template-columns:1fr 1fr}
    .topbar-tabs{display:none}
  }
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

// Точный формат БР до доллара
const fmtExact = n => {
  if (!n && n !== 0) return '—'
  const rounded = Math.round(n)
  if (rounded >= 1000) return '$' + Math.floor(rounded / 1000) + ' ' + String(rounded % 1000).padStart(3, '0')
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
            <text x={pL-5} y={y+3} className="mc-ylabel">{fkAbs(v)}</text>
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
function RoomWidget({ meta }) {
  const history = meta?.brHistory
  if (!history?.length) return null

  const last = [...history].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0)).slice(-1)[0]
  if (!last?.rooms) return null

  const rooms = [
    { name:'ГГ',   key:'gg',   emoji:'🟢' },
    { name:'ПС',   key:'ps',   emoji:'🔵' },
    { name:'Кинг', key:'king', emoji:'🟡' },
    { name:'Коин', key:'coin', emoji:'🟠' },
  ]

  // Считаем P&L каждого рума за всё время (сумма дельт по сессиям, исключая люксон)
  const pnl = {gg:0, ps:0, king:0, coin:0}
  history.forEach(h => {
    if (!h.rooms) return
    rooms.forEach(r => { pnl[r.key] += (h.rooms.after[r.key]||0) - (h.rooms.before[r.key]||0) })
  })

  const total = rooms.reduce((s,r)=>s+last.rooms.after[r.key],0)

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:12}}>
      <div className="section-head" style={{marginBottom:10}}>
        <span className="section-title">🏦 Балансы по румам</span>
        <span className="section-count">последний отчёт</span>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--dim)'}}>итого: ${total.toLocaleString()}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
        {rooms.map(r => {
          const bal = last.rooms.after[r.key] || 0
          const p   = pnl[r.key]
          const pct = total > 0 ? Math.round(bal/total*100) : 0
          return (
            <div key={r.key} style={{background:'var(--bg3)',borderRadius:5,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:'var(--dim)',marginBottom:3}}>{r.emoji} {r.name}</div>
              <div style={{fontSize:15,fontWeight:700,color:'var(--white)',fontFamily:"'Roboto Mono',monospace"}}>
                ${bal.toLocaleString()}
              </div>
              <div style={{fontSize:10,marginTop:2,color:p>=0?'#66bb6a':'#ff5252'}}>
                {fk(p)} за марафон
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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

  let summary = `${ps.length} постов`
  if (totalUniq > 0) summary += `, ${totalUniq} авторов`
  summary += '.'
  if (romeoCount) summary += ` Ромео: ${romeoCount} пост${romeoCount > 1 ? 'а' : ''}.`
  if (topLikes > 0) summary += ` Топ: +${topLikes} 👍.`
  if (popular.length) summary += ` ${popular.length} постов набрали 20+ лайков.`
  if (topAuthors.length) summary += ` Активные: ${topAuthors.join(', ')}.`
  return summary
}

function ActivityChart({ posts }) {
  const [tip,      setTip]      = useState(null)
  const [selected, setSelected] = useState(null)

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
        {selected && (
          <button onClick={()=>setSelected(null)}
            style={{marginLeft:'auto',background:'none',border:'none',color:'var(--dim)',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            ✕ закрыть
          </button>
        )}
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H+18}`} onMouseLeave={()=>setTip(null)}>
        {data.map(([date, {count, posts:dp}], i) => {
          const bw = (W-pad*(data.length-1))/data.length
          const x  = i*(bw+pad)
          const bh = Math.max(3,(count/max)*H)
          const showL = i===0||i===data.length-1||i%Math.ceil(data.length/6)===0
          const isSelected = selected?.date === date
          return (
            <g key={date} style={{cursor:'pointer'}}
              onMouseEnter={()=>setTip({date,count,posts:dp,x:x+bw/2})}
              onClick={()=>setSelected(selected?.date===date ? null : {date,posts:dp})}>
              <rect x={x} y={H-bh} width={bw} height={bh} rx={2}
                fill={isSelected?'#e53935':tip?.date===date?'#e5393570':'#e5393530'}
                style={{transition:'fill .1s'}}/>
              {showL&&<text x={x+bw/2} y={H+14} className="chart-label">{date.slice(5)}</text>}
            </g>
          )
        })}
      </svg>

      {/* HOVER TOOLTIP */}
      {tip && !selected && (() => {
        const pct = (tip.x/W)*100
        const right = pct>65
        return (
          <div className="chart-tooltip" style={{
            bottom:52,
            left:  right?'auto':`calc(${pct}% - 8px)`,
            right: right?`calc(${100-pct}% - 8px)`:'auto',
          }}>
            <div style={{fontWeight:700,color:'#fff',fontSize:12,marginBottom:5}}>📅 {tip.date}</div>
            <div style={{fontSize:11,color:'#888',marginBottom: tip.posts.length ? 5 : 0}}>
              {tip.count} {tip.count===1?'пост':'постов'}
              {(() => {
                const romeoPs = tip.posts.filter(p=>/romeopro/i.test(p.author))
                const top = [...tip.posts].sort((a,b)=>(b.likes||0)-(a.likes||0))[0]
                const parts = []
                if (romeoPs.length) parts.push(`Ромео написал ${romeoPs.length}`)
                if (top?.likes >= 5) parts.push(`топ +${top.likes} 👍`)
                return parts.length ? ' · ' + parts.join(', ') : ''
              })()}
            </div>
            {(() => {
              const top = [...tip.posts].sort((a,b)=>(b.likes||0)-(a.likes||0))[0]
              if (!top) return null
              const clean = (top.text||'').replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'').trim()
              if (!clean) return null
              return (
                <div style={{fontSize:11,color:'#bbb',lineHeight:1.55,
                  display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                  <span style={{color:'#666',fontSize:10}}>{top.author}: </span>
                  {clean.substring(0,120)}
                </div>
              )
            })()}
            <div style={{fontSize:10,color:'#444',marginTop:5}}>кликни → детали дня</div>
          </div>
        )
      })()}

      {/* EXPANDED DAY VIEW */}
      {selected && (() => {
        const popular = selected.posts.filter(p=>(p.likes||0)>=20).sort((a,b)=>(b.likes||0)-(a.likes||0))
        const summary = makeDaySummary(selected.posts)
        return (
          <div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--dim2)',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>
              📅 {selected.date} — {selected.posts.length} постов
            </div>
            <div className="day-summary">{summary}</div>
            {popular.length > 0 ? (
              <>
                <div style={{fontSize:11,color:'var(--dim)',marginBottom:6}}>
                  Посты с 20+ лайками ({popular.length}):
                </div>
                <div className="day-posts-grid">
                  {popular.map((p,i) => (
                    <div key={i} className="day-tile" onClick={()=>p.url&&window.open(p.url,'_blank')}>
                      <div className="day-tile-author">{p.author}</div>
                      <div className="day-tile-text">{p.text?.substring(0,140)}</div>
                      <div className="day-tile-likes">+{p.likes} 👍 · {p.date}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{fontSize:12,color:'var(--dim)'}}>Нет постов с 20+ лайками в этот день</div>
            )}
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
  const hasFilters = romeoOnly || minLikes !== 15 || minRating !== 1000 || search
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
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap'}} title="Минимум лайков на посте">👍 мин.</label>
        <input className="filter-num" type="number" min="0" value={minLikes}
          onChange={e=>setMinLikes(+e.target.value||0)} title="Минимум лайков на посте"/>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <label style={{fontSize:11,color:'var(--dim)',whiteSpace:'nowrap'}} title="Минимальная репутация автора">⭐ репа</label>
        <input className="filter-num" type="number" min="0" value={minRating}
          onChange={e=>setMinRating(+e.target.value||0)} title="Минимальная репутация автора"/>
      </div>
      <button className={`filter-pill ${showSearch?'on':'off'}`}
        onClick={()=>setShowSearch(s=>!s)} title="Поиск по тексту постов">🔍</button>
      {showSearch && (
        <input className="feed-search" style={{minWidth:140}} placeholder="Поиск…"
          value={search} onChange={e=>setSearch(e.target.value)} autoFocus/>
      )}
      {hasFilters && (
        <button className="filter-pill off" title="Сбросить все фильтры" onClick={()=>{
          setRomeoOnly(false); setMinLikes(15); setMinRating(1000); setSearch(''); setShowSearch(false);
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
  const isLong = (p.text?.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').length || 0) > 600

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

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
const ADMIN_HASH = '407b01cfc12336c25bb7978682cfc41584e14a7558ad502daa3e3dbc4c71e49e'
const FORUM_BASE = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const REPO       = 'loremcdmx/romeoprotracker'

function AdminPanel({ onNewPosts }) {
  const [step, setStep]     = useState('lock')  // lock | auth | panel
  const [pass, setPass]     = useState('')
  const [token, setToken]   = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog]       = useState([])

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

  const PROXY = 'https://corsproxy.io/?url='
  const proxyFetch = (url, opts) => fetch(PROXY + encodeURIComponent(url), opts)

  const scrapeNew = async () => {
    if (!token.trim()) { L('Введите GitHub токен', 'err'); return }
    setRunning(true)
    setLog([])
    try {
      // 1. Загружаем текущие посты
      L('Загружаю текущие посты...')
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/posts.json?t=${Date.now()}`)
      if (!r.ok) throw new Error(`posts.json: ${r.status}`)
      const existing = await r.json()
      const knownIds = new Set(existing.map(p => p.id).filter(Boolean))
      L(`Известно ${knownIds.size} постов. Иду на форум...`)

      // 2. Скрапим последние страницы форума пока не натолкнёмся на известные посты
      const newPosts = []
      const visited  = new Set()
      let   url      = FORUM_BASE + '&st=99999999' // последняя страница — форум сам перенаправит
      let   page     = 1

      // Находим реальную последнюю страницу через первую
      const firstPage = await proxyFetch(FORUM_BASE)
      if (!firstPage.ok) throw new Error(`Форум недоступен: ${firstPage.status}`)
      const firstHtml = await firstPage.text()
      const firstDoc  = new DOMParser().parseFromString(firstHtml, 'text/html')
      const pagers = [...firstDoc.querySelectorAll('a.theme-pagination--pager')]
      const lastLink = pagers.reverse().find(a => /\d+/.test(a.textContent))
      const lastSt = lastLink?.href?.match(/st=(\d+)/)?.[1]
      url = lastSt ? `${FORUM_BASE}&st=${lastSt}` : FORUM_BASE

      while (url && page <= 5) {
        const normUrl = url.split('#')[0]
        if (visited.has(normUrl)) break
        visited.add(normUrl)

        L(`Страница ${page}: ${normUrl}`)
        const res = await proxyFetch(normUrl)
        if (!res.ok) { L(`HTTP ${res.status}`, 'err'); break }
        const html = await res.text()
        const doc  = new DOMParser().parseFromString(html, 'text/html')

        let foundOld = false
        for (const b of doc.querySelectorAll('li.post')) {
          const anchor = b.querySelector('a.anchor')
          const postId = anchor?.getAttribute('data-pid')
          if (!postId) continue

          if (knownIds.has(postId)) { foundOld = true; continue }

          const authorEl = b.querySelector('.post-author--link')
          const bodyEl   = b.querySelector('.comment_text')
          if (!authorEl || !bodyEl) continue

          const tmp = document.createElement('div')
          tmp.innerHTML = bodyEl.innerHTML
          tmp.querySelectorAll('blockquote').forEach(bq => {
            const cite   = bq.querySelector('em.cite, .cite')
            const author = cite?.querySelector('strong, b')?.textContent?.trim() || ''
            const dateRaw = cite?.querySelector('.em-cite, span')?.textContent?.trim() || ''
            if (cite) cite.remove()
            const body = bq.innerText?.trim() || ''
            const mk   = document.createElement('div')
            mk.textContent = `[QUOTE]${author}|${dateRaw}\n${body}[/QUOTE]`
            bq.replaceWith(mk)
          })

          const dateEl   = b.querySelector('.post-date--item')
          const likesEl  = b.querySelector('.post-vote--rating')
          const avatarEl = b.querySelector('.post-author--avatar img')
          const ratingEl = b.querySelector('.post-author--rating')
          const msgEl    = b.querySelector('.post-author--messages')
          const regEl    = b.querySelector('.post-author--regdata')
          const imgs     = [...b.querySelectorAll('.comment_text img')]
            .map(i => i.src).filter(s => s?.startsWith('http') && !s.includes('smil'))

          newPosts.push({
            id:        postId,
            author:    authorEl.textContent.trim(),
            avatar:    avatarEl?.src || null,
            rating:    ratingEl ? parseInt(ratingEl.textContent.replace(/[^\d-]/g,'')) || null : null,
            msgCount:  msgEl    ? parseInt(msgEl.textContent.replace(/[^\d]/g,''))    || null : null,
            regData:   regEl    ? regEl.textContent.trim() : null,
            date:      dateEl?.textContent.trim() || '',
            timestamp: dateEl?.getAttribute('data-timestamp') ? parseInt(dateEl.getAttribute('data-timestamp')) : null,
            text:      tmp.innerText?.trim().substring(0, 1200) || '',
            likes:     likesEl ? parseInt(likesEl.textContent.trim()) || 0 : 0,
            images:    imgs,
            brBefore: null, brAfter: null, sessionResult: null,
            url: `https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=${postId}`,
          })
        }

        L(`  +${newPosts.length} новых постов`, 'ok')
        if (foundOld && newPosts.length > 0) { L('Дошли до известных постов — стоп'); break }

        // Идём на предыдущую страницу
        const prevLink = [...doc.querySelectorAll('a.theme-pagination--pager')]
          .find(a => a.textContent.trim() === '←')
        if (!prevLink || visited.has(prevLink.href.split('#')[0])) break
        url = prevLink.href
        page++
        await new Promise(r => setTimeout(r, 500))
      }

      if (!newPosts.length) { L('Новых постов нет', 'warn'); setRunning(false); return }

      // 3. Сохраняем в GitHub
      L(`Сохраняю ${newPosts.length} новых постов...`, 'warn')
      const merged = [...existing, ...newPosts]
      const sha    = await fetch(`https://api.github.com/repos/${REPO}/contents/data/posts.json`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      }).then(r => r.json()).then(j => j.sha)

      await fetch(`https://api.github.com/repos/${REPO}/contents/data/posts.json`, {
        method: 'PUT',
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify({ message: `scraper: +${newPosts.length} new posts`, content: b64enc(merged), sha })
      })

      L(`✓ Готово! +${newPosts.length} постов (всего ${merged.length})`, 'ok')
      onNewPosts(newPosts)
    } catch(e) {
      L(`Ошибка: ${e.message}`, 'err')
    }
    setRunning(false)
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
          <button className="admin-btn primary" onClick={scrapeNew} disabled={running}>
            {running ? '⏳ Скрапим...' : '🕷 Скрапить новые посты'}
          </button>
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
  const [minRating, setMinRating] = useState(1000)     // дефолт 1000

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

      // День = количество сессий из brHistory
      const day = brHistory.length

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

  const [hotPeriod, setHotPeriod] = useState('all') // today | week | month | all | memes
  const [hotPage, setHotPage] = useState(1)
  const HOT_PER_PAGE = 20

  const hotPosts = useMemo(() => {
    const now = Date.now() / 1000
    const cutoff = {
      today: now - 86400,
      week:  now - 604800,
      month: now - 2592000,
      all:   0,
      memes: 0,
    }[hotPeriod] || 0

    let filtered = posts
      .filter(p => !ignored.has(p.author))
      .filter(p => !minRating || (p.rating||0) >= minRating)
      .filter(p => (p.timestamp||0) >= cutoff)

    if (hotPeriod === 'memes') {
      // Мемы: посты с картинками ИЛИ короткий смешной текст с хорошими лайками
      filtered = filtered.filter(p => {
        const hasImg = p.images?.length > 0
        const isShort = (p.text?.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'').trim().length||0) < 200
        const goodLikes = (p.likes||0) >= Math.max(minLikes, 5)
        return goodLikes && (hasImg || isShort)
      })
    } else {
      filtered = filtered.filter(p => (p.likes||0) >= Math.max(minLikes, 1))
    }

    return filtered.sort((a,b) => (b.likes||0) - (a.likes||0))
  }, [posts, ignored, minLikes, minRating, hotPeriod])

  const hotTotalPages = Math.max(1, Math.ceil(hotPosts.length / HOT_PER_PAGE))
  const hotPagedPosts = hotPosts.slice((hotPage-1)*HOT_PER_PAGE, hotPage*HOT_PER_PAGE)
  const goHotPage = p => { setHotPage(p); window.scrollTo({top:300,behavior:'smooth'}) }

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

  useEffect(() => { setHotPage(1) },
    [minLikes, minRating, hotPeriod]) // eslint-disable-line

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
  }, [posts, ignored])

  const [topicTab, setTopicTab] = useState('marathon')
  const [topicPage, setTopicPage] = useState(1)
  const TOPIC_PER_PAGE = 20

  const currentTopicPosts = useMemo(() => {
    const all = classifiedPosts[topicTab] || []
    return {
      all,
      paged: all.slice((topicPage-1)*TOPIC_PER_PAGE, topicPage*TOPIC_PER_PAGE),
      totalPages: Math.max(1, Math.ceil(all.length / TOPIC_PER_PAGE))
    }
  }, [classifiedPosts, topicTab, topicPage])

  const goTopicPage = p => {
    setTopicPage(p)
    window.scrollTo({ top: 300, behavior: 'smooth' })
  }

  const goPage = p => {
    setPage(p)
    window.scrollTo({top: document.querySelector('.filter-bar')?.offsetTop - 60 || 0, behavior:'smooth'})
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
            {[['feed','Лента'],['topics','Темы'],['hot','Топ постов'],['settings','Настройки']].map(([id,label])=>(
              <div key={id} className={`topbar-tab ${activeTab===id?'active':''}`} onClick={()=>switchTab(id)}>{label}</div>
            ))}
          </div>
          <div className="topbar-right">
            <AdminPanel onNewPosts={newPosts => {
              setPosts(prev => {
                const ids = new Set(prev.map(p=>p.id))
                return [...prev, ...newPosts.filter(p=>!ids.has(p.id))]
              })
            }}/>
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
                    <div className="hstat-sub">{stats.totalTourneys.toLocaleString()} турниров</div>
                  )}
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
                  {topicTab==='debate' && <span style={{marginLeft:8,color:'var(--dim2)'}}>— длинные посты с лайками (>300 симв, >20 👍)</span>}
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
                        onIgnore={addIgnore} setLightbox={setLightbox}/>
                    ))}
                    <Paginator page={topicPage} totalPages={tpg} onPage={goTopicPage}
                      perPage={TOPIC_PER_PAGE} onPerPage={()=>{}} total={all.length}/>
                  </>
                }
              </>
            })()}

            {/* ТОП ПОСТОВ */}
            {activeTab==='hot' && <>
              <FilterBar
                sortBy={sortBy} setSortBy={setSortBy}
                search={search} setSearch={setSearch}
                showSearch={showSearch} setShowSearch={setShowSearch}
                romeoOnly={romeoOnly} setRomeoOnly={setRomeoOnly}
                minLikes={minLikes} setMinLikes={setMinLikes}
                minRating={minRating} setMinRating={setMinRating}
                count={hotPosts.length} showSort={false}
              />
              <div className="period-tabs">
                {[
                  ['all',   '🔥 Все время'],
                  ['month', '📅 Месяц'],
                  ['week',  '📅 Неделя'],
                  ['today', '📅 Сегодня'],
                  ['memes', '😂 Мемы'],
                ].map(([id, label]) => (
                  <div key={id}
                    className={`period-tab ${hotPeriod===id?'active':''}`}
                    onClick={()=>{ setHotPeriod(id); setHotPage(1) }}>
                    {label}
                  </div>
                ))}
              </div>
              {hotPosts.length===0
                ? <div className="empty-state">Нет постов с такими фильтрами</div>
                : <>
                  <Paginator page={hotPage} totalPages={hotTotalPages} onPage={goHotPage}
                    perPage={HOT_PER_PAGE} onPerPage={()=>{}} total={hotPosts.length}/>
                  <div className="hot-grid">
                    {hotPagedPosts.map((p,i)=>(
                      <HotPostCard key={p.id||i} p={p} rank={(hotPage-1)*HOT_PER_PAGE+i} setLightbox={setLightbox}/>
                    ))}
                  </div>
                  <Paginator page={hotPage} totalPages={hotTotalPages} onPage={goHotPage}
                    perPage={HOT_PER_PAGE} onPerPage={()=>{}} total={hotPosts.length}/>
                </>
              }
              <ActivityChart posts={posts}/>
            </>}


            {/* ЛЕНТА */}
            {activeTab==='feed' && <>
              <MarathonChart posts={posts} meta={meta} startBR={stats.startBR} setLightbox={setLightbox}/>
              <RoomWidget meta={meta}/>
              <ActivityChart posts={posts}/>
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
                    {hotPosts.slice(0,5).map((p,i)=>{
                      const clean = (p.text||'').replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi,'').trim()
                      const hasImgOnly = !clean && p.images?.[0]
                      return (
                        <div key={i} style={{display:'flex',gap:8,padding:'6px 0',borderBottom:'1px solid var(--border)',alignItems:'flex-start'}}>
                          <span style={{color:'var(--gold)',fontWeight:700,fontSize:11,minWidth:16,flexShrink:0,paddingTop:2}}>{i+1}</span>
                          {p.images?.[0] && (
                            <img src={p.images[0]} alt=""
                              style={{width:48,height:36,objectFit:'cover',borderRadius:3,flexShrink:0,cursor:'zoom-in'}}
                              onClick={()=>setLightbox(p.images[0])}
                              onError={e=>e.target.style.display='none'}/>
                          )}
                          <span style={{fontSize:11,color:'var(--text)',flex:1,overflow:'hidden',cursor:'pointer',
                            display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}
                            onClick={()=>p.url&&window.open(p.url,'_blank')}>
                            {clean.substring(0,80) || (hasImgOnly ? '→ форум' : p.text?.substring(0,80))}
                          </span>
                          <span style={{color:'var(--green)',fontSize:10,fontWeight:700,flexShrink:0}}>+{p.likes}</span>
                        </div>
                      )
                    })}
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
