const GITHUB_API = 'https://api.github.com'

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem('rpt_config') || 'null')
  } catch { return null }
}

export function saveConfig(cfg) {
  localStorage.setItem('rpt_config', JSON.stringify(cfg))
}

export async function fetchPublicData(repo) {
  // Читаем данные без авторизации (публичный репо)
  const base = `https://raw.githubusercontent.com/${repo}/main/data`
  const [postsRes, metaRes] = await Promise.all([
    fetch(`${base}/posts.json?t=${Date.now()}`),
    fetch(`${base}/meta.json?t=${Date.now()}`),
  ])
  const posts = postsRes.ok ? await postsRes.json() : []
  const meta  = metaRes.ok  ? await metaRes.json()  : {}
  return { posts, meta }
}

async function githubGet(repo, token, path) {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`)
  return res.json()
}

export async function githubPut(repo, token, path, content, commitMsg) {
  // Получаем sha существующего файла
  const existing = await githubGet(repo, token, path)
  const sha = existing?.sha

  const body = {
    message: commitMsg || `update ${path}`,
    content: btoa(unescape(encodeURIComponent(
      typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    ))),
  }
  if (sha) body.sha = sha

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitHub PUT ${path}: ${res.status} — ${err}`)
  }
  return res.json()
}

export async function uploadData(repo, token, posts, meta) {
  await githubPut(repo, token, 'data/posts.json', posts, `agent: ${posts.length} posts`)
  await githubPut(repo, token, 'data/meta.json', {
    ...meta,
    lastUpdated: new Date().toISOString(),
    totalPosts: posts.length,
  }, 'agent: update meta')
}
