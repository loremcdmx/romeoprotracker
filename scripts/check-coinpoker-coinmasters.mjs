#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { load } from 'cheerio'

const DEFAULT_URL = 'https://coinpoker.com/promotions/coinmasters-leaderboard/'
const DEFAULT_NICKS = ['R Romanovskyi', 'Romeopro', 'RomeoPro', 'Romanovskyi']

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    nicks: [...DEFAULT_NICKS],
    timeoutMs: 20000,
    json: false,
    write: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => argv[++index]

    if (arg === '--json') options.json = true
    else if (arg === '--url') options.url = next()
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length)
    else if (arg === '--nick') options.nicks.push(next())
    else if (arg.startsWith('--nick=')) options.nicks.push(arg.slice('--nick='.length))
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

  options.nicks = Array.from(new Set(options.nicks.map(cleanText).filter(Boolean)))
  if (!Number.isFinite(options.timeoutMs)) throw new Error('--timeout-ms must be a number')
  return options
}

function printHelp() {
  console.log(`Usage: npm run leaderboards:coin -- [options]

Check the public CoinPoker CoinMasters leaderboard page for known Romeo aliases.

Options:
  --nick "RomeoNick"      Add a nickname to search for. Can be repeated.
  --url ${DEFAULT_URL}
  --json                  Print JSON instead of a compact text report.
  --write path.json       Also write the full JSON snapshot to a file.
  --timeout-ms 20000      Request timeout.
`)
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalize(value) {
  return cleanText(value).toLowerCase()
}

async function fetchHtml(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'romeoprotracker-leaderboard-fetcher/1.0',
      },
    })
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  return {
    html: text,
    status: response.status,
    ok: response.ok,
  }
}

function parseCoinmastersRows(html) {
  const $ = load(html)
  const rows = []

  $('table tr').each((_, tr) => {
    const cells = $(tr).find('th,td').toArray().map(cell => cleanText($(cell).text()))
    if (cells.length < 2 || /^player$/i.test(cells[0])) return

    const rankPlayer = cells[0]
    const rankMatch = rankPlayer.match(/^(\d+)\.?\s*(.+)$/)
    const rank = rankMatch ? Number(rankMatch[1]) : rows.length + 1
    const player = rankMatch ? cleanText(rankMatch[2]) : rankPlayer
    const coins = $(tr).find('td').eq(1).find('img').toArray()
      .map(img => cleanText($(img).attr('alt') || $(img).attr('title')))
      .filter(Boolean)

    rows.push({
      rank,
      player,
      coins: coins.length ? coins : [cells[1]].filter(Boolean),
    })
  })

  return rows
}

async function checkCoinmasters(options) {
  const fetched = await fetchHtml(options.url, options.timeoutMs)
  const html = fetched.html
  const rows = parseCoinmastersRows(html)
  const nickSet = new Set(options.nicks.map(normalize))
  const matches = rows.filter(row => nickSet.has(normalize(row.player)))
  const pageText = cleanText(load(html)('body').text())
  const updatedMatch = pageText.match(/Leaderboard updated each Monday/i)
  const warnings = []

  if (!fetched.ok) {
    warnings.push(`CoinPoker returned HTTP ${fetched.status} to this direct fetch`)
  }
  if (rows.length === 0) {
    warnings.push('No machine-readable leaderboard rows found in the current public page HTML')
  }

  return {
    source: 'coinpoker-coinmasters-public-page',
    pageUrl: options.url,
    httpStatus: fetched.status,
    searchedNicks: options.nicks,
    fetchedAt: new Date().toISOString(),
    rowsFetched: rows.length,
    updateNote: updatedMatch ? 'Leaderboard updated each Monday' : null,
    warnings,
    matches,
    top: rows.slice(0, 10),
  }
}

function formatHumanReport(snapshot) {
  const lines = []
  lines.push('CoinPoker CoinMasters leaderboard')
  lines.push(`source: ${snapshot.pageUrl}`)
  lines.push(`searched: ${snapshot.searchedNicks.join(', ')}`)
  lines.push(`fetched: ${snapshot.fetchedAt}`)
  lines.push(`http: ${snapshot.httpStatus}`)
  lines.push(`rows: ${snapshot.rowsFetched}${snapshot.updateNote ? ` · ${snapshot.updateNote}` : ''}`)
  lines.push('')

  if (snapshot.matches.length) {
    lines.push('matches:')
    snapshot.matches.forEach(row => {
      lines.push(`#${row.rank} ${row.player} · coins: ${row.coins.join(', ') || '-'}`)
    })
  } else {
    lines.push('No exact match for the searched Romeo aliases on the public CoinMasters page.')
  }

  if (snapshot.top.length) {
    lines.push('')
    lines.push('top 10:')
    snapshot.top.forEach(row => {
      lines.push(`#${row.rank} ${row.player} · coins: ${row.coins.join(', ') || '-'}`)
    })
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
  const snapshot = await checkCoinmasters(options)
  if (options.write) {
    await writeFile(options.write, `${JSON.stringify(snapshot, null, 2)}\n`)
  }
  process.stdout.write(options.json ? `${JSON.stringify(snapshot, null, 2)}\n` : formatHumanReport(snapshot))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
