import { readFile } from 'node:fs/promises'
import { validateMarathonIntegrity } from './lib/marathon-integrity.mjs'

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
