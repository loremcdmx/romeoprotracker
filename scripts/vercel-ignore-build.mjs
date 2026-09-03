import { execFileSync } from 'child_process'
import { dirname, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SKIPPABLE_FILES = new Set([
  'CHANGELOG.md',
  'CLAUDE.md',
  'IDEAS.md',
  'README.md',
])

const SKIPPABLE_PREFIXES = [
  '.github/',
  'data/',
  'docs/',
  'public/data/',
]

function normalizePath(path) {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
}

export function isSkippablePath(path) {
  const normalized = normalizePath(path)
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/')) {
    return false
  }
  if (SKIPPABLE_FILES.has(normalized)) return true
  return SKIPPABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function shouldSkipBuild(changedFiles, env = process.env) {
  if (env.RPT_VERCEL_FORCE_BUILD === '1') {
    return { skip: false, reason: 'RPT_VERCEL_FORCE_BUILD=1' }
  }

  const files = [...new Set((changedFiles || []).map(normalizePath).filter(Boolean))]
  if (files.length === 0) {
    return { skip: false, reason: 'no changed files detected' }
  }

  const buildRelevantFiles = files.filter((file) => !isSkippablePath(file))
  if (buildRelevantFiles.length > 0) {
    return {
      skip: false,
      reason: `build-relevant files changed: ${buildRelevantFiles.join(', ')}`,
    }
  }

  return {
    skip: true,
    reason: `only build-irrelevant files changed: ${files.join(', ')}`,
  }
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function commitExists(ref) {
  try {
    runGit(['cat-file', '-e', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function looksLikeGitSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(String(ref || '').trim())
}

function fetchCommit(ref) {
  if (!looksLikeGitSha(ref)) {
    return false
  }

  try {
    runGit(['fetch', '--depth=1', 'origin', ref])
    return commitExists(ref)
  } catch {
    return false
  }
}

export function diffBase(env = process.env, exists = commitExists, fetchMissing = fetchCommit) {
  const previousSha = env.VERCEL_GIT_PREVIOUS_SHA || ''
  if (previousSha) {
    if (exists(previousSha)) {
      return { base: previousSha, source: 'VERCEL_GIT_PREVIOUS_SHA' }
    }
    if (fetchMissing(previousSha) && exists(previousSha)) {
      return { base: previousSha, source: 'fetched VERCEL_GIT_PREVIOUS_SHA' }
    }
    return {
      base: '',
      source: 'missing VERCEL_GIT_PREVIOUS_SHA in shallow clone',
    }
  }

  if (exists('HEAD^')) {
    return { base: 'HEAD^', source: 'HEAD^' }
  }

  return { base: '', source: 'no diff base' }
}

export function changedFiles(env = process.env) {
  const base = diffBase(env)
  if (!base.base) {
    return { ok: false, files: [], source: base.source }
  }

  const output = runGit([
    'diff',
    '--name-only',
    '--diff-filter=ACMRTUXB',
    base.base,
    'HEAD',
    '--',
  ])

  return {
    ok: true,
    files: output.split(/\r?\n/).filter(Boolean),
    source: base.source,
  }
}

function printDecision(decision, files, source) {
  const action = decision.skip ? 'skip' : 'build'
  const normalizedFiles = files.map(normalizePath).join(', ') || '(none)'
  console.log(`[vercel-ignore] action=${action}`)
  console.log(`[vercel-ignore] reason=${decision.reason}`)
  console.log(`[vercel-ignore] diff=${source}`)
  console.log(`[vercel-ignore] files=${normalizedFiles}`)
}

function main() {
  let diff
  try {
    diff = changedFiles()
  } catch (error) {
    console.log('[vercel-ignore] action=build')
    console.log(`[vercel-ignore] reason=git diff failed: ${error.message}`)
    process.exit(1)
  }

  if (!diff.ok) {
    // Deliberately fail OPEN: an occasional build on a data-only commit is
    // what keeps the same-origin /data copy from going stale indefinitely
    // (a commit-message skip was tried in 1.13.5 and reverted in 1.13.6).
    const decision = {
      skip: false,
      reason: `cannot safely determine changed files: ${diff.source}`,
    }
    printDecision(decision, diff.files, diff.source)
    process.exit(1)
  }

  const decision = shouldSkipBuild(diff.files)
  printDecision(decision, diff.files, diff.source)
  process.exit(decision.skip ? 0 : 1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]).split(sep).join('/') : ''
const modulePath = fileURLToPath(import.meta.url).split(sep).join('/')

if (invokedPath === modulePath) {
  main()
}
