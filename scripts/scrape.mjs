#!/usr/bin/env node
/**
 * GipsyTeam forum scraper for RomeoPro Tracker.
 * Runs in GitHub Actions on a cron schedule.
 *
 * Modes (set via SCRAPE_MODE env var or --mode):
 *   "normal"    — scan last 5 pages: add new posts + update likes on recent posts (default, every 30 min)
 *   "full"      — scan ALL pages: update likes/text on every post and drop posts the forum
 *                 no longer lists (capped, see --prune-force; Romeo's own posts are never dropped)
 *   "reextract" — re-extract BR data from ALL Romeo posts with images and replace brHistory
 *                 (needs ANTHROPIC_API_KEY; writes nothing unless every post succeeded)
 *   "translate" — fill en/es translations on all Romeo posts that are missing them (backfill)
 *
 * Safety flags:
 *   --dry-run / SCRAPE_DRY_RUN=1 — fetch + parse, but do not write files or run git
 *   --no-push / SCRAPE_NO_PUSH=1 — write local files, but skip git pull / commit / push
 *   --prune-force / SCRAPE_PRUNE_FORCE=1 — full mode only: lift the cap (min(50, 1%) posts per run) on removals
 *
 * Also: if Romeo posted images → sends to Claude API (vision) to extract BR data.
 * Also: Romeo posts get machine-translated to en/es (Haiku) on normal runs
 * (up to 10 per run); use translate mode to clear the backlog in one go.
 */

import { readFile, writeFile } from 'fs/promises'
import { execSync, execFileSync } from 'child_process'
import { createHash } from 'crypto'
import * as cheerio from 'cheerio'
import { computeMarathonDay, extractMarathonDay } from './lib/marathon-integrity.mjs'
import { ROMEO_AUTHOR_RE } from './lib/romeo-identity.mjs'
import { isSafeEmbedUrl } from './lib/embed-url.mjs'
import { isPersistentApiError, isPostSpecificApiError, persistentApiWarning, validateBrExtraction } from './lib/br-extraction.mjs'
import { planPrune, pruneLimit } from './lib/prune.mjs'
import { needsTranslation, translatePost } from './lib/translation.mjs'
import { parseScrapeOptions } from './lib/scrape-options.mjs'

const FORUM_URL = 'https://forum.gipsyteam.ru/index.php?viewtopic=181676'
const ROMEO_RE  = ROMEO_AUTHOR_RE   // exact account match, shared with the client
const DELAY_MS  = 500        // polite delay between page fetches
const { mode: MODE, dryRun: DRY_RUN, noPush: NO_PUSH, pruneForce: PRUNE_FORCE } = parseScrapeOptions(process.argv.slice(2), process.env)

// ─── UTILS ───────────────────────────────────────────────────────────────────

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2))
}

