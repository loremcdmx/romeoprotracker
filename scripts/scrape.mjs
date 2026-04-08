#!/usr/bin/env node
/**
 * GipsyTeam forum scraper for RomeoPro Tracker.
 * Runs in GitHub Actions on a cron schedule.
 *
 * 1. Fetches recent forum pages, extracts new posts
 * 2. If Romeo posted images → sends to Claude API (vision) to extract BR data
 * 3. Updates data/posts.json and data/meta.json, commits & pushes
 */

import { readFile, writeFile } from 'fs/promises'
import { execSync } from 'child_process'
import * as cheerio from 'cheerio'

const FORUM_URL = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const ROMEO_RE  = /romeopro/i
const REPO      = 'loremcdmx/romeoprotracker'
const MAX_PAGES = 5          // scan last 5 pages max per run
const DELAY_MS  = 800        // polite delay between page fetches

// ─── UTILS ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function htmlToText($el, $) {
  // Clone and process
  let html = $.html($el)
  // <br> → \n
  html = html.replace(/<br\s*\/?>/gi, '\n')
  // <p>, <div> closing → \n\n
  html = html.replace(/<\/(p|div)>/gi, '\n\n')
  // blockquotes → [QUOTE]...[/QUOTE]
  const $clone = cheerio.load(html)
  $clone('blockquote').each(function () {
    const bq = $clone(this)
    const cite = bq.find('em.cite, .cite')
    const author = cite.find('strong, b').first().text().trim()
    const dateRaw = cite.find('.em-cite, span').first().text().trim()
    cite.remove()
    const body = bq.text().trim()
    bq.replaceWith(`[QUOTE]${author}|${dateRaw}\n${body}[/QUOTE]`)
  })
  // Strip remaining tags
  const text = $clone.root().text()
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

// ─── FORUM SCRAPER ───────────────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RomeoProTracker/2.0; +https://github.com/loremcdmx/romeoprotracker)',
      'Accept': 'text/html',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function parsePosts(html) {
  const $ = cheerio.load(html)
  const posts = []

  $('li.post').each(function () {
    const el = $(this)
    const anchor = el.find('a.anchor')
    const postId = anchor.attr('data-pid')
    if (!postId) return

    const authorEl = el.find('.post-author--link')
    const bodyEl   = el.find('.comment_text')
    if (!authorEl.length || !bodyEl.length) return

    const author   = authorEl.text().trim()
    const isRomeo  = ROMEO_RE.test(author)
    const maxLen   = isRomeo ? 8000 : 2400

    const dateEl   = el.find('.post-date--item')
    const likesEl  = el.find('.post-vote--rating')
    const avatarEl = el.find('.post-author--avatar img')
    const ratingEl = el.find('.post-author--rating')
    const msgEl    = el.find('.post-author--messages')
    const regEl    = el.find('.post-author--regdata')

    const images = []
    bodyEl.find('img').each(function () {
      const src = $(this).attr('src')
      if (src?.startsWith('http') && !src.includes('smil')) images.push(src)
    })

    let text = htmlToText(bodyEl, $)
    if (text.length > maxLen) {
      const cut = text.substring(0, maxLen)
      const lastClose = cut.lastIndexOf('[/QUOTE]')
      text = lastClose > 600
        ? cut.substring(0, lastClose + '[/QUOTE]'.length)
        : cut
    }

    const timestamp = dateEl.attr('data-timestamp')
      ? parseInt(dateEl.attr('data-timestamp'))
      : null

    posts.push({
      id: postId,
      author,
      avatar: avatarEl.attr('src') || null,
      rating: ratingEl.length ? parseInt(ratingEl.text().replace(/[^\d-]/g, '')) || null : null,
      msgCount: msgEl.length ? parseInt(msgEl.text().replace(/[^\d]/g, '')) || null : null,
      regData: regEl.length ? regEl.text().trim() : null,
      date: dateEl.text().trim() || '',
      timestamp,
      text,
      likes: likesEl.length ? parseInt(likesEl.text().trim()) || 0 : 0,
      images,
      brBefore: null,
      brAfter: null,
      sessionResult: null,
      url: `https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=${postId}`,
    })
  })

  return posts
}

