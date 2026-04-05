// storage.js — только публичное чтение данных, без токенов
const REPO = 'loremcdmx/romeoprotracker'

export async function fetchPublicData() {
  const base = `https://raw.githubusercontent.com/${REPO}/main/data`
  const [postsRes, metaRes] = await Promise.all([
    fetch(`${base}/posts.json?t=${Date.now()}`),
    fetch(`${base}/meta.json?t=${Date.now()}`),
  ])
  const posts = postsRes.ok ? await postsRes.json() : []
  const meta  = metaRes.ok  ? await metaRes.json()  : {}
  return { posts, meta }
}
