const VALID_MODES = new Set(['normal', 'full', 'reextract', 'translate'])

function isTruthy(value) {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function parseScrapeOptions(argv = [], env = process.env) {
  let mode = env.SCRAPE_MODE || 'normal'
  let dryRun = isTruthy(env.SCRAPE_DRY_RUN) || isTruthy(env.DRY_RUN)
  let noPush = isTruthy(env.SCRAPE_NO_PUSH) || isTruthy(env.NO_PUSH)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--no-push') {
      noPush = true
      continue
    }
    if (arg === '--mode') {
      const next = argv[i + 1]
      if (!next) throw new Error('Missing value for --mode')
      mode = next
      i++
      continue
    }
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length)
    }
  }

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid scrape mode "${mode}". Expected one of: ${[...VALID_MODES].join(', ')}`)
  }

  return {
    mode,
    dryRun,
    noPush: noPush || dryRun,
  }
}
