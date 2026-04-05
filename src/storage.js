/**
 * Storage — читает /data/*.json (из public/),
 * пишет через GitHub API в public/data/ (только для администратора).
 */

const GITHUB_API = 'https://api.github.com';

export async function loadData() {
  try {
    const ts = Date.now();
    const [p, m, a] = await Promise.all([
      fetch(`/data/posts.json?t=${ts}`).then(r => r.ok ? r.json() : []),
      fetch(`/data/meta.json?t=${ts}`).then(r => r.ok ? r.json() : null),
      fetch(`/data/avatars.json?t=${ts}`).then(r => r.ok ? r.json() : {}),
    ]);
    return { posts: p, meta: m, avatars: a };
  } catch (e) {
    console.warn('loadData error:', e);
    return { posts: [], meta: null, avatars: {} };
  }
}

export async function saveData({ posts, meta, avatars }, config) {
  const { repo, token } = config;
  if (!repo || !token) throw new Error('Не заданы repo или token в настройках Admin');
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error('repo должен быть в формате owner/repo');

  const encode = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));

  const getSha = async path => {
    const r = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}/contents/${path}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) return undefined;
    return (await r.json()).sha;
  };

  const writeFile = async (path, obj) => {
    const sha = await getSha(path);
    const body = {
      message: `update ${path.split('/').pop()} [${new Date().toISOString().slice(0, 16)}]`,
      content: encode(obj),
    };
    if (sha) body.sha = sha;
    const r = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}/contents/${path}`, {
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
      throw new Error(`GitHub API (${path}): ${err.message || r.status}`);
    }
  };

  // Файлы лежат в public/data/ в репозитории
  await Promise.all([
    writeFile('public/data/posts.json',   posts),
    writeFile('public/data/meta.json',    meta),
    writeFile('public/data/avatars.json', avatars || {}),
  ]);
}

export const adminConfig = {
  save: cfg => { try { localStorage.setItem('rp_admin_cfg', JSON.stringify(cfg)); } catch {} },
  load: ()  => { try { return JSON.parse(localStorage.getItem('rp_admin_cfg') || 'null'); } catch { return null; } },
};
