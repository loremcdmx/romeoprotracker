// ─── HELPERS ─────────────────────────────────────────────────────────────────
export function timeAgo(timestamp) {
  if (!timestamp) return null
  const sec  = Math.floor((Date.now() / 1000) - timestamp)
  if (sec < 60)   return 'только что'
  if (sec < 3600) return Math.floor(sec/60) + ' мин назад'
  if (sec < 86400) return Math.floor(sec/3600) + ' ч назад'
  if (sec < 2592000) return Math.floor(sec/86400) + ' дн назад'
  if (sec < 31536000) return Math.floor(sec/2592000) + ' мес назад'
  return Math.floor(sec/31536000) + ' г назад'
}

export const fmtBR = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  const s = n < 0 ? '-' : n > 0 ? '+' : ''
  if (abs >= 1_000_000) return s + '$' + (abs/1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return s + '$' + (abs/1_000).toFixed(1) + 'k'
  return s + '$' + abs
}

export const fmtNum = n => {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (abs/1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return '$' + (abs/1_000).toFixed(1) + 'k'
  return '$' + abs
}

// Целое число с тонким пробелом как разделитель тысяч
export const fmtInt = n => {
  if (n == null || n === '') return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')
}

// Точный формат БР до доллара
export const fmtExact = n => {
  if (!n && n !== 0) return '—'
  const rounded = Math.round(n)
  if (rounded >= 1000) return '$' + Math.floor(rounded / 1000) + '\u202F' + String(rounded % 1000).padStart(3, '0')
  return '$' + rounded
}

export function extractDay(text) {
  const m = text?.match(/(?:[Дд]ень|[Dd]ay)\s*#?\s*(\d+)/i)
  return m ? parseInt(m[1]) : null
}

export function extractBR(text) {
  if (!text) return null
  // "после сессии: 9957"
  const m1 = text.match(/(?:после сессии|бр после)[:\s]+(\d[\d\s,]+)/i)
  if (m1) { const n = parseInt(m1[1].replace(/[\s,]/g,'')); if (n > 500 && n < 10_000_000) return n }
  // "$9.9k" формат
  const m2 = text.match(/\$\s?([\d.]+)\s*[kK]/)
  if (m2) { const n = parseFloat(m2[1]) * 1000; if (n > 500 && n < 10_000_000) return n }
  // "банкролл 9957"
  const m3 = text.match(/(?:банкролл|бр)[^\d]{0,20}(\d{4,6})/i)
  if (m3) { const n = parseInt(m3[1]); if (n > 500 && n < 10_000_000) return n }
  return null
}

// Компактный формат числа со знаком (для P&L внутри компонентов)
export const fk = (n, withSign = true) => {
  const a = Math.abs(n)
  const s = withSign ? (n < 0 ? '-' : n > 0 ? '+' : '') : ''
  return a >= 1000 ? s + '$' + (a / 1000).toFixed(1) + 'k' : s + '$' + a
}

export const ROMEO_RE = /romeopro/i

export const autoCloseQuotes = t => {
  const open  = (t.match(/\[QUOTE\]/gi)||[]).length
  const close = (t.match(/\[\/QUOTE\]/gi)||[]).length
  return open > close ? t + '[/QUOTE]'.repeat(open - close) : t
}

// Общая утилита стриппинга цитат
export const stripQuoteTags = t => {
  if (!t) return ''
  let s = t.replace(/\[QUOTE\][\s\S]*?\[\/QUOTE\]/gi, '').replace(/\[\/QUOTE\]/gi, '').trim()
  const unclosed = s.indexOf('[QUOTE]')
  if (unclosed !== -1) s = s.slice(0, unclosed).trim()
  return s
}

export const extractQuoteBody = t => {
  if (!t) return ''
  const qs = t.indexOf('[QUOTE]')
  if (qs === -1) return ''
  const inner = t.slice(qs + 7)
  const nl = inner.indexOf('\n')
  return (nl !== -1 ? inner.slice(nl + 1) : inner).replace(/\[\/QUOTE\].*/,'').trim()
}

export const fkAbs = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Math.round(v)}`

// ─── BEZIER ──────────────────────────────────────────────────────────────────
export function makeBezierPath(coords, tension = 0.3) {
  if (coords.length < 2) return ''
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 1; i < coords.length; i++) {
    const p0 = coords[Math.max(0, i-2)], p1 = coords[i-1], p2 = coords[i], p3 = coords[Math.min(coords.length-1, i+1)]
    const cp1x = p1.x + (p2.x - p0.x) * tension, cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension, cp2y = p2.y - (p3.y - p1.y) * tension
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export function makeBezierArea(coords, baseline, tension = 0.3) {
  if (coords.length < 2) return ''
  let d = `M ${coords[0].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 1; i < coords.length; i++) {
    const p0 = coords[Math.max(0, i-2)], p1 = coords[i-1], p2 = coords[i], p3 = coords[Math.min(coords.length-1, i+1)]
    const cp1x = p1.x + (p2.x - p0.x) * tension, cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension, cp2y = p2.y - (p3.y - p1.y) * tension
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d + ` L ${coords[coords.length-1].x.toFixed(1)} ${baseline} Z`
}
