import { useState, useEffect, useRef, useCallback } from 'react'
import { loadConfig, saveConfig, fetchPublicData, githubPut } from './storage.js'
import { generateUserscript } from './userscript.js'

const ADMIN_KEY = 'romeo2026'
const FORUM_URL = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'

// ─── СТИЛИ ──────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Unbounded:wght@400;700;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #060a0f;
    --bg2:      #0d1520;
    --bg3:      #111d2e;
    --border:   #1a2d45;
    --green:    #00e676;
    --green2:   #00c853;
    --red:      #ff1744;
    --gold:     #ffd600;
    --text:     #c8d8e8;
    --dim:      #4a6580;
    --accent:   #0d47a1;
  }

  html, body, #root {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .app { display: flex; flex-direction: column; min-height: 100vh; max-width: 900px; margin: 0 auto; padding: 0 16px 80px; }

  /* HEADER */
  .header { display: flex; align-items: center; gap: 12px; padding: 20px 0 16px; border-bottom: 1px solid var(--border); }
  .logo { font-size: 28px; cursor: pointer; user-select: none; filter: drop-shadow(0 0 8px #00e67640); }
  .header-title { font-family: 'Unbounded', sans-serif; font-size: 15px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
  .header-sub { font-size: 10px; color: var(--dim); }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .badge { padding: 3px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
  .badge-admin { background: #1a2d45; color: var(--green); border: 1px solid var(--green); }
  .badge-live  { background: #1a0a0a; color: var(--red);   border: 1px solid var(--red);   animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

  /* STATS GRID */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 16px 0; }
  .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; }
  .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); margin-bottom: 6px; }
  .stat-value { font-family: 'Unbounded', sans-serif; font-size: 20px; font-weight: 900; color: #fff; }
  .stat-value.green { color: var(--green); }
  .stat-value.gold  { color: var(--gold);  }
  .stat-sub { font-size: 10px; color: var(--dim); margin-top: 4px; }
  .progress-bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 10px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--green2), var(--green)); border-radius: 2px; transition: width .5s; }

  /* SECTION */
  .section { margin-top: 20px; }
  .section-title { font-size: 9px; text-transform: uppercase; letter-spacing: .15em; color: var(--dim); padding-bottom: 10px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }

  /* STATUS */
  .status-block { background: var(--bg2); border: 1px solid var(--border); border-left: 3px solid var(--green); border-radius: 0 6px 6px 0; padding: 14px 16px; font-size: 12px; color: var(--text); line-height: 1.7; }

  /* CHRONICLE */
  .chronicle-list { display: flex; flex-direction: column; gap: 8px; }
  .chronicle-item { display: flex; gap: 12px; align-items: flex-start; }
  .chronicle-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-top: 5px; flex-shrink: 0; }
  .chronicle-date { color: var(--dim); font-size: 11px; flex-shrink: 0; min-width: 90px; }
  .chronicle-text { font-size: 12px; color: var(--text); }

  /* POSTS */
  .posts-list { display: flex; flex-direction: column; gap: 1px; }
  .post-item { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; transition: border-color .15s; }
  .post-item:hover { border-color: #2a4060; }
  .post-meta { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
  .post-date { color: var(--dim); font-size: 10px; }
  .post-br { color: var(--green); font-weight: 700; font-size: 11px; }
  .post-text { font-size: 11px; color: #8a9bb0; line-height: 1.6; }
  .post-text.expanded { color: var(--text); }
  .post-expand { background: none; border: none; color: var(--dim); font-size: 10px; cursor: pointer; margin-top: 4px; font-family: inherit; }
  .post-expand:hover { color: var(--green); }

  /* ADMIN PANEL */
  .admin-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-top: 20px; }
  .admin-title { font-family: 'Unbounded', sans-serif; font-size: 12px; color: var(--green); margin-bottom: 16px; }
  .admin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-label { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .08em; }
  .field input, .field textarea, .field select {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 4px;
    color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12px;
    padding: 8px 10px; outline: none; transition: border-color .15s;
  }
  .field input:focus, .field textarea:focus { border-color: var(--green); }
  .field textarea { resize: vertical; min-height: 80px; }
  .field-full { grid-column: 1 / -1; }
  .btn { padding: 9px 16px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; cursor: pointer; border: none; transition: all .15s; }
  .btn-green  { background: var(--green2); color: #000; }
  .btn-green:hover  { background: var(--green); }
  .btn-red    { background: #c62828; color: #fff; }
  .btn-red:hover    { background: var(--red); }
  .btn-outline{ background: transparent; color: var(--text); border: 1px solid var(--border); }
  .btn-outline:hover{ border-color: var(--green); color: var(--green); }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }

  /* AGENT */
  .agent-block { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; margin-top: 14px; }
  .agent-title { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); margin-bottom: 10px; }
  .agent-modes { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .mode-btn { padding: 6px 12px; border-radius: 3px; font-size: 11px; cursor: pointer; border: 1px solid var(--border); background: var(--bg2); color: var(--text); font-family: inherit; transition: all .15s; }
  .mode-btn.active { border-color: var(--green); color: var(--green); background: #00e67610; }
  .agent-status { font-size: 11px; color: var(--dim); min-height: 18px; }
  .agent-status.running { color: var(--gold); }
  .agent-status.done    { color: var(--green); }
  .agent-status.error   { color: var(--red); }

  /* META EDIT */
  .meta-edit { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }

  /* AUTH SCREEN */
  .auth-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 16px; }
  .auth-input { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 12px 16px; width: 260px; outline: none; text-align: center; letter-spacing: .1em; }
  .auth-input:focus { border-color: var(--green); }
  .auth-hint { font-size: 10px; color: var(--dim); }
  .auth-error { font-size: 11px; color: var(--red); }

  /* TOAST */
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--bg2); border: 1px solid var(--green); border-radius: 6px; padding: 10px 16px; font-size: 12px; color: var(--green); z-index: 1000; animation: slideIn .2s ease; }
  .toast.error { border-color: var(--red); color: var(--red); }
  @keyframes slideIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  /* TABS */
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
  .tab { padding: 8px 14px; font-size: 11px; color: var(--dim); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .15s; }
  .tab.active { color: var(--green); border-bottom-color: var(--green); }

  /* UPDATED */
  .last-updated { font-size: 10px; color: var(--dim); text-align: right; padding: 8px 0; }

  @media (max-width: 600px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .admin-grid, .meta-edit { grid-template-columns: 1fr; }
  }
`

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}k`
  return `$${n}`
}

