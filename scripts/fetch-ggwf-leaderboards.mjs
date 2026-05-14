#!/usr/bin/env node

import { createDecipheriv, createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const PML_BASE_URL = 'https://pml.good-game-service.com'
const DEFAULT_GROUP_ID = 1360
const DEFAULT_NICK = 'R Romanovskyi'
const DEFAULT_LIMIT = 6000
const MAX_LIMIT = 6000
const TIER_ORDER = ['Low', 'Medium', 'High', 'Super']
const TIER_BY_CODE = { L: 'Low', M: 'Medium', H: 'High', S: 'Super' }

function parseArgs(argv) {
  const options = {
    groupId: DEFAULT_GROUP_ID,
    nick: DEFAULT_NICK,
    limit: DEFAULT_LIMIT,
    timeoutMs: 20000,
    json: false,
    write: null,
    skipDirect: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => argv[++index]

    if (arg === '--json') options.json = true
    else if (arg === '--skip-direct') options.skipDirect = true
    else if (arg === '--nick') options.nick = next()
    else if (arg.startsWith('--nick=')) options.nick = arg.slice('--nick='.length)
    else if (arg === '--group-id') options.groupId = Number(next())
    else if (arg.startsWith('--group-id=')) options.groupId = Number(arg.slice('--group-id='.length))
    else if (arg === '--limit') options.limit = Number(next())
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length))
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next())
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number(arg.slice('--timeout-ms='.length))
    else if (arg === '--write') options.write = next()
    else if (arg.startsWith('--write=')) options.write = arg.slice('--write='.length)
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.groupId)) throw new Error('--group-id must be a number')
  if (!options.nick) throw new Error('--nick is required')
  if (!Number.isFinite(options.limit) || options.limit < 1) throw new Error('--limit must be a positive number')
  options.limit = Math.min(Math.floor(options.limit), MAX_LIMIT)
  return options
}

function printHelp() {
  console.log(`Usage: npm run leaderboards:ggwf -- [options]

Fetch Romeo's current position in the public GGWF leaderboards.

Options:
  --nick "R Romanovskyi"  Target nickname. Default: ${DEFAULT_NICK}
  --group-id 1360         GGWF leaderboard group id. Default: ${DEFAULT_GROUP_ID}
  --limit 6000            Max rows to fetch per board. PML caps this at ${MAX_LIMIT}.
  --skip-direct           Skip the nickname/rank endpoint and use the ranked list only.
  --json                  Print JSON instead of a compact text report.
  --write path.json       Also write the full JSON snapshot to a file.
  --timeout-ms 20000      Request timeout.
`)
}

function groupPageUrl(groupId) {
  return `${PML_BASE_URL}/pm-leaderboard/group?groupId=${groupId}&lang=en&hr=on&pd=on&timezone=UTC-0`
}

function normalizeNick(nick) {
  return String(nick ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function moneyValue(prize) {
  const value = prize?.value ?? prize?.amount ?? prize
  return numberOrNull(value)
}

function prizeCurrency(prize) {
  return prize?.currencyId ?? prize?.currency ?? null
}

function evpBytesToKey(password, salt, keyLength, ivLength) {
  let previous = Buffer.alloc(0)
  let material = Buffer.alloc(0)

  while (material.length < keyLength + ivLength) {
    previous = createHash('md5')
      .update(Buffer.concat([previous, password, salt]))
      .digest()
    material = Buffer.concat([material, previous])
  }

  return {
    key: material.subarray(0, keyLength),
    iv: material.subarray(keyLength, keyLength + ivLength),
  }
}

function decryptPmlPayload(encryptedData, millisecondsHeader) {
  if (!millisecondsHeader) {
    throw new Error('Encrypted PML response is missing milliseconds header')
  }

  const passphrase = Buffer.from(Number(millisecondsHeader).toString(16))
  const encrypted = Buffer.from(encryptedData, 'base64')
  const signature = encrypted.subarray(0, 8).toString('utf8')
  if (signature !== 'Salted__') throw new Error('Unexpected encrypted PML payload format')

  const salt = encrypted.subarray(8, 16)
  const ciphertext = encrypted.subarray(16)
  const { key, iv } = evpBytesToKey(passphrase, salt, 32, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted)
}

async function fetchPmlJson(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  let response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: groupPageUrl(options.groupId),
        'user-agent': 'romeoprotracker-leaderboard-fetcher/1.0',
      },
    })
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    const retryNote = retryAfter ? ` retry-after=${retryAfter}s` : ''
    throw new Error(`HTTP ${response.status} for ${url}${retryNote}: ${text.slice(0, 240)}`)
  }

  const payload = JSON.parse(text)
  if (payload && typeof payload === 'object' && typeof payload.data === 'string') {
    return decryptPmlPayload(payload.data, response.headers.get('milliseconds'))
  }
  return payload
}

