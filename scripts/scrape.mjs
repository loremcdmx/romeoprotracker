#!/usr/bin/env node
/**
 * GipsyTeam forum scraper for RomeoPro Tracker.
 * Runs in GitHub Actions on a cron schedule.
 *
 * Modes (set via SCRAPE_MODE env var):
 *   "normal"    — scan last 5 pages: add new posts + update likes on recent posts (default, every 30 min)
 *   "full"      — scan ALL pages: update likes on every post (every 6 hours)
 *
 * Also: if Romeo posted images → sends to Claude API (vision) to extract BR data.
 */

import { readFile, writeFile } from 'fs/promises'
import { execSync } from 'child_process'
import * as cheerio from 'cheerio'

const FORUM_URL = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const ROMEO_RE  = /romeopro/i
const DELAY_MS  = 800        // polite delay between page fetches
const MODE      = process.env.SCRAPE_MODE || 'normal'

// ─── UTILS ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function htmlToText($el, $) {
  let html = $.html($el)
  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = html.replace(/<\/(p|div)>/gi, '\n\n')
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
  return $clone.root().text().replace(/\n{3,}/g, '\n\n').trim()
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
    const maxLen   = isRomeo ? 8000 : 4000

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
      // Prioritize keeping the reply (after [/QUOTE]) over the quote itself
      const lastClose = text.lastIndexOf('[/QUOTE]')
      if (lastClose !== -1) {
        const reply = text.substring(lastClose + '[/QUOTE]'.length).trim()
        const quoteStart = text.indexOf('[QUOTE]')
        if (reply.length > 0) {
          // Truncate the QUOTE body to fit, keep full reply
          const quoteHeader = text.substring(quoteStart, text.indexOf('\n', quoteStart) + 1)
          const replyBudget = Math.min(reply.length, maxLen - 200)
          const quoteBudget = maxLen - replyBudget - quoteHeader.length - '[/QUOTE]'.length
          const quoteBody = text.substring(quoteStart + quoteHeader.length, lastClose)
          text = quoteHeader + quoteBody.substring(0, Math.max(100, quoteBudget)) +
            (quoteBudget < quoteBody.length ? '…' : '') +
            '[/QUOTE]' + reply.substring(0, replyBudget)
        } else {
          // Quote-only: just truncate
          text = text.substring(0, maxLen)
        }
      } else {
        text = text.substring(0, maxLen)
      }
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

function findLastSt(html) {
  const $ = cheerio.load(html)
  let maxSt = 0
  $('a.theme-pagination--pager').each(function () {
    const m = ($(this).attr('href') || '').match(/st=(\d+)/)
    if (m) maxSt = Math.max(maxSt, parseInt(m[1]))
  })
  return maxSt
}

// ─── LIKES UPDATE ────────────────────────────────────────────────────────────

function updateLikes(existingPosts, scrapedPosts) {
  const scrapedById = new Map(scrapedPosts.map(p => [p.id, p]))
  let updated = 0

  for (const post of existingPosts) {
    const scraped = scrapedById.get(post.id)
    if (!scraped) continue
    if (post.likes !== scraped.likes) {
      post.likes = scraped.likes
      updated++
    }
    // Also update rating if changed
    if (scraped.rating != null && post.rating !== scraped.rating) {
      post.rating = scraped.rating
    }
  }

  return updated
}

// ─── CLAUDE VISION (BR extraction) ──────────────────────────────────────────

