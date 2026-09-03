#!/usr/bin/env node

import { copyFile, mkdir, rm } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { generateRecentData } from './generate-recent-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sourceDir = resolve(root, 'data')
const targetDir = resolve(root, 'public', 'data')
// posts.json (full payload) is NOT baked into the deploy: the client loads the
// compact posts.min.json, and raw.githubusercontent still serves posts.json as a
// fallback. Keeps the deploy artifact ~7MB smaller.
const files = ['meta.json', 'posts.min.json', 'posts.recent.min.json']

// Rebuild deterministically so local dev/build also works after data updates
// from older scraper revisions that did not yet publish the recent snapshot.
await generateRecentData(sourceDir)

// Start clean so a previously-synced file (e.g. an old posts.json) can't linger.
await rm(targetDir, { recursive: true, force: true })
await mkdir(targetDir, { recursive: true })

for (const name of files) {
  await copyFile(resolve(sourceDir, name), resolve(targetDir, name))
}

console.log(`Synced ${files.length} data file(s) to public/data`)