function collectPromotionCandidates(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach(item => collectPromotionCandidates(item, out, seen))
    return out
  }

  const id = value.promotionId ?? value.promotion?.promotionId ?? value.id
  const name = value.name ?? value.promotionName ?? value.promotion?.name ?? ''
  const description = value.displayName ?? value.title ?? value.promotion?.displayName ?? ''
  const tier = inferTier(`${name} ${description}`)
  const key = id ? String(id) : null

  if (id && tier && !seen.has(key)) {
    seen.add(key)
    out.push({
      promotionId: Number(id),
      name: String(name || description || id),
      tier,
      rawStatus: value.status ?? value.promotion?.status ?? null,
    })
  }

  Object.values(value).forEach(item => {
    if (item && typeof item === 'object') collectPromotionCandidates(item, out, seen)
  })

  return out
}

function inferTier(text) {
  const normalized = String(text).toUpperCase()
  const codeMatch = normalized.match(/GGWF[-_\s]*([LMHS])(?:\b|[^A-Z])/)
  if (codeMatch) return TIER_BY_CODE[codeMatch[1]] ?? null
  if (normalized.includes('LOW')) return 'Low'
  if (normalized.includes('MEDIUM') || normalized.includes('MIDDLE')) return 'Medium'
  if (normalized.includes('HIGH')) return 'High'
  if (normalized.includes('SUPER')) return 'Super'
  return null
}

function extractRows(value) {
  const rows = []
  const seen = new Set()

  function visit(item) {
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }

    if (typeof item.nickname === 'string' && item.rank !== undefined) {
      const rank = numberOrNull(item.rank)
      const nickname = String(item.nickname)
      const key = `${rank}:${nickname}`
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(normalizeRow(item))
      }
    }

    Object.values(item).forEach(visit)
  }

  visit(value)
  return rows.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
}

function normalizeRow(row) {
  return {
    rank: numberOrNull(row.rank),
    nickname: row.nickname,
    brandId: row.brandId ?? null,
    siteId: row.siteId ?? null,
    countryId: row.countryId ?? null,
    point: numberOrNull(row.point),
    prizeValue: moneyValue(row.prize ?? row.prizePaid ?? row.prizeItem),
    prizeCurrency: prizeCurrency(row.prize ?? row.prizePaid ?? row.prizeItem),
    isCorrect: row.isCorrect ?? null,
  }
}

