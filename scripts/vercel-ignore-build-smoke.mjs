import assert from 'assert'
import { execFileSync, spawnSync } from 'child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const {
  diffBase,
  isSkippablePath,
  shouldSkipBuild,
} = await import('./vercel-ignore-build.mjs')

assert.equal(isSkippablePath('data/posts.json'), true)
assert.equal(isSkippablePath('data/posts.min.json'), true)
assert.equal(isSkippablePath('data/meta.json'), true)
assert.equal(isSkippablePath('public/data/posts.min.json'), true)
assert.equal(isSkippablePath('.github/workflows/scrape.yml'), true)
assert.equal(isSkippablePath('README.md'), true)

assert.equal(isSkippablePath('src/App.jsx'), false)
assert.equal(isSkippablePath('index.html'), false)
assert.equal(isSkippablePath('package.json'), false)
assert.equal(isSkippablePath('vercel.json'), false)
assert.equal(isSkippablePath('/data/posts.json'), false)
assert.equal(isSkippablePath('../data/posts.json'), false)

assert.equal(
  shouldSkipBuild(['data/posts.json', 'data/posts.min.json', 'data/meta.json']).skip,
  true,
)
assert.equal(
  shouldSkipBuild(['data/posts.json', 'src/storage.js']).skip,
  false,
)
assert.equal(
  shouldSkipBuild(['data/posts.json'], { RPT_VERCEL_FORCE_BUILD: '1' }).skip,
  false,
)

const previousSha = 'a'.repeat(40)
const fetchedRefs = new Set()

assert.deepEqual(
  diffBase(
    { VERCEL_GIT_PREVIOUS_SHA: previousSha },
    (ref) => fetchedRefs.has(ref),
    (ref) => {
      fetchedRefs.add(ref)
      return true
    },
  ),
  { base: previousSha, source: 'fetched VERCEL_GIT_PREVIOUS_SHA' },
)

assert.deepEqual(
  diffBase(
    { VERCEL_GIT_PREVIOUS_SHA: previousSha },
    () => false,
    () => false,
  ),
  { base: '', source: 'missing VERCEL_GIT_PREVIOUS_SHA in shallow clone' },
)

// End-to-end cases against the real script in throwaway git repos. The script
// resolves its repo from its own location, so a copy goes into each repo.
const scriptSource = join(dirname(fileURLToPath(import.meta.url)), 'vercel-ignore-build.mjs')

// Inherited GIT_DIR / GIT_INDEX_FILE (set when this runs from a git hook)
// would point git at the real repository instead of the throwaway one.
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
    && key !== 'VERCEL_GIT_PREVIOUS_SHA' && key !== 'RPT_VERCEL_FORCE_BUILD'),
)

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: baseEnv },
  ).trim()
}

function write(cwd, path, text) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true })
  writeFileSync(join(cwd, path), text)
}

function commit(cwd, message) {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
}

// Returns 'skip' (exit 0) or 'build' (exit 1) as Vercel would see it.
function runIgnoreStep(cwd, env = {}) {
  const result = spawnSync(process.execPath, ['scripts/vercel-ignore-build.mjs'], {
    cwd,
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
  })
  assert.ok(result.status === 0 || result.status === 1, `unexpected exit ${result.status}: ${result.stderr}`)
  return result.status === 0 ? 'skip' : 'build'
}

