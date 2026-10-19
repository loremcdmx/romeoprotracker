// Test harness: run the real scripts/scrape.mjs in a throwaway directory with a
// mocked fetch (see mock-fetch.mjs). Never touches the repo's data/ or git.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRAPE = path.resolve(here, '../scrape.mjs')
const MOCK = pathToFileURL(path.join(here, 'mock-fetch.mjs')).href

export const FORUM = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

// One forum post in the markup parsePosts understands. `html` is the raw body.
export function postHtml({ id, author = 'Someone', html = 'hello', ts = 1_700_000_000, likes = 0 }) {
  return `<li class="post ">
<a class="anchor" id="entry${id}" data-mid="1" data-pid="${id}"></a>
<div class="post-author--nick"><a class="post-author--link" href="https://www.gipsyteam.ru/profile/x">${esc(author)}</a></div>
<div class="post-date--item" data-timestamp="${ts}">16 октября, 05:08</div>
<div class="post-vote--rating">${likes}</div>
<div class="comment_text">${html}</div>
</li>`
}

// A thread page: its posts plus a pager that reaches `lastSt`.
export function pageHtml(posts, lastSt = 20) {
  const pager = `<a class="theme-pagination--pager" href="${FORUM}&amp;st=${lastSt}">last</a>`
  return `<html><body>${pager}<ul class="post--list">${posts.map(postHtml).join('\n')}</ul></body></html>`
}

// A stored post as it sits in data/posts.json.
export function storedPost(over = {}) {
  const id = over.id ?? '1'
  return {
    id: String(id), author: 'Someone', avatar: null, rating: null, msgCount: null, regData: null,
    date: '16 октября, 05:08', timestamp: 1_700_000_000, text: 'hello', likes: 0, images: [], videos: [],
    brBefore: null, brAfter: null, sessionResult: null,
    url: `${FORUM}&view=findpost&p=${id}`,
    ...over,
    ...(over.id != null ? { id: String(over.id) } : {}),
  }
}

export function baseMeta(over = {}) {
  return {
    bankroll: 10000, startBankroll: 10000, targetBankroll: 10000000, day: 5, status: 'active',
    lastUpdated: '2026-01-01T00:00:00.000Z', totalPosts: 0, authorName: 'Romeopro',
    brHistory: [], totalTournaments: 0, lastScrapeRun: '2026-01-01T00:00:00.000Z',
    postsChangedAt: '2026-01-01T00:00:00.000Z', postsHash: 'x',
    ...over,
  }
}

// Writes the sandbox, runs the scraper, returns what it did.
//   pages      { "<st>": html }
//   anthropic  { vision: [...], translate: [...] }
//   apiKey     value for ANTHROPIC_API_KEY (omit for none)
//   args       CLI args (default ['--no-push'])
export function runScrape({ posts = [], meta = baseMeta(), pages = {}, anthropic = {}, apiKey, args = ['--no-push'], env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-scrape-'))
  fs.mkdirSync(path.join(dir, 'data'))
  const postsPath = path.join(dir, 'data/posts.json')
  const metaPath = path.join(dir, 'data/meta.json')
  fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages))
  fs.writeFileSync(path.join(dir, 'anthropic.json'), JSON.stringify(anthropic))
  const before = {
    posts: fs.readFileSync(postsPath, 'utf8'),
    meta: fs.readFileSync(metaPath, 'utf8'),
  }

  const childEnv = { ...process.env, MOCK_DIR: dir, TZ: 'Europe/Warsaw', ...env }
  for (const key of ['ANTHROPIC_API_KEY', 'SCRAPE_MODE', 'SCRAPE_DRY_RUN', 'SCRAPE_NO_PUSH', 'SCRAPE_PRUNE_FORCE', 'SCRAPE_ALERT_WEBHOOK', 'TELEGRAM_BOT_TOKEN']) {
    if (!(key in env)) delete childEnv[key]
  }
  if (apiKey) childEnv.ANTHROPIC_API_KEY = apiKey

  const res = spawnSync(process.execPath, ['--import', MOCK, SCRAPE, ...args], {
    cwd: dir, env: childEnv, encoding: 'utf8', timeout: 60_000,
  })

  const read = file => { try { return fs.readFileSync(path.join(dir, file), 'utf8') } catch { return null } }
  const calls = (read('calls.log') || '').split('\n').filter(Boolean)
  const out = {
    dir,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    output: `${res.stdout || ''}${res.stderr || ''}`,
    calls,
    count: kind => calls.filter(l => l.split(' ')[1] === kind).length,
    posts: JSON.parse(read('data/posts.json')),
    meta: JSON.parse(read('data/meta.json')),
    compact: read('data/posts.min.json') ? JSON.parse(read('data/posts.min.json')) : null,
    untouched: read('data/posts.json') === before.posts && read('data/meta.json') === before.meta && !read('data/posts.min.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
  return out
}
