export function generateUserscript(cfg, mode) {
  const maxPages = mode === 'last10' ? 10 : mode === 'all' ? 999 : 0
  return `// ==UserScript==
// @name         RomeoPro Tracker Agent v2
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Парсит посты RomeoPro с gipsyteam.ru и загружает в GitHub
// @author       RomeoPro Tracker
// @match        https://forum.gipsyteam.ru/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.github.com
// ==/UserScript==

(function () {
  'use strict';

  // ── КОНФИГ ──────────────────────────────────────────────────────────────
  const MODE       = '${mode}';
  const REPO       = '${cfg.repo}';
  const TOKEN      = '${cfg.token}';
  const AUTHOR     = '${cfg.authorName || 'Romeopro'}';
  const MAX_PAGES  = ${maxPages};
  const FORUM_BASE = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676';

  // ── ЛОГГЕР ──────────────────────────────────────────────────────────────
  let logPanel, logBody;

  function createPanel() {
    logPanel = document.createElement('div');
    logPanel.style.cssText = 'position:fixed;bottom:16px;right:16px;width:440px;max-height:340px;background:#0d1117;border:1px solid #1a2d45;border-radius:8px;font-family:JetBrains Mono,monospace;font-size:12px;z-index:999999;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.7)';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#0d1a2a;padding:8px 14px;border-bottom:1px solid #1a2d45;color:#00e676;font-weight:700;display:flex;justify-content:space-between;align-items:center';
    hdr.innerHTML = '<span>🎲 RomeoPro Tracker</span><span id="rpt-badge" style="font-size:10px;color:#4a6580">запуск...</span>';
    logBody = document.createElement('div');
    logBody.style.cssText = 'overflow-y:auto;max-height:290px;padding:6px 0';
    logPanel.appendChild(hdr);
    logPanel.appendChild(logBody);
    document.body.appendChild(logPanel);
  }

  const COLORS = { info:'#c8d8e8', ok:'#00e676', warn:'#ffd600', err:'#ff1744', dim:'#4a6580' };
  const ICONS  = { info:'→', ok:'✓', warn:'⚠', err:'✗', dim:'·' };

  function log(msg, level='info') {
    const t = new Date().toLocaleTimeString('ru',{hour12:false});
    const fn = level==='err' ? console.error : level==='warn' ? console.warn : console.log;
    fn('[RPT ' + t + '] ' + msg);
    if (!logBody) return;
    const line = document.createElement('div');
    line.style.cssText = 'padding:2px 12px;color:'+COLORS[level]+';line-height:1.6';
    line.innerHTML = '<span style="color:#4a6580">'+t+'</span> <span>'+ICONS[level]+'</span> '+msg.replace(/</g,'&lt;');
    logBody.appendChild(line);
    logBody.scrollTop = logBody.scrollHeight;
    const badge = document.getElementById('rpt-badge');
    if (badge && level !== 'dim') { badge.textContent = msg.substring(0,45); badge.style.color = COLORS[level]; }
    // Пингуем родительское окно (postMessage)
    try { window.opener?.postMessage({ type:'RPT_LOG', msg, level }, '*'); } catch(_) {}
    // Резервный канал: localStorage (если postMessage заблокирован cross-origin)
    try { localStorage.setItem('rpt_agent_log', JSON.stringify({msg, level, t: Date.now()})); } catch(_) {}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── ПАРСИНГ ──────────────────────────────────────────────────────────────
  function parsePosts(doc) {
    const results = [];
    // gipsyteam: посты в .ipbtable или отдельных div с data-author
    const postBlocks = doc.querySelectorAll('.post_block, [id^="post_"], tr.post');

    log('  блоков найдено: ' + postBlocks.length, 'dim');

    postBlocks.forEach(block => {
      try {
        // Автор
        const authorEl = block.querySelector('.post_author a, .member_title, [itemprop="name"], .normalname');
        if (!authorEl) return;
        const name = authorEl.textContent.trim();
        if (AUTHOR && !name.toLowerCase().includes(AUTHOR.toLowerCase())) return;

        // Тело поста
        const bodyEl = block.querySelector('.post_body, .postcolor, [itemprop="text"]');
        if (!bodyEl) return;
        const text = (bodyEl.innerText || bodyEl.textContent || '').trim();
        if (!text) return;

        // Дата
        const dateEl = block.querySelector('.post_date, [itemprop="datePublished"], .right_date');
        const date = dateEl ? dateEl.textContent.trim() : '';

        // ID поста
        const idEl = block.id || '';
        const idMatch = idEl.match(/\\d+/);
        const postId = idMatch ? idMatch[0] : null;

        // URL поста
        const linkEl = block.querySelector('a[href*="viewtopic"]');
        const url = linkEl ? linkEl.href : window.location.href;

        // Ищем данные БР
        const brMatch = text.match(/(?:\\$|\\€|€)\\s?([\\d,. ]+[kKмM]?)/);

        results.push({ id: postId, author: name, date, text: text.substring(0, 600), bankroll: brMatch ? brMatch[0] : null, url });
      } catch(e) {
        log('  ошибка блока: ' + e.message, 'warn');
      }
    });

    // Fallback: если не нашли посты по блокам — ищем по тексту страницы
    if (results.length === 0) {
      log('  основной селектор не сработал, пробуем fallback...', 'warn');
      const allLinks = doc.querySelectorAll('a');
      allLinks.forEach(a => {
        if (a.textContent.includes(AUTHOR)) {
          const row = a.closest('tr, div[id], article');
          if (row && !results.find(r => r.url === window.location.href + '#' + row.id)) {
            const text = row.innerText || '';
            results.push({ id: row.id, author: AUTHOR, date: '', text: text.substring(0,400), bankroll: null, url: window.location.href });
          }
        }
      });
      log('  fallback нашёл: ' + results.length, results.length>0?'ok':'warn');
    }

    return results;
  }

  // ── GITHUB ───────────────────────────────────────────────────────────────
  function ghGet(path) {
    return new Promise((res, rej) => {
      log('  GET data/' + path, 'dim');
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.github.com/repos/' + REPO + '/contents/data/' + path,
        headers: { Authorization: 'token ' + TOKEN, Accept: 'application/vnd.github.v3+json' },
        onload(r) {
          if (r.status === 200) res(JSON.parse(r.responseText));
          else if (r.status === 404) res(null);
          else rej(new Error('GET ' + path + ': ' + r.status));
        },
        onerror(e) { rej(new Error('Сеть: ' + (e.error||'unknown'))); },
      });
    });
  }

  function ghPut(path, data, sha, msg) {
    return new Promise((res, rej) => {
      log('  PUT data/' + path, 'dim');
      const body = {
        message: msg || 'update ' + path,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
      };
      if (sha) body.sha = sha;
      GM_xmlhttpRequest({
        method: 'PUT',
        url: 'https://api.github.com/repos/' + REPO + '/contents/data/' + path,
        headers: { Authorization: 'token ' + TOKEN, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
        data: JSON.stringify(body),
        onload(r) {
          if (r.status === 200 || r.status === 201) { log('  ✓ ' + path, 'dim'); res(JSON.parse(r.responseText)); }
          else rej(new Error('PUT ' + path + ': ' + r.status + ' — ' + r.responseText.substring(0,200)));
        },
        onerror(e) { rej(new Error('Сеть PUT: ' + (e.error||'unknown'))); },
      });
    });
  }

  async function upload(newPosts) {
    log('📤 Загружаю в GitHub... (' + newPosts.length + ' новых постов)', 'info');

    // Читаем существующие посты
    let sha = null, existing = [];
    try {
      const cur = await ghGet('posts.json');
      if (cur) { sha = cur.sha; existing = JSON.parse(atob(cur.content.replace(/\\n/g,''))); }
      log('  в репо: ' + existing.length + ' постов', 'dim');
    } catch(e) { log('  posts.json не найден, создаём', 'dim'); }

    // Мерж (не дублируем по id)
    const ids = new Set(existing.map(p => p.id).filter(Boolean));
    const toAdd = newPosts.filter(p => !p.id || !ids.has(p.id));
    const merged = [...existing, ...toAdd].sort((a,b) => (a.id > b.id ? 1 : -1));

    await ghPut('posts.json', merged, sha, 'agent: +' + toAdd.length + ' posts (total ' + merged.length + ')');
    log('✅ posts.json: ' + merged.length + ' постов', 'ok');

    // Обновляем мету
    let metaSha = null, meta = {};
    try {
      const m = await ghGet('meta.json');
      if (m) { metaSha = m.sha; meta = JSON.parse(atob(m.content.replace(/\\n/g,''))); }
    } catch(_) {}
    meta.lastUpdated = new Date().toISOString();
    meta.totalPosts = merged.length;
    await ghPut('meta.json', meta, metaSha, 'agent: update meta');
    log('✅ meta.json обновлён', 'ok');

    return { total: merged.length, added: toAdd.length };
  }

  // ── ПАГИНАЦИЯ ────────────────────────────────────────────────────────────
  function findNext() {
    const selectors = [
      'a[rel="next"]', 'a.next_page', 'span.next > a',
      '.ipbpagination a:last-of-type', '.pagination a:last-child',
      'a[title*="Следующ"]', 'a[title*="Next"]',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.href && !el.href.includes('#') && el.href !== window.location.href) {
        log('  пагинация: ' + s, 'dim');
        return el.href;
      }
    }
    // По тексту
    const found = [...document.querySelectorAll('a')].find(a =>
      /следующ|›|»|next/i.test(a.textContent.trim()) && a.href && !a.href.includes('#') && a.href !== window.location.href
    );
    if (found) { log('  пагинация по тексту: "' + found.textContent.trim() + '"', 'dim'); return found.href; }
    log('  следующей страницы нет', 'dim');
    return null;
  }

  // ── ГЛАВНЫЙ ЦИКЛ ─────────────────────────────────────────────────────────
  async function run() {
    await sleep(600);
    createPanel();

    log('🚀 Агент запущен', 'info');
    log('  режим: ' + MODE + ' | репо: ' + REPO, 'dim');
    log('  URL: ' + window.location.href, 'dim');
    log('  автор: ' + (AUTHOR || 'все'), 'dim');

    if (!window.location.hostname.includes('gipsyteam')) {
      log('❌ Не та страница. Ожидается forum.gipsyteam.ru', 'err');
      return;
    }
    if (!TOKEN) { log('❌ Нет GitHub токена! Укажите в Admin Mode', 'err'); return; }
    if (!REPO)  { log('❌ Нет репозитория! Укажите в Admin Mode', 'err'); return; }

    const page = GM_getValue('rpt_page', 0);
    const accumulated = GM_getValue('rpt_posts', []);

    log('📄 Страница ' + (page + 1) + (MAX_PAGES ? ' из ' + MAX_PAGES : ''), 'info');

    const posts = parsePosts(document);
    log('  найдено постов: ' + posts.length, posts.length > 0 ? 'ok' : 'warn');

    const allPosts = [...accumulated, ...posts];
    GM_setValue('rpt_posts', allPosts);
    GM_setValue('rpt_page', page + 1);

    const nextUrl = findNext();
    const shouldContinue = nextUrl && (MAX_PAGES === 0 || page + 1 < MAX_PAGES);

    if (shouldContinue) {
      log('  → следующая страница', 'dim');
      await sleep(1200 + Math.random() * 800);
      window.location.href = nextUrl;
    } else {
      log('🏁 Сбор завершён. Всего постов: ' + allPosts.length, 'ok');
      try {
        const result = await upload(allPosts);
        GM_setValue('rpt_posts', []);
        GM_setValue('rpt_page', 0);
        log('🎉 Загружено! +' + result.added + ' новых, итого ' + result.total, 'ok');
        try { window.opener?.postMessage({ type:'RPT_DONE', count: result.total }, '*'); } catch(_) {}
        try { localStorage.setItem('rpt_agent_done', JSON.stringify({count: result.total, t: Date.now()})); } catch(_) {}
      } catch(e) {
        log('❌ Ошибка GitHub: ' + e.message, 'err');
        try { window.opener?.postMessage({ type:'RPT_ERROR', msg: e.message }, '*'); } catch(_) {}
      }
    }
  }

  run().catch(e => {
    console.error('[RPT] критическая ошибка:', e);
    log('💥 ' + e.message, 'err');
  });

})();`
}
