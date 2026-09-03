import { readFile } from 'node:fs/promises'
import { validateMarathonIntegrity } from './lib/marathon-integrity.mjs'
import { buildRecentPosts } from './lib/recent-posts.mjs'

const [postsRaw, metaRaw] = await Promise.all([
  readFile('data/posts.json', 'utf8'),
  readFile('data/meta.json', 'utf8'),
])

const posts = JSON.parse(postsRaw)
const meta = JSON.parse(metaRaw)
const { report, errors, warnings } = validateMarathonIntegrity({ posts, meta })

if (warnings.length) {
  for (const warning of warnings) console.log(`INFO data integrity: ${warning}`)
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL data integrity: ${error}`)
  process.exit(1)
}

console.log(
  `PASS data integrity: day ${report.metaDay}, ${report.brUpdateCount} BR updates, ${meta.totalTournaments} MTT`
)

const [compactRaw, recentRaw] = await Promise.all([
  readFile('data/posts.min.json', 'utf8'),
  readFile('data/posts.recent.min.json', 'utf8'),
])
const expectedRecent = buildRecentPosts(JSON.parse(compactRaw), meta)
if (recentRaw !== JSON.stringify(expectedRecent)) {
  console.error('FAIL recent feed: snapshot does not match current compact posts and complete metadata; run node scripts/generate-recent-data.mjs')
  process.exit(1)
}
console.log(`PASS recent feed: ${expectedRecent.coverage.loadedPosts}/${expectedRecent.coverage.totalPosts} posts, complete ${meta.brHistory.length}-entry BR history`)
