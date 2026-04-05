const GITHUB_API = 'https://api.github.com'

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem('rpt_config') || 'null') } catch { return null }
}
export function saveConfig(cfg) {
  localStorage.setItem('rpt_config', JSON.stringify(cfg))
}

// Правильное декодирование UTF-8 из base64 GitHub API
function b64decode(str) {
  return decodeURIComponent(escape(atob(str.replace(/\n/g, ''))))
}
// Правильное кодирование UTF-8 в base64
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)))
}

export async function fetchPublicData(repo) {
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
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`)
  return res.json()
}

export async function githubPut(repo, token, path, content, commitMsg) {
  const existing = await githubGet(repo, token, path)
  const sha = existing?.sha
  const body = {
    message: commitMsg || `update ${path}`,
    content: b64encode(typeof content === 'string' ? content : JSON.stringify(content, null, 2)),
  }
  if (sha) body.sha = sha
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} — ${await res.text()}`)
  return res.json()
}
