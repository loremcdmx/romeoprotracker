#!/usr/bin/env node
/**
 * GipsyTeam forum scraper for RomeoPro Tracker.
 * Runs in GitHub Actions on a cron schedule.
 *
 * Modes (set via SCRAPE_MODE env var):
 *   "normal"    — scan last 5 pages: add new posts + update likes on recent posts (default, every 30 min)
 *   "full"      — scan ALL pages: update likes on every post (every 6 hours)
 *   "reextract" — re-extract BR data from ALL Romeo posts with images (clears brHistory, reprocesses everything)
 *
 * Also: if Romeo posted images → sends to Claude API (vision) to extract BR data.
 */

import { readFile, writeFile } from 'fs/promises'
import { execSync } from 'child_process'
import * as cheerio from 'cheerio'

const FORUM_URL = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const ROMEO_RE  = /romeopro/i
const DELAY_MS  = 500        // polite delay between page fetches
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

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
function tsToDate(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
function isRelativeDate(date) {
  return /назад|Вчера|Сегодня/i.test(date) || /(.{10,})\1/.test(date)
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
    const maxLen   = 50000  // safety cap for extreme edge cases only

    const dateEl   = el.find('.post-date--item').first()
    const likesEl  = el.find('.post-vote--rating')
    const avatarEl = el.find('.post-author--avatar img')
    const ratingEl = el.find('.post-author--rating')
    const msgEl    = el.find('.post-author--messages')
    const regEl    = el.find('.post-author--regdata')

    const images = []
    bodyEl.find('img').each(function () {
      if ($(this).closest('blockquote').length) return  // skip images inside quotes
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
      date: (() => {
        const raw = dateEl.text().trim() || ''
        return (isRelativeDate(raw) && timestamp) ? tsToDate(timestamp) : raw
      })(),
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
    // Sync images (e.g. remove quoted images after scraper fix)
    if (scraped.images && JSON.stringify(scraped.images) !== JSON.stringify(post.images)) {
      post.images = scraped.images
    }
    // Update date to absolute form
    if (scraped.date && scraped.date !== post.date) {
      post.date = scraped.date
    }
    // Fix relative/doubled dates using timestamp
    if (isRelativeDate(post.date) && post.timestamp) {
      post.date = tsToDate(post.timestamp)
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

  // Try full-res first, fall back to thumb if full-res 404s (parallel)
  const fullResImages = await Promise.all(brImages.map(async url => {
    const fullUrl = url.replace('_thumb.webp', '.webp').replace('_thumb.jpg', '.jpg').replace('_thumb.png', '.png')
    if (fullUrl === url) return url
    try {
      const head = await fetch(fullUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return head.ok ? fullUrl : url
    } catch {
      return url
    }
  }))

  const content = [
    {
      type: 'text',
      text: `Это скриншот(ы) из поста покериста Romeopro. Он играет марафон $10k→$10M на нескольких покер-румах.

Текст поста: "${post.text.substring(0, 1000)}"

Извлеки из скриншота(ов) данные о банкролле ДО и ПОСЛЕ сессии по каждому руму. Также найди:
- "tournaments": количество турниров за сессию (ячейка "Турниров сыграно за сессию")
- "totalTournaments": общее количество турниров (ячейка "Турниров сыграно всего")

Ответь СТРОГО в формате JSON (без markdown, без комментариев):
{"brBefore":число,"brAfter":число,"roomsBefore":{"gg":число,"ps":число,"king":число,"coin":число,"lux":число},"roomsAfter":{"gg":число,"ps":число,"king":число,"coin":число,"lux":число},"tournaments":число_или_null,"totalTournaments":число_или_null}

Если на скриншоте НЕТ данных о банкролле — ответь: {"skip":true}
Числа должны быть точные, в долларах. НЕ округляй — используй точные значения со скриншота.`
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

    const parseRooms = (r) => ({
      gg: r?.gg ?? 0, ps: r?.ps ?? 0, king: r?.king ?? 0, coin: r?.coin ?? 0, lux: r?.lux ?? 0,
    })

    return {
      brBefore: parsed.brBefore,
      brAfter: parsed.brAfter,
      sessionResult: parsed.brAfter - parsed.brBefore,
      rooms: {
        before: parseRooms(parsed.roomsBefore),
        after: parseRooms(parsed.roomsAfter),
      },
      tournaments: parsed.tournaments || null,
      totalTournaments: parsed.totalTournaments || null,
    }
  } catch (e) {
    console.log(`  ⚠ Claude API parse error: ${e.message}`)
    return null
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const isFullScan = MODE === 'full'
  const isReextract = MODE === 'reextract'
  console.log(`🕷 RomeoPro Scraper [${isReextract ? 'REEXTRACT' : isFullScan ? 'FULL SCAN' : 'normal'}]`)

  // Load existing data
  const posts = JSON.parse(await readFile('data/posts.json', 'utf-8'))
  const meta = JSON.parse(await readFile('data/meta.json', 'utf-8'))
  const knownIds = new Set(posts.map(p => p.id))
  console.log(`📊 Existing: ${posts.length} posts, ${meta.brHistory.length} BR entries`)

  // Reextract mode: clear brHistory and re-process all Romeo posts with images
  if (isReextract) {
    console.log('🔄 Clearing brHistory and re-extracting all BR data...')
    meta.brHistory = []
    meta.bankroll = 10000
    meta.totalTournaments = 0

    // Clear BR fields on all posts
    for (const p of posts) {
      p.brBefore = null
      p.brAfter = null
      p.sessionResult = null
      p.rooms = null
      p.brChecked = false
    }

    // Get all Romeo posts with images, sorted by timestamp
    const romeoPosts = posts.filter(p =>
      ROMEO_RE.test(p.author) && p.images && p.images.length > 0
    ).sort((a, b) => a.timestamp - b.timestamp)

    console.log(`🎰 Processing ${romeoPosts.length} Romeo posts with images...`)
    for (const p of romeoPosts) {
      console.log(`🎰 [reextract] Romeo post ${p.id} (${p.date}) — ${p.images.length} images...`)
      const brData = await extractBrFromImages(p, meta.brHistory)
      if (!brData) {
        console.log('  ℹ No BR data — marking as checked')
        p.brChecked = true
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
        ...(brData.totalTournaments != null ? { totalTournaments: brData.totalTournaments } : {})
      })

      meta.bankroll = brData.brAfter
      if (brData.totalTournaments != null) {
        meta.totalTournaments = brData.totalTournaments
      }
      meta.lastUpdated = new Date().toISOString()

      console.log(`  ✅ BR: $${brData.brBefore} → $${brData.brAfter} (${brData.sessionResult >= 0 ? '+' : ''}${brData.sessionResult})`)
    }

    await writeFile('data/posts.json', JSON.stringify(posts, null, 2))
    await writeFile('data/meta.json', JSON.stringify(meta, null, 2))

    const msg = `scraper: reextract ${meta.brHistory.length} BR entries, BR → $${meta.bankroll} (total ${posts.length})`
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
    return
  }

  // Find last page (reuse this HTML for parsing too)
  const firstPageUrl = FORUM_URL
  const firstPageHtml = await fetchPage(firstPageUrl)
  const lastSt = findLastSt(firstPageHtml)
  if (!lastSt) {
    console.log('⚠ Could not find last page')
    return
  }

  // Build list of pages to scan
  const pagesToScan = []
  if (isFullScan) {
    for (let st = 0; st <= lastSt; st += 20) {
      pagesToScan.push(st === 0 ? FORUM_URL : `${FORUM_URL}&st=${st}`)
    }
  } else {
    // Normal: last 5 pages, newest first for early exit
    for (let i = 0; i < 5; i++) {
      const st = lastSt - i * 20
      if (st < 0) break
      pagesToScan.push(st === 0 ? FORUM_URL : `${FORUM_URL}&st=${st}`)
    }
  }

  console.log(`📄 Scanning up to ${pagesToScan.length} pages...`)

  // Scrape pages
  const allScraped = []
  const newPosts = []
  for (let i = 0; i < pagesToScan.length; i++) {
    const url = pagesToScan[i]
    if (i % 20 === 0 || !isFullScan) console.log(`📄 Page ${i + 1}/${pagesToScan.length}: ${url}`)
    // Reuse already-fetched first page
    const html = (url === firstPageUrl) ? firstPageHtml : await fetchPage(url)
    const pagePosts = parsePosts(html)
    allScraped.push(...pagePosts)

    let pageHasNew = false
    for (const p of pagePosts) {
      if (!knownIds.has(p.id)) {
        newPosts.push(p)
        knownIds.add(p.id)
        pageHasNew = true
      }
    }

    // Normal mode: stop scanning older pages once no new posts found
    if (!isFullScan && !pageHasNew && i > 0) {
      console.log(`⏩ No new posts on page ${i + 1}, stopping early`)
      break
    }
    if (url !== firstPageUrl) await sleep(DELAY_MS)
  }

  // Update likes on existing posts
  const likesUpdated = updateLikes(posts, allScraped)
  if (likesUpdated > 0) {
    console.log(`👍 Likes: ${likesUpdated} posts updated`)
  }

  if (newPosts.length > 0) {
    console.log(`🆕 Found ${newPosts.length} new posts`)
  }

  // Helper: run BR extraction for a post and update meta
  async function processPostBr(p, label) {
    console.log(`🎰 ${label} Romeo post ${p.id} has ${p.images.length} images — analyzing...`)
    const brData = await extractBrFromImages(p, meta.brHistory)
    if (!brData) {
      console.log('  ℹ No BR data found in images — marking as checked')
      p.brChecked = true
      return false
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
      ...(brData.totalTournaments != null ? { totalTournaments: brData.totalTournaments } : {})
    })

    meta.bankroll = brData.brAfter
    if (brData.totalTournaments != null) {
      meta.totalTournaments = brData.totalTournaments
    }
    meta.lastUpdated = new Date().toISOString()

    console.log(`  ✅ BR: $${brData.brBefore} → $${brData.brAfter} (${brData.sessionResult >= 0 ? '+' : ''}${brData.sessionResult})`)
    return true
  }

  // Process Romeo's posts with images (BR extraction via Claude)
  let metaUpdated = false
  for (const p of newPosts) {
    if (!ROMEO_RE.test(p.author)) continue
    if (!p.images || p.images.length === 0) continue
    if (await processPostBr(p, '[new]')) metaUpdated = true
  }

  // Retry existing Romeo posts that have images but missing BR data (skip already-checked non-BR posts)
  const brHistoryIds = new Set(meta.brHistory.map(h => h.id))
  const retryPosts = posts.filter(p =>
    ROMEO_RE.test(p.author) &&
    p.images && p.images.length > 0 &&
    p.brAfter == null &&
    !p.brChecked &&
    !brHistoryIds.has(p.id)
  ).sort((a, b) => a.timestamp - b.timestamp)  // process in chronological order
  if (retryPosts.length > 0) {
    console.log(`🔄 Retrying BR extraction for ${retryPosts.length} existing post(s)...`)
    for (const p of retryPosts) {
      if (await processPostBr(p, '[retry]')) metaUpdated = true
    }
  }

  // Always sort brHistory chronologically and recompute the brBefore/sessionResult chain
  // This fixes any out-of-order entries from retries or prior bugs
  {
    const allPostsMap = new Map([...posts, ...newPosts].map(p => [p.id, p]))
    meta.brHistory.sort((a, b) => a.timestamp - b.timestamp)
    let metaFixed = false
    let lastTotalTournaments = null
    for (let i = 0; i < meta.brHistory.length; i++) {
      const entry = meta.brHistory[i]
      // sessionResult is always brAfter - brBefore (both from image)
      const correctResult = entry.brAfter - entry.brBefore
      if (entry.sessionResult !== correctResult) {
        entry.sessionResult = correctResult
        metaFixed = true
      }
      // totalTournaments comes from the image, not computed
      if (entry.totalTournaments != null) {
        lastTotalTournaments = entry.totalTournaments
      }
      // Sync with the corresponding post object
      const post = allPostsMap.get(entry.id)
      if (post) {
        post.brBefore = entry.brBefore
        post.brAfter = entry.brAfter
        post.sessionResult = entry.sessionResult
        if (post.date) entry.date = post.date
      }
    }
    const lastEntry = meta.brHistory[meta.brHistory.length - 1]
    if (lastEntry && meta.bankroll !== lastEntry.brAfter) {
      meta.bankroll = lastEntry.brAfter
      metaFixed = true
    }
    if (lastTotalTournaments != null && meta.totalTournaments !== lastTotalTournaments) {
      meta.totalTournaments = lastTotalTournaments
      metaFixed = true
    }
    if (metaFixed) {
      meta.lastUpdated = new Date().toISOString()
      metaUpdated = true
    }
  }

  // Check if anything changed
  const hasRetries = retryPosts.length > 0 && metaUpdated
  const hasChanges = newPosts.length > 0 || likesUpdated > 0 || metaUpdated
  if (!hasChanges) {
    console.log('✅ No changes')
    return
  }

  // Merge new posts
  const merged = newPosts.length > 0 ? [...posts, ...newPosts] : posts
  meta.totalPosts = merged.length

  // Build commit message
  const parts = []
  if (newPosts.length > 0) parts.push(`+${newPosts.length} posts`)
  if (likesUpdated > 0) parts.push(`likes: ${likesUpdated} updated`)
  if (hasRetries) parts.push(`retried ${retryPosts.length} BR`)
  if (metaUpdated) parts.push(`BR → $${meta.bankroll}`)
  const msg = `scraper: ${parts.join(', ')} (total ${merged.length})`

  // Git commit & push
  execSync('git config user.name "RomeoPro Scraper"')
  execSync('git config user.email "scraper@romeoprotracker.vercel.app"')

  // Pull remote changes BEFORE writing data files to avoid merge conflicts
  try { execSync('git pull --rebase origin main') } catch {}

  // Write full data
  await writeFile('data/posts.json', JSON.stringify(merged, null, 2))
  await writeFile('data/meta.json', JSON.stringify(meta, null, 2))

  // Write compact posts for frontend (strip nulls, dedupe avatars, truncate text)
  const avatarMap = new Map()
  merged.forEach(p => {
    if (p.avatar && !avatarMap.has(p.avatar)) avatarMap.set(p.avatar, avatarMap.size)
  })
  const compactPosts = merged.map(p => {
    const o = {
      i: p.id,
      a: p.author,
      t: p.timestamp,
      l: p.likes || 0,
    }
    if (p.text) o.x = p.text
    if (p.avatar) o.v = avatarMap.get(p.avatar)
    if (p.rating)      o.r = p.rating
    if (p.msgCount)    o.m = p.msgCount
    if (p.regData)     o.g = p.regData
    if (p.date)        o.d = p.date
    if (p.images?.length) o.p = p.images
    if (p.brAfter != null) o.ba = p.brAfter
    if (p.brBefore != null) o.bb = p.brBefore
    if (p.sessionResult != null) o.sr = p.sessionResult
    if (p.rooms) o.rm = p.rooms
    return o
  })
  const avatarList = [...avatarMap.keys()]
  const compactData = { avatars: avatarList, posts: compactPosts }
  await writeFile('data/posts.min.json', JSON.stringify(compactData))

  execSync('git add data/posts.json data/meta.json data/posts.min.json')

  try {
    execSync(`git commit -m "${msg}"`)
    execSync('git push')
    console.log(`✅ Pushed: ${msg}`)
  } catch (e) {
    console.log('ℹ Nothing to commit or push failed:', e.message)
  }
}

main().catch(e => {
  console.error('❌ Fatal:', e.message)
  process.exit(1)
})
