import { useState, useEffect, useCallback } from 'react'
import { loadConfig, saveConfig, fetchPublicData, githubPut } from './storage.js'
import { generateUserscript } from './userscript.js'

const ADMIN_KEY = 'romeo2026'

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #141414;
    --bg2:      #1c1c1c;
    --bg3:      #242424;
    --border:   #2e2e2e;
    --red:      #d32f2f;
    --red2:     #f44336;
    --red-dim:  #3a1515;
    --text:     #e0e0e0;
    --dim:      #757575;
    --dim2:     #9e9e9e;
    --green:    #43a047;
    --gold:     #f9a825;
    --white:    #ffffff;
    --radius:   4px;
  }

  html, body, #root {
    min-height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }

  a { color: var(--red2); text-decoration: none; }
  a:hover { text-decoration: underline; }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* LAYOUT */
  .wrap { max-width: 960px; margin: 0 auto; padding: 0 12px 60px; }

  /* TOP BAR */
  .topbar {
    background: #0d0d0d;
    border-bottom: 2px solid var(--red);
    padding: 0;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .topbar-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 12px;
    display: flex;
    align-items: stretch;
    height: 44px;
    gap: 0;
  }
  .topbar-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 0 0;
    border-right: 1px solid #222;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .topbar-logo-icon {
    background: var(--red);
    color: #fff;
    font-size: 15px;
    width: 28px;
    height: 28px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
  }
  .topbar-logo-text {
    font-size: 13px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: 0.01em;
  }
  .topbar-logo-sub {
    font-size: 10px;
    color: var(--dim);
    font-weight: 400;
  }
  .topbar-nav {
    display: flex;
    align-items: stretch;
    flex: 1;
    padding-left: 4px;
  }
  .topbar-nav-item {
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 12px;
    color: var(--dim2);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color .15s, border-color .15s;
  }
  .topbar-nav-item:hover { color: var(--text); }
  .topbar-nav-item.active { color: var(--white); border-bottom-color: var(--red); }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .badge {
    padding: 2px 8px;
    border-radius: 2px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .badge-admin { background: var(--red-dim); color: var(--red2); border: 1px solid var(--red); }
  .badge-live  { background: #1a2f1a; color: #66bb6a; border: 1px solid #43a047; animation: blink 2s infinite; }
  .badge-author { background: var(--red); color: #fff; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.6} }

  /* BREADCRUMB */
  .breadcrumb {
    padding: 10px 0 8px;
    font-size: 11px;
    color: var(--dim);
    display: flex;
    gap: 6px;
    align-items: center;
    border-bottom: 1px solid var(--border);
    margin-bottom: 14px;
  }
  .breadcrumb span { color: var(--dim); }
  .breadcrumb a { color: var(--dim2); }
  .breadcrumb a:hover { color: var(--red2); text-decoration: none; }

  /* TOPIC HEADER */
  .topic-header {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    margin-bottom: 14px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .topic-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--red);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
    border: 2px solid var(--border);
  }
  .topic-info { flex: 1; }
  .topic-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 4px;
  }
  .topic-meta { font-size: 11px; color: var(--dim); display: flex; gap: 12px; flex-wrap: wrap; }
  .topic-meta span { display: flex; align-items: center; gap: 4px; }
  .topic-stat-val { color: var(--text); font-weight: 600; }

  /* STATS ROW */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .stat-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
    text-align: center;
  }
  .stat-card-label { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
  .stat-card-value { font-size: 22px; font-weight: 700; color: var(--white); font-family: 'Roboto Mono', monospace; }
  .stat-card-value.red   { color: var(--red2); }
  .stat-card-value.green { color: #66bb6a; }
  .stat-card-value.gold  { color: var(--gold); }
  .stat-card-sub { font-size: 10px; color: var(--dim); margin-top: 4px; }
  .progress-wrap { height: 3px; background: var(--border); border-radius: 2px; margin-top: 8px; overflow:hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 2px; transition: width .5s; }

  /* CONTENT AREA */
  .content-cols { display: grid; grid-template-columns: 1fr 280px; gap: 12px; align-items: start; }

  /* POST BLOCK */
  .post-block {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 8px;
    overflow: hidden;
  }
  .post-head {
    background: var(--bg3);
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--border);
  }
  .post-author-name { font-weight: 600; color: var(--white); font-size: 13px; }
  .post-author-rank { font-size: 10px; color: var(--dim); }
  .post-date { margin-left: auto; font-size: 11px; color: var(--dim); font-family: 'Roboto Mono', monospace; }
  .post-body { padding: 12px 14px; font-size: 13px; color: var(--text); line-height: 1.65; }
  .post-br-tag { display: inline-block; background: var(--red-dim); color: var(--red2); border: 1px solid var(--red); border-radius: 2px; padding: 1px 6px; font-size: 11px; font-weight: 700; margin-left: 6px; font-family: 'Roboto Mono', monospace; }
  .post-footer { padding: 6px 14px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
  .post-link { font-size: 11px; color: var(--dim); }
  .post-link:hover { color: var(--red2); }
  .btn-expand { background: none; border: none; color: var(--dim); font-size: 11px; cursor: pointer; font-family: inherit; padding: 0; }
  .btn-expand:hover { color: var(--red2); }

  /* SIDEBAR */
  .sidebar { display: flex; flex-direction: column; gap: 10px; }
  .side-block {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .side-title {
    background: var(--bg3);
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    color: var(--dim2);
    text-transform: uppercase;
    letter-spacing: .08em;
    border-bottom: 1px solid var(--border);
  }
  .side-body { padding: 12px; }
  .side-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .side-row:last-child { border-bottom: none; }
  .side-key { color: var(--dim); }
  .side-val { color: var(--text); font-weight: 600; font-family: 'Roboto Mono', monospace; }
  .side-val.red { color: var(--red2); }
  .side-val.green { color: #66bb6a; }

  /* CHRONICLE */
  .chron-item { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .chron-item:last-child { border-bottom: none; }
  .chron-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--red); margin-top: 5px; flex-shrink: 0; }
  .chron-date { color: var(--dim); min-width: 80px; flex-shrink: 0; }
  .chron-text { color: var(--text); }

  /* STATUS */
  .status-text { font-size: 12px; color: var(--text); line-height: 1.7; }

  /* PAGINATION TABS */
  .forum-tabs {
    display: flex;
    border-bottom: 2px solid var(--border);
    margin-bottom: 12px;
    gap: 0;
  }
  .forum-tab {
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 500;
    color: var(--dim2);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: all .15s;
  }
  .forum-tab:hover { color: var(--text); }
  .forum-tab.active { color: var(--white); border-bottom-color: var(--red); }
  .tab-count { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 1px 6px; font-size: 10px; margin-left: 5px; color: var(--dim); }

  /* ADMIN */
  .admin-wrap {
    background: var(--bg2);
    border: 1px solid var(--red);
    border-radius: var(--radius);
    overflow: hidden;
    margin-top: 14px;
  }
  .admin-head {
    background: var(--red-dim);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--red);
  }
  .admin-head-title { font-size: 13px; font-weight: 700; color: var(--red2); }
  .admin-body { padding: 16px; }
  .admin-section { margin-bottom: 18px; }
  .admin-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .form-full { grid-column: 1 / -1; }
  .form-field { display: flex; flex-direction: column; gap: 5px; }
  .form-label { font-size: 11px; color: var(--dim2); }
  .form-input, .form-textarea, .form-select {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    padding: 7px 10px;
    outline: none;
    transition: border-color .15s;
    width: 100%;
  }
  .form-input:focus, .form-textarea:focus { border-color: var(--red2); }
  .form-textarea { resize: vertical; min-height: 80px; font-family: 'Roboto Mono', monospace; font-size: 11px; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .btn {
    padding: 7px 14px;
    border-radius: var(--radius);
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all .15s;
    white-space: nowrap;
  }
  .btn-red     { background: var(--red); color: #fff; }
  .btn-red:hover { background: var(--red2); }
  .btn-stop    { background: #7f0000; color: #fff; }
  .btn-stop:hover { background: #b71c1c; }
  .btn-ghost   { background: transparent; color: var(--dim2); border: 1px solid var(--border); }
  .btn-ghost:hover { border-color: var(--red2); color: var(--text); }
  .btn-green   { background: #1b5e20; color: #fff; }
  .btn-green:hover { background: #2e7d32; }

  /* AGENT */
  .agent-section { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-top: 12px; }
  .agent-modes { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
  .agent-mode-btn { padding: 5px 12px; border-radius: var(--radius); font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: var(--bg2); color: var(--dim2); font-family: inherit; transition: all .15s; }
  .agent-mode-btn.active { border-color: var(--red2); color: var(--red2); background: var(--red-dim); }
  .agent-log-panel { margin-top:10px; background:var(--bg); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
  .agent-log-head { background:#0a0a0a; padding:5px 10px; font-size:10px; color:var(--dim); display:flex; justify-content:space-between; border-bottom:1px solid var(--border); }
  .agent-log-body { max-height:180px; overflow-y:auto; padding:6px 0; font-family:'Roboto Mono',monospace; font-size:11px; }
  .agent-log-line { padding:2px 10px; line-height:1.6; display:flex; gap:8px; }
  .agent-log-time { color:#555; flex-shrink:0; }
  .agent-log-msg  { }
  .log-info  { color:#c8d8e8; }
  .log-ok    { color:#66bb6a; }
  .log-warn  { color:var(--gold); }
  .log-err   { color:var(--red2); }
  .log-dim   { color:#555; }
  .code-preview { margin-top:10px; width:100%; min-height:160px; background:var(--bg); border:1px solid var(--border); color:var(--dim); font-size:10px; padding:8px; border-radius:var(--radius); font-family:'Roboto Mono',monospace; resize:vertical; }

  /* AUTH */
  .auth-overlay { position:fixed; inset:0; background:#000a; display:flex; align-items:center; justify-content:center; z-index:200; }
  .auth-box { background:var(--bg2); border:1px solid var(--border); border-radius:var(--radius); padding:28px 32px; display:flex; flex-direction:column; gap:14px; align-items:center; min-width:280px; }
  .auth-title { font-size:14px; font-weight:700; color:var(--white); }
  .auth-input { background:var(--bg3); border:1px solid var(--border); border-radius:var(--radius); color:var(--text); font-family:inherit; font-size:14px; padding:9px 14px; outline:none; width:100%; text-align:center; letter-spacing:.1em; }
  .auth-input:focus { border-color:var(--red2); }
  .auth-err { font-size:11px; color:var(--red2); }
  .auth-hint { font-size:10px; color:var(--dim); }

  /* TOAST */
  .toast { position:fixed; bottom:20px; right:20px; background:var(--bg2); border:1px solid var(--green); border-radius:var(--radius); padding:9px 14px; font-size:12px; color:#66bb6a; z-index:300; animation:fadeUp .2s ease; }
  .toast.err { border-color:var(--red); color:var(--red2); }
  @keyframes fadeUp { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }

  /* UPDATED */
  .last-updated { font-size:10px; color:var(--dim); text-align:right; padding:6px 0 2px; font-family:'Roboto Mono',monospace; }

  /* EMPTY */
  .empty { padding:24px; text-align:center; color:var(--dim); font-size:12px; }

  @media(max-width:640px){
    .content-cols { grid-template-columns:1fr; }
    .stats-row { grid-template-columns:1fr 1fr; }
    .form-grid { grid-template-columns:1fr; }
    .topbar-nav { display:none; }
  }
`

function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return '$' + (n/1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return '$' + (n/1_000).toFixed(1) + 'k'
  return '$' + n
}

function fmtNum(n) {
  if (!n) return '—'
  return Number(n).toLocaleString('ru')
}

function useToast() {
  const [t, setT] = useState(null)
  const show = useCallback((msg, err=false) => {
    setT({msg,err}); setTimeout(() => setT(null), 3000)
  }, [])
  return [t, show]
}

export default function App() {
  const [meta, setMeta]         = useState(null)
  const [posts, setPosts]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('status')
  const [expanded, setExpanded] = useState({})

  const [adminMode, setAdminMode] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authVal, setAuthVal]   = useState('')
  const [authErr, setAuthErr]   = useState('')
  const [clicks, setClicks]     = useState(0)

  const [cfg, setCfg] = useState(() => loadConfig() || { repo: 'loremcdmx/romeoprotracker', token: '', authorName: 'Romeopro' })
  const [editMeta, setEditMeta]       = useState({})
  const [editChronicle, setEditChronicle] = useState('')
  const [agentMode, setAgentMode]     = useState('author')
  const [agentLogs, setAgentLogs]     = useState([])
  const [agentRunning, setAgentRunning] = useState(false)
  const agentWin  = useRef(null)
  const agentTimer = useRef(null)
  const msgListener = useRef(null)

  const addLog = useCallback((msg, level='info') => {
    const time = new Date().toLocaleTimeString('ru', {hour12:false})
    console.log(`[RPT ${time}] ${msg}`)
    setAgentLogs(prev => [...prev.slice(-80), {time, msg, level}])
  }, [])
  const [showCode, setShowCode]       = useState(false)
  const [code, setCode]               = useState('')
  const [toast, showToast] = useToast()

  useEffect(() => {
    const repo = cfg.repo || 'loremcdmx/romeoprotracker'
    fetchPublicData(repo)
      .then(({ posts, meta }) => {
        setPosts(posts || [])
        setMeta(meta || {})
        setEditMeta(meta || {})
        setEditChronicle((meta?.chronicle || []).map(c => `${c.date}|${c.text}`).join('\n'))
      })
      .catch(() => { setMeta({}); setPosts([]) })
      .finally(() => setLoading(false))
  }, [])

  const handleLogoClick = () => {
    const n = clicks + 1; setClicks(n)
    if (n >= 5) { setShowAuth(true); setClicks(0) }
  }

  const handleAuth = (e) => {
    if (e.key !== 'Enter' && e.type !== 'click') return
    if (authVal === ADMIN_KEY) { setAdminMode(true); setShowAuth(false); setAuthErr(''); setAuthVal('') }
    else setAuthErr('Неверный пароль')
  }

  const handleSaveCfg = () => { saveConfig(cfg); showToast('Конфиг сохранён') }

  const handleSaveMeta = async () => {
    if (!cfg.repo || !cfg.token) return showToast('Укажите репо и токен', true)
    try {
      const chronicle = editChronicle.split('\n').filter(l=>l.trim()).map(l=>{
        const [date,...rest] = l.split('|'); return {date:date.trim(), text:rest.join('|').trim()}
      })
      const newMeta = { ...editMeta, chronicle, lastUpdated: new Date().toISOString() }
      await githubPut(cfg.repo, cfg.token, 'data/meta.json', newMeta, 'admin: update meta')
      setMeta(newMeta)
      showToast('Мета сохранена в GitHub')
    } catch(e) { showToast(e.message, true) }
  }

  const handleCopy = () => {
    const c = generateUserscript(cfg, agentMode)
    setCode(c)
    navigator.clipboard.writeText(c).then(() => showToast('Скопировано в буфер'))
  }

  const handleStartAgent = () => {
    if (!cfg.repo || !cfg.token) return showToast('Укажите репо и токен', true)

    setAgentLogs([])
    setAgentRunning(true)

    addLog('Агент запускается...', 'info')
    addLog(`Режим: ${agentMode} | Репо: ${cfg.repo}`, 'dim')
    addLog(`Токен: ${cfg.token ? cfg.token.substring(0,8)+'...' : '❌ НЕ ЗАДАН'}`, cfg.token ? 'dim' : 'err')

    const c = generateUserscript(cfg, agentMode)
    setCode(c)

    addLog('Открываю вкладку форума...', 'info')
    try {
      agentWin.current = window.open(
        'https://forum.gipsyteam.ru/index.php?viewtopic=181676&filter=author&rp_mode=author',
        'rpt_agent'
      )
      if (!agentWin.current) {
        addLog('❌ Браузер заблокировал открытие вкладки! Разрешите всплывающие окна для этого сайта.', 'err')
        setAgentRunning(false)
        return
      }
      addLog('✓ Вкладка открыта. Ждём ответа от Tampermonkey-скрипта...', 'ok')
      addLog('  (если через 15 сек нет ответа — скрипт не установлен или не активен)', 'dim')
    } catch(e) {
      addLog('❌ Ошибка открытия вкладки: ' + e.message, 'err')
      setAgentRunning(false)
      return
    }

    // Таймаут — если за 15 сек нет ответа
    agentTimer.current = setTimeout(() => {
      if (agentRunning) {
        addLog('⏱ 15 секунд без ответа. Возможные причины:', 'warn')
        addLog('  1. Tampermonkey-скрипт не установлен', 'warn')
        addLog('  2. Скрипт установлен, но не совпадает URL (@match)', 'warn')
        addLog('  3. Tampermonkey отключён на этой странице', 'warn')
        addLog('  → Откройте вкладку форума → F12 → Console — должны быть строки [RPT ...]', 'warn')
      }
    }, 15000)

    // Слушаем postMessage от агента
    if (msgListener.current) window.removeEventListener('message', msgListener.current)
    msgListener.current = (e) => {
      // Показываем все входящие сообщения для диагностики
      if (e.data?.type?.startsWith('RPT_')) {
        addLog(`← postMessage: ${JSON.stringify(e.data)}`, 'dim')
      }
      if (e.data?.type === 'RPT_LOG') {
        addLog(e.data.msg, e.data.level || 'info')
      }
      if (e.data?.type === 'RPT_DONE') {
        clearTimeout(agentTimer.current)
        addLog(`🎉 Готово! Загружено ${e.data.count} постов`, 'ok')
        setAgentRunning(false)
        window.removeEventListener('message', msgListener.current)
        setTimeout(() => fetchPublicData(cfg.repo).then(({posts,meta}) => { setPosts(posts||[]); setMeta(meta||{}) }), 3000)
      }
      if (e.data?.type === 'RPT_ERROR') {
        clearTimeout(agentTimer.current)
        addLog('❌ Ошибка агента: ' + e.data.msg, 'err')
        setAgentRunning(false)
        window.removeEventListener('message', msgListener.current)
      }
    }
    window.addEventListener('message', msgListener.current)

    // Дополнительно: опрашиваем localStorage каждые 2 сек (если postMessage не работает)
    const lsPoll = setInterval(() => {
      try {
        const done = localStorage.getItem('rpt_agent_done')
        if (done) {
          const data = JSON.parse(done)
          clearInterval(lsPoll)
          clearTimeout(agentTimer.current)
          addLog(`🎉 (localStorage) Готово! ${data.count} постов`, 'ok')
          setAgentRunning(false)
          localStorage.removeItem('rpt_agent_done')
          fetchPublicData(cfg.repo).then(({posts,meta}) => { setPosts(posts||[]); setMeta(meta||{}) })
        }
        const lastLog = localStorage.getItem('rpt_agent_log')
        if (lastLog) {
          const entry = JSON.parse(lastLog)
          // показываем только новые
          if (entry.t > (lsPoll._lastT || 0)) {
            lsPoll._lastT = entry.t
            addLog('(ls) ' + entry.msg, entry.level || 'info')
          }
          localStorage.removeItem('rpt_agent_log')
        }
      } catch(_) {}
    }, 1500)
    agentTimer._lsPoll = lsPoll
  }

  const handleStopAgent = () => {
    clearTimeout(agentTimer.current)
    if (agentTimer._lsPoll) clearInterval(agentTimer._lsPoll)
    agentWin.current?.close()
    if (msgListener.current) window.removeEventListener('message', msgListener.current)
    setAgentRunning(false)
    addLog('■ Агент остановлен вручную', 'warn')
  }

  const progress = meta ? Math.min(100, ((meta.bankroll - meta.startBankroll) / (meta.targetBankroll - meta.startBankroll)) * 100) : 0

  return (
    <>
      <style>{css}</style>

      {/* AUTH */}
      {showAuth && (
        <div className="auth-overlay" onClick={() => setShowAuth(false)}>
          <div className="auth-box" onClick={e => e.stopPropagation()}>
            <div className="auth-title">🔐 Admin Mode</div>
            <input className="auth-input" type="password" placeholder="пароль" value={authVal} autoFocus
              onChange={e=>setAuthVal(e.target.value)} onKeyDown={handleAuth} />
            {authErr && <div className="auth-err">{authErr}</div>}
            <button className="btn btn-red" onClick={handleAuth}>Войти</button>
            <div className="auth-hint">или Enter</div>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-logo" onClick={handleLogoClick} title="5 кликов → Admin Mode">
            <div className="topbar-logo-icon">GT</div>
            <div>
              <div className="topbar-logo-text">RomeoPro Tracker</div>
              <div className="topbar-logo-sub">марафон $10k → $10M</div>
            </div>
          </div>
          <nav className="topbar-nav">
            {[['status','Статус'],['chronicle','Хроника'],['posts','Посты']].map(([id,label])=>(
              <div key={id} className={`topbar-nav-item ${activeTab===id?'active':''}`} onClick={()=>setActiveTab(id)}>
                {label}{id==='posts'&&<span className="tab-count">{posts.length}</span>}
              </div>
            ))}
          </nav>
          <div className="topbar-right">
            {adminMode && <span className="badge badge-admin">Admin</span>}
            {meta?.status === 'active' && <span className="badge badge-live">Live</span>}
          </div>
        </div>
      </div>

      <div className="wrap">
        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <a href="https://forum.gipsyteam.ru">GipsyTeam</a>
          <span>›</span>
          <a href="https://forum.gipsyteam.ru">Форум</a>
          <span>›</span>
          <a href="https://forum.gipsyteam.ru">Долги и споры</a>
          <span>›</span>
          <span style={{color:'var(--dim2)'}}>From Hero to Zero — RomeoPro</span>
        </div>

        {loading ? (
          <div className="empty">Загружаем данные марафона…</div>
        ) : (
          <>
            {/* TOPIC HEADER */}
            <div className="topic-header">
              <div className="topic-avatar">🎲</div>
              <div className="topic-info">
                <div className="topic-title">From Hero to Zero. Последний покерный марафон RomeoPro. С 10к$ до 10кк$.</div>
                <div className="topic-meta">
                  <span>Автор: <strong style={{color:'var(--red2)'}}>Romeopro</strong></span>
                  <span>Просмотров: <span className="topic-stat-val">{fmtNum(meta?.views || 1870000)}</span></span>
                  <span>Постов: <span className="topic-stat-val">{fmtNum(posts.length || meta?.totalPosts)}</span></span>
                  <span>Подписчиков: <span className="topic-stat-val">{fmtNum(meta?.subscribers || 1240)}</span></span>
                  {meta?.lastUpdated && <span>Обновлено: <span className="topic-stat-val">{new Date(meta.lastUpdated).toLocaleDateString('ru')}</span></span>}
                </div>
              </div>
              <span className="badge badge-author">АВТОР</span>
            </div>

            {/* STATS */}
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-card-label">Банкролл</div>
                <div className="stat-card-value green">{fmt(meta?.bankroll)}</div>
                <div className="stat-card-sub">старт: {fmt(meta?.startBankroll)}</div>
                <div className="progress-wrap"><div className="progress-fill" style={{width: (progress||0)+'%'}} /></div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Цель</div>
                <div className="stat-card-value" style={{fontSize:18}}>$10M</div>
                <div className="stat-card-sub">{(progress||0).toFixed(4)}% пути</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">День марафона</div>
                <div className="stat-card-value gold">#{meta?.day || '—'}</div>
                <div className="stat-card-sub">с 10 марта 2026</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Постов в теме</div>
                <div className="stat-card-value">{fmtNum(posts.length || meta?.totalPosts || 0)}</div>
                <div className="stat-card-sub">на GipsyTeam</div>
              </div>
            </div>

            {/* TABS */}
            <div className="forum-tabs">
              {[['status','Статус'],['chronicle','Хроника'],['posts','Посты']].map(([id,label])=>(
                <div key={id} className={`forum-tab ${activeTab===id?'active':''}`} onClick={()=>setActiveTab(id)}>
                  {label}{id==='posts'&&<span className="tab-count">{posts.length}</span>}
                </div>
              ))}
            </div>

            {/* CONTENT */}
            <div className="content-cols">
              <div>
                {/* STATUS TAB */}
                {activeTab === 'status' && (
                  <div className="post-block">
                    <div className="post-head">
                      <div>
                        <div className="post-author-name">Romeopro</div>
                        <div className="post-author-rank">Легенда форума · 25 445 постов · 15 лет на сайте</div>
                      </div>
                      <span className="badge badge-author" style={{marginLeft:'auto'}}>АВТОР</span>
                    </div>
                    <div className="post-body">
                      {meta?.currentStatus
                        ? <div className="status-text">{meta.currentStatus}</div>
                        : <div style={{color:'var(--dim)'}}>Текущий статус не указан. Добавьте в Admin Mode.</div>
                      }
                    </div>
                  </div>
                )}

                {/* CHRONICLE TAB */}
                {activeTab === 'chronicle' && (
                  <div className="post-block">
                    <div className="post-head">
                      <div className="post-author-name">Хроника марафона</div>
                    </div>
                    <div className="post-body">
                      {(meta?.chronicle || []).length === 0 ? (
                        <div style={{color:'var(--dim)'}}>Хроника пуста. Добавьте записи в Admin Mode.</div>
                      ) : (
                        (meta?.chronicle || []).map((c,i) => (
                          <div key={i} className="chron-item">
                            <div className="chron-dot" />
                            <div className="chron-date">{c.date}</div>
                            <div className="chron-text">{c.text}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* POSTS TAB */}
                {activeTab === 'posts' && (
                  posts.length === 0 ? (
                    <div className="post-block"><div className="empty">Постов нет — запустите агента в Admin Mode</div></div>
                  ) : (
                    posts.slice().reverse().map((p,i) => {
                      const exp = expanded[i]
                      const text = p.text || ''
                      return (
                        <div key={i} className="post-block">
                          <div className="post-head">
                            <div>
                              <div className="post-author-name">
                                {p.author || 'Romeopro'}
                                {p.bankroll && <span className="post-br-tag">{p.bankroll}</span>}
                              </div>
                              <div className="post-author-rank">Легенда форума</div>
                            </div>
                            <div className="post-date">{p.date}</div>
                          </div>
                          <div className="post-body">
                            <div className="status-text">
                              {exp ? text : text.substring(0,200) + (text.length>200?'…':'')}
                            </div>
                          </div>
                          <div className="post-footer">
                            {text.length>200 && (
                              <button className="btn-expand" onClick={()=>setExpanded(s=>({...s,[i]:!s[i]}))}>
                                {exp ? '▲ свернуть' : '▼ развернуть'}
                              </button>
                            )}
                            {p.url && <a className="post-link" href={p.url} target="_blank" rel="noreferrer">→ форум</a>}
                          </div>
                        </div>
                      )
                    })
                  )
                )}
              </div>

              {/* SIDEBAR */}
              <div className="sidebar">
                <div className="side-block">
                  <div className="side-title">📊 Статистика</div>
                  <div className="side-body">
                    <div className="side-row"><span className="side-key">БР сейчас</span><span className="side-val green">{fmt(meta?.bankroll)}</span></div>
                    <div className="side-row"><span className="side-key">Стартовый БР</span><span className="side-val">{fmt(meta?.startBankroll)}</span></div>
                    <div className="side-row"><span className="side-key">Цель</span><span className="side-val">$10M</span></div>
                    <div className="side-row"><span className="side-key">День</span><span className="side-val gold">#{meta?.day || '—'}</span></div>
                    <div className="side-row"><span className="side-key">Прогресс</span><span className="side-val">{(progress||0).toFixed(4)}%</span></div>
                    <div className="side-row"><span className="side-key">Постов</span><span className="side-val">{fmtNum(posts.length || meta?.totalPosts)}</span></div>
                    <div className="side-row"><span className="side-key">Подписчики</span><span className="side-val">{fmtNum(meta?.subscribers)}</span></div>
                  </div>
                </div>

                <div className="side-block">
                  <div className="side-title">🔗 Ссылки</div>
                  <div className="side-body">
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      <a href="https://forum.gipsyteam.ru/index.php?viewtopic=181676" target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Тема на GipsyTeam</a>
                      <a href={`https://github.com/${cfg.repo || 'loremcdmx/romeoprotracker'}`} target="_blank" rel="noreferrer" style={{fontSize:12}}>→ Репозиторий GitHub</a>
                    </div>
                  </div>
                </div>

                {!adminMode && (
                  <div className="side-block" style={{cursor:'pointer'}} onClick={handleLogoClick}>
                    <div className="side-body" style={{textAlign:'center',padding:'14px',color:'var(--dim)',fontSize:11}}>
                      🔐 Admin Mode<br/><span style={{fontSize:10}}>кликните лого 5 раз</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ADMIN PANEL */}
            {adminMode && (
              <div className="admin-wrap">
                <div className="admin-head">
                  <span>⚙</span>
                  <span className="admin-head-title">Admin Mode</span>
                  <button className="btn btn-ghost" style={{marginLeft:'auto',padding:'4px 10px'}} onClick={()=>setAdminMode(false)}>Выйти</button>
                </div>
                <div className="admin-body">

                  {/* GITHUB CONFIG */}
                  <div className="admin-section">
                    <div className="admin-section-title">GitHub (для сохранения данных)</div>
                    <div className="form-grid">
                      <div className="form-field">
                        <label className="form-label">Репозиторий</label>
                        <input className="form-input" value={cfg.repo} onChange={e=>setCfg(s=>({...s,repo:e.target.value}))} placeholder="username/romeoprotracker" />
                      </div>
                      <div className="form-field">
                        <label className="form-label">GitHub PAT (ghp_...)</label>
                        <input className="form-input" type="password" value={cfg.token} onChange={e=>setCfg(s=>({...s,token:e.target.value}))} placeholder="ghp_xxxxxxxxxxxx" />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Имя автора (для парсинга)</label>
                        <input className="form-input" value={cfg.authorName} onChange={e=>setCfg(s=>({...s,authorName:e.target.value}))} placeholder="Romeopro" />
                      </div>
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-red" onClick={handleSaveCfg}>Сохранить конфиг</button>
                    </div>
                  </div>

                  {/* META EDIT */}
                  <div className="admin-section">
                    <div className="admin-section-title">Данные марафона</div>
                    <div className="form-grid">
                      <div className="form-field">
                        <label className="form-label">Банкролл ($)</label>
                        <input className="form-input" type="number" value={editMeta.bankroll||''} onChange={e=>setEditMeta(s=>({...s,bankroll:+e.target.value}))} />
                      </div>
                      <div className="form-field">
                        <label className="form-label">День марафона</label>
                        <input className="form-input" type="number" value={editMeta.day||''} onChange={e=>setEditMeta(s=>({...s,day:+e.target.value}))} />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Стартовый БР ($)</label>
                        <input className="form-input" type="number" value={editMeta.startBankroll||10000} onChange={e=>setEditMeta(s=>({...s,startBankroll:+e.target.value}))} />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Подписчиков</label>
                        <input className="form-input" type="number" value={editMeta.subscribers||''} onChange={e=>setEditMeta(s=>({...s,subscribers:+e.target.value}))} />
                      </div>
                      <div className="form-field form-full">
                        <label className="form-label">Текущий статус</label>
                        <textarea className="form-textarea" value={editMeta.currentStatus||''} onChange={e=>setEditMeta(s=>({...s,currentStatus:e.target.value}))} />
                      </div>
                      <div className="form-field form-full">
                        <label className="form-label">Хроника (дата|текст, каждая запись с новой строки)</label>
                        <textarea className="form-textarea" style={{minHeight:100}} value={editChronicle} onChange={e=>setEditChronicle(e.target.value)} placeholder={"10 марта 2026|Объявил о марафоне\n15 марта 2026|Достиг $15k"} />
                      </div>
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-green" onClick={handleSaveMeta}>Сохранить в GitHub</button>
                    </div>
                  </div>

                  {/* AGENT */}
                  <div className="admin-section">
                    <div className="admin-section-title">Скрипт Tampermonkey</div>
                    <div className="agent-section">
                      <div style={{fontSize:11,color:'var(--dim)'}}>Режим сбора постов:</div>
                      <div className="agent-modes">
                        {[['author','Посты автора (~1-3 мин)'],['last10','Последние 10 стр.'],['all','Все страницы (~40 мин)']].map(([id,label])=>(
                          <button key={id} className={`agent-mode-btn ${agentMode===id?'active':''}`} onClick={()=>setAgentMode(id)}>{label}</button>
                        ))}
                      </div>
                      <div className="btn-row">
                        <button className="btn btn-ghost" onClick={()=>{ setCode(generateUserscript(cfg,agentMode)); setShowCode(s=>!s) }}>
                          {showCode ? 'Скрыть код' : 'Показать код'}
                        </button>
                        <button className="btn btn-red" onClick={handleCopy}>📋 Скопировать код</button>
                        {agentRunning
                          ? <button className="btn btn-stop" onClick={handleStopAgent}>■ Остановить</button>
                          : <button className="btn btn-red" onClick={handleStartAgent}>▶ Запустить агента</button>
                        }
                      </div>

                      {/* LOG PANEL */}
                      {agentLogs.length > 0 && (
                        <div className="agent-log-panel">
                          <div className="agent-log-head">
                            <span>🎲 Лог агента</span>
                            <span style={{cursor:'pointer',color:'var(--dim)'}} onClick={()=>setAgentLogs([])}>очистить</span>
                          </div>
                          <div className="agent-log-body" ref={el => { if(el) el.scrollTop = el.scrollHeight }}>
                            {agentLogs.map((l,i) => (
                              <div key={i} className={`agent-log-line log-${l.level}`}>
                                <span className="agent-log-time">{l.time}</span>
                                <span className="agent-log-msg">{l.msg}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {showCode && code && (
                        <textarea className="code-preview" readOnly value={code} />
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div className={`toast ${toast.err?'err':''}`}>{toast.msg}</div>}
    </>
  )
}