async function persistScrapeOutputs({
  posts,
  meta = null,
  writeCompact = true,
  gitFiles = [],
  commitMessage,
}) {
  const filesLabel = gitFiles.length ? gitFiles.join(', ') : 'data files'

  if (DRY_RUN) {
    console.log(`🧪 Dry run: would write ${filesLabel}${commitMessage ? ` and publish "${commitMessage}"` : ''}`)
    return
  }

  if (!NO_PUSH) {
    execSync('git config user.name "RomeoPro Scraper"')
    execSync('git config user.email "scraper@romeoprotracker.vercel.app"')
    try { execSync('git pull --rebase origin main') } catch {}
  }

  await writeJson('data/posts.json', posts)
  if (meta) await writeJson('data/meta.json', meta)
  if (writeCompact) await writeCompactPosts(posts)

  if (NO_PUSH) {
    console.log(`📝 Local-only mode: updated ${filesLabel}, skipped git pull / commit / push`)
    return
  }

  execFileSync('git', ['add', ...gitFiles])
  // Distinguish "nothing changed" (fine) from a real commit/push failure: the
  // old single catch swallowed rejected pushes, so a persistent failure looked
  // like a healthy run and notifyFailure never fired.
  let hasStagedChanges = false
  try { execSync('git diff --cached --quiet') } catch { hasStagedChanges = true }
  if (!hasStagedChanges) {
    console.log('ℹ Nothing to commit')
    return
  }
  execFileSync('git', ['commit', '-m', commitMessage])
  try {
    execSync('git push')
  } catch (e) {
    console.log('⚠ push rejected, retrying after rebase:', e.message)
    execSync('git pull --rebase origin main')
    execSync('git push')
  }
  console.log(`✅ Pushed: ${commitMessage}`)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Log-friendly id list: everything for short lists, first `max` plus a count otherwise.
function idList(ids, max = 100) {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} … (+${ids.length - max} more)`
}

function htmlToText($el, $) {
  let html = $.html($el)
  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = html.replace(/<\/(p|div)>/gi, '\n\n')
  const $clone = cheerio.load(html)
  // Replace media figures (video iframes etc) with a [VIDEO] marker so the
  // post body doesn't end up empty when its only content is an embed.
  $clone('figure.media, figure').each(function () {
    const fig = $clone(this)
    if (fig.find('iframe').length) fig.replaceWith('\n[VIDEO]\n')
  })
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
function normalizeGtAssetUrl(value) {
  if (!value) return null
  const src = String(value).trim()
  if (!src) return null
  if (src.startsWith('//')) return `https:${src}`
  if (/^https?:\/\/forum\.gipsyteam\.ru\/img\//i.test(src)) {
    return src.replace(/^https?:\/\/forum\.gipsyteam\.ru/i, 'https://forum.gipsyteam.com')
  }
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('/upload/')) return `https://www.gipsyteam.ru${src}`
  if (src.startsWith('/img/')) return `https://forum.gipsyteam.com${src}`
  if (src.startsWith('/')) return `https://forum.gipsyteam.ru${src}`
  return src
}
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

    const videos = []
    bodyEl.find('figure.media iframe, figure iframe').each(function () {
      if ($(this).closest('blockquote').length) return
      const src = $(this).attr('src')
      if (!src) return
      // Only https embeds from known player hosts are kept; javascript:/data:/
      // http:/unknown hosts never reach the dataset (the client re-checks).
      if (isSafeEmbedUrl(src)) videos.push(src)
      else console.log(`  ⚠ dropped embed with a non-allow-listed src (${String(src).slice(0, 60)}) in post ${postId}`)
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
      avatar: normalizeGtAssetUrl(avatarEl.attr('src')),
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
      videos,
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

// A scraped body shorter than half of a stored body (100+ chars) is treated as a
// degraded page (stub, partial render, block text), not as an edit: the stored
// text stays and the id is reported. Real edits and parser improvements
// lengthen or barely change a body.
const TEXT_SHRINK_MIN_STORED = 100
const TEXT_SHRINK_RATIO = 0.5

// Returns the number of posts whose likes changed. Ids of posts whose BODY was
// refreshed / refused as a suspicious shrink are pushed to `text.edited` /
// `text.shrunk` when given.
function updateLikes(existingPosts, scrapedPosts, text = { edited: [], shrunk: [] }) {
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
    // Sync videos (added by scraper fix — backfill on existing posts)
    if (scraped.videos && JSON.stringify(scraped.videos) !== JSON.stringify(post.videos || [])) {
      post.videos = scraped.videos
    }
    // Sync the body: forum edits and parser improvements used to be ignored
    // after the first import (text was refreshed only as a side effect of a
    // videos change). An empty scrape never replaces a stored body. A changed
    // body changes the translation signature, so needsTranslation re-queues
    // exactly the Romeo posts whose text moved.
    if (scraped.text && scraped.text !== post.text) {
      const stored = post.text || ''
      if (stored.length >= TEXT_SHRINK_MIN_STORED && scraped.text.length < stored.length * TEXT_SHRINK_RATIO) {
        text.shrunk.push(post.id)
      } else {
        post.text = scraped.text
        text.edited.push(post.id)
      }
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

// extractBrFromImages results besides real data:
//   null                  "definitively no BR data in these images" (model said skip)
//   BR_EXTRACT_RETRY      the model ANSWERED but the answer is unusable (not JSON,
//                         fails validation) or the request itself is bad for this
//                         post (400/413 about the images). Counts against the
//                         post's attempt budget.
//   BR_EXTRACT_TRANSIENT  no verdict about the post: missing key, network error,
//                         429/5xx/529, 401/402/403/404, low credit. Never counts
//                         against the budget - an API outage must not use up the
//                         attempts of a good screenshot.
const BR_EXTRACT_RETRY = Symbol('br-extract-retry')
const BR_EXTRACT_TRANSIENT = Symbol('br-extract-transient')
// After this many unusable answers for one post, stop retrying it so a
// genuinely unreadable screenshot can't trigger an unbounded API spend. Giving
// up is never silent: see processPostBr (brGaveUp flag, error annotation, red run).
const BR_MAX_ATTEMPTS = 6
// Posts the retry budget was exhausted on during this run (reported at the end).
const brGaveUp = []
// A persistent API refusal (401/402/403, no credit) is free - it never spends a
// post's budget - but it must not be silent either: the run stays green and the
// data untouched, so one ::warning:: annotation per run is the only signal.
let persistentApiWarned = false
function warnPersistentApiFailure(status, bodyText) {
  if (persistentApiWarned) return
  persistentApiWarned = true
  console.log(persistentApiWarning(status, bodyText))
}

async function extractBrFromImages(post, lastBrHistory) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('  ⚠ ANTHROPIC_API_KEY not set, skipping BR extraction')
    return BR_EXTRACT_TRANSIENT
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

  let res
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content }],
      })
    })
  } catch (e) {
    console.log(`  ⚠ Claude API network error: ${e.message}`)
    return BR_EXTRACT_TRANSIENT
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.log(`  ⚠ Claude API error ${res.status}: ${err.substring(0, 200)}`)
    if (isPersistentApiError(res.status, err)) warnPersistentApiFailure(res.status, err)
    return isPostSpecificApiError(res.status, err) ? BR_EXTRACT_RETRY : BR_EXTRACT_TRANSIENT
  }

  let data
  try {
    data = await res.json()
  } catch (e) {
    console.log(`  ⚠ Claude API response was not JSON: ${e.message}`)
    return BR_EXTRACT_TRANSIENT
  }

  const text = data?.content?.[0]?.text?.trim()
  if (!text) {
    console.log('  ⚠ Claude API answer had no text')
    return BR_EXTRACT_RETRY
  }

  let parsed
  try {
    parsed = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''))
  } catch (e) {
    console.log(`  ⚠ Claude API parse error: ${e.message}`)
    return BR_EXTRACT_RETRY
  }
  if (parsed && typeof parsed === 'object' && parsed.skip) return null

  // The model's numbers become the headline bankroll: nothing is trusted until
  // types, ranges and the chain with neighbouring sessions check out.
  const checked = validateBrExtraction(parsed, { history: lastBrHistory, timestamp: post.timestamp })
  if (!checked.ok) {
    console.log(`  ⚠ Claude API answer rejected: ${checked.reason}`)
    return BR_EXTRACT_RETRY
  }
  return checked.value
}

