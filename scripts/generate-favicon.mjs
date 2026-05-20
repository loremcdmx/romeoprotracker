import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const OUT = 'public'

const clamp = v => Math.max(0, Math.min(1, v))
const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t))
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function hex(hex) {
  const raw = hex.replace('#', '')
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ]
}

function blend(dst, src, alpha) {
  const a = clamp(alpha)
  const inv = 1 - a
  dst[0] = Math.round(src[0] * a + dst[0] * inv)
  dst[1] = Math.round(src[1] * a + dst[1] * inv)
  dst[2] = Math.round(src[2] * a + dst[2] * inv)
  dst[3] = Math.round((a + dst[3] / 255 * inv) * 255)
}

function roundedRectAlpha(x, y, radius) {
  const px = Math.abs(x - 0.5) - (0.5 - radius)
  const py = Math.abs(y - 0.5) - (0.5 - radius)
  const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0))
  const inside = Math.min(Math.max(px, py), 0)
  return outside + inside - radius
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const len = vx * vx + vy * vy
  const t = len ? clamp((wx * vx + wy * vy) / len) : 0
  const x = ax + vx * t
  const y = ay + vy * t
  return Math.hypot(px - x, py - y)
}

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ -1) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuf = Buffer.from(type)
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  typeBuf.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length)
  return out
}

function pngEncode(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ])
}

function renderIcon(size) {
  const data = Buffer.alloc(size * size * 4)
  const bgA = hex('#151819')
  const bgB = hex('#070809')
  const red = hex('#e53935')
  const gold = hex('#ffb300')
  const green = hex('#7ee787')
  const mint = hex('#c8ffd1')
  const cream = hex('#fff3dc')
  const linePoints = [
    [0.17, 0.66],
    [0.33, 0.64],
    [0.46, 0.52],
    [0.58, 0.57],
    [0.74, 0.34],
    [0.84, 0.30],
  ]
  const aa = 1.6 / size
  const radius = 0.185
  const lineWidth = Math.max(1.8 / size, 0.083)
  const glowWidth = lineWidth * 2.7

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size
      const ny = (y + 0.5) / size
      const idx = (y * size + x) * 4
      const px = [0, 0, 0, 0]

      const rectD = roundedRectAlpha(nx, ny, radius)
      const rectAlpha = 1 - smoothstep(-aa, aa, rectD)
      if (rectAlpha > 0) {
        const bg = mix(bgA, bgB, clamp((nx * 0.55 + ny * 0.85)))
        blend(px, bg, rectAlpha)

        const greenWash = Math.max(0, 1 - Math.hypot(nx - 0.76, ny - 0.32) / 0.55)
        blend(px, green, rectAlpha * greenWash * 0.12)
        const redWash = Math.max(0, 1 - Math.hypot(nx - 0.24, ny - 0.68) / 0.42)
        blend(px, red, rectAlpha * redWash * 0.10)
      }

      const border = 1 - smoothstep(0.010, 0.030, Math.abs(rectD))
      if (border > 0 && rectD < 0.028) {
        blend(px, mix(red, gold, clamp(nx * 0.9 + ny * 0.1)), rectAlpha * border * 0.95)
      }

      const innerLine = Math.abs(ny - 0.735)
      if (nx > 0.15 && nx < 0.87 && innerLine < 0.006) {
        blend(px, [255, 255, 255], rectAlpha * 0.13)
      }

      let distance = 9
      for (let i = 0; i < linePoints.length - 1; i++) {
        const a = linePoints[i]
        const b = linePoints[i + 1]
        distance = Math.min(distance, distPointToSegment(nx, ny, a[0], a[1], b[0], b[1]))
      }
      const glow = 1 - smoothstep(lineWidth, glowWidth, distance)
      if (glow > 0) blend(px, green, rectAlpha * glow * 0.28)

      const line = 1 - smoothstep(lineWidth * 0.72, lineWidth, distance)
      if (line > 0) {
        const t = clamp((nx - 0.18) / 0.66)
        blend(px, mix(cream, mint, t), rectAlpha * line)
      }

      const start = Math.hypot(nx - linePoints[0][0], ny - linePoints[0][1])
      const startDot = 1 - smoothstep(0.045, 0.060, start)
      if (startDot > 0) blend(px, red, rectAlpha * startDot * 0.92)

      const end = Math.hypot(nx - linePoints.at(-1)[0], ny - linePoints.at(-1)[1])
      const endGlow = 1 - smoothstep(0.080, 0.145, end)
      if (endGlow > 0) blend(px, green, rectAlpha * endGlow * 0.30)
      const endDot = 1 - smoothstep(0.052, 0.068, end)
      if (endDot > 0) blend(px, green, rectAlpha * endDot)
      const endCore = 1 - smoothstep(0.020, 0.032, end)
      if (endCore > 0) blend(px, [10, 15, 12], rectAlpha * endCore * 0.72)

      data[idx] = px[0]
      data[idx + 1] = px[1]
      data[idx + 2] = px[2]
      data[idx + 3] = px[3]
    }
  }
  return pngEncode(size, size, data)
}

function icoEncode(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size === 256 ? 0 : image.size
    entry[1] = image.size === 256 ? 0 : image.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.png.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map(image => image.png)])
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
      <stop stop-color="#171a1b"/>
      <stop offset="1" stop-color="#070809"/>
    </linearGradient>
    <linearGradient id="edge" x1="7" y1="12" x2="56" y2="54" gradientUnits="userSpaceOnUse">
      <stop stop-color="#e53935"/>
      <stop offset=".62" stop-color="#ffb300"/>
      <stop offset="1" stop-color="#7ee787"/>
    </linearGradient>
    <linearGradient id="line" x1="10" y1="42" x2="54" y2="18" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff1db"/>
      <stop offset="1" stop-color="#bfffc9"/>
    </linearGradient>
    <filter id="glow" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="2.4" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.49 0 0 0 0 0.91 0 0 0 0 0.53 0 0 0 .52 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="12" fill="url(#bg)"/>
  <rect x="4.8" y="4.8" width="54.4" height="54.4" rx="11.2" fill="none" stroke="url(#edge)" stroke-width="2.4"/>
  <path d="M10.5 47.5H54" stroke="white" stroke-opacity=".12" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M11 42.5 C18 43.2 22.5 42.6 28.3 35.7 C33.7 29.1 37.4 40.8 42 32.2 C45.2 26.1 47.8 21.3 54 19" fill="none" stroke="#7ee787" stroke-opacity=".36" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="M11 42.5 C18 43.2 22.5 42.6 28.3 35.7 C33.7 29.1 37.4 40.8 42 32.2 C45.2 26.1 47.8 21.3 54 19" fill="none" stroke="url(#line)" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="11" cy="42.5" r="4.3" fill="#e53935"/>
  <circle cx="54" cy="19" r="6" fill="#7ee787"/>
  <circle cx="54" cy="19" r="2.3" fill="#09100b"/>
</svg>
`

await writeFile(`${OUT}/favicon.svg`, svg)
const png16 = renderIcon(16)
const png32 = renderIcon(32)
const png48 = renderIcon(48)
const png180 = renderIcon(180)
const png512 = renderIcon(512)
await writeFile(`${OUT}/favicon-16x16.png`, png16)
await writeFile(`${OUT}/favicon-32x32.png`, png32)
await writeFile(`${OUT}/apple-touch-icon.png`, png180)
await writeFile(`${OUT}/favicon.png`, png512)
await writeFile(`${OUT}/favicon.ico`, icoEncode([
  { size: 16, png: png16 },
  { size: 32, png: png32 },
  { size: 48, png: png48 },
]))