function findLastPageUrl(html) {
  const $ = cheerio.load(html)
  const pagers = $('a.theme-pagination--pager')
  let maxSt = 0
  pagers.each(function () {
    const href = $(this).attr('href') || ''
    const m = href.match(/st=(\d+)/)
    if (m) maxSt = Math.max(maxSt, parseInt(m[1]))
  })
  return maxSt > 0 ? `${FORUM_URL}&st=${maxSt}` : null
}

function findPrevPageUrl(html) {
  const $ = cheerio.load(html)
  // Find current page's st, go back 20
  const currentSt = (() => {
    const active = $('span.theme-pagination--pager.active, strong.theme-pagination--pager')
    if (!active.length) return null
    // Check surrounding links for st patterns
    const links = $('a.theme-pagination--pager')
    let max = 0
    links.each(function () {
      const m = ($(this).attr('href') || '').match(/st=(\d+)/)
      if (m) max = Math.max(max, parseInt(m[1]))
    })
    return max
  })()
  // Previous page link
  const prevLinks = $('a.theme-pagination--pager')
  let prevUrl = null
  prevLinks.each(function () {
    const text = $(this).text().trim()
    if (text === '←' || text === '‹') {
      prevUrl = $(this).attr('href')
    }
  })
  return prevUrl
}

// ─── CLAUDE VISION (BR extraction) ──────────────────────────────────────────

