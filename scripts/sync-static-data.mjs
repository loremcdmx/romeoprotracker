#!/usr/bin/env node

import { copyFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sourceDir = resolve(root, 'data')
const targetDir = resolve(root, 'public', 'data')
const files = ['meta.json', 'posts.min.json', 'posts.json', 'leaderboards.json']

await mkdir(targetDir, { recursive: true })

for (const name of files) {
  await copyFile(resolve(sourceDir, name), resolve(targetDir, name))
}

console.log(`Synced ${files.length} data file(s) to public/data`)