// ─── COMPACT WRITER ─────────────────────────────────────────────────────────
//
// Keep the compact schema in sync with src/storage.js expandPosts().
// Added: te (translation en), ts (translation es).

async function writeCompactPosts(merged) {
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
    if (p.videos?.length) o.vd = p.videos
    if (p.brAfter != null) o.ba = p.brAfter
    if (p.brBefore != null) o.bb = p.brBefore
    if (p.sessionResult != null) o.sr = p.sessionResult
    if (p.rooms) o.rm = p.rooms
    if (p.translations?.en) o.te = p.translations.en
    if (p.translations?.es) o.ts = p.translations.es
    return o
  })
  const avatarList = [...avatarMap.keys()]
  const compactData = { avatars: avatarList, posts: compactPosts }
  await writeFile('data/posts.min.json', JSON.stringify(compactData))
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const isFullScan  = MODE === 'full'
  const isReextract = MODE === 'reextract'
  const isTranslate = MODE === 'translate'
  console.log(`🕷 RomeoPro Scraper [${isReextract ? 'REEXTRACT' : isTranslate ? 'TRANSLATE' : isFullScan ? 'FULL SCAN' : 'normal'}]`)
  if (DRY_RUN) {
    console.log('🧪 Execution mode: dry-run (no file writes, no git)')
  } else if (NO_PUSH) {
    console.log('📝 Execution mode: local-only (write files, skip git pull / commit / push)')
  }

  // Sync BEFORE reading: the old order read data/*.json first and pulled
  // right before writing, so any data commit pulled in was overwritten by the
  // in-memory copy (lost update).
  if (!DRY_RUN && !NO_PUSH) {
    try { execSync('git pull --rebase origin main', { stdio: 'ignore' }) } catch {}
  }

  // Load existing data
  let posts = JSON.parse(await readFile('data/posts.json', 'utf-8'))
  const meta = JSON.parse(await readFile('data/meta.json', 'utf-8'))
  const knownIds = new Set(posts.map(p => p.id))
  console.log(`📊 Existing: ${posts.length} posts, ${meta.brHistory.length} BR entries`)

  // Translate-only mode: fill missing en/es translations on Romeo posts, then commit.
  if (isTranslate) {
    const queue = posts.filter(p => ROMEO_RE.test(p.author) && needsTranslation(p))
    console.log(`🌐 ${queue.length} Romeo posts need translation`)
    let done = 0
    for (const p of queue) {
      const ok = await translatePost(p)
      if (ok) {
        done++
        console.log(`  ✅ ${p.id} translated (${done}/${queue.length})`)
      } else {
        console.log(`  ⚠ ${p.id} skipped`)
      }
      await sleep(DELAY_MS)
    }
    if (done === 0) {
      console.log('✅ Nothing translated')
      return
    }
    await persistScrapeOutputs({
      posts,
      writeCompact: true,
      gitFiles: ['data/posts.json', 'data/posts.min.json'],
      commitMessage: `scraper: translate ${done} Romeo posts to en/es`,
    })
    return
  }

  // Reextract mode: rebuild brHistory from every Romeo post with images.
  // Destructive by nature, so: it refuses to start without an API key, builds
  // the new history on the side, and touches posts/meta/files ONLY after every
  // post resolved. Any failure (API trouble, unreadable answer) aborts with
  // nothing written - the old code wiped history up front and published the
  // wipe (bankroll $10,000, empty chart) when the key was missing or the API
  // failed.
  if (isReextract) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('reextract needs ANTHROPIC_API_KEY - refusing to start, nothing was changed')
    }
    console.log('🔄 Re-extracting all BR data (nothing is written until every post succeeded)...')

    // Get all Romeo posts with images, sorted by timestamp
    const romeoPosts = posts.filter(p =>
      ROMEO_RE.test(p.author) && p.images && p.images.length > 0
    ).sort((a, b) => a.timestamp - b.timestamp)

    console.log(`🎰 Processing ${romeoPosts.length} Romeo posts with images...`)
    const newHistory = []
    const extracted = new Map()   // post id -> BR data, or null for "no BR data"
    for (const p of romeoPosts) {
      console.log(`🎰 [reextract] Romeo post ${p.id} (${p.date}) — ${p.images.length} images...`)
      const brData = await extractBrFromImages(p, newHistory)
      if (brData === BR_EXTRACT_RETRY || brData === BR_EXTRACT_TRANSIENT) {
        throw new Error(`reextract aborted at post ${p.id}: BR extraction failed - nothing was written`)
      }
      extracted.set(p.id, brData)
      if (!brData) {
        console.log('  ℹ No BR data — marking as checked')
        continue
      }

      newHistory.push({
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
      console.log(`  ✅ BR: $${brData.brBefore} → $${brData.brAfter} (${brData.sessionResult >= 0 ? '+' : ''}${brData.sessionResult})`)
    }

    if (newHistory.length === 0) {
      throw new Error('reextract aborted: no BR data extracted from any post - refusing to publish an empty history')
    }
    if (newHistory.length < meta.brHistory.length) {
      console.log(`⚠ reextract produced ${newHistory.length} BR entries, the previous history had ${meta.brHistory.length}`)
    }

    // Every post resolved: now (and only now) replace the stored BR state.
    for (const p of posts) {
      p.brBefore = null
      p.brAfter = null
      p.sessionResult = null
      p.rooms = null
      p.brChecked = false
      delete p.brAttempts
      delete p.brGaveUp
    }
    for (const p of romeoPosts) {
      const brData = extracted.get(p.id)
      if (!brData) {
        p.brChecked = true
        continue
      }
      p.brBefore = brData.brBefore
      p.brAfter = brData.brAfter
      p.sessionResult = brData.sessionResult
      p.rooms = brData.rooms
    }
    meta.brHistory = newHistory
    const lastBr = newHistory[newHistory.length - 1]
    meta.bankroll = lastBr.brAfter
    meta.totalTournaments = [...newHistory].reverse().find(h => h.totalTournaments != null)?.totalTournaments ?? 0
    meta.lastUpdated = new Date().toISOString()

    const msg = `scraper: reextract ${meta.brHistory.length} BR entries, BR → $${meta.bankroll} (total ${posts.length})`
    await persistScrapeOutputs({
      posts,
      meta,
      writeCompact: true,
      gitFiles: ['data/posts.json', 'data/meta.json', 'data/posts.min.json'],
      commitMessage: msg,
    })
    return
  }

  // Find last page (reuse this HTML for parsing too)
  const firstPageUrl = FORUM_URL
  const firstPageHtml = await fetchPage(firstPageUrl)
  const lastSt = findLastSt(firstPageHtml)
  if (!lastSt) {
    // No pager means this is not the thread page (markup change, block or
    // maintenance page). A quiet exit 0 looked like a healthy run.
    throw new Error('Could not find the last page (pager missing) - forum markup changed or request blocked; nothing was written')
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
  let pagesFetched = 0
  for (let i = 0; i < pagesToScan.length; i++) {
    const url = pagesToScan[i]
    if (i % 20 === 0 || !isFullScan) console.log(`📄 Page ${i + 1}/${pagesToScan.length}: ${url}`)
    // Reuse already-fetched first page
    const html = (url === firstPageUrl) ? firstPageHtml : await fetchPage(url)
    const pagePosts = parsePosts(html)
    if (pagePosts.length === 0) {
      // Every page of this thread holds posts. Zero parsed posts means the
      // markup changed or we were served a block page: fail the run before
      // anything (including the lastScrapeRun heartbeat) is written. The only
      // exception is the newest page, which can hold nothing but hidden posts;
      // if the markup is really broken the next (older) page fails the run.
      const pageSt = Number(url.match(/[?&]st=(\d+)/)?.[1] || 0)
      if (pageSt !== lastSt) {
        throw new Error(`Parsed 0 posts from ${url} - forum markup changed or request blocked; nothing was written`)
      }
      console.log(`  ⚠ newest page ${url} has no visible posts, continuing`)
    }
    allScraped.push(...pagePosts)
    pagesFetched++

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

  // Update likes (and edited text) on existing posts
  const textChanges = { edited: [], shrunk: [] }
  const likesUpdated = updateLikes(posts, allScraped, textChanges)
  const textEdited = textChanges.edited
  if (likesUpdated > 0) {
    console.log(`👍 Likes: ${likesUpdated} posts updated`)
  }
  if (textEdited.length > 0) {
    console.log(`✏ Text: ${textEdited.length} posts refreshed from the forum`)
  }
  if (textChanges.shrunk.length > 0) {
    console.log(`::warning::Text refresh skipped for ${textChanges.shrunk.length} post(s) whose forum body is less than half of the stored one (degraded page?): ${idList(textChanges.shrunk, 20)}`)
  }

  // Reconcile deletions - full scans only, and only when EVERY page was
  // fetched and parsed (a failed page throws above, so reaching this point
  // means a complete scan). Romeo's own posts are never auto-removed: they feed
  // brHistory and the day counter. Removal is capped (see pruneLimit) unless
  // --prune-force is given.
  const pruned = []
  if (isFullScan && pagesFetched === pagesToScan.length) {
    const plan = planPrune({
      posts,
      scrapedIds: new Set(allScraped.map(p => p.id)),
      isKept: p => ROMEO_RE.test(p.author),
    })
    if (plan.kept.length > 0) {
      console.log(`ℹ ${plan.kept.length} Romeo post(s) no longer listed on the forum are kept: ${idList(plan.kept)}`)
    }
    if (plan.missing.length > 0) {
      const limit = pruneLimit(posts.length)
      if (plan.missing.length > limit && !PRUNE_FORCE) {
        console.log(`::warning::Prune refused: ${plan.missing.length} stored posts are not on the forum, more than the safe limit of ${limit} per run. Re-run with --prune-force if this is real. ids: ${idList(plan.missing)}`)
      } else {
        const drop = new Set(plan.missing)
        posts = posts.filter(p => !drop.has(p.id))
        pruned.push(...plan.missing)
        console.log(`🗑 Removed ${pruned.length} post(s) the forum no longer lists: ${idList(pruned)}`)
      }
    }
  }

  if (newPosts.length > 0) {
    console.log(`🆕 Found ${newPosts.length} new posts`)
  }

  // Retry bookkeeping that must be committed even when nothing else changed.
  let brStateChanged = false

  // Helper: run BR extraction for a post and update meta
  async function processPostBr(p, label) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(`  ⚠ ANTHROPIC_API_KEY not set — skipping BR extraction for ${p.id} (will retry later)`)
      return false
    }
    console.log(`🎰 ${label} Romeo post ${p.id} has ${p.images.length} images — analyzing...`)
    const brData = await extractBrFromImages(p, meta.brHistory)
    if (brData === BR_EXTRACT_TRANSIENT) {
      // API/network/account trouble says nothing about this post: no attempt is
      // spent, the post simply stays eligible for the next run.
      console.log(`  ↻ BR extraction postponed for ${p.id} (API/network problem) — will retry next run`)
      return false
    }
    if (brData === BR_EXTRACT_RETRY) {
      // The model answered but the answer is unusable (not JSON, failed
      // validation) or the request is bad for this post. Bounded, so a
      // genuinely unreadable image can't hammer the API.
      p.brAttempts = (p.brAttempts || 0) + 1
      brStateChanged = true
      if (p.brAttempts >= BR_MAX_ATTEMPTS) {
        // Stop retrying, but never silently: the post carries brGaveUp, the log
        // gets an error annotation and the run finishes red (see the end of
        // main). Recovery: README, "Recovering from a given-up BR session".
        p.brChecked = true
        p.brGaveUp = new Date().toISOString()
        brGaveUp.push(p.id)
        console.log(`::error::BR extraction gave up on post ${p.id} after ${p.brAttempts} unusable answers - its session is NOT in the bankroll history (README: Recovering from a given-up BR session)`)
      } else {
        console.log(`  ↻ BR extraction failed (attempt ${p.brAttempts}/${BR_MAX_ATTEMPTS}) for ${p.id} — will retry next run`)
      }
      return false
    }
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

  // Translate new/edited Romeo posts to en/es (lazy catch-up included).
  // allRomeoCandidates = new Romeo posts + any existing Romeo post whose text
  // changed or never got translated. We cap per-run so the Action stays fast;
  // the `translate` mode exists for bulk backfill.
  let translated = 0
  if (process.env.ANTHROPIC_API_KEY) {
    const mergedForTr = [...posts, ...newPosts]
    const trQueue = mergedForTr
      .filter(p => ROMEO_RE.test(p.author) && needsTranslation(p))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10)
    if (trQueue.length > 0) {
      console.log(`🌐 Translating ${trQueue.length} Romeo post(s)...`)
      for (const p of trQueue) {
        if (await translatePost(p)) translated++
      }
      if (translated > 0) console.log(`  ✅ ${translated} translated`)
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
    const computedDay = computeMarathonDay([...allPostsMap.values()], meta.brHistory)
    if (computedDay && meta.day !== computedDay) {
      meta.day = computedDay
      metaFixed = true
    }
    if (metaFixed) {
      meta.lastUpdated = new Date().toISOString()
      metaUpdated = true
    }
  }

  // Heartbeat: always record that a scrape run completed successfully.
  // lastScrapeRun bumps every run; lastUpdated keeps its old semantics
  // (only when BR/posts actually changed) for backwards compat.
  const prevScrapeRun = meta.lastScrapeRun ? Date.parse(meta.lastScrapeRun) : 0
  const nowMs = Date.now()
  meta.lastScrapeRun = new Date(nowMs).toISOString()
  // Commit heartbeat-only updates at most once per 30 min to keep git log clean.
  const heartbeatDue = nowMs - prevScrapeRun > 30 * 60 * 1000

  // Check if anything changed
  const hasRetries = retryPosts.length > 0 && metaUpdated
  const hasRealChanges = newPosts.length > 0 || likesUpdated > 0 || metaUpdated || translated > 0
    || textEdited.length > 0 || pruned.length > 0 || brStateChanged
  const hasChanges = hasRealChanges || heartbeatDue
  if (!hasChanges) {
    console.log('✅ No changes')
    return
  }

  // Merge new posts
  const merged = newPosts.length > 0 ? [...posts, ...newPosts] : posts
  meta.totalPosts = merged.length

  // Open tabs gate their heavy refetch on meta freshness. Stamp whenever the
  // published posts CONTENT changes — hashing catches rating/image/date syncs
  // that the likes/new-post counters missed (audit: 2 of 291 commits).
  const postsHash = createHash('sha1')
    .update(JSON.stringify(merged.map(p => [p.id, p.likes, p.rating, p.text, p.translations, p.images, p.videos, p.date, p.brAfter])))
    .digest('hex')
  if (postsHash !== meta.postsHash) {
    meta.postsHash = postsHash
    meta.postsChangedAt = new Date().toISOString()
  }

  // Build commit message
  const parts = []
  if (newPosts.length > 0) parts.push(`+${newPosts.length} posts`)
  if (likesUpdated > 0) parts.push(`likes: ${likesUpdated} updated`)
  if (textEdited.length > 0) parts.push(`text: ${textEdited.length} refreshed`)
  if (pruned.length > 0) parts.push(`-${pruned.length} removed`)
  if (brStateChanged && !metaUpdated) parts.push('BR retry state')
  if (hasRetries) parts.push(`retried ${retryPosts.length} BR`)
  if (metaUpdated) parts.push(`BR → $${meta.bankroll}`)
  if (translated > 0) parts.push(`translated ${translated}`)
  if (parts.length === 0) parts.push('heartbeat')
  const msg = `scraper: ${parts.join(', ')} (total ${merged.length})`

  await persistScrapeOutputs({
    posts: merged,
    meta,
    writeCompact: true,
    gitFiles: ['data/posts.json', 'data/meta.json', 'data/posts.min.json'],
    commitMessage: msg,
  })
}

// Optional failure alert so a silently broken scraper (forum markup change,
// Cloudflare block, API key issue) doesn't quietly serve stale data for hours.
// No-op unless a channel is configured: SCRAPE_ALERT_WEBHOOK (Slack/Discord/
// generic JSON webhook) or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
async function notifyFailure(error) {
  const message = `🚨 RomeoPro scraper failed (mode=${MODE}): ${error?.message || error}`
  try {
    const webhook = process.env.SCRAPE_ALERT_WEBHOOK
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message, content: message }),
      })
      return
    }
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      })
    }
  } catch (alertError) {
    console.error('⚠️  Failed to send failure alert:', alertError.message)
  }
}

main().then(async () => {
  // Persisting already happened; the red run is the visible alarm for a BR post
  // the scraper had to give up on.
  if (brGaveUp.length > 0) {
    const e = new Error(`BR extraction gave up on post(s) ${brGaveUp.join(', ')} - flagged brGaveUp in data/posts.json`)
    console.error('❌', e.message)
    await notifyFailure(e)
    process.exitCode = 1
  }
}).catch(async e => {
  console.error('❌ Fatal:', e.message)
  await notifyFailure(e)
  process.exit(1)
})
