import { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { loadData, saveData, localCache, adminConfig } from './storage.js';
import { getUserscriptCode } from './userscript.js';

/* ─── Constants ──────────────────────────────────────────── */
const FORUM     = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676';
const ADMIN_KEY = 'romeo2026'; // Смените на свой

/* ─── Helpers ─────────────────────────────────────────────── */
const weservUrl = (url, w = 80) =>
  url ? 'https://images.weserv.nl/?url=' + url.replace(/^https?:\/\//, '') + '&w=' + w + '&output=webp&q=85' : null;

const blobToB64 = b => new Promise((r, j) => {
  const f = new FileReader(); f.onloadend = () => r(f.result); f.onerror = j; f.readAsDataURL(b);
});
const fetchB64 = async (url, w = 80) => {
  try { const r = await fetch(weservUrl(url, w)); if (!r.ok) return null; return await blobToB64(await r.blob()); }
  catch { return null; }
};
const fmt$ = n => {
  if (n == null) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + n;
};
const kc = r => r > 10000 ? '#4ade80' : r > 3000 ? '#86efac' : r > 500 ? '#93c5fd' : r > 0 ? '#cbd5e1' : '#f87171';
const mergePosts = (...arrs) => {
  const m = new Map();
  for (const a of arrs) for (const p of (a || [])) if (p?.id) m.set(String(p.id), p);
  return [...m.values()];
};

/* ─── Avatar ──────────────────────────────────────────────── */
function Avatar({ author, b64, directUrl, size = 40 }) {
  const [stage, setStage] = useState(0);
  const initials = (author || '?').slice(0, 2).toUpperCase();
  const hue = [...(author || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0, border: '2px solid rgba(255,255,255,0.08)', background: 'hsl(' + hue + ',35%,24%)' };
  const srcs = [b64, directUrl, weservUrl(directUrl, 80)].filter(Boolean);
  const src = srcs[stage];
  if (!src) return <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, color: 'hsl(' + hue + ',60%,70%)' }}>{initials}</div>;
  return <img src={src} alt={author} onError={() => setStage(s => s + 1)} style={{ ...base, objectFit: 'cover' }} />;
}

/* ─── PostCard ─────────────────────────────────────────────── */
function PostCard({ post, avStore, rank }) {
  const [open, setOpen] = useState(false);
  const isA = post.isRomeopro;
  const txt = post.text || ''; const long = txt.length > 500;
  const shown = long && !open ? txt.slice(0, 500) + '…' : txt;
  const r = post.rating ?? 0;
  const rc = r > 100 ? '#fbbf24' : r > 20 ? '#4ade80' : r > 0 ? '#86efac' : r === 0 ? '#64748b' : '#f87171';
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
      {rank != null && <div style={{ minWidth: 28, paddingTop: 14, fontSize: 13, fontWeight: 800, color: rank < 3 ? '#fbbf24' : rank < 7 ? '#4ade80' : '#475569', textAlign: 'center', flexShrink: 0 }}>{'#' + (rank + 1)}</div>}
      <div style={{ flex: 1, background: isA ? '#071410' : '#0d1526', border: '1px solid ' + (isA ? '#14532d' : '#1e293b'), borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid ' + (isA ? '#14532d' : '#1e293b'), background: isA ? '#040e08' : '#080f1f' }}>
          <Avatar author={post.author} b64={avStore?.[post.author]} directUrl={post.avatarUrl} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <a href={'https://www.gipsyteam.ru/profile/' + post.author} target="_blank" rel="noreferrer" style={{ fontSize: 15, fontWeight: 700, color: isA ? '#4ade80' : '#60a5fa', textDecoration: 'none' }}>{post.author}</a>
              {isA && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', background: '#15803d', color: '#fff', padding: '2px 7px', borderRadius: 4 }}>АВТОР</span>}
              {post.brMentioned && <span style={{ fontSize: 12, background: '#052e16', color: '#4ade80', padding: '2px 9px', borderRadius: 6, fontFamily: 'monospace', fontWeight: 700, border: '1px solid #166634' }}>{'💰 ' + fmt$(post.brMentioned)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              {post.authorReputation != null && <span style={{ fontSize: 13, color: kc(post.authorReputation), fontFamily: 'monospace', fontWeight: 700 }}>{(post.authorReputation >= 0 ? '+' : '') + Number(post.authorReputation).toLocaleString()}</span>}
              {post.postCount && <span style={{ fontSize: 12, color: '#64748b' }}>{Number(post.postCount).toLocaleString() + ' постов'}</span>}
              {post.yearsOnSite && <span style={{ fontSize: 12, color: '#64748b' }}>{post.yearsOnSite + ' лет на сайте'}</span>}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace', flexShrink: 0 }}>{post.timestamp}</div>
        </div>
        <div style={{ padding: '13px 16px' }}>
          <p style={{ fontSize: 15, lineHeight: 1.75, color: isA ? '#d1fae5' : '#cbd5e1', whiteSpace: 'pre-wrap', margin: 0 }}>{shown}</p>
          {long && <button onClick={() => setOpen(!open)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 }}>{open ? '↑ свернуть' : '↓ показать полностью'}</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid ' + (isA ? '#14532d' : '#1e293b'), background: isA ? '#020907' : '#050b16' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {['Ответить', 'Цитировать'].map(l => <a key={l} href={post.postUrl || FORUM} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#475569', textDecoration: 'none', fontWeight: 500 }}>{l}</a>)}
            {post.postUrl && <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#1e293b', textDecoration: 'none' }}>{'→ форум'}</a>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 18, color: '#15803d', userSelect: 'none' }}>+</span>
            <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: rc, minWidth: 32, textAlign: 'center' }}>{post.rating != null ? r : '?'}</span>
            <span style={{ fontSize: 18, color: '#991b1b', userSelect: 'none' }}>−</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AdminPanel ──────────────────────────────────────────── */
function AdminPanel({ posts, meta, avStore, onSaved, onLog }) {
  const [cfg, setCfg]           = useState(() => adminConfig.load() || { repo: '', token: '' });
  const [saving, setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [agentMode, setAgentMode]   = useState('author');
  const [agentStatus, setAgentStatus] = useState('idle');
  const [agentProg, setAgentProg]     = useState({ page: 0, posts: 0 });
  const [showPaste, setShowPaste]     = useState(false);
  const [pasteText, setPasteText]     = useState('');
  const [showScript, setShowScript]   = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const listenerRef = useRef(null);
  const winRef = useRef(null);

  const saveCfg = () => { adminConfig.save(cfg); setSaveStatus('Настройки сохранены'); setTimeout(() => setSaveStatus(''), 2000); };

  const processResult = useCallback(async (newPosts, newBrData, pageCount) => {
    onLog('Обрабатываем результаты: ' + newPosts.length + ' постов...');
    const merged = mergePosts(posts, newPosts);
    const byDay = new Map();
    for (const pt of (meta?.brData || [])) byDay.set(pt.day, pt);
    for (const pt of newBrData) if (pt?.day != null) byDay.set(pt.day, { ...pt, profit: pt.profit ?? (pt.totalBr - 10000) });
    const newBr = [...byDay.values()].sort((a, b) => a.day - b.day);
    const newMeta = { ...(meta || {}), brData: newBr };
    const avMap = {};
    for (const p of merged.filter(p => p.avatarUrl && !avMap[p.author])) {
      const b64 = await fetchB64(p.avatarUrl, 80); if (b64) avMap[p.author] = b64;
    }
    try {
      setSaving(true); setSaveStatus('Загружаем в GitHub...');
      await saveData({ posts: merged, meta: newMeta, avatars: { ...avStore, ...avMap } }, cfg);
      setSaveStatus('✅ Загружено в GitHub! Сайт обновится через ~1 мин.');
      onSaved({ posts: merged, meta: newMeta, avatars: avMap });
      onLog('Данные сохранены в GitHub');
    } catch (e) {
      setSaveStatus('❌ Ошибка: ' + e.message);
      onLog('Ошибка GitHub: ' + e.message);
    } finally { setSaving(false); setAgentStatus('done'); }
  }, [posts, meta, avStore, cfg, onLog, onSaved]);

  const startAgent = () => {
    if (listenerRef.current) window.removeEventListener('message', listenerRef.current);
    const handler = async (ev) => {
      if (ev.data?.type !== 'romeoproAgent') return;
      if (ev.data.event === 'progress') setAgentProg({ page: ev.data.pageCount, posts: ev.data.totalPosts });
      if (ev.data.event === 'done') {
        window.removeEventListener('message', listenerRef.current);
        await processResult(ev.data.posts || [], ev.data.brData || [], ev.data.pageCount || 0);
      }
    };
    listenerRef.current = handler;
    window.addEventListener('message', handler);
    const url = agentMode === 'author' ? FORUM + '&filter=author&rp_mode=author'
              : agentMode === 'recent' ? FORUM + '&st=3400&rp_mode=recent'
              : FORUM + '&rp_mode=all';
    const win = window.open(url, 'rp_agent', 'width=900,height=650,menubar=no,toolbar=no');
    winRef.current = win;
    if (!win) { setSaveStatus('Браузер заблокировал попап — разрешите для этого сайта'); setShowPaste(true); return; }
    setAgentStatus('running'); setAgentProg({ page: 0, posts: 0 });
    onLog('Агент запущен: ' + agentMode);
  };

  const copyScript = async () => {
    const code = getUserscriptCode();
    try { await navigator.clipboard.writeText(code); }
    catch { const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    setScriptCopied(true); setTimeout(() => setScriptCopied(false), 3000);
  };

  const handlePaste = async () => {
    try {
      const d = JSON.parse(pasteText);
      if (d.type === 'rp_crawler_result' && d.posts) await processResult(d.posts, d.brData || [], d.pageCount || 0);
      else setSaveStatus('Неверный формат JSON');
    } catch (e) { setSaveStatus('Ошибка: ' + e.message); }
  };

  const runPct = Math.min(95, agentProg.page * (agentMode === 'author' ? 25 : agentMode === 'recent' ? 10 : 0.5));

  return (
    <div style={{ background: '#0a1a10', border: '2px solid #15803d', borderRadius: 12, marginBottom: 16 }}>
      <div style={{ background: '#061208', padding: '12px 16px', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#4ade80' }}>⚙ ADMIN</span>
        {agentStatus === 'running' && <span style={{ fontSize: 12, color: '#fbbf24', fontFamily: 'monospace' }}>{'● АГЕНТ: стр.' + agentProg.page + ' · ' + agentProg.posts + ' постов'}</span>}
        {agentStatus === 'done' && <span style={{ fontSize: 12, color: '#4ade80' }}>{'✓ Готово · ' + agentProg.posts + ' постов'}</span>}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* GitHub config */}
        <div style={{ background: '#040e08', border: '1px solid #14532d', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>GitHub (для сохранения данных)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={cfg.repo} onChange={e => setCfg({ ...cfg, repo: e.target.value })} placeholder="username/romeoprotracker" style={{ flex: 1, minWidth: 160, background: '#020917', border: '1px solid #1e293b', color: '#cbd5e1', padding: '7px 10px', borderRadius: 6, fontSize: 13, outline: 'none' }} />
            <input value={cfg.token} onChange={e => setCfg({ ...cfg, token: e.target.value })} type="password" placeholder="GitHub PAT (ghp_...)" style={{ flex: 1, minWidth: 160, background: '#020917', border: '1px solid #1e293b', color: '#cbd5e1', padding: '7px 10px', borderRadius: 6, fontSize: 13, outline: 'none' }} />
            <button onClick={saveCfg} style={{ background: '#15803d', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Сохранить</button>
          </div>
          {saveStatus && <div style={{ marginTop: 8, fontSize: 12, color: saveStatus.startsWith('✅') ? '#4ade80' : saveStatus.startsWith('❌') ? '#f87171' : '#94a3b8' }}>{saveStatus}</div>}
        </div>

        {/* Tampermonkey script */}
        <div style={{ background: '#040e08', border: '1px solid #14532d', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Скрипт Tampermonkey</div>
          <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, marginBottom: 10 }}>
            {'Установите '}
            <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer" style={{ color: '#22c55e' }}>Tampermonkey</a>
            {' → скопируйте код → Tampermonkey → «Создать новый скрипт» → Ctrl+A → Ctrl+V → Ctrl+S'}
          </div>
          {showScript && (
            <textarea readOnly value={getUserscriptCode()} style={{ width: '100%', height: 120, background: '#020917', border: '1px solid #1e293b', color: '#94a3b8', padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', borderRadius: 6, resize: 'vertical', outline: 'none', marginBottom: 8 }} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowScript(!showScript)} style={{ background: 'transparent', border: '1px solid #14532d', color: '#4ade80', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{showScript ? 'Скрыть код' : 'Показать код'}</button>
            <button onClick={copyScript} style={{ background: scriptCopied ? '#166534' : '#15803d', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{scriptCopied ? '✓ Скопировано!' : '📋 Скопировать код'}</button>
          </div>
        </div>

        {/* Agent */}
        <div style={{ background: '#040e08', border: '1px solid #14532d', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Запуск агента</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { id: 'author', label: 'Посты автора', desc: '~1-3 мин' },
              { id: 'recent', label: 'Последние 10 стр.', desc: '~3-5 мин' },
              { id: 'all',    label: 'Все страницы', desc: '20-40 мин' },
            ].map(m => (
              <button key={m.id} onClick={() => setAgentMode(m.id)} disabled={agentStatus === 'running'} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid ' + (agentMode === m.id ? '#22c55e' : '#1e293b'), background: agentMode === m.id ? '#0a2010' : 'transparent', color: agentMode === m.id ? '#22c55e' : '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {m.label + ' (' + m.desc + ')'}
              </button>
            ))}
          </div>
          {agentStatus === 'running' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ height: 6, background: '#0f1f14', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ height: '100%', width: runPct + '%', background: 'linear-gradient(90deg,#15803d,#4ade80)', transition: 'width .5s' }} />
              </div>
              <div style={{ fontSize: 11, color: '#374151' }}>{'Страница ' + agentProg.page + ' · ' + agentProg.posts + ' постов · не закрывайте вкладку'}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agentStatus !== 'running'
              ? <button onClick={startAgent} style={{ background: '#15803d', border: 'none', color: '#fff', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>▶ Запустить агента</button>
              : <button onClick={() => { if (winRef.current) try { winRef.current.close(); } catch {} setAgentStatus('idle'); }} style={{ background: '#7f1d1d', border: 'none', color: '#fca5a5', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>■ Остановить</button>
            }
            <button onClick={() => setShowPaste(!showPaste)} style={{ background: 'transparent', border: '1px solid #1e293b', color: '#64748b', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>📋 Вставить вручную</button>
          </div>
          {showPaste && (
            <div style={{ marginTop: 10, background: '#020917', border: '1px solid #14532d', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 6 }}>Вставьте JSON из буфера (скрипт скопировал после завершения):</div>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Ctrl+V сюда..." style={{ width: '100%', height: 80, background: '#040e08', border: '1px solid #1e293b', borderRadius: 6, color: '#cbd5e1', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none' }} />
              <button onClick={handlePaste} disabled={!pasteText.trim() || saving} style={{ marginTop: 8, background: pasteText.trim() ? '#15803d' : '#1a2235', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Обработать и загрузить в GitHub</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main App ─────────────────────────────────────────────── */
export default function App() {
  const [posts,     setPosts]     = useState([]);
  const [meta,      setMeta]      = useState(null);
  const [avStore,   setAvStore]   = useState({});
  const [loading,   setLoading]   = useState(true);
  const [loadedAt,  setLoadedAt]  = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [pwd,       setPwd]       = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [showLog,   setShowLog]   = useState(false);
  const [logLines,  setLogLines]  = useState([]);
  const [feedMode,  setFeedMode]  = useState('all');
  const [minR,      setMinR]      = useState(0);
  const [minRep,    setMinRep]    = useState(1000);
  const [clicks,    setClicks]    = useState(0);

  const log = useCallback(msg => {
    const ts = new Date().toLocaleTimeString('ru-RU');
    setLogLines(p => [...p, '[' + ts + '] ' + msg]);
  }, []);

  useEffect(() => {
    loadData().then(({ posts: p, meta: m, avatars: a }) => {
      if (p?.length) { setPosts(p); log('Загружено ' + p.length + ' постов'); }
      if (m) setMeta(m);
      if (a) setAvStore(a);
      setLoadedAt(new Date());
      setLoading(false);
    });
  }, [log]);

  const handleLogo = () => { const n = clicks + 1; setClicks(n); if (n >= 5) { setShowLogin(true); setClicks(0); } };
  const tryLogin   = () => { if (pwd === ADMIN_KEY) { setAdminMode(true); setShowLogin(false); setPwd(''); } else setLoginErr('Неверный ключ'); };

  const all      = posts;
  const filtered = all.filter(p => (p.rating ?? 0) >= minR && (p.authorReputation ?? -99999) >= minRep);
  const tsOnly   = all.filter(p => p.isRomeopro);
  const top15    = [...all].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 15);
  const display  = feedMode === 'author' ? tsOnly : feedMode === 'top' ? top15 : filtered;
  const brPct    = meta?.currentBr ? Math.max(0, Math.min(100, ((meta.currentBr - 10000) / (10e6 - 10000)) * 100)) : 0;

  return (
    <div style={{ minHeight: '100vh', background: '#030b18', color: '#e2e8f0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'IBM Plex Sans',system-ui,sans-serif; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-thumb { background:#1e3a28; border-radius:2px; }
        input { background:#0d1526; border:1px solid #1e293b; color:#cbd5e1; padding:5px 8px; border-radius:6px; font-size:13px; outline:none; }
        input:focus { border-color:#15803d; }
      `}</style>

      {/* Header */}
      <div style={{ background: '#030b18', borderBottom: '1px solid #0f1e30', padding: '12px 20px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span onClick={handleLogo} style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', cursor: 'default', userSelect: 'none' }}>🎲 RomeoPro</span>
              {adminMode && <span style={{ fontSize: 10, background: '#15803d', color: '#fff', padding: '2px 7px', borderRadius: 4, fontWeight: 800 }}>ADMIN</span>}
              {meta?.currentBr && <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#4ade80', background: '#071810', padding: '3px 13px', borderRadius: 7, border: '1px solid #14532d' }}>{fmt$(meta.currentBr)}</span>}
              {meta?.currentDay && <span style={{ fontSize: 14, color: '#64748b' }}>{'День '}<b style={{ color: '#94a3b8' }}>{meta.currentDay}</b></span>}
              {meta?.totalPosts && <span style={{ fontSize: 13, color: '#475569', fontFamily: 'monospace' }}>{Number(meta.totalPosts).toLocaleString() + ' постов'}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {loadedAt && <span style={{ fontSize: 11, color: '#1e3a22', fontFamily: 'monospace' }}>{'обновлено ' + loadedAt.toLocaleTimeString('ru-RU')}</span>}
              {adminMode && <button onClick={() => setAdminMode(false)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Выйти</button>}
              <button onClick={() => setShowLog(v => !v)} style={{ padding: '6px 13px', borderRadius: 20, border: '1px solid ' + (showLog ? '#15803d' : '#1e293b'), fontSize: 13, fontWeight: 600, cursor: 'pointer', background: showLog ? '#071a0e' : 'transparent', color: showLog ? '#4ade80' : '#64748b' }}>{'📋 Логи' + (logLines.length > 0 ? ' (' + logLines.length + ')' : '')}</button>
              <a href={FORUM} target="_blank" rel="noreferrer" style={{ padding: '7px 13px', border: '1px solid #1e293b', borderRadius: 8, color: '#475569', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>{'→ Форум'}</a>
            </div>
          </div>
          {meta?.currentBr && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 4, background: '#0f1f2e', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: brPct + '%', background: 'linear-gradient(90deg,#15803d,#4ade80)', borderRadius: 2 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#1e3a22', fontFamily: 'monospace' }}>$10k</span>
                <span style={{ fontSize: 11, color: '#1e3a22', fontFamily: 'monospace' }}>{brPct.toFixed(4) + '% к $10M'}</span>
                <span style={{ fontSize: 11, color: '#1e3a22', fontFamily: 'monospace' }}>$10M</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '14px 16px 60px' }}>
        {showLogin && (
          <div style={{ background: '#0a1a10', border: '1px solid #15803d', borderRadius: 10, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#4ade80', fontWeight: 700 }}>🔑 Ключ:</span>
            <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && tryLogin()} autoFocus style={{ width: 160 }} />
            <button onClick={tryLogin} style={{ background: '#15803d', border: 'none', color: '#fff', padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Войти</button>
            <button onClick={() => { setShowLogin(false); setPwd(''); setLoginErr(''); }} style={{ background: 'none', border: '1px solid #1e293b', color: '#475569', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Отмена</button>
            {loginErr && <span style={{ fontSize: 12, color: '#f87171' }}>{loginErr}</span>}
          </div>
        )}

        {showLog && (
          <div style={{ background: '#0d1526', border: '1px solid #1e293b', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#475569', fontFamily: 'monospace' }}>{'📋 ЛОГ (' + logLines.length + ')'}</span>
              <button onClick={() => navigator.clipboard.writeText(logLines.join('\n')).catch(() => {})} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Копировать</button>
            </div>
            <pre style={{ padding: '12px 16px', fontSize: 12, color: '#94a3b8', overflow: 'auto', maxHeight: 200, fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>{logLines.join('\n')}</pre>
          </div>
        )}

        {adminMode && (
          <AdminPanel posts={posts} meta={meta} avStore={avStore} onLog={log}
            onSaved={({ posts: p, meta: m, avatars: a }) => { setPosts(p); setMeta(m); setAvStore(a); }} />
        )}

        <div style={{ background: '#0a1020', border: '1px solid #1e3050', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 12, color: '#475569' }}>
          {all.length + ' постов · ' + (meta?.topicViews ? (meta.topicViews / 1e6).toFixed(2) + 'M просмотров · ' : '') + (meta?.subscribers ?? '') + ' подписчиков'}
          {loading && <span style={{ marginLeft: 8, color: '#334155' }}>⟳ загрузка…</span>}
        </div>

        {/* Status + Chart */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 14, marginBottom: 14 }}>
          <div style={{ background: '#050f10', border: '1px solid #0f2016', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', letterSpacing: '0.12em', marginBottom: 10, fontFamily: 'monospace' }}>▶ ТЕКУЩИЙ СТАТУС</div>
            <p style={{ fontSize: 14, lineHeight: 1.75, color: '#86efac' }}>{meta?.currentStatus || '—'}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 14 }}>
              {[{ l: 'Банкролл', v: fmt$(meta?.currentBr) }, { l: 'День', v: meta?.currentDay ? '#' + meta.currentDay : '—' }, { l: 'Постов', v: meta?.totalPosts?.toLocaleString() ?? '—' }, { l: 'Подписок', v: meta?.subscribers?.toLocaleString() ?? '—' }].map(s => (
                <div key={s.l} style={{ background: '#020917', borderRadius: 8, padding: '9px 12px', border: '1px solid #0f2016' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{s.v}</div>
                  <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#080f1f', border: '1px solid #1e293b', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: '0.12em', marginBottom: 10, fontFamily: 'monospace' }}>📈 ПРОФИТ (БР − $10k старт) · клик на точку → пост</div>
            {(meta?.brData || []).length >= 2 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={meta.brData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }} onClick={e => { const p = e?.activePayload?.[0]?.payload; if (p?.postUrl) window.open(p.postUrl, '_blank'); }}>
                  <defs>
                    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 0 ? '+$' + (v / 1000).toFixed(0) + 'k' : '-$' + (Math.abs(v) / 1000).toFixed(0) + 'k'} />
                  <Tooltip cursor={{ stroke: '#22c55e30' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return <div style={{ background: '#0b1526', border: '1px solid #22c55e40', borderRadius: 10, padding: '12px 14px', maxWidth: 240 }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4ade80', fontSize: 14, marginBottom: 4 }}>{d.label}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, color: d.profit >= 0 ? '#4ade80' : '#f87171', marginBottom: 4 }}>{'Профит: ' + (d.profit >= 0 ? '+' : '') + '$' + Number(d.profit).toLocaleString()}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{'БР: ~$' + Number(d.totalBr).toLocaleString()}</div>
                      {d.postText && <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginTop: 6 }}>{d.postText}</p>}
                      {d.postUrl && <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginTop: 4 }}>🖱 Нажмите для открытия</div>}
                    </div>;
                  }} />
                  <Area type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} fill="url(#bg)" dot={p => <circle key={p.cx} cx={p.cx} cy={p.cy} r={5} fill="#22c55e" stroke="#4ade80" strokeWidth={1.5} style={{ cursor: 'pointer' }} />} activeDot={{ r: 7, fill: '#4ade80', stroke: '#22c55e', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e3a22', fontSize: 14 }}>Нет данных графика</div>}
            {meta?.brDataNote && <p style={{ fontSize: 11, color: '#334155', marginTop: 6, fontStyle: 'italic' }}>{meta.brDataNote}</p>}
          </div>
        </div>

        {/* Chronicle */}
        {meta?.summary && (
          <div style={{ background: '#080f1f', border: '1px solid #1e293b', borderRadius: 12, padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: '0.12em', marginBottom: 10, fontFamily: 'monospace' }}>📜 ХРОНИКА МАРАФОНА</div>
            <p style={{ fontSize: 15, lineHeight: 1.85, color: '#94a3b8' }}>{meta.summary}</p>
          </div>
        )}

        {/* Feed */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ id: 'all', label: 'Все (' + filtered.length + ')' }, { id: 'author', label: 'Автор ТС (' + tsOnly.length + ')' }, { id: 'top', label: 'Топ 15 ★' }].map(m => (
                <button key={m.id} onClick={() => setFeedMode(m.id)} style={{ padding: '7px 16px', borderRadius: 20, border: '1px solid ' + (feedMode === m.id ? '#15803d' : '#1e293b'), fontSize: 13, fontWeight: 600, cursor: 'pointer', background: feedMode === m.id ? '#071a0e' : 'transparent', color: feedMode === m.id ? '#4ade80' : '#64748b' }}>{m.label}</button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>{'Мин. плюсов: '}<input type="number" value={minR} step={1} onChange={e => setMinR(+e.target.value)} style={{ width: 64, textAlign: 'center' }} /></label>
              <label style={{ fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>{'Мин. репутация: '}<input type="number" value={minRep} step={100} onChange={e => setMinRep(+e.target.value)} style={{ width: 80, textAlign: 'center' }} /></label>
            </div>
          </div>
          {display.length === 0
            ? <div style={{ textAlign: 'center', padding: 50, color: '#334155', fontSize: 15 }}>Нет постов</div>
            : display.map((p, i) => <PostCard key={p.id || i} post={p} avStore={avStore} rank={feedMode === 'top' ? i : null} />)
          }
        </div>
      </div>

      <div style={{ borderTop: '1px solid #0f172a', padding: '14px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: '#1e3a22', fontFamily: 'monospace' }}>
          {'RomeoPro Tracker · '}
          <a href={FORUM} target="_blank" rel="noreferrer" style={{ color: '#1e3a22', textDecoration: 'none' }}>gipsyteam.ru/181676</a>
        </p>
      </div>
    </div>
  );
}
