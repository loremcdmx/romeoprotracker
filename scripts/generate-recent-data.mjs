#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRecentPosts } from './lib/recent-posts.mjs'

const modulePath = fileURLToPath(import.meta.url)
const root = resolve(dirname(modulePath), '..')

export async function generateRecentData(sourceDir = resolve(root, 'data')) {
  const [compactRaw, metaRaw] = await Promise.all([
    readFile(resolve(sourceDir, 'posts.min.json'), 'utf8'),
    readFile(resolve(sourceDir, 'meta.json'), 'utf8'),
  ])
  const recent = buildRecentPosts(JSON.parse(compactRaw), JSON.parse(metaRaw))
  await writeFile(resolve(sourceDir, 'posts.recent.min.json'), JSON.stringify(recent))
  return recent
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const recent = await generateRecentData()
  console.log(`Generated recent feed: ${recent.coverage.loadedPosts}/${recent.coverage.totalPosts} posts, ${recent.meta.brHistory?.length || 0} BR updates`)
}
