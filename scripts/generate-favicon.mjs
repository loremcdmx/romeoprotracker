import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const OUT = 'public'
const SOURCE = `${OUT}/favicon.png`

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code}`))
    })
  })
}

async function resizePng(size, target) {
  try {
    await run('sips', ['-z', String(size), String(size), SOURCE, '--out', target])
  } catch (error) {
    await copyFile(SOURCE, target)
    console.warn(`Could not resize ${target}; copied source favicon instead.`)
  }
}

const png = await readFile(SOURCE)
const pngBase64 = png.toString('base64')

await resizePng(16, `${OUT}/favicon-16x16.png`)
await resizePng(32, `${OUT}/favicon-32x32.png`)
await resizePng(180, `${OUT}/apple-touch-icon.png`)
await writeFile(
  `${OUT}/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87 87"><image href="data:image/png;base64,${pngBase64}" width="87" height="87"/></svg>\n`,
)

console.log('Regenerated favicon set from Romeo avatar.')
console.log('favicon.ico is kept from the committed Romeo avatar asset.')