async function extractBrFromImages(post, lastBrHistory) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('  ⚠ ANTHROPIC_API_KEY not set, skipping BR extraction')
    return null
  }

  const brImages = post.images.filter(url =>
    !url.includes('smil') && !url.includes('emoji') &&
    (url.includes('_thumb') || url.includes('post-'))
  )
  if (brImages.length === 0) return null

  const fullResImages = brImages.map(url =>
    url.replace('_thumb.webp', '.webp').replace('_thumb.jpg', '.jpg').replace('_thumb.png', '.png')
  )

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
  const isFullScan = MODE === 'full'
  console.log(`🕷 RomeoPro Scraper [${isFullScan ? 'FULL SCAN' : 'normal'}]`)

  // Load existing data
  const posts = JSON.parse(await readFile('data/posts.json', 'utf-8'))
  const meta = JSON.parse(await readFile('data/meta.json', 'utf-8'))
  const knownIds = new Set(posts.map(p => p.id))
  console.log(`📊 Existing: ${posts.length} posts, ${meta.brHistory.length} BR entries`)

  // Find last page
  const firstPageHtml = await fetchPage(FORUM_URL)
  const lastSt = findLastSt(firstPageHtml)
  if (!lastSt) {
    console.log('⚠ Could not find last page')
    return
  }

  // Build list of pages to scan
  const pagesToScan = []
  if (isFullScan) {
    // Full scan: ALL pages (for likes update)
    for (let st = 0; st <= lastSt; st += 20) {
      pagesToScan.push(st === 0 ? FORUM_URL : `${FORUM_URL}&st=${st}`)
    }
  } else {
    // Normal: last 5 pages
    for (let i = 0; i < 5; i++) {
      const st = lastSt - i * 20
      if (st < 0) break
      pagesToScan.push(st === 0 ? FORUM_URL : `${FORUM_URL}&st=${st}`)
    }
    pagesToScan.reverse()
  }

  console.log(`📄 Scanning ${pagesToScan.length} pages...`)

  // Scrape all pages
  const allScraped = []
  const newPosts = []
  for (let i = 0; i < pagesToScan.length; i++) {
    const url = pagesToScan[i]
    if (i % 20 === 0 || !isFullScan) console.log(`📄 Page ${i + 1}/${pagesToScan.length}: ${url}`)
    const html = await fetchPage(url)
    const pagePosts = parsePosts(html)
    allScraped.push(...pagePosts)

    for (const p of pagePosts) {
      if (!knownIds.has(p.id)) {
        newPosts.push(p)
        knownIds.add(p.id)
      }
    }
    await sleep(DELAY_MS)
  }

  // Update likes on existing posts
  const likesUpdated = updateLikes(posts, allScraped)
  if (likesUpdated > 0) {
    console.log(`👍 Likes: ${likesUpdated} posts updated`)
  }

  if (newPosts.length > 0) {
    console.log(`🆕 Found ${newPosts.length} new posts`)
  }

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

    p.brBefore = brData.brBefore
    p.brAfter = brData.brAfter
    p.sessionResult = brData.sessionResult
    p.rooms = brData.rooms

    meta.brHistory.push({
      id: p.id,
      date: p.date,
      timestamp: p.timestamp,
      brBefore: brData.brBefore,
      brAfter: brData.brAfter,
      sessionResult: brData.sessionResult,
      rooms: brData.rooms,
      url: p.url,
      tournaments: brData.tournaments,
      ...(brData.tournaments ? {
        totalTournaments: (meta.totalTournaments || 0) + brData.tournaments
      } : {})
    })

    meta.bankroll = brData.brAfter
    if (brData.tournaments) {
      meta.totalTournaments = (meta.totalTournaments || 0) + brData.tournaments
    }
    meta.lastUpdated = new Date().toISOString()
    metaUpdated = true

    console.log(`  ✅ BR: $${brData.brBefore} → $${brData.brAfter} (${brData.sessionResult >= 0 ? '+' : ''}${brData.sessionResult})`)
  }

  // Check if anything changed
  const hasChanges = newPosts.length > 0 || likesUpdated > 0 || metaUpdated
  if (!hasChanges) {
    console.log('✅ No changes')
    return
  }

  // Merge new posts and save
  const merged = newPosts.length > 0 ? [...posts, ...newPosts] : posts
  meta.totalPosts = merged.length

  await writeFile('data/posts.json', JSON.stringify(merged, null, 2))

  if (metaUpdated) {
    await writeFile('data/meta.json', JSON.stringify(meta, null, 2))
  }

  // Build commit message
  const parts = []
  if (newPosts.length > 0) parts.push(`+${newPosts.length} posts`)
  if (likesUpdated > 0) parts.push(`likes: ${likesUpdated} updated`)
  if (metaUpdated) parts.push(`BR → $${meta.bankroll}`)
  const msg = `scraper: ${parts.join(', ')} (total ${merged.length})`

  // Git commit & push
  execSync('git config user.name "RomeoPro Scraper"')
  execSync('git config user.email "scraper@romeoprotracker.vercel.app"')
  execSync('git add data/posts.json data/meta.json')

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
