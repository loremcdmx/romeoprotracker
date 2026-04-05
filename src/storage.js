/**
 * Storage layer — читает data/*.json из репозитория,
 * пишет через GitHub API (только для администратора).
 */

const CACHE_KEY = 'rp_local_cache';

// ── Загрузка данных (публичный доступ) ──────────────────────
export async function loadData() {
  try {
    const ts = Date.now(); // cache-bust
    const [postsRes, metaRes, avatarsRes] = await Promise.all([
      fetch(`./data/posts.json?t=${ts}`),
      fetch(`./data/meta.json?t=${ts}`),
      fetch(`./data/avatars.json?t=${ts}`),
    ]);
    return {
      posts:   postsRes.ok   ? await postsRes.json()   : [],
      meta:    metaRes.ok    ? await metaRes.json()    : null,
      avatars: avatarsRes.ok ? await avatarsRes.json() : {},
    };
  } catch (e) {
    console.warn('loadData error:', e);
    return { posts: [], meta: null, avatars: {} };
  }
}

// ── Запись данных (только администратор, нужен GitHub PAT) ──
export async function saveData({ posts, meta, avatars }, config) {
  const { repo, token } = config;
  if (!repo || !token) throw new Error('Не заданы repo или token');

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error('repo должен быть в формате owner/repo');

  const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));

  const getSha = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${path}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) return undefined;
    const d = await r.json();
    return d.sha;
  };

  const writeFile = async (path, obj) => {
    const sha = await getSha(path);
    const body = {
      message: `update ${path} [${new Date().toISOString().slice(0, 16)}]`,
      content: encode(obj),
    };
    if (sha) body.sha = sha;
    const r = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`GitHub API error (${path}): ${err.message || r.status}`);
    }
    return r.json();
  };

  await Promise.all([
    writeFile('data/posts.json',   posts),
    writeFile('data/meta.json',    meta),
    writeFile('data/avatars.json', avatars || {}),
  ]);
}

// ── Локальный кэш (localStorage) для admin-данных ───────────
export const localCache = {
  save: (data) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() })); } catch {}
  },
  load: () => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
  },
};

// ── Настройки администратора ─────────────────────────────────
export const adminConfig = {
  save: (cfg) => { try { localStorage.setItem('rp_admin_cfg', JSON.stringify(cfg)); } catch {} },
  load: () => { try { return JSON.parse(localStorage.getItem('rp_admin_cfg') || 'null'); } catch { return null; } },
};