// Each case starts from the same deployed commit; `change` makes the commits
// to be judged. `previous` is what Vercel passes as VERCEL_GIT_PREVIOUS_SHA:
// the deployed commit, nothing, or a literal SHA.
function ignoreCase(name, expected, change, { previous = 'deployed' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'rpt-ignore-smoke-'))
  try {
    git(cwd, 'init', '-q')
    mkdirSync(join(cwd, 'scripts'), { recursive: true })
    copyFileSync(scriptSource, join(cwd, 'scripts', 'vercel-ignore-build.mjs'))
    write(cwd, 'src/App.jsx', 'export default 1\n')
    write(cwd, 'src/legacy.js', 'export const legacy = 1\n')
    write(cwd, 'public/promo.png', 'PNG\n')
    write(cwd, 'data/meta.json', '{}\n')
    write(cwd, 'data/old.json', '{}\n')
    write(cwd, 'README.md', 'readme\n')
    commit(cwd, 'deployed')
    const deployed = git(cwd, 'rev-parse', 'HEAD')
    change(cwd)
    const sha = previous === 'deployed' ? deployed : previous
    const actual = runIgnoreStep(cwd, sha === 'none' ? {} : { VERCEL_GIT_PREVIOUS_SHA: sha })
    return actual === expected ? null : `${name}: expected ${expected}, got ${actual}`
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const dataCommit = (cwd, n = 1) => {
  write(cwd, 'data/meta.json', `{"n":${n}}\n`)
  commit(cwd, `scraper: ${n}`)
}

// Without VERCEL_GIT_PREVIOUS_SHA there is no way to know what was last
// deployed, so there must be no diff base at all (fail open), not HEAD^.
const noPreviousBase = diffBase({}, () => true, () => true)

const failures = [
  noPreviousBase.base === ''
    ? null
    : `no previous SHA must give no diff base, got ${noPreviousBase.base}`,
  // Existing behaviour: data/docs-only changes since the deployed commit skip.
  ignoreCase('data-only commits skip', 'skip', (cwd) => { dataCommit(cwd, 1); dataCommit(cwd, 2) }),
  ignoreCase('data + README skip', 'skip', (cwd) => {
    write(cwd, 'data/meta.json', '{"n":3}\n')
    write(cwd, 'README.md', 'changed\n')
    commit(cwd, 'data and docs')
  }),
  ignoreCase('src change builds', 'build', (cwd) => {
    write(cwd, 'src/App.jsx', 'export default 2\n')
    commit(cwd, 'code')
  }),
  // Deleted and renamed files: a build-relevant path leaving the tree counts.
  ignoreCase('deleted public asset + data change builds', 'build', (cwd) => {
    git(cwd, 'rm', '-q', 'public/promo.png')
    write(cwd, 'data/meta.json', '{"n":4}\n')
    commit(cwd, 'delete asset and update data')
  }),
  ignoreCase('src file moved into docs/ builds', 'build', (cwd) => {
    mkdirSync(join(cwd, 'docs'), { recursive: true })
    git(cwd, 'mv', 'src/legacy.js', 'docs/legacy.js')
    commit(cwd, 'move code to docs')
  }),
  ignoreCase('deleted src file + README change builds', 'build', (cwd) => {
    git(cwd, 'rm', '-q', 'src/legacy.js')
    write(cwd, 'README.md', 'changed\n')
    commit(cwd, 'delete code and update docs')
  }),
  ignoreCase('deleted data file + rename inside data/ skip', 'skip', (cwd) => {
    git(cwd, 'rm', '-q', 'data/old.json')
    git(cwd, 'mv', 'data/meta.json', 'data/meta2.json')
    commit(cwd, 'data housekeeping')
  }),
  // No VERCEL_GIT_PREVIOUS_SHA: fail open instead of judging only HEAD^..HEAD.
  ignoreCase('no previous SHA: src change then docs-only tip builds', 'build', (cwd) => {
    write(cwd, 'src/App.jsx', 'export default 5\n')
    commit(cwd, 'code, never deployed')
    write(cwd, 'README.md', 'changelog\n')
    commit(cwd, 'docs')
  }, { previous: 'none' }),
  ignoreCase('no previous SHA: data-only tip builds (fail open)', 'build', (cwd) => dataCommit(cwd, 6),
    { previous: 'none' }),
  // A previous SHA that is not in the clone and cannot be fetched fails open.
  ignoreCase('unreachable previous SHA builds', 'build', (cwd) => dataCommit(cwd, 7),
    { previous: 'b'.repeat(40) }),
].filter(Boolean)

assert.deepEqual(failures, [], `vercel ignore build cases failed:\n${failures.join('\n')}`)

console.log('PASS vercel ignore build policy')
