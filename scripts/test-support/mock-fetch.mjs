// Test-only preload for running the REAL scripts/scrape.mjs without network:
//   node --import <this file> scripts/scrape.mjs --no-push
// Every fetch is answered from files in MOCK_DIR:
//   pages.json      { "<st>": "<forum page html>" }   ("0" is the thread's first page)
//   anthropic.json  { vision: [resp...], translate: [resp...] }
//                   resp = { status?: 200, text?: "<model text>", raw?: "<body>", throw?: true }
//                   consumed in order, the last one repeats; missing vision -> HTTP 500
//   calls.log       one line per request: "<METHOD> <kind> <url>"
// Nothing here can reach the network: an unknown URL is a loud error.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.env.MOCK_DIR
const read = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) } catch { return fallback }
}
const pages = read('pages.json', {})
const anthropic = read('anthropic.json', {})
const counters = { vision: 0, translate: 0 }
const log = line => fs.appendFileSync(path.join(dir, 'calls.log'), line + '\n')

// The scraper sleeps 500 ms between pages; keep full-scan tests fast.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args)

function next(kind) {
  const list = anthropic[kind] || []
  if (!list.length) return kind === 'translate' ? { text: 'TRANSLATED' } : { status: 500, raw: 'no mock configured' }
  const resp = list[Math.min(counters[kind], list.length - 1)]
  counters[kind]++
  return resp
}

globalThis.fetch = async (input, opts = {}) => {
  const url = String(input)
  const method = (opts.method || 'GET').toUpperCase()

  if (url.startsWith('https://forum.gipsyteam.ru/index.php?viewtopic=181676')) {
    const st = url.match(/[?&]st=(\d+)/)?.[1] || '0'
    log(`${method} forum ${url}`)
    const html = pages[st]
    if (html == null) return new Response('not found', { status: 404 })
    if (typeof html === 'object' && html.status) return new Response(html.body || '', { status: html.status })
    return new Response(html, { status: 200 })
  }

  if (url.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(opts.body)
    const kind = String(body.model).includes('haiku') ? 'translate' : 'vision'
    log(`${method} ${kind} ${url}`)
    const resp = next(kind)
    if (resp.throw) throw new TypeError('fetch failed')
    if (resp.raw != null) return new Response(resp.raw, { status: resp.status || 200 })
    return new Response(JSON.stringify({ content: [{ type: 'text', text: resp.text }] }), { status: resp.status || 200 })
  }

  if (method === 'HEAD') {
    log(`HEAD image ${url}`)
    return new Response('', { status: 404 })
  }

  log(`${method} UNEXPECTED ${url}`)
  throw new Error(`mock-fetch: unexpected request ${method} ${url}`)
}