async function extractBrFromImages(post, lastBrHistory) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('  ⚠ ANTHROPIC_API_KEY not set, skipping BR extraction')
    return null
  }

  // Filter to likely BR screenshot images (not smileys, not tiny)
  const brImages = post.images.filter(url =>
    !url.includes('smil') && !url.includes('emoji') &&
    (url.includes('_thumb') || url.includes('post-'))
  )
  if (brImages.length === 0) return null

  // Use full-res URLs (remove _thumb suffix if present)
  const fullResImages = brImages.map(url => url.replace('_thumb.webp', '.webp').replace('_thumb.jpg', '.jpg').replace('_thumb.png', '.png'))

  const lastEntry = lastBrHistory?.[lastBrHistory.length - 1]
  const prevBr = lastEntry ? lastEntry.brAfter : 10000
  const prevRooms = lastEntry?.rooms?.after || { gg: 0, ps: 0, king: 0, coin: 0, lux: 0 }

  const content = [
    {
      type: 'text',
      text: `Это скриншот(ы) из поста покериста Romeopro. Он играет марафон $10k→$10M на нескольких покер-румах.

Предыдущий БР по румам: GG=${prevRooms.gg}, PS=${prevRooms.ps}, King=${prevRooms.king}, Coin=${prevRooms.coin}, Lux=${prevRooms.lux}. Итого: $${prevBr}.

Текст поста: "${post.text.substring(0, 1000)}"

Извлеки из скриншота(ов) данные о банкролле ПОСЛЕ сессии по каждому руму. Также найди количество турниров за сессию если указано.

Ответь СТРОГО в формате JSON (без markdown, без комментариев):
{"brAfter":число,"rooms":{"gg":число,"ps":число,"king":число,"coin":число,"lux":число},"tournaments":число_или_null}

Если на скриншоте НЕТ данных о банкролле — ответь: {"skip":true}
Числа должны быть целые, в долларах. Округляй до целого.`
    },
    ...fullResImages.map(url => ({
      type: 'image',
      source: { type: 'url', url }
    }))
  ]

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content }],
      })
    })

    if (!res.ok) {
      const err = await res.text()
      console.log(`  ⚠ Claude API error ${res.status}: ${err.substring(0, 200)}`)
      return null
    }

    const data = await res.json()
    const text = data.content?.[0]?.text?.trim()
    if (!text) return null

    // Parse JSON from response (handle possible markdown wrapping)
    const jsonStr = text.replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(jsonStr)
    if (parsed.skip) return null

    return {
      brBefore: prevBr,
      brAfter: parsed.brAfter,
      sessionResult: parsed.brAfter - prevBr,
      rooms: {
        before: { ...prevRooms },
        after: {
          gg: parsed.rooms?.gg ?? 0,
          ps: parsed.rooms?.ps ?? 0,
          king: parsed.rooms?.king ?? 0,
          coin: parsed.rooms?.coin ?? 0,
          lux: parsed.rooms?.lux ?? 0,
        }
      },
      tournaments: parsed.tournaments || null,
    }
  } catch (e) {
    console.log(`  ⚠ Claude API parse error: ${e.message}`)
    return null
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🕷 RomeoPro Scraper starting...')

  // Load existing data
  const postsRaw = await readFile('data/posts.json', 'utf-8')
  const posts = JSON.parse(postsRaw)
  const metaRaw = await readFile('data/meta.json', 'utf-8')
  const meta = JSON.parse(metaRaw)

  const knownIds = new Set(posts.map(p => p.id))
  console.log(`📊 Existing: ${posts.length} posts, ${meta.brHistory.length} BR entries`)

  // Find last page of the forum
  const firstPageHtml = await fetchPage(FORUM_URL)
  const lastPageUrl = findLastPageUrl(firstPageHtml)
  if (!lastPageUrl) {
    console.log('⚠ Could not find last page')
    return
  }

  // Calculate pages to scan (last N pages, working backwards)
  const lastSt = parseInt(lastPageUrl.match(/st=(\d+)/)[1])
  const pagesToScan = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const st = lastSt - i * 20
    if (st < 0) break
    pagesToScan.push(st === 0 ? FORUM_URL : `${FORUM_URL}&st=${st}`)
  }
  pagesToScan.reverse() // oldest first

  // Scrape pages
  const newPosts = []
  for (const url of pagesToScan) {
    console.log(`📄 Fetching: ${url}`)
    const html = await fetchPage(url)
    const pagePosts = parsePosts(html)

    for (const p of pagePosts) {
      if (!knownIds.has(p.id)) {
        newPosts.push(p)
        knownIds.add(p.id)
      }
    }
    await sleep(DELAY_MS)
  }

  if (newPosts.length === 0) {
    console.log('✅ No new posts found')
    return
  }

  console.log(`🆕 Found ${newPosts.length} new posts`)

  // Process Romeo's posts with images (BR extraction via Claude)
  let metaUpdated = false
  for (const p of newPosts) {
    if (!ROMEO_RE.test(p.author)) continue
    if (!p.images || p.images.length === 0) continue

    console.log(`🎰 Romeo post ${p.id} has ${p.images.length} images — analyzing...`)
    const brData = await extractBrFromImages(p, meta.brHistory)
    if (!brData) {
      console.log('  ℹ No BR data found in images')
      continue
    }

    // Update the post
    p.brBefore = brData.brBefore
    p.brAfter = brData.brAfter
    p.sessionResult = brData.sessionResult
    p.rooms = brData.rooms

    // Add to brHistory
    const historyEntry = {
      id: p.id,
      date: p.date,
      timestamp: p.timestamp,
      brBefore: brData.brBefore,
      brAfter: brData.brAfter,
      sessionResult: brData.sessionResult,
      rooms: brData.rooms,
      url: p.url,
      tournaments: brData.tournaments,
    }
    meta.brHistory.push(historyEntry)

    // Update meta totals
    meta.bankroll = brData.brAfter
    if (brData.tournaments) {
      meta.totalTournaments = (meta.totalTournaments || 0) + brData.tournaments
      historyEntry.totalTournaments = meta.totalTournaments
    }
    meta.lastUpdated = new Date().toISOString()
    metaUpdated = true

    console.log(`  ✅ BR: $${brData.brBefore} → $${brData.brAfter} (${brData.sessionResult >= 0 ? '+' : ''}${brData.sessionResult})`)
  }

  // Merge and sort
  const merged = [...posts, ...newPosts]
  meta.totalPosts = merged.length

  // Write files
  await writeFile('data/posts.json', JSON.stringify(merged, null, 2))
  console.log(`💾 Saved ${merged.length} posts`)

  if (metaUpdated) {
    await writeFile('data/meta.json', JSON.stringify(meta, null, 2))
    console.log('💾 Updated meta.json with new BR data')
  }

  // Git commit
  execSync('git config user.name "RomeoPro Scraper"')
  execSync('git config user.email "scraper@romeoprotracker.vercel.app"')
  execSync('git add data/posts.json data/meta.json')

  const msg = metaUpdated
    ? `scraper: +${newPosts.length} posts, BR updated to $${meta.bankroll}`
    : `scraper: +${newPosts.length} posts (total ${merged.length})`

  try {
    execSync(`git commit -m "${msg}"`)
    execSync('git push')
    console.log(`✅ Pushed: ${msg}`)
  } catch (e) {
    console.log('ℹ Nothing to commit or push failed')
  }
}

main().catch(e => {
  console.error('❌ Fatal:', e.message)
  process.exit(1)
})