function mergeRows(...rowLists) {
  const map = new Map()
  for (const row of rowLists.flat()) {
    const key = `${row.rank}:${normalizeNick(row.nickname)}`
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
}

async function fetchRows(promotionId, options, nickPath = null) {
  const params = new URLSearchParams({
    limit: String(options.limit),
    hasSummary: 'true',
    hasSummaryPaidPrizes: 'false',
    hasSummaryPrizeItem: 'false',
  })
  if (nickPath) params.set('forRank', 'true')

  const suffix = nickPath ? `/${encodeURIComponent(nickPath)}` : '/'
  const url = `${PML_BASE_URL}/lapi/leaderboard/${promotionId}${suffix}?${params.toString()}`
  const payload = await fetchPmlJson(url, options)
  return {
    url,
    rows: extractRows(payload),
  }
}

function summarizeBoard(promotion, rows, targetNick) {
  const targetKey = normalizeNick(targetNick)
  const targetIndex = rows.findIndex(row => normalizeNick(row.nickname) === targetKey)
  const target = targetIndex >= 0 ? rows[targetIndex] : null
  const leader = rows[0] ?? null
  const nextAbove = targetIndex > 0 ? rows[targetIndex - 1] : null
  const nextBelow = targetIndex >= 0 && targetIndex < rows.length - 1 ? rows[targetIndex + 1] : null
  const lastRank = rows.reduce((max, row) => Math.max(max, row.rank ?? 0), 0) || null

  return {
    tier: promotion.tier,
    promotionId: promotion.promotionId,
    promotionName: promotion.name,
    status: target ? 'found' : 'not_found',
    target,
    leader,
    top: rows.slice(0, 5),
    nextAbove,
    nextBelow,
    rowsFetched: rows.length,
    lastRank,
    gapToLeader: pointGap(target, leader),
    gapToNextAbove: pointGap(target, nextAbove),
    gapToNextBelow: pointGap(nextBelow, target),
  }
}

function pointGap(left, right) {
  if (!left || !right || left.point === null || right.point === null) return null
  return Number((left.point - right.point).toFixed(2))
}

async function fetchGgwfLeaderboards(options) {
  const groupUrl = `${PML_BASE_URL}/lapi/leaderboard/groups/${options.groupId}`
  const group = await fetchPmlJson(groupUrl, options)
  const promotions = collectPromotionCandidates(group)
    .filter(promotion => Number.isFinite(promotion.promotionId))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))

  if (promotions.length === 0) {
    throw new Error(`No GGWF promotions found in group ${options.groupId}`)
  }

  const leaderboards = []
  const warnings = []

  for (const promotion of promotions) {
    let directRows = []
    if (!options.skipDirect) {
      try {
        const direct = await fetchRows(
          promotion.promotionId,
          { ...options, limit: Math.min(options.limit, 20) },
          options.nick,
        )
        directRows = direct.rows
      } catch (error) {
        warnings.push(`${promotion.tier}: direct rank lookup failed: ${error.message}`)
      }
    }

    const ranked = await fetchRows(promotion.promotionId, options)
    const rows = mergeRows(directRows, ranked.rows)
    leaderboards.push(summarizeBoard(promotion, rows, options.nick))
  }

  return {
    source: 'ggpoker-pml',
    officialPage: 'https://ggpoker.com/tournaments/ggpoker-world-festival/',
    iframePage: groupPageUrl(options.groupId),
    apiGroupUrl: groupUrl,
    groupId: options.groupId,
    groupName: group.name ?? group.title ?? null,
    startedAt: group.startedAt ?? group.startAt ?? null,
    finishedAt: group.finishedAt ?? group.endAt ?? null,
    targetNick: options.nick,
    limit: options.limit,
    fetchedAt: new Date().toISOString(),
    warnings,
    leaderboards,
  }
}

function formatMoney(value, currency = 'USD') {
  if (value === null || value === undefined) return '-'
  const prefix = currency === 'USD' || !currency ? '$' : `${currency} `
  return `${prefix}${Math.round(value).toLocaleString('en-US')}`
}

function formatPoints(value) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatSignedPoints(value) {
  if (value === null || value === undefined) return '-'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatPoints(value)}`
}

function formatHumanReport(snapshot) {
  const lines = []
  lines.push(`GGWF leaderboards · group ${snapshot.groupId}${snapshot.groupName ? ` · ${snapshot.groupName}` : ''}`)
  if (snapshot.startedAt || snapshot.finishedAt) {
    lines.push(`period: ${snapshot.startedAt ?? '?'} -> ${snapshot.finishedAt ?? '?'}`)
  }
  lines.push(`target: ${snapshot.targetNick}`)
  lines.push(`fetched: ${snapshot.fetchedAt}`)
  lines.push(`source: ${snapshot.iframePage}`)
  lines.push('')

  for (const board of snapshot.leaderboards) {
    const label = board.tier.padEnd(6)
    if (board.status === 'found') {
      const target = board.target
      const leaderPart = board.leader && normalizeNick(board.leader.nickname) !== normalizeNick(target.nickname)
        ? `leader #${board.leader.rank} ${board.leader.nickname} (${formatPoints(board.leader.point)} pts, gap ${formatSignedPoints(board.gapToLeader)})`
        : 'leader'
      const abovePart = board.nextAbove
        ? `next #${board.nextAbove.rank} gap ${formatSignedPoints(board.gapToNextAbove)}`
        : 'no one above'
      lines.push(`${label} #${target.rank} · ${formatPoints(target.point)} pts · ${formatMoney(target.prizeValue, target.prizeCurrency)} · ${leaderPart} · ${abovePart}`)
    } else {
      lines.push(`${label} not found in fetched rows · rows=${board.rowsFetched} · lastRank=${board.lastRank ?? '-'}`)
    }
  }

  if (snapshot.warnings.length) {
    lines.push('')
    lines.push('warnings:')
    snapshot.warnings.forEach(warning => lines.push(`- ${warning}`))
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const snapshot = await fetchGgwfLeaderboards(options)
  if (options.write) {
    await writeFile(options.write, `${JSON.stringify(snapshot, null, 2)}\n`)
  }
  process.stdout.write(options.json ? `${JSON.stringify(snapshot, null, 2)}\n` : formatHumanReport(snapshot))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
