import assert from 'assert'

const {
  isSkippablePath,
  shouldSkipBuild,
} = await import('./vercel-ignore-build.mjs')

assert.equal(isSkippablePath('data/posts.json'), true)
assert.equal(isSkippablePath('data/posts.min.json'), true)
assert.equal(isSkippablePath('data/meta.json'), true)
assert.equal(isSkippablePath('data/leaderboards.json'), true)
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
  shouldSkipBuild(['data/leaderboards.json', '.github/workflows/leaderboards.yml']).skip,
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

console.log('PASS vercel ignore build policy')