function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return [toast, show]
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [meta, setMeta]         = useState(null)
  const [posts, setPosts]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [adminMode, setAdminMode] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authVal, setAuthVal]   = useState('')
  const [authErr, setAuthErr]   = useState('')
  const [logoClicks, setLogoClicks] = useState(0)
  const [cfg, setCfg]           = useState(() => loadConfig() || { repo: '', token: '', authorName: 'Romeopro' })
  const [agentMode, setAgentMode] = useState('author')
  const [agentStatus, setAgentStatus] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [scriptCode, setScriptCode] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [editMeta, setEditMeta] = useState({})
  const [editChronicle, setEditChronicle] = useState('')
  const [activeTab, setActiveTab] = useState('status')
  const [expandedPosts, setExpandedPosts] = useState({})
  const [toast, showToast] = useToast()
  const agentWindow = useRef(null)
  const agentTimer  = useRef(null)

  // Загружаем данные
  useEffect(() => {
    const repo = cfg.repo || 'loremcdmx/romeoprotracker'
    fetchPublicData(repo)
      .then(({ posts, meta }) => {
        setPosts(posts || [])
        setMeta(meta || {})
        setEditMeta(meta || {})
        setEditChronicle((meta?.chronicle || []).map(c => `${c.date}|${c.text}`).join('\n'))
      })
      .catch(() => setMeta({}))
      .finally(() => setLoading(false))
  }, [])

  // Клики по лого → открыть auth
  const handleLogoClick = () => {
    const n = logoClicks + 1
    setLogoClicks(n)
    if (n >= 5) { setShowAuth(true); setLogoClicks(0) }
  }

  const handleAuth = (e) => {
    if (e.key === 'Enter' || e.type === 'click') {
      if (authVal === ADMIN_KEY) {
        setAdminMode(true); setShowAuth(false); setAuthErr(''); setAuthVal('')
      } else {
        setAuthErr('Неверный пароль')
      }
    }
  }

  // Сохраняем конфиг
  const handleSaveCfg = () => {
    saveConfig(cfg)
    showToast('✓ Конфиг сохранён')
  }

  // Сохраняем мету в GitHub
  const handleSaveMeta = async () => {
    if (!cfg.repo || !cfg.token) return showToast('Укажите репо и токен', true)
    try {
      const chronicle = editChronicle
        .split('\n')
        .filter(l => l.trim())
        .map(l => { const [date, ...rest] = l.split('|'); return { date: date.trim(), text: rest.join('|').trim() } })
      const newMeta = { ...editMeta, chronicle, lastUpdated: new Date().toISOString() }
      await githubPut(cfg.repo, cfg.token, 'data/meta.json', newMeta, 'admin: update meta')
      setMeta(newMeta)
      showToast('✓ Мета сохранена в GitHub')
    } catch (e) {
      showToast(e.message, true)
    }
  }

  // Агент
  const handleStartAgent = () => {
    if (!cfg.repo || !cfg.token) return showToast('Укажите репо и токен', true)
    const code = generateUserscript(cfg, agentMode)
    setScriptCode(code)

    // Сохраняем конфиг для userscript (через GM_setValue симулируем через URL)
    const params = new URLSearchParams({
      rpt_mode: agentMode,
      rpt_repo: cfg.repo,
      rpt_token: cfg.token,
      rpt_author: cfg.authorName || 'Romeopro',
      rpt_maxpages: agentMode === 'last10' ? 10 : agentMode === 'all' ? 999 : 0,
    })

    const forumUrl = `${FORUM_URL}&${params.toString()}`
    agentWindow.current = window.open(forumUrl, 'rpt_agent')
    setAgentRunning(true)
    setAgentStatus('Агент запущен, ожидаем данные...')

    // Слушаем сообщения от агента
    const onMsg = (e) => {
      if (e.data?.type === 'RPT_LOG') {
        setAgentStatus(e.data.msg)
      }
      if (e.data?.type === 'RPT_DONE') {
        setAgentRunning(false)
        setAgentStatus(`✓ Готово! Загружено ${e.data.count} постов`)
        window.removeEventListener('message', onMsg)
        // Перезагружаем данные
        setTimeout(() => {
          fetchPublicData(cfg.repo).then(({ posts, meta }) => {
            setPosts(posts || []); setMeta(meta || {})
          })
        }, 3000)
      }
      if (e.data?.type === 'RPT_ERROR') {
        setAgentRunning(false)
        setAgentStatus(`✗ Ошибка: ${e.data.msg}`)
        window.removeEventListener('message', onMsg)
      }
    }
    window.addEventListener('message', onMsg)
  }

  const handleStopAgent = () => {
    agentWindow.current?.close()
    clearInterval(agentTimer.current)
    setAgentRunning(false)
    setAgentStatus('Остановлен')
  }

  const handleCopyScript = () => {
    const code = generateUserscript(cfg, agentMode)
    navigator.clipboard.writeText(code).then(() => showToast('✓ Скопировано в буфер'))
  }

  const handleInsertManual = () => {
    const input = prompt('Вставьте данные поста (JSON или текст):')
    if (!input) return
    // TODO: parse and push
    showToast('Вставка вручную — в разработке')
  }

  // Прогресс марафона
  const progress = meta ? ((meta.bankroll - meta.startBankroll) / (meta.targetBankroll - meta.startBankroll)) * 100 : 0
  const progressPct = Math.min(100, Math.max(0, progress)).toFixed(4)

  if (showAuth) {
    return (
      <>
        <style>{css}</style>
        <div className="auth-screen">
          <div style={{ fontSize: 36 }}>🎲</div>
          <div style={{ fontFamily: 'Unbounded', fontSize: 13, color: '#fff' }}>Admin Mode</div>
          <input
            className="auth-input"
            type="password"
            placeholder="пароль"
            value={authVal}
            onChange={e => setAuthVal(e.target.value)}
            onKeyDown={handleAuth}
            autoFocus
          />
          {authErr && <div className="auth-error">{authErr}</div>}
          <div className="auth-hint">или нажмите Enter</div>
          <button className="btn btn-outline" onClick={() => setShowAuth(false)}>Отмена</button>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* HEADER */}
        <header className="header">
          <div className="logo" onClick={handleLogoClick} title="Кликните 5 раз для Admin Mode">🎲</div>
          <div>
            <div className="header-title">RomeoPro Tracker</div>
            <div className="header-sub">марафон $10k → $10M · From Hero to Zero</div>
          </div>
          <div className="header-right">
            {adminMode && <span className="badge badge-admin">ADMIN</span>}
            {meta?.status === 'active' && <span className="badge badge-live">LIVE</span>}
          </div>
        </header>

        {/* STATS */}
        {loading ? (
          <div style={{ padding: '40px 0', color: 'var(--dim)', textAlign: 'center' }}>Загружаем данные марафона…</div>
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <div className="stat-label">Банкролл</div>
                <div className="stat-value green">{fmt(meta?.bankroll)}</div>
                <div className="stat-sub">старт: {fmt(meta?.startBankroll)}</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">День марафона</div>
                <div className="stat-value gold">#{meta?.day || '—'}</div>
                <div className="stat-sub">цель: $10M</div>
              </div>
              <div className="stat">
                <div className="stat-label">Постов</div>
                <div className="stat-value">{posts.length || meta?.totalPosts || '—'}</div>
                <div className="stat-sub">на форуме GT</div>
              </div>
              <div className="stat">
                <div className="stat-label">Подписчики</div>
                <div className="stat-value">{meta?.subscribers ? meta.subscribers.toLocaleString('ru') : '—'}</div>
                <div className="stat-sub">темы на GipsyTeam</div>
              </div>
            </div>

            {meta?.lastUpdated && (
              <div className="last-updated">
                обновлено: {new Date(meta.lastUpdated).toLocaleString('ru')}
              </div>
            )}

            {/* TABS */}
            <div className="tabs">
              <div className={`tab ${activeTab==='status'?'active':''}`} onClick={()=>setActiveTab('status')}>Статус</div>
              <div className={`tab ${activeTab==='chronicle'?'active':''}`} onClick={()=>setActiveTab('chronicle')}>Хроника</div>
              <div className={`tab ${activeTab==='posts'?'active':''}`} onClick={()=>setActiveTab('posts')}>Посты ({posts.length})</div>
            </div>

            {activeTab === 'status' && meta?.currentStatus && (
              <div className="status-block">{meta.currentStatus}</div>
            )}

            {activeTab === 'chronicle' && (
              <div className="chronicle-list">
                {(meta?.chronicle || []).length === 0 && (
                  <div style={{ color: 'var(--dim)', fontSize: 12 }}>Хроника пуста</div>
                )}
                {(meta?.chronicle || []).map((c, i) => (
                  <div key={i} className="chronicle-item">
                    <div className="chronicle-dot" />
                    <div className="chronicle-date">{c.date}</div>
                    <div className="chronicle-text">{c.text}</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'posts' && (
              <div className="posts-list">
                {posts.length === 0 && (
                  <div style={{ color: 'var(--dim)', fontSize: 12 }}>Постов нет — запустите агента в Admin Mode</div>
                )}
                {posts.slice().reverse().map((p, i) => {
                  const exp = expandedPosts[i]
                  const text = p.text || ''
                  return (
                    <div key={i} className="post-item">
                      <div className="post-meta">
                        <span className="post-date">{p.date}</span>
                        {p.bankroll && <span className="post-br">{p.bankroll}</span>}
                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{color:'var(--dim)',fontSize:10,textDecoration:'none'}}>→ форум</a>}
                      </div>
                      <div className={`post-text ${exp?'expanded':''}`}>
                        {exp ? text : text.substring(0,160) + (text.length>160?'…':'')}
                      </div>
                      {text.length > 160 && (
                        <button className="post-expand" onClick={()=>setExpandedPosts(s=>({...s,[i]:!s[i]}))}>
                          {exp ? '▲ свернуть' : '▼ развернуть'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ADMIN PANEL */}
        {adminMode && (
          <div className="admin-panel">
            <div className="admin-title">⚙ Admin Mode</div>

            {/* Конфиг GitHub */}
            <div className="section-title">GitHub (для сохранения данных)</div>
            <div className="admin-grid">
              <div className="field">
                <label className="field-label">Репозиторий</label>
                <input
                  value={cfg.repo}
                  onChange={e => setCfg(s => ({...s, repo: e.target.value}))}
                  placeholder="username/romeoprotracker"
                />
              </div>
              <div className="field">
                <label className="field-label">GitHub PAT (ghp_...)</label>
                <input
                  type="password"
                  value={cfg.token}
                  onChange={e => setCfg(s => ({...s, token: e.target.value}))}
                  placeholder="ghp_xxxxxxxxxxxx"
                />
              </div>
              <div className="field">
                <label className="field-label">Имя автора (для парсинга)</label>
                <input
                  value={cfg.authorName}
                  onChange={e => setCfg(s => ({...s, authorName: e.target.value}))}
                  placeholder="Romeopro"
                />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-green" onClick={handleSaveCfg}>Сохранить конфиг</button>
              <button className="btn btn-outline" onClick={() => setAdminMode(false)}>Выйти</button>
            </div>

            {/* Редактирование меты */}
            <div className="section-title" style={{marginTop:20}}>Данные марафона</div>
            <div className="meta-edit">
              <div className="field">
                <label className="field-label">Банкролл ($)</label>
                <input type="number" value={editMeta.bankroll||''} onChange={e=>setEditMeta(s=>({...s,bankroll:+e.target.value}))} />
              </div>
              <div className="field">
                <label className="field-label">День (#)</label>
                <input type="number" value={editMeta.day||''} onChange={e=>setEditMeta(s=>({...s,day:+e.target.value}))} />
              </div>
              <div className="field">
                <label className="field-label">Стартовый БР ($)</label>
                <input type="number" value={editMeta.startBankroll||''} onChange={e=>setEditMeta(s=>({...s,startBankroll:+e.target.value}))} />
              </div>
              <div className="field">
                <label className="field-label">Подписчиков</label>
                <input type="number" value={editMeta.subscribers||''} onChange={e=>setEditMeta(s=>({...s,subscribers:+e.target.value}))} />
              </div>
              <div className="field field-full">
                <label className="field-label">Текущий статус</label>
                <textarea value={editMeta.currentStatus||''} onChange={e=>setEditMeta(s=>({...s,currentStatus:e.target.value}))} />
              </div>
              <div className="field field-full">
                <label className="field-label">Хроника (формат: дата|текст, каждая запись с новой строки)</label>
                <textarea
                  style={{minHeight:120}}
                  value={editChronicle}
                  onChange={e=>setEditChronicle(e.target.value)}
                  placeholder={"10 марта 2026|Объявил о марафоне\n15 марта 2026|Достиг $15k"}
                />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-green" onClick={handleSaveMeta}>Сохранить в GitHub</button>
            </div>

            {/* Агент */}
            <div className="agent-block">
              <div className="agent-title">Скрипт Tampermonkey</div>
              <div className="agent-modes">
                {[
                  { id: 'author', label: 'Посты автора (~1-3 мин)' },
                  { id: 'last10', label: 'Последние 10 стр.' },
                  { id: 'all',    label: 'Все страницы (~40 мин)' },
                ].map(m => (
                  <button key={m.id} className={`mode-btn ${agentMode===m.id?'active':''}`} onClick={()=>setAgentMode(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn btn-outline" onClick={()=>setShowScript(s=>!s)}>
                  {showScript ? 'Скрыть код' : 'Показать код'}
                </button>
                <button className="btn btn-green" onClick={handleCopyScript}>📋 Скопировать код</button>
                {agentRunning
                  ? <button className="btn btn-red" onClick={handleStopAgent}>■ Остановить</button>
                  : <button className="btn btn-green" onClick={handleStartAgent}>▶ Запустить агента</button>
                }
                <button className="btn btn-outline" onClick={handleInsertManual}>📝 Вставить вручную</button>
              </div>
              {agentStatus && (
                <div className={`agent-status ${agentRunning?'running':agentStatus.startsWith('✓')?'done':agentStatus.startsWith('✗')?'error':''}`}>
                  {agentStatus}
                </div>
              )}
              {showScript && scriptCode && (
                <textarea
                  readOnly
                  value={scriptCode}
                  style={{ marginTop:10, width:'100%', minHeight:200, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--dim)', fontSize:10, padding:8, borderRadius:4, fontFamily:'JetBrains Mono, monospace' }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {toast && <div className={`toast ${toast.err?'error':''}`}>{toast.msg}</div>}
    </>
  )
}
